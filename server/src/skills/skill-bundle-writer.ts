import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { rewriteCkReferences } from './skill-name-transform.js';

// Filtered, transformed copy of skill/agent/rule sources into the cf-plugin
// bundle, plus the cf-manifest.json bookkeeping. This is the WRITE side of the
// skills subsystem — deliberately separate from readers/skill-catalog-reader.ts,
// whose read-only contract stays intact. Every destination path is confined to
// the bundle dir; every source read is bounded; oversized content is skipped
// and recorded as truncated rather than thrown.

const EXCLUDED_DIRS = new Set(['node_modules', '.venv', '.git', '__pycache__', 'dist', 'assets']);
const MAX_FILE_BYTES = 512 * 1024; // any single file bigger than this is skipped
const MAX_ENTRY_BYTES = 2 * 1024 * 1024; // per-skill budget; remainder skipped + flagged

export type BundleKind = 'skills' | 'agents' | 'rules' | 'hooks' | 'output-styles';
export type ProvenanceKind = 'upstream' | 'global' | 'project' | 'local' | 'github';

export interface ManifestEntry {
  name: string;
  origin: ProvenanceKind;
  /** Source path or owner/repo ref the entry came from. */
  source: string;
  syncedAt: string;
  files: number;
  bytes: number;
  /** sha256 over the sorted `relPath:sha256(content)` lines — drift detector. */
  filesHash: string;
  truncated?: boolean;
}

export interface CfManifest {
  upstream?: { repo: string; tag: string; commit: string; syncedAt: string };
  entries: Partial<Record<BundleKind, ManifestEntry[]>>;
}

export interface CopyResult {
  files: number;
  bytes: number;
  filesHash: string;
  truncated: boolean;
}

export interface CopyDirOptions {
  srcDir: string;
  destDir: string;
  /** Renamed base names for the `ck-<name>` → `<name>` text rewrite. */
  renamed: ReadonlySet<string>;
  /** Rewrite /ck: references in .md files (false for verbatim kinds like hooks). */
  transformMd: boolean;
}

/** Copy one source dir into the bundle with filters + transforms. */
export async function copyDirIntoBundle({ srcDir, destDir, renamed, transformMd }: CopyDirOptions): Promise<CopyResult> {
  const hashLines: string[] = [];
  const state = { files: 0, bytes: 0, truncated: false };
  await copyTree(srcDir, destDir, '', { renamed, transformMd, hashLines, state });
  hashLines.sort();
  return { ...state, filesHash: sha256(hashLines.join('\n')) };
}

interface WalkContext {
  renamed: ReadonlySet<string>;
  transformMd: boolean;
  hashLines: string[];
  state: { files: number; bytes: number; truncated: boolean };
}

async function copyTree(srcDir: string, destDir: string, rel: string, ctx: WalkContext): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(path.join(srcDir, rel), { withFileTypes: true });
  } catch {
    return; // unreadable dir — contribute nothing rather than fail the sync
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : 1)); // deterministic walk ⇒ stable filesHash
  for (const entry of entries) {
    const relPath = rel ? path.join(rel, entry.name) : entry.name;
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      await copyTree(srcDir, destDir, relPath, ctx);
      continue;
    }
    if (!entry.isFile()) continue; // symlinks in source trees are never followed
    if (ctx.state.truncated) continue;
    await copyOneFile(path.join(srcDir, relPath), path.join(destDir, relPath), relPath, ctx);
  }
}

async function copyOneFile(srcFile: string, destFile: string, relPath: string, ctx: WalkContext): Promise<void> {
  let stat;
  try {
    stat = await fs.stat(srcFile);
  } catch {
    return;
  }
  if (stat.size > MAX_FILE_BYTES) return; // oversized single file — silently filtered by design
  if (ctx.state.bytes + stat.size > MAX_ENTRY_BYTES) {
    ctx.state.truncated = true; // budget exhausted — flag, keep what we have
    return;
  }
  let content: Buffer | string;
  try {
    content = await fs.readFile(srcFile);
  } catch {
    return;
  }
  if (ctx.transformMd && relPath.toLowerCase().endsWith('.md')) {
    content = rewriteCkReferences(content.toString('utf8'), ctx.renamed);
  }
  await fs.mkdir(path.dirname(destFile), { recursive: true });
  await fs.writeFile(destFile, content);
  const bytes = typeof content === 'string' ? Buffer.byteLength(content) : content.length;
  ctx.state.files += 1;
  ctx.state.bytes += bytes;
  ctx.hashLines.push(`${relPath}:${sha256(content)}`);
}

// --- manifest ---

const MANIFEST_FILE = 'cf-manifest.json';

export async function readManifest(bundleDir: string): Promise<CfManifest> {
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(bundleDir, MANIFEST_FILE), 'utf8')) as CfManifest;
    return parsed && typeof parsed === 'object' && parsed.entries ? parsed : { entries: {} };
  } catch {
    return { entries: {} };
  }
}

export async function writeManifest(bundleDir: string, manifest: CfManifest): Promise<void> {
  await fs.mkdir(bundleDir, { recursive: true });
  await fs.writeFile(path.join(bundleDir, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
}

/** Upsert one entry (keyed by kind+name) into a manifest, in place. */
export function upsertManifestEntry(manifest: CfManifest, kind: BundleKind, entry: ManifestEntry): void {
  const list = manifest.entries[kind] ?? (manifest.entries[kind] = []);
  const idx = list.findIndex((e) => e.name === entry.name);
  if (idx >= 0) list[idx] = entry;
  else list.push(entry);
}

/**
 * Remove one skill dir from the bundle + its manifest entry. The name is
 * validated to a plain dir-name shape and the resolved path must stay inside
 * `<bundleDir>/skills` — a crafted name can never escape the bundle.
 */
export async function removeSkillFromBundle(bundleDir: string, name: string): Promise<boolean> {
  if (!isSafeSkillName(name)) return false;
  const skillsDir = path.join(bundleDir, 'skills');
  const target = path.resolve(skillsDir, name);
  // Equal-to-root would rm the whole skills dir — reject it along with escapes.
  if (target === skillsDir || !target.startsWith(skillsDir + path.sep)) return false;
  try {
    await fs.rm(target, { recursive: true, force: false });
  } catch {
    return false;
  }
  const manifest = await readManifest(bundleDir);
  manifest.entries.skills = (manifest.entries.skills ?? []).filter((e) => e.name !== name);
  await writeManifest(bundleDir, manifest);
  return true;
}

// Plain dir-name shape: starts with a word char, then word chars/dots/dashes.
// No slashes and no leading dot ⇒ can never traverse or hide as a dotfile.
export function isSafeSkillName(name: string): boolean {
  return /^[\w][\w.-]*$/.test(name);
}

function sha256(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

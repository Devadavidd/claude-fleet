import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { downloadTarball, extractTarball, assertRepoSlug } from './upstream-release-fetcher.js';
import { copyDirIntoBundle, readManifest, writeManifest, upsertManifestEntry, isSafeSkillName } from './skill-bundle-writer.js';

// Two-step install of external skills into the cf bundle: PREVIEW stages the
// source (local dir as-is; GitHub ref downloaded to a temp dir) and lists the
// skills found, CONFIRM copies only the lead-chosen names into cf-plugin.
// The gap between the steps is the security review point — an installed skill
// later runs inside bypassPermissions sessions, so nothing is ever installed
// sight-unseen. Installed dirs keep their original names; their .md files
// still get the /ck:→/cf: reference rewrite (renames set is empty).

const PREVIEW_TTL_MS = 10 * 60_000;
const MAX_PREVIEWS = 5;
const MAX_DISCOVERY_DEPTH = 3;
const MAX_DISCOVERED = 100;
const DESC_READ_BYTES = 4 * 1024;

export interface DiscoveredSkill {
  name: string;
  desc: string;
  /** Absolute dir of the skill source (inside temp extract for github). */
  dir: string;
}

export interface PreviewRecord {
  id: string;
  kind: 'local' | 'github';
  source: string;
  skills: DiscoveredSkill[];
  createdAt: number;
  /** Temp dir to remove when the preview is consumed/expired (github only). */
  tempDir?: string;
}

export class SkillInstallService {
  private readonly previews = new Map<string, PreviewRecord>();

  /** Preview a local directory (a skill dir itself, or a folder of skills). */
  async previewLocalPath(requested: string): Promise<PreviewRecord> {
    const real = await fs.realpath(path.resolve(requested)); // throws → caller 400s
    if (!(await fs.stat(real)).isDirectory()) throw new Error('path is not a directory');
    const skills = await discoverSkillDirs(real);
    if (!skills.length) throw new Error('no SKILL.md found under that path');
    return this.#store({ kind: 'local', source: real, skills });
  }

  /** Preview `owner/repo[#subpath]` — default-branch tarball via gh. */
  async previewGithub(ref: string, tmpRoot = os.tmpdir()): Promise<PreviewRecord> {
    const match = /^([\w.-]+\/[\w.-]+)(?:#([\w./-]+))?$/.exec(ref.trim());
    if (!match) throw new Error('ref must look like owner/repo or owner/repo#subpath');
    const [, repo, subpath] = match;
    assertRepoSlug(repo);
    if (subpath && subpath.split('/').some((seg) => seg === '..' || seg === '')) throw new Error('invalid subpath');
    const tempDir = await fs.mkdtemp(path.join(tmpRoot, 'cf-install-'));
    try {
      const tarFile = path.join(tempDir, 'src.tar.gz');
      await downloadTarball(repo, 'HEAD', tarFile);
      const { root } = await extractTarball(tarFile, tempDir);
      const searchRoot = subpath ? path.resolve(root, subpath) : root;
      if (searchRoot !== root && !searchRoot.startsWith(root + path.sep)) throw new Error('invalid subpath');
      const skills = await discoverSkillDirs(searchRoot);
      if (!skills.length) throw new Error('no SKILL.md found in that repo/subpath');
      return this.#store({ kind: 'github', source: ref.trim(), skills, tempDir });
    } catch (err) {
      await fs.rm(tempDir, { recursive: true, force: true });
      throw err;
    }
  }

  /** Copy the chosen previewed skills into the bundle; consumes the preview. */
  async confirm(
    previewId: string,
    names: readonly string[],
    bundleDir: string,
  ): Promise<{ installed: string[]; skipped: string[] }> {
    const record = this.#take(previewId);
    if (!record) throw new Error('preview expired or unknown — run preview again');
    try {
      const chosen = record.skills.filter((s) => names.includes(s.name));
      if (!chosen.length) throw new Error('none of the requested names are in the preview');
      const manifest = await readManifest(bundleDir);
      const syncedAt = new Date().toISOString();
      const installed: string[] = [];
      const skipped: string[] = [];
      for (const skill of chosen) {
        // Unsafe dir names are reported, never silently dropped — the modal
        // must not tell the lead something installed when it didn't.
        if (!isSafeSkillName(skill.name)) {
          skipped.push(skill.name);
          continue;
        }
        const destDir = path.resolve(bundleDir, 'skills', skill.name);
        if (!destDir.startsWith(path.resolve(bundleDir, 'skills') + path.sep)) {
          skipped.push(skill.name);
          continue;
        }
        await fs.rm(destDir, { recursive: true, force: true }); // re-install = replace
        const result = await copyDirIntoBundle({ srcDir: skill.dir, destDir, renamed: new Set(), transformMd: true });
        upsertManifestEntry(manifest, 'skills', {
          name: skill.name,
          origin: record.kind,
          source: record.source,
          syncedAt,
          files: result.files,
          bytes: result.bytes,
          filesHash: result.filesHash,
          ...(result.truncated ? { truncated: true } : {}),
        });
        installed.push(skill.name);
      }
      await writeManifest(bundleDir, manifest);
      return { installed, skipped };
    } finally {
      if (record.tempDir) await fs.rm(record.tempDir, { recursive: true, force: true });
    }
  }

  #store(partial: Omit<PreviewRecord, 'id' | 'createdAt'>): PreviewRecord {
    this.#sweep();
    // Oldest preview is evicted (and its temp dir cleaned) once the cap hits.
    while (this.previews.size >= MAX_PREVIEWS) {
      const oldest = this.previews.keys().next().value;
      if (oldest === undefined) break;
      this.#evict(oldest);
    }
    const record: PreviewRecord = { ...partial, id: randomUUID(), createdAt: Date.now() };
    this.previews.set(record.id, record);
    return record;
  }

  #take(id: string): PreviewRecord | null {
    this.#sweep();
    const record = this.previews.get(id) ?? null;
    if (record) this.previews.delete(record.id);
    return record;
  }

  #sweep(): void {
    const cutoff = Date.now() - PREVIEW_TTL_MS;
    for (const [id, record] of this.previews) if (record.createdAt < cutoff) this.#evict(id);
  }

  #evict(id: string): void {
    const record = this.previews.get(id);
    this.previews.delete(id);
    if (record?.tempDir) void fs.rm(record.tempDir, { recursive: true, force: true });
  }
}

/** Find dirs containing SKILL.md: the root itself or descendants (bounded). */
export async function discoverSkillDirs(root: string, depth = 0): Promise<DiscoveredSkill[]> {
  if (depth > MAX_DISCOVERY_DEPTH) return [];
  const out: DiscoveredSkill[] = [];
  const skillMd = path.join(root, 'SKILL.md');
  try {
    // lstat: a symlinked SKILL.md in a hostile previewed repo must not lead the
    // description reader to an arbitrary host file.
    if ((await fs.lstat(skillMd)).isFile()) {
      return [{ name: path.basename(root), desc: await readDescription(skillMd), dir: root }];
    }
  } catch {
    /* not a skill dir itself — search children */
  }
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (out.length >= MAX_DISCOVERED) break;
    if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    out.push(...(await discoverSkillDirs(path.join(root, entry.name), depth + 1)));
  }
  return out.slice(0, MAX_DISCOVERED);
}

async function readDescription(skillMdPath: string): Promise<string> {
  try {
    const handle = await fs.open(skillMdPath, 'r');
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(DESC_READ_BYTES), 0, DESC_READ_BYTES, 0);
    await handle.close();
    const text = buffer.subarray(0, bytesRead).toString('utf8');
    const desc = /^description:\s*(.+)$/m.exec(text)?.[1] ?? '';
    return desc.trim().replace(/^['"]|['"]$/g, '').slice(0, 200);
  } catch {
    return '';
  }
}

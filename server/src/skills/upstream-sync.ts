import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  fetchLatestRelease,
  downloadTarball,
  extractTarball,
  assertTag,
  type GhExecFn,
  type UpstreamRelease,
} from './upstream-release-fetcher.js';
import {
  copyDirIntoBundle,
  readManifest,
  writeManifest,
  upsertManifestEntry,
  type CfManifest,
  type BundleKind,
} from './skill-bundle-writer.js';
import { buildSkillRenames, renamedBaseNames } from './skill-name-transform.js';

// Orchestrates "pull ClaudeKit upstream → transform → swap into cf-plugin/".
// The bundle is built in a sibling `.staging` dir and atomically swapped in
// only on full success, so a failed sync can never leave a half-written
// bundle. Verification = release-tag pin + the tarball's commit suffix
// recorded in the manifest + self-computed content hashes per entry (upstream
// ships no per-file checksums — its metadata.json is a deletions list).

const PAYLOAD_DIR = 'claude'; // upstream repo keeps the ~/.claude payload here

// .md-bearing kinds get the /ck:→/cf: rewrite; hooks are scripts, copied verbatim.
const SYNC_KINDS: ReadonlyArray<{ kind: BundleKind; transformMd: boolean }> = [
  { kind: 'agents', transformMd: true },
  { kind: 'rules', transformMd: true },
  { kind: 'output-styles', transformMd: true },
  { kind: 'hooks', transformMd: false },
];

export interface SyncDeps {
  ghExec?: GhExecFn;
  download?: typeof downloadTarball;
  extract?: typeof extractTarball;
}

export interface CheckResult {
  current: string;
  latest: string;
  prerelease: boolean;
  publishedAt: string;
  upToDate: boolean;
}

export interface SyncSummary {
  tag: string;
  commit: string;
  skills: number;
  agents: number;
  rules: number;
  hooks: number;
  outputStyles: number;
  truncated: string[];
  /** Operator-installed skills (origin ≠ upstream) carried over from the previous bundle. */
  preserved: string[];
}

export async function checkUpstream(
  { repo, bundleDir }: { repo: string; bundleDir: string },
  { ghExec }: SyncDeps = {},
): Promise<CheckResult> {
  const [release, manifest] = await Promise.all([fetchLatestRelease(repo, ghExec), readManifest(bundleDir)]);
  const current = manifest.upstream?.tag ?? '';
  return {
    current,
    latest: release.tag,
    prerelease: release.prerelease,
    publishedAt: release.publishedAt,
    upToDate: current === release.tag,
  };
}

export async function syncUpstream(
  { repo, tag, bundleDir, tmpRoot = os.tmpdir() }: { repo: string; tag?: string; bundleDir: string; tmpRoot?: string },
  { ghExec, download = downloadTarball, extract = extractTarball }: SyncDeps = {},
): Promise<SyncSummary> {
  const release: UpstreamRelease = tag
    ? { tag, prerelease: false, publishedAt: '' }
    : await fetchLatestRelease(repo, ghExec);
  assertTag(release.tag);

  const tmpDir = await fs.mkdtemp(path.join(tmpRoot, 'cf-sync-'));
  // Unique staging path per sync: a concurrent/retried sync can never delete
  // or swap another sync's half-built tree (the route also serializes, but
  // uniqueness keeps this module safe on its own).
  const staging = `${bundleDir}.staging-${path.basename(tmpDir).slice(-8)}`;
  try {
    const tarFile = path.join(tmpDir, 'upstream.tar.gz');
    await download(repo, release.tag, tarFile);
    const { root, commit } = await extract(tarFile, tmpDir);
    const payload = path.join(root, PAYLOAD_DIR);
    await assertDir(payload, `upstream payload dir '${PAYLOAD_DIR}/' missing in tarball`);

    await fs.rm(staging, { recursive: true, force: true });
    await fs.mkdir(staging, { recursive: true });
    const manifest: CfManifest = { entries: {} };
    const syncedAt = new Date().toISOString();
    const truncated: string[] = [];

    // --- skills: one entry per dir, ck-* renamed, md refs rewritten ---
    const skillDirs = await listDirs(path.join(payload, 'skills'));
    const renames = buildSkillRenames(skillDirs);
    const renamed = renamedBaseNames(renames);
    for (const dirName of skillDirs) {
      const destName = renames.get(dirName) ?? dirName;
      const result = await copyDirIntoBundle({
        srcDir: path.join(payload, 'skills', dirName),
        destDir: path.join(staging, 'skills', destName),
        renamed,
        transformMd: true,
      });
      if (result.truncated) truncated.push(destName);
      upsertManifestEntry(manifest, 'skills', {
        name: destName,
        origin: 'upstream',
        source: `${repo}/claude/skills/${dirName}`,
        syncedAt,
        files: result.files,
        bytes: result.bytes,
        filesHash: result.filesHash,
        ...(result.truncated ? { truncated: true } : {}),
      });
    }

    // --- flat kinds: whole dir per entry ---
    const kindCounts: Record<string, number> = {};
    for (const { kind, transformMd } of SYNC_KINDS) {
      const result = await copyDirIntoBundle({
        srcDir: path.join(payload, kind),
        destDir: path.join(staging, kind),
        renamed,
        transformMd,
      });
      kindCounts[kind] = result.files;
      if (result.truncated) truncated.push(kind);
      upsertManifestEntry(manifest, kind, {
        name: kind,
        origin: 'upstream',
        source: `${repo}/claude/${kind}`,
        syncedAt,
        files: result.files,
        bytes: result.bytes,
        filesHash: result.filesHash,
        ...(result.truncated ? { truncated: true } : {}),
      });
    }

    // Operator-installed skills (origin ≠ upstream) survive a sync: their dirs
    // are carried over verbatim from the current bundle (they were transformed
    // at install time) and their manifest entries kept. An operator install
    // wins over a same-named upstream skill — the lead chose it explicitly.
    const preserved = await preserveOperatorSkills(bundleDir, staging, manifest);

    manifest.upstream = { repo, tag: release.tag, commit, syncedAt };
    await writePluginJson(staging, release.tag);
    await writeManifest(staging, manifest);
    await swapIntoPlace(staging, bundleDir);

    return {
      tag: release.tag,
      commit,
      skills: skillDirs.length,
      agents: kindCounts['agents'] ?? 0,
      rules: kindCounts['rules'] ?? 0,
      hooks: kindCounts['hooks'] ?? 0,
      outputStyles: kindCounts['output-styles'] ?? 0,
      truncated,
      preserved,
    };
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
    await fs.rm(staging, { recursive: true, force: true }); // no-op after a successful swap
  }
}

async function writePluginJson(bundleDir: string, tag: string): Promise<void> {
  const dir = path.join(bundleDir, '.claude-plugin');
  await fs.mkdir(dir, { recursive: true });
  const plugin = {
    name: 'cf',
    version: tag.replace(/^v/, ''),
    description: 'Claude Fleet default skill bundle (synced from ClaudeKit upstream, /cf namespace)',
  };
  await fs.writeFile(path.join(dir, 'plugin.json'), `${JSON.stringify(plugin, null, 2)}\n`);
}

// Copy skills whose manifest origin is not 'upstream' from the live bundle
// into staging (verbatim — cpdir, no re-transform), merging their entries.
async function preserveOperatorSkills(bundleDir: string, staging: string, manifest: CfManifest): Promise<string[]> {
  const previous = await readManifest(bundleDir);
  const preserved: string[] = [];
  for (const entry of previous.entries.skills ?? []) {
    if (entry.origin === 'upstream') continue;
    const srcDir = path.join(bundleDir, 'skills', entry.name);
    try {
      if (!(await fs.stat(srcDir)).isDirectory()) continue;
    } catch {
      continue; // manifest entry without a dir — drop it
    }
    const destDir = path.join(staging, 'skills', entry.name);
    await fs.rm(destDir, { recursive: true, force: true }); // operator install wins over upstream
    await fs.cp(srcDir, destDir, { recursive: true });
    upsertManifestEntry(manifest, 'skills', entry);
    preserved.push(entry.name);
  }
  return preserved;
}

// Old bundle out, staging in. The brief old→.old rename keeps a rollback copy
// alive until the new bundle is in place; if the final rename fails the old
// bundle is restored, so the live dir can never be left missing.
async function swapIntoPlace(staging: string, bundleDir: string): Promise<void> {
  const old = `${bundleDir}.old`;
  await fs.rm(old, { recursive: true, force: true });
  let movedAside = false;
  try {
    await fs.rename(bundleDir, old);
    movedAside = true;
  } catch {
    /* first sync — no existing bundle */
  }
  try {
    await fs.rename(staging, bundleDir);
  } catch (err) {
    if (movedAside) await fs.rename(old, bundleDir).catch(() => {}); // restore — never leave no bundle at all
    throw err;
  }
  await fs.rm(old, { recursive: true, force: true });
}

async function listDirs(dir: string): Promise<string[]> {
  try {
    return (await fs.readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  } catch {
    return [];
  }
}

async function assertDir(dir: string, message: string): Promise<void> {
  try {
    if (!(await fs.stat(dir)).isDirectory()) throw new Error(message);
  } catch {
    throw new Error(message);
  }
}

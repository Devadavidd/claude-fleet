import { execFile, spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

// Thin gh-CLI wrappers for reaching the (private) upstream ClaudeKit repo.
// Auth rides on the user's own `gh auth login` — the server never sees or
// stores a token. Every invocation is an argv ARRAY (no shell), the repo slug
// and tag are validated before use, and everything is time-bounded so a hung
// gh can never wedge a request handler. All functions throw Error with a
// user-presentable message; callers map that to an HTTP 502.

const API_TIMEOUT_MS = 60_000;
const TARBALL_TIMEOUT_MS = 300_000;

const REPO_SLUG_RE = /^[\w.-]+\/[\w.-]+$/;
const TAG_RE = /^[\w.-]+$/;

export interface UpstreamRelease {
  tag: string;
  prerelease: boolean;
  publishedAt: string;
}

/** Injectable exec seam so unit tests never touch the network or gh. */
export type GhExecFn = (args: readonly string[], timeoutMs: number) => Promise<string>;

export const defaultGhExec: GhExecFn = (args, timeoutMs) =>
  new Promise((resolve, reject) => {
    execFile('gh', [...args], { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(ghErrorMessage(err, stderr)));
      else resolve(stdout);
    });
  });

export function assertRepoSlug(repo: string): void {
  if (!REPO_SLUG_RE.test(repo)) throw new Error(`invalid repo slug: ${repo}`);
}

export function assertTag(tag: string): void {
  if (!TAG_RE.test(tag)) throw new Error(`invalid release tag: ${tag}`);
}

/** Newest release (pre-releases included — the agreed channel). */
export async function fetchLatestRelease(repo: string, ghExec: GhExecFn = defaultGhExec): Promise<UpstreamRelease> {
  assertRepoSlug(repo);
  const raw = await ghExec(['api', `repos/${repo}/releases?per_page=1`], API_TIMEOUT_MS);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('upstream release list: invalid JSON from gh');
  }
  const first = Array.isArray(parsed) ? (parsed[0] as Record<string, unknown> | undefined) : undefined;
  if (!first || typeof first.tag_name !== 'string') throw new Error('upstream has no releases');
  return {
    tag: first.tag_name,
    prerelease: first.prerelease === true,
    publishedAt: typeof first.published_at === 'string' ? first.published_at : '',
  };
}

/**
 * Stream the release tarball to `destFile`. Streamed (not execFile-buffered)
 * because the archive is tens of MB. Rejects on non-zero exit or timeout.
 */
export function downloadTarball(repo: string, tag: string, destFile: string): Promise<void> {
  assertRepoSlug(repo);
  assertTag(tag);
  return new Promise((resolve, reject) => {
    const child = spawn('gh', ['api', `repos/${repo}/tarball/${tag}`], { stdio: ['ignore', 'pipe', 'pipe'] });
    const out = createWriteStream(destFile);
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), TARBALL_TIMEOUT_MS);
    child.stderr.on('data', (d: Buffer) => { stderr = (stderr + d.toString()).slice(-2000); });
    child.stdout.pipe(out);
    // A disk-full/permission error on the write side would otherwise be an
    // unhandled 'error' event — killing the whole dashboard process.
    out.on('error', (err) => { clearTimeout(timer); child.kill('SIGKILL'); reject(new Error(`tarball write failed: ${err.message}`)); });
    child.on('error', (err) => { clearTimeout(timer); reject(new Error(ghErrorMessage(err, stderr))); });
    child.on('close', (code) => {
      clearTimeout(timer);
      out.end(() => (code === 0 ? resolve() : reject(new Error(ghErrorMessage({ code }, stderr)))));
    });
  });
}

/**
 * Extract a GitHub tarball and return the payload root. GitHub archives wrap
 * everything in a single `<owner>-<repo>-<shortsha>/` dir — that suffix is the
 * commit the tag resolved to, recorded in the manifest as the pin.
 */
export async function extractTarball(tarFile: string, destDir: string): Promise<{ root: string; commit: string }> {
  await new Promise<void>((resolve, reject) => {
    execFile('tar', ['-xzf', tarFile, '-C', destDir], { timeout: TARBALL_TIMEOUT_MS }, (err) =>
      err ? reject(new Error(`tar extract failed: ${err.message}`)) : resolve(),
    );
  });
  const entries = await fs.readdir(destDir, { withFileTypes: true });
  const topDir = entries.find((e) => e.isDirectory());
  if (!topDir) throw new Error('tarball extracted to an empty directory');
  const commit = topDir.name.split('-').at(-1) ?? '';
  return { root: path.join(destDir, topDir.name), commit };
}

function ghErrorMessage(err: { message?: string; code?: unknown } | null, stderr: string): string {
  const detail = stderr.trim() || err?.message || `exit ${String(err?.code ?? 'unknown')}`;
  if (/gh auth|not logged|authentication/i.test(detail)) return `gh is not authenticated: ${detail}`;
  if (/ENOENT/.test(detail)) return 'gh CLI not found — install GitHub CLI and run `gh auth login`';
  return `gh failed: ${detail}`;
}

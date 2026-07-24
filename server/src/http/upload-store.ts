import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// Persists chat-composer attachments so a launched (bypassPermissions) agent
// can read them from disk — the composed task text carries the absolute paths.
// JSON base64 (no multipart dependency); every request lands in a fresh
// owner-only batch dir under the fleet uploads root, so concurrent launches
// never collide and nothing outside that root is ever written.

export const MAX_UPLOAD_FILES = 8;
export const MAX_UPLOAD_FILE_BYTES = 8 * 1024 * 1024; // decoded size, per file

/** Validation failure the route maps to a 400 (anything else stays a 500). */
export class UploadError extends Error {}

export interface SaveUploadsResult {
  paths: string[];
}

// Everything that is NOT a conservative allow-list char gets stripped: keep
// letters, digits, dot, dash, underscore. A stored name can then be safely
// echoed into the task text and any shell/tool argument. Dots are kept
// (extensions matter); leading dots are stripped below.
const DISALLOWED_NAME_CHARS = /[^A-Za-z0-9._-]/g;

/**
 * Collapse an untrusted client filename to a safe basename. Never returns an
 * empty string — falls back to `file-<n>` so every upload gets a real path.
 */
export function sanitizeUploadName(raw: unknown, index: number): string {
  const base = path.basename(typeof raw === 'string' ? raw.trim() : '');
  const cleaned = base
    .replace(DISALLOWED_NAME_CHARS, '')
    .replace(/^\.+/, '') // no hidden files, and '..' can never survive
    .slice(0, 120)
    .trim();
  return cleaned || `file-${index + 1}`;
}

// Strict-ish base64 check: Buffer.from(_, 'base64') silently ignores garbage,
// so an all-invalid payload would "decode" to empty. Reject foreign chars.
function decodeBase64(raw: unknown): Buffer | null {
  if (typeof raw !== 'string' || !raw) return null;
  const compact = raw.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) return null;
  return Buffer.from(compact, 'base64');
}

/**
 * Boot-time hygiene: delete upload batch dirs older than maxAgeMs. Batches
 * have no other lifecycle (a launch only references them by path), so without
 * this the uploads root grows forever. Best-effort — a failure never blocks boot.
 * Returns the number of batch dirs removed.
 */
export function sweepOldUploads(rootDir: string, maxAgeMs: number, now = Date.now()): number {
  let removed = 0;
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(rootDir, { withFileTypes: true }); } catch { return 0; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(rootDir, entry.name);
    try {
      if (now - fs.statSync(dir).mtimeMs < maxAgeMs) continue;
      fs.rmSync(dir, { recursive: true, force: true });
      removed += 1;
    } catch { /* skip anything unreadable — never fail boot over hygiene */ }
  }
  return removed;
}

/**
 * Validate + persist one upload batch. Throws UploadError on any client-input
 * problem; on success returns the absolute paths written.
 */
export function saveUploads(body: unknown, rootDir: string): SaveUploadsResult {
  const files = (body as { files?: unknown } | null)?.files;
  if (!Array.isArray(files) || files.length === 0) throw new UploadError('files[] is required');
  if (files.length > MAX_UPLOAD_FILES) throw new UploadError(`too many files (max ${MAX_UPLOAD_FILES})`);

  // Decode + validate EVERYTHING before touching disk, so a bad batch writes nothing.
  const staged: Array<{ name: string; data: Buffer }> = [];
  const seen = new Set<string>();
  for (let i = 0; i < files.length; i += 1) {
    const f = (files[i] ?? {}) as { name?: unknown; dataBase64?: unknown };
    const data = decodeBase64(f.dataBase64);
    if (!data || data.length === 0) throw new UploadError(`file ${i + 1}: invalid or empty base64 data`);
    if (data.length > MAX_UPLOAD_FILE_BYTES) {
      throw new UploadError(`file ${i + 1}: exceeds ${MAX_UPLOAD_FILE_BYTES / (1024 * 1024)}MB limit`);
    }
    let name = sanitizeUploadName(f.name, i);
    while (seen.has(name)) name = `${i + 1}-${name}`; // same-batch duplicates: loop until unique
    seen.add(name);
    staged.push({ name, data });
  }

  const batchDir = path.join(path.resolve(rootDir), randomUUID());
  fs.mkdirSync(batchDir, { recursive: true, mode: 0o700 });
  const paths: string[] = [];
  for (const { name, data } of staged) {
    const target = path.resolve(batchDir, name);
    // Belt-and-braces: sanitizeUploadName already precludes traversal.
    if (!target.startsWith(batchDir + path.sep)) throw new UploadError('invalid file name');
    fs.writeFileSync(target, data, { mode: 0o600 });
    paths.push(target);
  }
  return { paths };
}

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Persisted launch allow-list, editable from the app (behind the CSRF token
// guard). This is SAFE because the allow-list is fat-finger-safety, not a
// security boundary: a launch is already full-user code execution regardless of
// cwd, so widening the list grants nothing an existing allowed dir didn't. The
// real boundary is the token guard, which gates this endpoint exactly like
// /api/spawn. Effective roots = env FLEET_ALLOWED_ROOTS ∪ saved.
const FILE = path.join(os.homedir(), '.claude-fleet', 'launch.json');

export function readSavedRoots(): string[] {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    const roots = (parsed as { allowedRoots?: unknown } | null)?.allowedRoots;
    return Array.isArray(roots) ? roots.filter((r): r is string => typeof r === 'string') : [];
  } catch { return []; }
}

export interface SaveRootsResult {
  ok: boolean;
  roots?: string[];
  error?: string;
}

// Validates + persists. Each root must be an absolute path to an existing
// directory (realpath canonicalized). `requested` arrives as an untrusted JSON
// request body, hence `unknown`. Returns { ok, roots } or { ok:false, error }.
export function saveRoots(requested: unknown): SaveRootsResult {
  if (!Array.isArray(requested)) return { ok: false, error: 'roots must be an array' };
  // Bound the loop: each entry does synchronous realpath+stat; a huge array
  // would block the event loop (DoS). Nobody needs > 64 launch dirs.
  if (requested.length > 64) return { ok: false, error: 'too many directories (max 64)' };
  const clean: string[] = [];
  for (const raw of requested) {
    if (typeof raw !== 'string' || !raw.trim()) continue;
    const expanded = raw.trim().startsWith('~')
      ? path.join(os.homedir(), raw.trim().slice(1))
      : raw.trim();
    if (!path.isAbsolute(expanded)) return { ok: false, error: `not an absolute path: ${raw}` };
    let real: string;
    try { real = fs.realpathSync(expanded); } catch { return { ok: false, error: `directory not found: ${raw}` }; }
    if (!fs.statSync(real).isDirectory()) return { ok: false, error: `not a directory: ${raw}` };
    if (!clean.includes(real)) clean.push(real);
  }
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify({ allowedRoots: clean }, null, 2));
  } catch (err) {
    return { ok: false, error: `could not save: ${String((err as { message?: unknown } | null)?.message ?? err)}` };
  }
  return { ok: true, roots: clean };
}

// Env roots ∪ saved roots — the live effective allow-list.
export function effectiveRoots(envRoots: readonly string[] | undefined | null): string[] {
  return [...new Set([...(envRoots ?? []), ...readSavedRoots()])];
}

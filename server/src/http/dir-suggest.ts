import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Path autocomplete for the desktop-style working-folder picker: given what
// the user typed so far, list matching directories. Read-only metadata
// (directory NAMES only, never file contents), same-origin GET like the other
// dashboard reads. Dotfolders are hidden unless the prefix explicitly starts
// one — the picker is for projects, not for spelunking ~/.ssh.

export interface DirSuggestion {
  path: string;
}

const MAX_SUGGESTIONS = 30;

/** Expand a leading '~' and resolve to an absolute path ('' when hopeless). */
function normalizePrefix(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return `${os.homedir()}${path.sep}`;
  const expanded = trimmed.startsWith('~') ? path.join(os.homedir(), trimmed.slice(1)) : trimmed;
  return path.isAbsolute(expanded) ? expanded : '';
}

/**
 * Directories matching the typed prefix: children of the deepest complete
 * directory in `raw`, filtered by the trailing partial segment.
 */
export function suggestDirectories(raw: string): DirSuggestion[] {
  const prefix = normalizePrefix(raw);
  if (!prefix) return [];
  // "/a/b/par" → list /a/b, keep entries starting with "par"; "/a/b/" → list all of /a/b.
  const endsWithSep = prefix.endsWith(path.sep);
  const parent = endsWithSep ? prefix : path.dirname(prefix);
  const partial = endsWithSep ? '' : path.basename(prefix).toLowerCase();
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(parent, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: DirSuggestion[] = [];
  for (const entry of entries) {
    if (out.length >= MAX_SUGGESTIONS) break;
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (entry.name.startsWith('.') && !partial.startsWith('.')) continue;
    if (partial && !entry.name.toLowerCase().startsWith(partial)) continue;
    const full = path.join(parent, entry.name);
    // Symlinks only count when they really point at a directory.
    if (entry.isSymbolicLink()) {
      try { if (!fs.statSync(full).isDirectory()) continue; } catch { continue; }
    }
    out.push({ path: full });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

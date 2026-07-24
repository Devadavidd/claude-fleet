// Pure text/name transforms for building the /cf bundle from ClaudeKit (/ck)
// sources. No fs, no config — fully unit-testable. Two jobs:
//   1. Skill dir renames: `ck-plan` → `plan` (collision-guarded by the caller
//      via buildSkillRenames, which never renames onto an existing dir name).
//   2. Markdown reference rewrites: `/ck:x` → `/cf:x`, bare `ck:x` → `cf:x`,
//      and `ck-<renamed>` → `<renamed>` — all boundary-guarded so words that
//      merely end in "ck" (`check:`, `pack:`) are never touched, and fenced
//      code blocks are left byte-identical (agreed design decision).

/** `ck-plan` → `plan`; names without the prefix pass through unchanged. */
export function stripCkPrefix(name: string): string {
  return name.startsWith('ck-') ? name.slice(3) : name;
}

/**
 * Map of original dir name → bundle dir name for a full set of skill dirs.
 * A rename that would collide with an existing dir (e.g. both `ck-loop` and
 * `loop` present) keeps its original name — never overwrite, never merge.
 */
export function buildSkillRenames(dirNames: readonly string[]): Map<string, string> {
  const taken = new Set(dirNames);
  const renames = new Map<string, string>();
  for (const name of dirNames) {
    const stripped = stripCkPrefix(name);
    renames.set(name, stripped !== name && !taken.has(stripped) ? stripped : name);
  }
  return renames;
}

/** Base names that were actually renamed (the `plan` of `ck-plan` → `plan`). */
export function renamedBaseNames(renames: ReadonlyMap<string, string>): Set<string> {
  const out = new Set<string>();
  for (const [from, to] of renames) if (from !== to) out.add(to);
  return out;
}

// Boundary class for the bare-prefix rewrites: start-of-line, whitespace,
// inline-code backtick, quotes, brackets, or a path slash. Deliberately NOT a
// letter — that is what protects `check:` / `pack:` from matching.
const BOUNDARY = String.raw`(^|[\s\`'"([/])`;
const BARE_CK_COLON = new RegExp(`${BOUNDARY}ck:`, 'gm');

/**
 * Rewrite /ck references in markdown OUTSIDE fenced code blocks.
 * Inline code spans ARE rewritten (they are invocation examples); fences are
 * preserved byte-for-byte per the agreed design.
 */
export function rewriteCkReferences(text: string, renamed: ReadonlySet<string>): string {
  // Longest-first so alternation can never partially match a shorter sibling.
  const names = [...renamed].sort((a, b) => b.length - a.length);
  const ckDashRenamed = names.length
    ? new RegExp(`${BOUNDARY}ck-(${names.join('|')})(?![\\w-])`, 'gm')
    : null;

  const rewriteSegment = (segment: string): string => {
    let out = segment.replaceAll('/ck:', '/cf:');
    out = out.replace(BARE_CK_COLON, '$1cf:');
    if (ckDashRenamed) out = out.replace(ckDashRenamed, '$1$2');
    return out;
  };

  // Walk line-by-line tracking fence state per CommonMark: a fence opened with
  // N backticks/tildes closes only on a bare line of the SAME char with ≥N
  // marks. That keeps ````markdown blocks (which SHOW ``` examples inside)
  // fully untouched instead of toggling on every inner fence. A dangling fence
  // leaves the rest of the file untouched — safer than guessing its close.
  const lines = text.split('\n');
  let fence: { char: string; len: number } | null = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (fence) {
      const close = new RegExp(`^\\s*${fence.char}{${fence.len},}\\s*$`).test(line);
      if (close) fence = null;
      continue; // everything inside (and the closing line) stays byte-identical
    }
    const open = /^\s*(`{3,}|~{3,})/.exec(line);
    if (open) {
      fence = { char: open[1][0], len: open[1].length };
      continue; // opener (incl. its info string) stays untouched
    }
    lines[i] = rewriteSegment(line);
  }
  return lines.join('\n');
}

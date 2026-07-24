// Shared, minimal frontmatter reader for plan.md / phase-*.md / wiki entries.
// NOT a full YAML parser (KISS) — pulls whitelisted scalar `key: value` lines plus
// a `tags` list. Fail-open: anything without a leading `---` block returns empty data
// and the whole text as body, never throws. Extracted so wiki-reader and plan-reader
// share one implementation (DRY).

/** Whitelisted scalar frontmatter keys any caller in this codebase extracts. */
export type FrontmatterFieldKey =
  | 'title'
  | 'status'
  | 'branch'
  | 'created'
  | 'completed'
  | 'project'
  | 'plan_slug'
  | 'source_hash'
  | 'phase'
  | 'priority';

/** Extracted scalar fields (only those requested via `keys` and present are set) + tags. */
export type FrontmatterData = Partial<Record<FrontmatterFieldKey, string>> & { tags: string[] };

export interface FrontmatterResult {
  data: FrontmatterData;
  body: string;
}

// Parse the frontmatter block at the top of `text`. `keys` is the whitelist of scalar
// fields to extract (quotes stripped). `tags` is always parsed when a block exists.
export function parseFrontmatter(text: string, keys: FrontmatterFieldKey[] = []): FrontmatterResult {
  if (typeof text !== 'string' || !text.startsWith('---')) {
    return { data: { tags: [] }, body: typeof text === 'string' ? text : '' };
  }
  const end = text.indexOf('\n---', 3);
  if (end === -1) return { data: { tags: [] }, body: text };
  const fm = text.slice(text.indexOf('\n') + 1, end);
  const nl = text.indexOf('\n', end + 1);
  const body = nl === -1 ? '' : text.slice(nl + 1);
  const data: FrontmatterData = { tags: [] };
  const scalar = (k: string): string => {
    const m = fm.match(new RegExp(`^${k}:\\s*(.+)$`, 'm'));
    return m ? m[1].trim().replace(/^['"]|['"]$/g, '').trim() : '';
  };
  for (const k of keys) {
    const v = scalar(k);
    if (v) data[k] = v;
  }
  data.tags = parseTags(fm);
  return { data, body };
}

// Tags accept either inline `[a, b]` or a YAML block list of `- a` lines.
export function parseTags(fm: string): string[] {
  const inline = fm.match(/^tags:\s*\[(.*)\]\s*$/m);
  if (inline) return inline[1].split(',').map((t) => t.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  const block = fm.match(/^tags:\s*\n((?:\s+-\s*.+\n?)+)/m);
  if (block) return block[1].split('\n').map((l) => l.replace(/^\s*-\s*/, '').trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  return [];
}

// First `# H1` heading in a markdown body, '' if none. Handy for deriving a
// human-readable title from prose.
export function firstHeading(body: string): string {
  const m = typeof body === 'string' ? body.match(/^#\s+(.+)$/m) : null;
  return m ? m[1].trim() : '';
}

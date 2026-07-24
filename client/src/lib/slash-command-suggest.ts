import type { SkillEntry } from '../../../shared/types/index.js';

// Pure suggestion logic for the desktop-app-style slash menu: given the text
// before the caret, decide whether a slash command is being typed and which
// catalog skills match. UI-free → unit-testable.

export interface SlashSuggestion {
  /** Full command to insert, e.g. "/cf:brainstorm". */
  command: string;
  name: string;
  desc: string;
}

/**
 * The active slash token, but ONLY when the caret is still inside the first
 * word of the message and that word starts with '/'. Returns null otherwise
 * ('/path/to/file' mid-sentence must not open the menu).
 */
export function activeSlashToken(textBeforeCaret: string): string | null {
  if (!textBeforeCaret.startsWith('/')) return null;
  if (/[\s\n]/.test(textBeforeCaret)) return null; // first word already finished
  return textBeforeCaret;
}

/** Rank catalog skills against the typed token ("/bra" → /cf:brainstorm …). */
export function suggestSlashCommands(
  skills: readonly SkillEntry[],
  token: string,
  limit = 8,
): SlashSuggestion[] {
  const q = token.replace(/^\//, '').replace(/^cf:/, '').toLowerCase();
  const scored: Array<{ score: number; s: SlashSuggestion }> = [];
  for (const skill of skills) {
    const name = skill.name.toLowerCase();
    let score = -1;
    if (!q) score = 1; // bare "/" lists everything
    else if (name.startsWith(q)) score = 3;
    else if (name.includes(q)) score = 2;
    else if ((skill.desc ?? '').toLowerCase().includes(q)) score = 1;
    if (score < 0) continue;
    scored.push({ score, s: { command: `/cf:${skill.name}`, name: skill.name, desc: skill.desc ?? '' } });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.s.name.localeCompare(b.s.name))
    .slice(0, limit)
    .map((x) => x.s);
}

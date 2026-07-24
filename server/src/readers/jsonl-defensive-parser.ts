// The transcript JSONL schema is Claude Code internal and may change between
// versions. Only `type: string` is assumed; every other shape passes through
// untouched, and anything unparseable becomes a raw entry instead of a crash.

import type { TranscriptEntry, TranscriptEvent } from '../../../shared/types/index.js';

export function parseLine(line: string): TranscriptEntry | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const obj: unknown = JSON.parse(trimmed);
    if (
      obj === null ||
      typeof obj !== 'object' ||
      Array.isArray(obj) ||
      typeof (obj as { type?: unknown }).type !== 'string'
    ) {
      return { kind: 'raw', raw: truncateRaw(trimmed) };
    }
    return { kind: 'event', event: obj as TranscriptEvent };
  } catch {
    return { kind: 'raw', raw: truncateRaw(trimmed) };
  }
}

// Raw fallback lines are display-only; cap them so one corrupt megabyte line
// cannot bloat memory or the SSE stream.
function truncateRaw(str: string, max = 2000): string {
  return str.length > max ? `${str.slice(0, max)}… (+${str.length - max} chars)` : str;
}

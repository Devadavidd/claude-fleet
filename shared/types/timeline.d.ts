// Timeline drill-down contract — mirrors src/jsonl-defensive-parser.js and
// src/timeline-reader.js (/api/sessions/:id[/agents/:aid]/timeline).

/** Transcript schema is Claude-Code-internal: only `type` is assumed. */
export interface TranscriptEvent {
  type: string;
  timestamp?: string;
  cwd?: string;
  message?: { content?: unknown; usage?: Record<string, unknown> };
  [key: string]: unknown;
}

/** Defensive parse result: a structured event or a truncated raw line. */
export type TranscriptEntry =
  | { kind: 'event'; event: TranscriptEvent }
  | { kind: 'raw'; raw: string };

export interface TimelineResponse {
  events: TranscriptEntry[];
  total: number;
  /** Absolute index of events[0] in the file — live-append with ?since=total. */
  offset: number;
}

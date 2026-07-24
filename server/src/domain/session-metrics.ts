// Token-burn and file-touch accounting, kept out of the reducer so both stay
// under the file-size budget and the pure math is unit-testable.

import type { FileTouchEntry, TokenStats } from '../../../shared/types/index.js';

const BUCKET_MS = 60_000;
const BUCKET_WINDOW = 30; // sparkline covers the last 30 minutes

export interface TokenTotals {
  output: number;
  cacheRead: number;
  cacheCreate: number;
}

export interface FileTouch {
  count: number;
  lastAt: number;
}

/** Minimal shape of an `assistant` transcript event this module reads. */
export interface UsageEvent {
  timestamp?: string;
  message?: { usage?: Record<string, unknown> };
}

/** Narrow slice of session state this module owns — the reducer's full
 * per-session state (session-state-reducer.ts) satisfies this structurally. */
export interface MetricsState {
  tokens?: TokenTotals;
  tokenBuckets?: Map<number, number>;
  fileTouches?: Map<string, FileTouch>;
  readableFiles?: Set<string>;
}

/** The subset needed by aggregateFileTouches — always has a sessionId. */
export interface FileTouchSource {
  sessionId: string;
  title?: string;
  firstPrompt?: string;
  fileTouches?: Map<string, FileTouch>;
}

export function initMetrics(state: MetricsState): void {
  state.tokens = { output: 0, cacheRead: 0, cacheCreate: 0 };
  state.tokenBuckets = new Map();
  state.fileTouches = new Map();
  state.readableFiles = new Set();
}

// Accrue usage from an assistant event (main session or subagent — worker
// burn counts toward its parent session).
export function recordUsage(state: MetricsState, event: UsageEvent): void {
  if (!state.tokens) initMetrics(state); // tolerate states built elsewhere (tests)
  const usage = event.message?.usage;
  if (!usage || typeof usage !== 'object') return;
  const out = Number(usage.output_tokens) || 0;
  const tokens = state.tokens!;
  tokens.output += out;
  tokens.cacheRead += Number(usage.cache_read_input_tokens) || 0;
  tokens.cacheCreate += Number(usage.cache_creation_input_tokens) || 0;
  const ts = Date.parse(event.timestamp ?? '');
  if (!Number.isFinite(ts) || out === 0) return;
  const minute = Math.floor(ts / BUCKET_MS) * BUCKET_MS;
  const buckets = state.tokenBuckets!;
  buckets.set(minute, (buckets.get(minute) ?? 0) + out);
  // Drop buckets that scrolled out of the sparkline window.
  for (const key of buckets.keys()) {
    if (key < minute - BUCKET_WINDOW * BUCKET_MS) buckets.delete(key);
  }
}

export function recordFileTouch(state: MetricsState, filePath: string, timestamp: number): void {
  if (!state.fileTouches) initMetrics(state);
  const touches = state.fileTouches!;
  const entry = touches.get(filePath) ?? { count: 0, lastAt: 0 };
  entry.count += 1;
  entry.lastAt = Math.max(entry.lastAt, timestamp ?? 0);
  touches.set(filePath, entry);
}

// A file the agent read or wrote is safe to preview — its content already
// appears inline in this session's transcript; the viewer just re-renders it.
// Kept separate from fileTouches so the write-activity heatmap stays writes-only.
export function recordReadable(state: MetricsState, filePath: string): void {
  (state.readableFiles ??= new Set()).add(filePath);
}

// Card payload: totals + a fixed-length per-minute series ending "now".
export function tokensForCard(state: MetricsState, now: number): TokenStats {
  if (!state.tokens) initMetrics(state);
  const currentMinute = Math.floor(now / BUCKET_MS) * BUCKET_MS;
  const perMin: number[] = [];
  for (let i = BUCKET_WINDOW - 1; i >= 0; i -= 1) {
    perMin.push(state.tokenBuckets?.get(currentMinute - i * BUCKET_MS) ?? 0);
  }
  return { ...state.tokens!, perMin };
}

// Fleet-wide file aggregation for the /api/files heatmap: merges every
// session's touch map. Computed on request — no extra storage.
export function aggregateFileTouches(sessionStates: Iterable<FileTouchSource>): FileTouchEntry[] {
  const files = new Map<string, FileTouchEntry>();
  for (const state of sessionStates) {
    for (const [filePath, touch] of state.fileTouches ?? new Map<string, FileTouch>()) {
      let entry = files.get(filePath);
      if (!entry) {
        entry = { path: filePath, count: 0, lastAt: 0, sessions: [] };
        files.set(filePath, entry);
      }
      entry.count += touch.count;
      entry.lastAt = Math.max(entry.lastAt, touch.lastAt);
      entry.sessions.push({
        sessionId: state.sessionId,
        title: state.title || state.firstPrompt || state.sessionId,
        lastAt: touch.lastAt,
      });
    }
  }
  return [...files.values()].sort((a, b) => b.lastAt - a.lastAt);
}

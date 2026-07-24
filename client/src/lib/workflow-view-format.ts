// Pure presentation helpers for the #/workflows view — the only unit-testable
// slice of the front-end (no DOM). Kept separate so vitest can cover them.

// ms → "m:ss", or "h:mm:ss" past an hour.
export function formatDuration(ms: number | null | undefined): string {
  const total = Math.max(0, Math.round((ms ?? 0) / 1000));
  const s = String(total % 60).padStart(2, '0');
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

// Abbreviate large token counts (48800 → "48.8k") to match the native panel.
export function formatTokens(n: number | null | undefined): string {
  const v = Number(n) || 0;
  return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v);
}

export type WorkflowDisplayStatus = 'running' | 'done' | 'idle';

/** Only the field this helper reads; the raw `status` may be any value. */
export interface WorkflowStatusLike {
  status?: unknown;
}

export function workflowStatusLabel(wf: WorkflowStatusLike | undefined): WorkflowDisplayStatus {
  const s = wf?.status;
  return s === 'running' || s === 'done' ? s : 'idle';
}

/** Newest run first; Array.sort is stable so ties keep their prior order. */
export function sortWorkflows<T extends { lastActivityAt?: number | null }>(
  list: T[] | null | undefined,
): T[] {
  return [...(list ?? [])].sort((a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0));
}

/** Only the two fields displayLabel reads; both may be missing or null. */
export interface DisplayLabelAgent {
  label?: string | null;
  agentType?: string | null;
}

// The static parser can't resolve dynamic labels (`write:${p.filename}`) or find a
// label at all; fall back to the agentType so the row stays meaningful.
export function displayLabel(agent: DisplayLabelAgent | undefined): string {
  const label = agent?.label;
  if (label && !label.includes('${')) return label;
  return agent?.agentType || 'agent';
}

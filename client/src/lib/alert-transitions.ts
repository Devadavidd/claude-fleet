// Pure decision logic for fleet alerts — no DOM, no audio — so it is unit-testable in node
// and shared by the app-level alerter. Given a session card's previous and next alert states,
// decide which chime (if any) to play.
//
// A session's alert state collapses to one of four keys:
//   'permission' — waiting-for-you on a PERMISSION request (blocked tool call)
//   'question'   — waiting-for-you WITH a pending question (blocked on your answer)
//   'done'       — waiting-for-you with NO question (turn finished, FYI)
//   'quiet'      — working / idle / anything else
// Alerts fire on ENTERING an alerting key from a different key. Moving
// question→done (answered elsewhere) or into 'quiet' never chimes.

import type { SessionCard } from '../../../shared/types/index.js';

export type AlertKey = 'quiet' | 'done' | 'question' | 'permission';
export type AlertKind = 'question' | 'done' | 'permission' | null;

/**
 * Minimal slice of SessionCard this module reads. `pendingQuestion` is only
 * kind-sniffed / truth-tested (never destructured further), so it is accepted
 * loosely — any truthy non-permission value collapses to the 'question' key.
 */
export interface AlertableCard {
  status?: SessionCard['status'];
  pendingQuestion?: unknown;
}

export function alertKeyFor(card: AlertableCard | undefined): AlertKey {
  if (!card || card.status !== 'waiting-for-you') return 'quiet';
  if (!card.pendingQuestion) return 'done';
  const kind = (card.pendingQuestion as { kind?: unknown }).kind;
  return kind === 'permission' ? 'permission' : 'question';
}

// → 'question' | 'done' | 'permission' | null (null = stay silent)
export function alertKindFor(prevKey: AlertKey, nextKey: AlertKey): AlertKind {
  if (nextKey === prevKey) return null;
  if (nextKey === 'permission') return 'permission';
  if (nextKey === 'question') return 'question';
  if (nextKey === 'done') return 'done';
  return null;
}

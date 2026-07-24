// Pure decision logic for fleet alerts — no DOM, no audio — so it is unit-testable in node
// and shared by the app-level alerter. Given a session card's previous and next alert states,
// decide which chime (if any) to play.
//
// A session's alert state collapses to one of three keys:
//   'question' — waiting-for-you WITH a pending question (blocked on your answer)
//   'done'     — waiting-for-you with NO question (turn finished, FYI)
//   'quiet'    — working / idle / anything else
// Alerts fire on ENTERING 'question' or 'done' from a different key. Moving question→done
// (answered elsewhere) or into 'quiet' never chimes.

import type { SessionCard } from '../../../shared/types/index.js';

export type AlertKey = 'quiet' | 'done' | 'question';
export type AlertKind = 'question' | 'done' | null;

/**
 * Minimal slice of SessionCard this module reads. `pendingQuestion` is only
 * ever truth-tested (never destructured), so it is accepted as `unknown` —
 * any truthy value collapses to the 'question' key.
 */
export interface AlertableCard {
  status?: SessionCard['status'];
  pendingQuestion?: unknown;
}

export function alertKeyFor(card: AlertableCard | undefined): AlertKey {
  if (!card || card.status !== 'waiting-for-you') return 'quiet';
  return card.pendingQuestion ? 'question' : 'done';
}

// → 'question' | 'done' | null (null = stay silent)
export function alertKindFor(prevKey: AlertKey, nextKey: AlertKey): AlertKind {
  if (nextKey === prevKey) return null;
  if (nextKey === 'question') return 'question';
  if (nextKey === 'done') return 'done';
  return null;
}

// The /events SSE contract — one discriminated union over every named event
// the server broadcasts (src/sse-server.js). The broadcast site switches on
// `type` with an exhaustiveness check, so adding a server event without
// extending this union fails compilation.

import type { SessionCard } from './session-card.js';
import type { LoopJob } from './loop-job.js';
import type { WorkflowRun } from './workflow-run.js';

export type SseEvent =
  /** Authoritative full-board state; re-sent on connect + every 15s heartbeat. */
  | { type: 'snapshot'; data: SessionCard[] }
  /** One card changed (debounced per session). */
  | { type: 'session'; data: SessionCard }
  | { type: 'session-removed'; data: { sessionId: string } }
  /** A docs/wiki entry changed on disk — Shipped view refetches /api/wiki. */
  | { type: 'wiki-updated'; data: { changed: true } }
  /** A plan/phase file changed on disk — Overview refetches /api/overview. */
  | { type: 'overview-updated'; data: { changed: true } }
  | { type: 'loop-job'; data: LoopJob }
  /** One projected workflow run changed (debounced per run). */
  | { type: 'workflow'; data: WorkflowRun }
  | { type: 'workflow-removed'; data: { sessionId: string } };

export type SseEventName = SseEvent['type'];

/** Payload type for one named SSE event. */
export type SseEventData<N extends SseEventName> = Extract<SseEvent, { type: N }>['data'];

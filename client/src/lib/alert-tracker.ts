// Pure, runes-free alert bookkeeping so the "fire once per real transition"
// rule is unit-testable. Given successive full card lists (each SSE delta,
// heartbeat, and reconnect reassigns the whole store map), decide which cards
// should chime — driven by the 3-key machine in alert-transitions.
//
// Storm guards (see red-team H3):
//  - fire only on an ENTER-question / ENTER-done key EDGE (alertKindFor)
//  - an `initialized` gate swallows the first observation after construction
//    (the initial snapshot is history, not news)
//  - `lastKey` PERSISTS across reconnects, so a reconnect snapshot whose keys
//    match what we already saw produces no edge → silence
//  - keys for sessions absent from a list are pruned (no ghost re-alerts)

import { alertKeyFor, alertKindFor, type AlertKey } from './alert-transitions.js';
import type { AlertKind } from './audio.js';
import type { SessionCard } from '../../../shared/types/index.js';

export interface AlertFire {
  card: SessionCard;
  kind: AlertKind;
}

export class AlertTracker {
  #lastKey = new Map<string, AlertKey>();
  #initialized = false;

  /** Returns the alerts to fire for this observation of the full card list. */
  observe(cards: SessionCard[]): AlertFire[] {
    const fires: AlertFire[] = [];
    for (const card of cards) {
      const next = alertKeyFor(card);
      const kind = alertKindFor(this.#lastKey.get(card.sessionId) ?? 'quiet', next);
      this.#lastKey.set(card.sessionId, next);
      if (this.#initialized && kind) fires.push({ card, kind });
    }
    // Prune keys for sessions that vanished (their session-removed may never replay).
    const alive = new Set(cards.map((c) => c.sessionId));
    for (const id of [...this.#lastKey.keys()]) if (!alive.has(id)) this.#lastKey.delete(id);
    this.#initialized = true;
    return fires;
  }
}

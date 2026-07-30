// App-level alerter, wired ONCE in App.svelte so chimes play on every tab/route
// (the legacy bug: alerts lived inside the Board view and were silent elsewhere).
// The pure AlertTracker owns the fire-once-per-edge decision; this module only
// wires it to the reactive store and performs the side effects (sound + desktop
// notification), gated by the 🔔 localStorage toggle.

import { AlertTracker } from './alert-tracker.js';
import { playAlertSound } from './audio.js';
import type { SessionCard } from '../../../shared/types/index.js';
import type { AlertKind } from './audio.js';

function notify(card: SessionCard, kind: AlertKind): void {
  // Guarded: Notification may be absent (iOS Safari) or throw on construction
  // (some Android Chrome) — never let that break the reactive effect.
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    const q = card.pendingQuestion?.questions?.[0];
    const body = kind === 'question' || kind === 'permission'
      ? (q?.question || q?.header || 'waiting for your answer')
      : 'Session is waiting for your input';
    const icon = kind === 'permission' ? '🔐' : '⏳';
    const n = new Notification(`${icon} ${card.title}`, {
      body,
      tag: `fleet-${card.sessionId}`, // replaces, never stacks per session
    });
    n.onclick = () => { window.focus(); location.hash = `#/session/${encodeURIComponent(card.sessionId)}`; };
  } catch { /* sound already played — desktop notification is best-effort */ }
}

/**
 * Subscribe the alerter to the store. Must be called from component init (it
 * creates a `$effect`). The effect re-runs on every store.sessions reassignment
 * (delta / heartbeat / reconnect); the tracker's edge + initialized gates keep
 * it from storming.
 */
export function initFleetAlerts(getSessions: () => SessionCard[]): void {
  const tracker = new AlertTracker();
  $effect(() => {
    const cards = getSessions(); // reactive dependency on the store map
    const fires = tracker.observe(cards);
    if (localStorage.getItem('fleet-alerts') !== 'on') return;
    for (const { card, kind } of fires) {
      playAlertSound(kind);
      notify(card, kind);
    }
  });
}

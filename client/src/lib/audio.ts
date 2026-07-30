// Self-contained notification chimes via the Web Audio API — no audio asset,
// works offline. Two distinct tones so you can tell by ear what happened:
//   • 'done'       — a soft descending ding-dong (Claude replied, waiting on you)
//   • 'question'   — a more insistent rising arpeggio (blocked on your answer)
//   • 'permission' — the same urgent arpeggio (a tool call is blocked on Allow/Deny)
// Autoplay policy keeps the AudioContext suspended until a user gesture, so
// unlockAudio() must run from a click/keydown before the first beep can sound.

export type AlertKind = 'done' | 'question' | 'permission';

let ctx: AudioContext | null = null;

export function unlockAudio(): void {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!ctx && Ctor) ctx = new Ctor();
    if (ctx?.state === 'suspended') void ctx.resume();
  } catch { /* Web Audio unavailable — degrade to silent */ }
}

function beep(freq: number, offset: number, duration: number, peak: number): void {
  if (!ctx) return;
  const t = ctx.currentTime + offset;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, t);
  // Quick attack, exponential decay — a clean bell-ish note (ramps can't hit 0).
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(peak, t + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + duration + 0.02);
}

export function playAlertSound(kind: AlertKind = 'done'): void {
  unlockAudio();
  if (!ctx || ctx.state !== 'running') return; // not yet unlocked by a gesture
  if (kind === 'question' || kind === 'permission') {
    beep(659.25, 0, 0.18, 0.20);    // E5
    beep(830.61, 0.16, 0.18, 0.20); // G#5
    beep(987.77, 0.32, 0.26, 0.22); // B5
  } else {
    beep(880.0, 0, 0.18, 0.18);     // A5
    beep(587.33, 0.17, 0.30, 0.18); // D5
  }
}

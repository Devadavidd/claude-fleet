import { test, expect } from 'vitest';
import { AlertTracker } from './alert-tracker.js';
import type { SessionCard } from '../../../shared/types/index.js';

const working = (id: string): SessionCard => ({ sessionId: id, status: 'working', title: id } as SessionCard);
const done = (id: string): SessionCard => ({ sessionId: id, status: 'waiting-for-you', pendingQuestion: null, title: id } as SessionCard);
const asking = (id: string): SessionCard =>
  ({ sessionId: id, status: 'waiting-for-you', pendingQuestion: { questions: [{ header: 'h' }] }, title: id } as unknown as SessionCard);

test('the first observation never fires (initial snapshot is history)', () => {
  const t = new AlertTracker();
  expect(t.observe([done('a'), asking('b')])).toEqual([]);
});

test('entering done chimes done; entering question chimes question', () => {
  const t = new AlertTracker();
  t.observe([working('a'), working('b')]);            // seed
  const fires = t.observe([done('a'), asking('b')]);
  expect(fires.map((f) => [f.card.sessionId, f.kind])).toEqual([['a', 'done'], ['b', 'question']]);
});

test('a still-waiting card does NOT re-chime on the next snapshot/heartbeat', () => {
  const t = new AlertTracker();
  t.observe([working('a')]);
  expect(t.observe([done('a')]).length).toBe(1);      // enter done
  expect(t.observe([done('a')]).length).toBe(0);      // still done — silent
  expect(t.observe([done('a')]).length).toBe(0);      // and again
});

test('a question appearing mid-wait re-chimes (done → question edge)', () => {
  const t = new AlertTracker();
  t.observe([working('a')]);
  t.observe([done('a')]);                             // done
  const fires = t.observe([asking('a')]);             // question appears while still waiting
  expect(fires).toEqual([{ card: expect.objectContaining({ sessionId: 'a' }), kind: 'question' }]);
});

test('leaving an alert state to quiet is silent; question→done still dings (turn ended)', () => {
  const t = new AlertTracker();
  t.observe([working('a')]);
  t.observe([asking('a')]);                           // question
  // question → done: the question resolved elsewhere but the turn still ended,
  // so it chimes 'done' (matches alertKindFor parity, alert-transitions.test).
  expect(t.observe([done('a')]).map((f) => f.kind)).toEqual(['done']);
  expect(t.observe([working('a')]).length).toBe(0);   // done → quiet: silent
});

test('reconnect: keys persist, so an unchanged snapshot is silent', () => {
  const t = new AlertTracker();
  t.observe([working('a')]);
  t.observe([done('a')]);                             // done (fired)
  // simulate a reconnect delivering the same authoritative snapshot
  expect(t.observe([done('a')]).length).toBe(0);
});

test('a vanished session is pruned — a later re-appearance is treated as fresh', () => {
  const t = new AlertTracker();
  t.observe([working('a')]);
  t.observe([done('a')]);                             // done
  t.observe([]);                                      // a gone
  // a re-appears already waiting → fresh quiet→done edge → chimes again
  expect(t.observe([done('a')]).length).toBe(1);
});

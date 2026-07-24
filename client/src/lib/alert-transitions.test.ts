import { test, expect } from 'vitest';
import { alertKeyFor, alertKindFor } from './alert-transitions.js';

// Regression for the silent-notification bug: a session that had already finished its turn
// (waiting, no question) and THEN asked a question stayed silent, because alerting keyed on
// status alone and 'waiting-for-you' → 'waiting-for-you' is not a transition.

test('alertKeyFor collapses a card to quiet/done/question', () => {
  expect(alertKeyFor({ status: 'working' })).toBe('quiet');
  expect(alertKeyFor({ status: 'idle' })).toBe('quiet');
  expect(alertKeyFor({ status: 'waiting-for-you' })).toBe('done');
  expect(alertKeyFor({ status: 'waiting-for-you', pendingQuestion: { questions: [{}] } })).toBe('question');
  expect(alertKeyFor(undefined)).toBe('quiet');
});

test('question appearing while already waiting chimes with the question tone', () => {
  expect(alertKindFor('done', 'question')).toBe('question'); // the exact reported bug
});

test('entering waiting from working chimes by kind', () => {
  expect(alertKindFor('quiet', 'done')).toBe('done');
  expect(alertKindFor('quiet', 'question')).toBe('question');
});

test('no chime when nothing changed or when leaving alert states', () => {
  expect(alertKindFor('done', 'done')).toBeNull();
  expect(alertKindFor('question', 'question')).toBeNull();
  expect(alertKindFor('question', 'quiet')).toBeNull(); // answered → back to work
  expect(alertKindFor('done', 'quiet')).toBeNull();
  expect(alertKindFor('question', 'done')).toBe('done'); // question resolved elsewhere, turn still ended
});

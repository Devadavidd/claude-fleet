import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isForeignWriterFresh, FOREIGN_WRITER_WINDOW_MS } from '../../dist/server/launch/resume-freshness-gate.js';

const NOW = 1_700_000_000_000;

test('quiet transcript (or none) never blocks', () => {
  assert.equal(isForeignWriterFresh(null, null, NOW), false);
  assert.equal(isForeignWriterFresh(NOW - FOREIGN_WRITER_WINDOW_MS, null, NOW), false);
  assert.equal(isForeignWriterFresh(NOW - FOREIGN_WRITER_WINDOW_MS - 1, NOW - 5_000, NOW), false);
});

test('fresh activity with no exit record blocks (foreign process may own the session)', () => {
  assert.equal(isForeignWriterFresh(NOW - 5_000, null, NOW), true);
  assert.equal(isForeignWriterFresh(NOW - 5_000, undefined, NOW), true);
  assert.equal(isForeignWriterFresh(NOW - (FOREIGN_WRITER_WINDOW_MS - 1), null, NOW), true);
});

test('our own just-exited child does not block: last writes precede the exit', () => {
  // Child wrote its final entries, then exited — the classic stop/finish → follow-up flow.
  const exitedAt = NOW - 2_000;
  assert.equal(isForeignWriterFresh(NOW - 3_000, exitedAt, NOW), false);
  // Final flush landing just after the reap is absorbed by the slack.
  assert.equal(isForeignWriterFresh(exitedAt + 9_000, exitedAt, NOW), false);
});

test('activity well AFTER our child exited blocks: someone else took the session over', () => {
  const exitedAt = NOW - 60_000;
  assert.equal(isForeignWriterFresh(NOW - 5_000, exitedAt, NOW), true);
});

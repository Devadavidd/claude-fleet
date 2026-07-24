import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initMetrics, recordUsage, recordFileTouch, tokensForCard, aggregateFileTouches } from '../../dist/server/domain/session-metrics.js';

const T0 = Date.parse('2026-07-21T10:00:00Z');

function usageEvent(ts, output, cacheRead = 0) {
  return { timestamp: new Date(ts).toISOString(), message: { usage: { output_tokens: output, cache_read_input_tokens: cacheRead } } };
}

test('recordUsage accrues totals and per-minute buckets', () => {
  const state = {};
  recordUsage(state, usageEvent(T0, 100, 5000));
  recordUsage(state, usageEvent(T0 + 30_000, 50)); // same minute
  recordUsage(state, usageEvent(T0 + 60_000, 200)); // next minute
  assert.equal(state.tokens.output, 350);
  assert.equal(state.tokens.cacheRead, 5000);
  const card = tokensForCard(state, T0 + 60_000);
  assert.equal(card.perMin.length, 30);
  assert.equal(card.perMin.at(-1), 200); // current minute
  assert.equal(card.perMin.at(-2), 150); // previous minute
});

test('buckets outside the 30-minute window are dropped', () => {
  const state = {};
  recordUsage(state, usageEvent(T0, 100));
  recordUsage(state, usageEvent(T0 + 45 * 60_000, 10)); // 45 min later
  assert.equal(state.tokenBuckets.size, 1); // old bucket evicted
  assert.equal(state.tokens.output, 110); // totals keep accruing
});

test('events without usage are ignored, malformed usage does not throw', () => {
  const state = {};
  recordUsage(state, { message: {} });
  recordUsage(state, { message: { usage: { output_tokens: 'garbage' } } });
  assert.equal(state.tokens.output, 0);
});

test('aggregateFileTouches merges sessions and sorts by recency', () => {
  const s1 = { sessionId: 's1', title: 'One', firstPrompt: '' };
  const s2 = { sessionId: 's2', title: 'Two', firstPrompt: '' };
  initMetrics(s1);
  initMetrics(s2);
  recordFileTouch(s1, '/repo/a.js', T0);
  recordFileTouch(s2, '/repo/a.js', T0 + 60_000);
  recordFileTouch(s2, '/repo/b.js', T0 + 30_000);
  const files = aggregateFileTouches([s1, s2, { sessionId: 's3' }]); // s3 has no metrics
  assert.equal(files[0].path, '/repo/a.js'); // most recent first
  assert.equal(files[0].count, 2);
  assert.deepEqual(files[0].sessions.map((s) => s.sessionId).sort(), ['s1', 's2']);
  assert.equal(files[1].path, '/repo/b.js');
});

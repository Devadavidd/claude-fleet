import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readTimeline } from '../../dist/server/readers/timeline-reader.js';

// Characterization of the timeline ring-buffer + live-append cursor. These
// semantics (bounded memory on huge files, `since` continuation, total count,
// offset) are the acceptance bar for the TS port of the drill-down reader.

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'sanitized-session-transcript.jsonl');

// A throwaway transcript with N structurally-valid lines + a couple corrupt ones.
function makeTranscript(validCount, { corrupt = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-timeline-'));
  const file = path.join(dir, 'session.jsonl');
  const lines = [];
  for (let i = 0; i < validCount; i += 1) {
    lines.push(JSON.stringify({ type: 'user', timestamp: `2026-07-21T10:00:${String(i % 60).padStart(2, '0')}.000Z`, n: i }));
  }
  if (corrupt) { lines.splice(1, 0, '{ not json'); lines.push('also broken }'); }
  fs.writeFileSync(file, lines.join('\n') + '\n');
  return file;
}

test('parses the sanitized fixture into events + total', async () => {
  const res = await readTimeline(FIXTURE);
  assert.ok(res.total > 0);
  assert.equal(res.events.length, res.total, 'small fixture fits under the default limit');
  assert.equal(res.offset, 0);
});

test('ring-buffers to the requested limit, keeping the LAST entries', async () => {
  const file = makeTranscript(50);
  const res = await readTimeline(file, { limit: 10 });
  assert.equal(res.total, 50);
  assert.equal(res.events.length, 10);
  assert.equal(res.offset, 40, 'offset = total - kept');
  // Kept window is the tail: last event has n=49.
  const last = res.events[res.events.length - 1];
  assert.equal(last.event.n, 49);
});

test('`since` returns only entries after the client cursor, still ring-bounded', async () => {
  const file = makeTranscript(50);
  const res = await readTimeline(file, { since: 45, limit: 1000 });
  assert.equal(res.total, 50);
  assert.equal(res.events.length, 5, 'only entries 46..50');
  assert.equal(res.events[0].event.n, 45);
});

test('since=0 on a large file cannot blow memory — capped at limit', async () => {
  const file = makeTranscript(5000);
  const res = await readTimeline(file, { since: 0, limit: 1000 });
  assert.equal(res.total, 5000);
  assert.ok(res.events.length <= 1000);
});

test('corrupt lines never crash — they become raw entries', async () => {
  const file = makeTranscript(5, { corrupt: true });
  const res = await readTimeline(file, { limit: 1000 });
  assert.ok(res.events.some((e) => e.kind === 'raw'), 'malformed lines survive as raw');
  assert.ok(res.events.some((e) => e.kind === 'event'), 'valid lines still parse');
});

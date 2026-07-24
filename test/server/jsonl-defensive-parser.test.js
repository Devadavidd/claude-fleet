import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLine } from '../../dist/server/readers/jsonl-defensive-parser.js';

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'sanitized-session-transcript.jsonl');

test('valid event line parses with kind=event', () => {
  const result = parseLine('{"type":"user","timestamp":"2026-07-21T10:00:00Z"}');
  assert.equal(result.kind, 'event');
  assert.equal(result.event.type, 'user');
});

test('malformed JSON falls back to raw instead of throwing', () => {
  const result = parseLine('this is not json {{{');
  assert.equal(result.kind, 'raw');
  assert.match(result.raw, /not json/);
});

test('JSON without a type string falls back to raw', () => {
  assert.equal(parseLine('{"noType":true}').kind, 'raw');
  assert.equal(parseLine('[1,2,3]').kind, 'raw');
  assert.equal(parseLine('"just a string"').kind, 'raw');
});

test('blank lines produce null', () => {
  assert.equal(parseLine(''), null);
  assert.equal(parseLine('   '), null);
});

test('huge corrupt lines are truncated', () => {
  const result = parseLine('x'.repeat(10_000));
  assert.equal(result.kind, 'raw');
  assert.ok(result.raw.length < 3000);
  assert.match(result.raw, /\+\d+ chars/);
});

test('full sanitized fixture parses without throwing; bad lines become raw', () => {
  const lines = fs.readFileSync(FIXTURE, 'utf8').split('\n').filter(Boolean);
  const parsed = lines.map((line) => parseLine(line));
  const events = parsed.filter((p) => p.kind === 'event');
  const raws = parsed.filter((p) => p.kind === 'raw');
  assert.equal(events.length, 7);
  assert.equal(raws.length, 2); // the non-JSON line and the type-less object
});

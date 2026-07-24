import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readTouchedFile } from '../../dist/server/readers/touched-file-reader.js';

// Characterization of the file-viewer security gate. The invariant the TS port
// MUST NOT weaken: the requested path is an EXACT lookup key into the tracked
// set — never normalized/canonicalized before the membership check, so a
// dir/sub/../file that would collapse onto a tracked sibling is still rejected.

function tmpFile(contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-touched-'));
  const file = path.join(dir, 'note.md');
  fs.writeFileSync(file, contents);
  return { dir, file };
}

// A session state carrying an explicit readable-files allow-list.
const stateWith = (...paths) => [{ readableFiles: new Set(paths), fileTouches: new Map() }];

test('serves a path present verbatim in the registry', async () => {
  const { file } = tmpFile('# hi\nbody');
  const res = await readTouchedFile(file, stateWith(file));
  assert.equal(res.status, 200);
  assert.equal(res.body.content, '# hi\nbody');
  assert.equal(res.body.binary, undefined);
});

test('rejects a path not in the registry (403, not a filesystem walk)', async () => {
  const { file } = tmpFile('secret');
  const res = await readTouchedFile(file, stateWith('/some/other/tracked/file.md'));
  assert.equal(res.status, 403);
  assert.match(res.body.error, /not a tracked file/);
});

test('EXACT membership: a non-normalized path that maps onto a tracked file is rejected', async () => {
  const { dir, file } = tmpFile('tracked');
  // Raw concat (NOT path.join, which would normalize): this string resolves to
  // the tracked file on disk, but is NOT the verbatim registry key — the gate
  // must reject it because it never path.normalizes before the allow-list check.
  const sneaky = `${dir}${path.sep}sub${path.sep}..${path.sep}note.md`;
  assert.notEqual(sneaky, file, 'precondition: the sneaky string differs from the key');
  const res = await readTouchedFile(sneaky, stateWith(file));
  assert.equal(res.status, 403, 'must not normalize before the allow-list check');
});

test('a registered-but-deleted file returns 404, not a crash', async () => {
  const { dir } = tmpFile('x');
  const gone = path.join(dir, 'deleted.md');
  const res = await readTouchedFile(gone, stateWith(gone));
  assert.equal(res.status, 404);
});

test('binary (null-byte) content returns the indicator, never inline content', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-touched-'));
  const file = path.join(dir, 'blob.bin');
  fs.writeFileSync(file, Buffer.from([0x00, 0x01, 0x02, 0x00, 0xff]));
  const res = await readTouchedFile(file, stateWith(file));
  assert.equal(res.status, 200);
  assert.equal(res.body.binary, true);
  assert.equal(res.body.content, undefined, 'binary content is never returned for rendering');
});

test('content over 512KB is flagged truncated and capped', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-touched-'));
  const file = path.join(dir, 'big.txt');
  fs.writeFileSync(file, 'a'.repeat(600 * 1024));
  const res = await readTouchedFile(file, stateWith(file));
  assert.equal(res.status, 200);
  assert.equal(res.body.truncated, true);
  assert.ok(res.body.content.length <= 512 * 1024);
  assert.equal(res.body.size, 600 * 1024, 'reports the true on-disk size');
});

test('the fileTouches map is also an accepted membership source', async () => {
  const { file } = tmpFile('via touches');
  const state = [{ readableFiles: new Set(), fileTouches: new Map([[file, { count: 1, lastAt: 0 }]]) }];
  const res = await readTouchedFile(file, state);
  assert.equal(res.status, 200);
});

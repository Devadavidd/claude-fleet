import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  saveUploads,
  sanitizeUploadName,
  sweepOldUploads,
  UploadError,
  MAX_UPLOAD_FILES,
  MAX_UPLOAD_FILE_BYTES,
} from '../../dist/server/http/upload-store.js';

// Pins the attachment-upload contract: sanitized basenames only, per-file and
// per-batch caps, all-or-nothing persistence, and confinement to the root dir.

function makeTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-uploads-'));
}

const b64 = (s) => Buffer.from(s).toString('base64');

test('saveUploads writes each file under a fresh batch dir and returns absolute paths', () => {
  const root = makeTmp();
  const { paths } = saveUploads(
    { files: [{ name: 'notes.md', dataBase64: b64('hello') }, { name: 'shot.png', dataBase64: b64('png-bytes') }] },
    root,
  );
  assert.equal(paths.length, 2);
  for (const p of paths) {
    assert.ok(path.isAbsolute(p));
    assert.ok(p.startsWith(root + path.sep), `confined to root: ${p}`);
    assert.ok(fs.existsSync(p));
  }
  assert.equal(fs.readFileSync(paths[0], 'utf8'), 'hello');
  assert.equal(path.basename(paths[0]), 'notes.md');
  // both files share one batch dir
  assert.equal(path.dirname(paths[0]), path.dirname(paths[1]));
});

test('two batches never collide (fresh uuid dir per call)', () => {
  const root = makeTmp();
  const a = saveUploads({ files: [{ name: 'same.txt', dataBase64: b64('a') }] }, root);
  const b = saveUploads({ files: [{ name: 'same.txt', dataBase64: b64('b') }] }, root);
  assert.notEqual(a.paths[0], b.paths[0]);
  assert.equal(fs.readFileSync(a.paths[0], 'utf8'), 'a');
  assert.equal(fs.readFileSync(b.paths[0], 'utf8'), 'b');
});

test('traversal and hostile names collapse to safe basenames', () => {
  assert.equal(sanitizeUploadName('../../etc/passwd', 0), 'passwd');
  assert.equal(sanitizeUploadName('..', 3), 'file-4');
  assert.equal(sanitizeUploadName('.env', 0), 'env');
  assert.equal(sanitizeUploadName('a b$(rm -rf)`x`.png', 0), 'abrm-rfx.png');
  assert.equal(sanitizeUploadName('', 1), 'file-2');
  assert.equal(sanitizeUploadName(null, 0), 'file-1');
  assert.equal(sanitizeUploadName('x'.repeat(300) + '.txt', 0).length, 120);
});

test('duplicate names within one batch are disambiguated, not overwritten', () => {
  const root = makeTmp();
  const { paths } = saveUploads(
    { files: [{ name: 'a.txt', dataBase64: b64('one') }, { name: 'a.txt', dataBase64: b64('two') }] },
    root,
  );
  assert.equal(new Set(paths).size, 2);
  assert.equal(fs.readFileSync(paths[0], 'utf8'), 'one');
  assert.equal(fs.readFileSync(paths[1], 'utf8'), 'two');
});

test('rejects: missing files, empty array, too many, bad/empty base64, oversize — writing nothing', () => {
  const root = makeTmp();
  assert.throws(() => saveUploads(null, root), UploadError);
  assert.throws(() => saveUploads({}, root), UploadError);
  assert.throws(() => saveUploads({ files: [] }, root), UploadError);
  const many = Array.from({ length: MAX_UPLOAD_FILES + 1 }, (_, i) => ({ name: `f${i}`, dataBase64: b64('x') }));
  assert.throws(() => saveUploads({ files: many }, root), UploadError);
  assert.throws(() => saveUploads({ files: [{ name: 'a', dataBase64: '@@not-base64@@' }] }, root), UploadError);
  assert.throws(() => saveUploads({ files: [{ name: 'a', dataBase64: '' }] }, root), UploadError);
  assert.throws(() => saveUploads({ files: [{ name: 'a' }] }, root), UploadError);
  // one bad file in a batch → nothing persisted (all-or-nothing)
  assert.throws(
    () => saveUploads({ files: [{ name: 'ok.txt', dataBase64: b64('fine') }, { name: 'bad', dataBase64: '!!' }] }, root),
    UploadError,
  );
  assert.equal(fs.readdirSync(root).length, 0, 'no partial batch dirs left behind');
});

test('a crafted name colliding with the dedupe prefix still never overwrites', () => {
  const root = makeTmp();
  const { paths } = saveUploads(
    {
      files: [
        { name: '3-a.txt', dataBase64: b64('first') },
        { name: 'a.txt', dataBase64: b64('second') },
        { name: 'a.txt', dataBase64: b64('third') }, // would dedupe to 3-a.txt — must re-loop
      ],
    },
    root,
  );
  assert.equal(new Set(paths).size, 3);
  assert.deepEqual(paths.map((p) => fs.readFileSync(p, 'utf8')).sort(), ['first', 'second', 'third']);
});

test('sweepOldUploads removes only batch dirs older than the max age', () => {
  const root = makeTmp();
  const oldDir = path.join(root, 'old-batch');
  const newDir = path.join(root, 'new-batch');
  fs.mkdirSync(oldDir);
  fs.writeFileSync(path.join(oldDir, 'x.txt'), 'x');
  fs.mkdirSync(newDir);
  const now = Date.now();
  const eightDaysAgo = new Date(now - 8 * 24 * 60 * 60 * 1000);
  fs.utimesSync(oldDir, eightDaysAgo, eightDaysAgo);

  const removed = sweepOldUploads(root, 7 * 24 * 60 * 60 * 1000, now);
  assert.equal(removed, 1);
  assert.ok(!fs.existsSync(oldDir));
  assert.ok(fs.existsSync(newDir));
  // missing root is a clean no-op
  assert.equal(sweepOldUploads(path.join(root, 'nope'), 1000), 0);
});

test('oversize file rejected at the decoded-bytes cap', () => {
  const root = makeTmp();
  const big = Buffer.alloc(MAX_UPLOAD_FILE_BYTES + 1).toString('base64');
  assert.throws(() => saveUploads({ files: [{ name: 'big.bin', dataBase64: big }] }, root), UploadError);
});

// resolveExistingDir lives in server.js — appended here to reuse the tmp-dir helpers.
import { resolveExistingDir } from '../../dist/server/http/server.js';

test('resolveExistingDir: real dir ok (canonicalized), missing dir refused', () => {
  const dir = makeTmp();
  const ok = resolveExistingDir(dir);
  assert.equal(ok.ok, true);
  assert.ok(fs.existsSync(ok.path));
  const gone = resolveExistingDir(path.join(dir, 'nope'));
  assert.equal(gone.ok, false);
  assert.match(gone.error, /no longer exists/);
  const file = path.join(dir, 'f.txt');
  fs.writeFileSync(file, 'x');
  assert.equal(resolveExistingDir(file).ok, false);
});

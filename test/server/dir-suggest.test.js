import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { suggestDirectories } from '../../dist/server/http/dir-suggest.js';

// Pins the folder-picker autocomplete: directories only, dotfolders hidden
// unless explicitly asked for, partial-segment filtering, junk-safe.

function makeTree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-dirs-'));
  fs.mkdirSync(path.join(root, 'projects'));
  fs.mkdirSync(path.join(root, 'proto'));
  fs.mkdirSync(path.join(root, 'docs'));
  fs.mkdirSync(path.join(root, '.secret'));
  fs.writeFileSync(path.join(root, 'notafolder.txt'), 'x');
  return root;
}

test('lists child directories of a complete path (trailing sep), files and dotdirs hidden', () => {
  const root = makeTree();
  const got = suggestDirectories(root + path.sep).map((s) => path.basename(s.path));
  assert.deepEqual(got, ['docs', 'projects', 'proto']);
});

test('a trailing partial segment filters the listing', () => {
  const root = makeTree();
  const got = suggestDirectories(path.join(root, 'pro')).map((s) => path.basename(s.path));
  assert.deepEqual(got, ['projects', 'proto']);
});

test('an explicit dot prefix reveals dotfolders', () => {
  const root = makeTree();
  const got = suggestDirectories(path.join(root, '.se')).map((s) => path.basename(s.path));
  assert.deepEqual(got, ['.secret']);
});

test('junk input is a clean empty list (relative paths, missing dirs)', () => {
  assert.deepEqual(suggestDirectories('not-absolute'), []);
  assert.deepEqual(suggestDirectories('/definitely/not/here/xyz'), []);
});

test('empty prefix starts from the home directory', () => {
  const got = suggestDirectories('');
  assert.ok(Array.isArray(got));
  for (const s of got) assert.ok(s.path.startsWith(os.homedir()));
});

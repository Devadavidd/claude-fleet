import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

// Black-box contract test for the generation collector: runs the real script the /ck:wiki
// skill invokes, so the hash-guard idempotency and journal-owner dedup are verified end to end.
const SCRIPT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', '.claude', 'skills', 'wiki', 'scripts', 'collect-wiki-sources.mjs',
);

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-collector-'));
}

function writePlan(root, slug, { status = 'completed', title = slug, branch = '' } = {}) {
  const dir = path.join(root, 'plans', slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'plan.md'),
    `---\ntitle: ${title}\nstatus: ${status}\nbranch: ${branch}\n---\n\n# ${title}\n\nbody text`);
}

function writeJournal(root, name, text = 'journal body') {
  const dir = path.join(root, 'docs', 'journals');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), text);
}

function collect(root, extra = []) {
  const out = execFileSync('node', [SCRIPT, '--root', root, ...extra], { encoding: 'utf8' });
  return JSON.parse(out);
}

test('collector reports create, then skip once the entry with its hash exists (idempotency)', () => {
  const root = tmpRoot();
  writePlan(root, '260101-1200-thing');

  const first = collect(root);
  assert.equal(first.items.length, 1);
  const item = first.items[0];
  assert.equal(item.action, 'create');
  assert.match(item.sourceHash, /^sha256:/);

  // Write a matching entry stamped with the collector's own hash.
  fs.mkdirSync(path.dirname(item.entryPath), { recursive: true });
  fs.writeFileSync(item.entryPath, `---\nsource_hash: ${item.sourceHash}\n---\n\n# x\n`);

  const second = collect(root);
  assert.equal(second.items[0].action, 'skip');

  // Change the source → hash changes → back to update.
  fs.writeFileSync(path.join(root, 'plans', '260101-1200-thing', 'plan.md'),
    '---\ntitle: t\nstatus: completed\n---\n\n# t\n\nDIFFERENT body');
  const third = collect(root);
  assert.equal(third.items[0].action, 'update');
});

test('a journal binds to its highest-overlap plan only (best-owner dedup)', () => {
  const root = tmpRoot();
  // Both slugs share >=3 tokens with the journal; the 4-token match must win, the 3-token loses.
  writePlan(root, '260201-1200-source-viewer-citation-sync', { title: 'A' }); // 4 shared words
  writePlan(root, '260202-1200-source-viewer-citation', { title: 'B' });      // 3 shared words
  writeJournal(root, '260201-1300-source-viewer-citation-sync.md');

  const { items } = collect(root);
  const a = items.find((i) => i.slug === '260201-1200-source-viewer-citation-sync');
  const b = items.find((i) => i.slug === '260202-1200-source-viewer-citation');
  assert.ok(a.journalPath, 'higher-overlap plan should own the journal');
  assert.equal(b.journalPath, null, 'lower-overlap plan must not borrow the same journal');
});

test('non-completed plans are excluded from generation', () => {
  const root = tmpRoot();
  writePlan(root, '260301-1200-pending-plan', { status: 'pending' });
  writePlan(root, '260301-1300-done-plan', { status: 'completed' });
  const { items } = collect(root);
  assert.equal(items.length, 1);
  assert.equal(items[0].slug, '260301-1300-done-plan');
});

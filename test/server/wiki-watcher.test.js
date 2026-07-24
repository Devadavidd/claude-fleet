import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { WikiWatcher } from '../../dist/server/watchers/wiki-watcher.js';

// Integration: a real chokidar watch over a temp docs/wiki must fire 'wiki-changed' when an
// entry file appears. Uses a fake reducer so no transcripts are involved.
test('emits wiki-changed when a docs/wiki entry is added', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-watch-'));
  const wikiDir = path.join(root, 'docs', 'wiki');
  fs.mkdirSync(wikiDir, { recursive: true });

  const reducer = { listProjectRoots: () => [root] };
  const watcher = new WikiWatcher({ reducer, syncMs: 1_000_000, debounceMs: 30 });
  watcher.start();

  // Give chokidar a moment to become ready before mutating the directory.
  await new Promise((r) => setTimeout(r, 250));
  const changed = once(watcher, 'wiki-changed');
  fs.writeFileSync(path.join(wikiDir, '260101-1200-x.md'), '---\nsource_hash: sha256:z\n---\n\n# x\n');

  // Resolve as soon as the event fires; fail if it does not within the window.
  const winner = await Promise.race([
    changed.then(() => 'changed'),
    new Promise((r) => setTimeout(() => r('timeout'), 4000)),
  ]);
  await watcher.stop();
  assert.equal(winner, 'changed');
});

// A plan.md status flip (plans/<slug>/plan.md) must also fire 'wiki-changed' so the Shipped
// tab refreshes the moment a plan is marked completed, without waiting for /ck:wiki.
test('emits wiki-changed when a plans/<slug>/plan.md changes', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-watch-'));
  const planDir = path.join(root, 'plans', '260101-1200-x');
  fs.mkdirSync(planDir, { recursive: true });
  const planPath = path.join(planDir, 'plan.md');
  fs.writeFileSync(planPath, '---\nstatus: in_progress\n---\n\n# x\n');

  const reducer = { listProjectRoots: () => [root] };
  const watcher = new WikiWatcher({ reducer, syncMs: 1_000_000, debounceMs: 30 });
  watcher.start();

  await new Promise((r) => setTimeout(r, 250));
  const changed = once(watcher, 'wiki-changed');
  fs.writeFileSync(planPath, '---\nstatus: completed\n---\n\n# x\n');

  const winner = await Promise.race([
    changed.then(() => 'changed'),
    new Promise((r) => setTimeout(() => r('timeout'), 4000)),
  ]);
  await watcher.stop();
  assert.equal(winner, 'changed');
});

// Churn from phase/report files under plans/ must NOT trigger a refresh — only plan.md matters.
test('ignores non-plan.md writes under plans/', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-watch-'));
  const planDir = path.join(root, 'plans', '260101-1200-x');
  fs.mkdirSync(planDir, { recursive: true });

  const reducer = { listProjectRoots: () => [root] };
  const watcher = new WikiWatcher({ reducer, syncMs: 1_000_000, debounceMs: 30 });
  watcher.start();

  await new Promise((r) => setTimeout(r, 250));
  let fired = false;
  watcher.on('wiki-changed', () => { fired = true; });
  fs.writeFileSync(path.join(planDir, 'phase-01-setup.md'), '# phase\n');

  await new Promise((r) => setTimeout(r, 1000));
  await watcher.stop();
  assert.equal(fired, false);
});

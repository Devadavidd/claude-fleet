import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { PlanWatcher } from '../../dist/server/watchers/plan-watcher.js';

// Integration: a real chokidar watch over a temp plans/ must fire 'plans-changed' when a
// phase-*.md is edited (a checkbox tick) — the Overview's durable progress depends on phase
// files, unlike the Shipped tab which only cares about plan.md. Fake reducer, no transcripts.
test('emits plans-changed when a phase-*.md checkbox changes', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-watch-'));
  const planDir = path.join(root, 'plans', '260101-1200-x');
  fs.mkdirSync(planDir, { recursive: true });
  const phasePath = path.join(planDir, 'phase-01-setup.md');
  fs.writeFileSync(phasePath, '---\nstatus: in-progress\n---\n\n- [ ] a\n');

  const reducer = { listProjectRoots: () => [root] };
  const watcher = new PlanWatcher({ reducer, syncMs: 1_000_000, debounceMs: 30 });
  watcher.start();

  await new Promise((r) => setTimeout(r, 250)); // let chokidar become ready
  const changed = once(watcher, 'plans-changed');
  fs.writeFileSync(phasePath, '---\nstatus: in-progress\n---\n\n- [x] a\n');

  const winner = await Promise.race([
    changed.then(() => 'changed'),
    new Promise((r) => setTimeout(() => r('timeout'), 4000)),
  ]);
  await watcher.stop();
  assert.equal(winner, 'changed');
});

test('emits plans-changed when a plan.md status flips', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-watch-'));
  const planDir = path.join(root, 'plans', '260101-1200-x');
  fs.mkdirSync(planDir, { recursive: true });
  const planPath = path.join(planDir, 'plan.md');
  fs.writeFileSync(planPath, '---\nstatus: in-progress\n---\n\n# x\n');

  const reducer = { listProjectRoots: () => [root] };
  const watcher = new PlanWatcher({ reducer, syncMs: 1_000_000, debounceMs: 30 });
  watcher.start();

  await new Promise((r) => setTimeout(r, 250));
  const changed = once(watcher, 'plans-changed');
  fs.writeFileSync(planPath, '---\nstatus: completed\n---\n\n# x\n');

  const winner = await Promise.race([
    changed.then(() => 'changed'),
    new Promise((r) => setTimeout(() => r('timeout'), 4000)),
  ]);
  await watcher.stop();
  assert.equal(winner, 'changed');
});

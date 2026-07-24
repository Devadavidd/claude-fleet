import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readPlanDir, readProjectPlans, readFleetPlans } from '../../dist/server/readers/plan-reader.js';

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'plan-reader-'));
}

function writePlan(root, slug, fm) {
  const dir = path.join(root, 'plans', slug);
  fs.mkdirSync(dir, { recursive: true });
  const lines = ['---', ...Object.entries(fm).map(([k, v]) => `${k}: ${v}`), '---', '', `# ${fm.title ?? slug}`, ''];
  fs.writeFileSync(path.join(dir, 'plan.md'), lines.join('\n'));
  return dir;
}

function writePhase(dir, file, fm, body) {
  const lines = ['---', ...Object.entries(fm).map(([k, v]) => `${k}: ${v}`), '---', '', body ?? ''];
  fs.writeFileSync(path.join(dir, file), lines.join('\n'));
}

test('rolls up checkbox progress from phase files', async () => {
  const root = tmpRoot();
  const dir = writePlan(root, '260722-1200-alpha', { title: 'Alpha', status: 'in-progress' });
  // 2 of 3 checked across two phases → 67%.
  writePhase(dir, 'phase-01-setup.md', { phase: 1, title: 'Setup', status: 'completed' }, '- [x] a\n- [x] b');
  writePhase(dir, 'phase-02-build.md', { phase: 2, title: 'Build', status: 'in-progress' }, '- [x] c\n- [ ] d\n- [ ] e');

  const plan = await readPlanDir(root, '260722-1200-alpha');
  assert.equal(plan.phaseTotal, 2);
  assert.equal(plan.progress.checked, 3);
  assert.equal(plan.progress.total, 5);
  assert.equal(plan.progress.pct, 60);
  // phase 1: all ticked → done; phase 2: partial → not done.
  assert.equal(plan.phaseDone, 1);
  assert.equal(plan.phases[0].pct, 100);
  assert.equal(plan.phases[1].done, false);
});

test('a phase with no checkboxes but completed status counts as done/100%', async () => {
  const root = tmpRoot();
  const dir = writePlan(root, '260722-1300-beta', { title: 'Beta', status: 'completed' });
  writePhase(dir, 'phase-01-only.md', { phase: 1, title: 'Only', status: 'completed' }, 'no checkboxes here');
  const plan = await readPlanDir(root, '260722-1300-beta');
  assert.equal(plan.shipped, true);
  assert.equal(plan.phaseDone, 1);
  assert.equal(plan.phases[0].pct, 100);
});

test('phase num falls back to the file name ordinal when frontmatter omits phase:', async () => {
  const root = tmpRoot();
  const dir = writePlan(root, '260722-2038-fleet-workflow', { title: 'FW', status: 'pending' });
  // No `phase:` key — the ordinal must come from the `phase-0N-` file name so live
  // tasks tagged "Phase N" still match the phase node.
  writePhase(dir, 'phase-01-watcher.md', { title: 'Watcher', status: 'pending' }, '- [ ] a');
  writePhase(dir, 'phase-05-launcher.md', { title: 'Launcher', status: 'pending' }, '- [ ] b');
  const plan = await readPlanDir(root, '260722-2038-fleet-workflow');
  assert.equal(plan.phases[0].num, 1);
  assert.equal(plan.phases[1].num, 5);
  // An explicit frontmatter phase still wins over the name.
  writePhase(dir, 'phase-05-launcher.md', { phase: 9, title: 'Launcher', status: 'pending' }, '- [ ] b');
  const plan2 = await readPlanDir(root, '260722-2038-fleet-workflow');
  assert.equal(plan2.phases[1].num, 9);
});

test('missing plan.md returns null (skipped, not fatal)', async () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, 'plans', '260722-1400-empty'), { recursive: true });
  assert.equal(await readPlanDir(root, '260722-1400-empty'), null);
  writePlan(root, '260722-1500-real', { title: 'Real', status: 'pending' });
  const plans = await readProjectPlans(root);
  assert.equal(plans.length, 1);
  assert.equal(plans[0].slug, '260722-1500-real');
});

test('readFleetPlans sorts newest date-prefixed slug first', async () => {
  const root = tmpRoot();
  writePlan(root, '260101-1200-old', { title: 'Old', status: 'completed' });
  writePlan(root, '260901-1200-new', { title: 'New', status: 'pending' });
  const plans = await readFleetPlans([root]);
  assert.equal(plans[0].slug, '260901-1200-new');
  assert.equal(plans[1].slug, '260101-1200-old');
});

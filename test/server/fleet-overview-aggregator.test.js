import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOverview } from '../../dist/server/readers/fleet-overview-aggregator.js';

const NOW = Date.parse('2026-07-22T12:00:00'); // local midday → same-day history stays same-day

function fixture() {
  const plans = [
    {
      slug: '260722-1200-alpha', project: 'proj', title: 'Alpha', status: 'in-progress', shipped: false,
      completed: '', tags: [], phaseTotal: 2, phaseDone: 1, progress: { checked: 3, total: 5, pct: 60 },
      phases: [
        { file: 'phase-01-setup.md', title: 'Setup', num: 1, status: 'completed', checked: 2, total: 2, pct: 100, done: true },
        { file: 'phase-02-build.md', title: 'Build', num: 2, status: 'in-progress', checked: 1, total: 3, pct: 33, done: false },
      ],
    },
    {
      slug: '260722-0100-beta', project: 'proj', title: 'Beta', status: 'completed', shipped: true,
      completed: '2026-07-22', tags: [], phaseTotal: 1, phaseDone: 1, progress: { checked: 1, total: 1, pct: 100 },
      phases: [{ file: 'phase-01-only.md', title: 'Only', num: 1, status: 'completed', checked: 1, total: 1, pct: 100, done: true }],
    },
  ];
  const liveTasks = [
    { id: '1', subject: 'do build', status: 'in_progress', column: 'in_progress', owner: 'lead', priority: 'P1',
      phase: 2, planDir: 'plans/260722-1200-alpha', planPath: '', blockedBy: [], sessionId: 's1', sessionTitle: 'Sess 1',
      history: [{ kind: 'created', status: 'pending', ts: NOW - 7_200_000, owner: 'lead' }, { status: 'in_progress', ts: NOW - 3_600_000, owner: 'lead' }] },
    { id: '2', subject: 'stray phase', status: 'completed', column: 'completed', owner: 'lead',
      phase: 9, planDir: 'plans/260722-1200-alpha', sessionId: 's1', sessionTitle: 'Sess 1',
      history: [{ status: 'completed', ts: NOW - 1_800_000, owner: 'lead' }] },
    { id: '3', subject: 'ad-hoc', status: 'pending', column: 'pending', owner: 'worker', planDir: '', history: [] },
  ];
  const cards = [
    { status: 'working', tokens: { output: 1000 } },
    { status: 'idle', tokens: { output: 500 } },
    { status: 'waiting-for-you', tokens: { output: 0 } },
  ];
  return { plans, liveTasks, cards, now: NOW };
}

test('rollup totals across plans, tasks, phases, sessions, tokens', () => {
  const { rollup } = buildOverview(fixture());
  assert.deepEqual(rollup.plans, { total: 2, shipped: 1, active: 1 });
  assert.deepEqual(rollup.tasks, { total: 3, pending: 1, in_progress: 1, completed: 1 });
  assert.deepEqual(rollup.phases, { total: 3, done: 2 });
  assert.deepEqual(rollup.sessions, { total: 3, working: 1, waiting: 1, idle: 1 });
  assert.equal(rollup.tokensOutput, 1500);
});

test('tree nests tasks Plan→Phase, loose when phase absent, adhoc when no plan', () => {
  const { tree } = buildOverview(fixture());
  assert.equal(tree.plans.length, 2);
  const alpha = tree.plans.find((p) => p.slug === '260722-1200-alpha');
  const phase2 = alpha.phases.find((ph) => ph.num === 2);
  assert.deepEqual(phase2.tasks.map((t) => t.id), ['1']); // matched phase
  assert.deepEqual(alpha.looseTasks.map((t) => t.id), ['2']); // plan matched, phase 9 did not
  assert.deepEqual(tree.adhoc.map((t) => t.id), ['3']); // no plan reference
});

test('velocity counts shipped plans this week and today task completions by hour', () => {
  const { velocity } = buildOverview(fixture());
  assert.equal(velocity.plansByWeek.length, 8);
  assert.equal(velocity.plansByWeek.reduce((n, w) => n + w.count, 0), 1); // beta shipped this window
  assert.equal(velocity.tasksTodayByHour.length, 24);
  assert.equal(velocity.tasksTodayByHour.reduce((n, h) => n + h.count, 0), 1); // task #2 completed today
  assert.equal(velocity.tasksTodayByHour[new Date(NOW - 1_800_000).getHours()].count, 1);
});

test('activity is newest-first and bounded, spanning all task histories', () => {
  const { activity } = buildOverview(fixture());
  assert.equal(activity.length, 3); // 2 (task#1) + 1 (task#2) + 0 (task#3)
  assert.equal(activity[0].taskId, '2'); // most recent transition
  assert.equal(activity[0].planSlug, '260722-1200-alpha');
});

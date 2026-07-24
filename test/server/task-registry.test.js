import { test } from 'node:test';
import assert from 'node:assert/strict';
import { columnFor, applyTaskEvent, resolveTaskCreateResult, taskSummaryFor, planFileSuffixes } from '../../dist/server/domain/task-registry.js';
import { SessionStateReducer, applyEvent, applyAgentEvent } from '../../dist/server/domain/session-state-reducer.js';

// A TaskCreate tool_use as it appears in a transcript. The assigned id comes
// back separately in the tool_result, so create then resolve.
function createBlock(id, subject, extra = {}) {
  return { type: 'tool_use', id, name: 'TaskCreate', input: { subject, ...extra } };
}
function createResult(toolUseId, n, subject) {
  return { type: 'tool_result', tool_use_id: toolUseId, content: `Task #${n} created successfully: ${subject}` };
}
function updateBlock(taskId, status, extra = {}) {
  return { type: 'tool_use', id: `u-${taskId}-${status}`, name: 'TaskUpdate', input: { taskId, status, ...extra } };
}

test('columnFor maps statuses to three columns, unknown → pending', () => {
  assert.equal(columnFor('completed'), 'completed');
  assert.equal(columnFor('done'), 'completed');
  assert.equal(columnFor('in_progress'), 'in_progress');
  assert.equal(columnFor('in-progress'), 'in_progress');
  assert.equal(columnFor('pending'), 'pending');
  assert.equal(columnFor('something-new'), 'pending');
  assert.equal(columnFor(undefined), 'pending');
});

test('create tool_use + matching result registers a task with parsed id and fields', () => {
  const state = {};
  applyTaskEvent(state, createBlock('tc1', 'Phase 1: registry', {
    description: 'build it', activeForm: 'Building', metadata: { phase: 1, priority: 'P1', planDir: 'plans/x' },
    addBlockedBy: [2, 3],
  }), { owner: 'lead', ts: 1000 });
  // Not registered until the result carries the id.
  assert.equal(taskSummaryFor(state).total, 0);
  resolveTaskCreateResult(state, 'tc1', 'Task #7 created successfully: Phase 1: registry', 'lead');
  const task = state.tasks.get('7');
  assert.ok(task, 'task registered under parsed id');
  assert.equal(task.subject, 'Phase 1: registry');
  assert.equal(task.priority, 'P1');
  assert.equal(task.phase, 1);
  assert.equal(task.planDir, 'plans/x');
  assert.deepEqual(task.blockedBy, ['2', '3']);
  assert.equal(task.owner, 'lead');
  assert.equal(task.column, 'pending');
  assert.equal(task.createdAt, 1000);
});

test('TaskUpdate to completed moves the task to the completed column', () => {
  const state = {};
  applyTaskEvent(state, createBlock('tc1', 'do a thing'), { owner: 'lead', ts: 1 });
  resolveTaskCreateResult(state, 'tc1', 'Task #1 created successfully: do a thing');
  assert.equal(taskSummaryFor(state).pending, 1);
  applyTaskEvent(state, updateBlock('1', 'completed'), { ts: 2 });
  assert.equal(state.tasks.get('1').column, 'completed');
  const s = taskSummaryFor(state);
  assert.deepEqual({ total: s.total, pending: s.pending, completed: s.completed }, { total: 1, pending: 0, completed: 1 });
});

test('TaskUpdate for an unknown id is fail-open: registers a stub, never throws', () => {
  const state = {};
  assert.doesNotThrow(() => applyTaskEvent(state, updateBlock('99', 'in_progress'), { owner: 'lead', ts: 5 }));
  const stub = state.tasks.get('99');
  assert.ok(stub);
  assert.equal(stub.column, 'in_progress');
  assert.match(stub.subject, /task 99/);
});

test('a racing create-result merges onto an earlier update stub, preserving status', () => {
  const state = {};
  applyTaskEvent(state, updateBlock('4', 'in_progress'), { ts: 1 }); // stub first
  applyTaskEvent(state, createBlock('tc4', 'real subject'), { owner: 'lead', ts: 2 });
  resolveTaskCreateResult(state, 'tc4', 'Task #4 created: real subject', 'lead');
  const task = state.tasks.get('4');
  assert.equal(task.subject, 'real subject'); // full data from create
  assert.equal(task.column, 'in_progress'); // status preserved from the prior update
});

test('malformed inputs never throw and leave the registry unchanged', () => {
  const state = {};
  assert.doesNotThrow(() => {
    applyTaskEvent(state, null, {});
    applyTaskEvent(state, { name: 'TaskCreate' }, {}); // no id
    applyTaskEvent(state, { name: 'TaskUpdate', input: {} }, {}); // no taskId
    applyTaskEvent(undefined, createBlock('x', 'y'), {});
    resolveTaskCreateResult(state, 'never-stashed', 'Task #1 created');
    resolveTaskCreateResult(state, 'x', null);
  });
  assert.equal(taskSummaryFor(state).total, 0);
  assert.deepEqual(taskSummaryFor(null), { total: 0, pending: 0, in_progress: 0, completed: 0 });
});

test('result text without a "Task #N" marker resolves to nothing', () => {
  const state = {};
  applyTaskEvent(state, createBlock('tc1', 'x'), { ts: 1 });
  resolveTaskCreateResult(state, 'tc1', 'some unrelated tool output');
  assert.equal(taskSummaryFor(state).total, 0);
});

// --- Integration through the reducer (proves the wiring) ---

test('reducer folds lead TaskCreate/TaskUpdate into the card taskSummary and listTasks', () => {
  const reducer = new SessionStateReducer({ now: () => Date.parse('2026-07-21T10:00:00Z') });
  const evt = (content) => ({ kind: 'event', event: { type: 'assistant', timestamp: '2026-07-21T09:00:00Z', message: { content } } });
  const usr = (content) => ({ kind: 'event', event: { type: 'user', timestamp: '2026-07-21T09:00:01Z', message: { content } } });
  reducer.ingest({ projectSlug: 'p', sessionId: 's1', entry: evt([createBlock('c1', 'Phase A')]) });
  reducer.ingest({ projectSlug: 'p', sessionId: 's1', entry: usr([createResult('c1', 1, 'Phase A')]) });
  reducer.ingest({ projectSlug: 'p', sessionId: 's1', entry: evt([updateBlock('1', 'completed')]) });

  const card = reducer.listCards()[0];
  assert.equal(card.taskSummary.total, 1);
  assert.equal(card.taskSummary.completed, 1);
  const tasks = reducer.listTasks('s1');
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].subject, 'Phase A');
  assert.equal(reducer.listTasks('missing'), null); // unknown session → 404 signal
});

test('subagent-emitted TaskCreate is owned by the worker label', () => {
  const state = {
    sessionId: 's', projectSlug: 'p', title: '', firstPrompt: '', status: 'idle',
    currentAction: '', filesTouched: new Set(), subagentCount: 0, subagents: new Map(),
    pendingToolUses: new Set(), pendingQuestion: null, lastActivityAt: null,
  };
  const meta = { agentType: 'planner', description: 'Plan the work' };
  applyAgentEvent(state, 'a1', meta, { kind: 'event', event: { type: 'assistant', timestamp: '2026-07-21T10:00:00Z', message: { content: [createBlock('c9', 'worker task')] } } });
  applyAgentEvent(state, 'a1', meta, { kind: 'event', event: { type: 'user', timestamp: '2026-07-21T10:00:01Z', message: { content: [createResult('c9', 9, 'worker task')] } } });
  const task = state.tasks.get('9');
  assert.ok(task);
  assert.equal(task.owner, 'Plan the work'); // agent.label (description) is the owner
});

test('planFileSuffixes lists phase file then plan.md, most-specific first', () => {
  assert.deepEqual(
    planFileSuffixes({ planDir: 'plans/a-feature', phaseFile: 'phase-02.md' }),
    ['plans/a-feature/phase-02.md', 'plans/a-feature/plan.md'],
  );
  assert.deepEqual(planFileSuffixes({ planDir: 'plans/a-feature/' }), ['plans/a-feature/plan.md']);
  assert.deepEqual(planFileSuffixes({ phaseFile: 'x.md' }), []); // no planDir → nothing
  assert.deepEqual(planFileSuffixes(null), []);
});

// A read of the real, absolute plan file — under a root that differs from any
// session cwd (cross-project team session). listTasks must locate it by suffix.
function readBlock(absPath) {
  return { type: 'tool_use', id: `rd-${absPath}`, name: 'Read', input: { file_path: absPath } };
}

test('listTasks resolves planPath by matching the relative planDir against a tracked file', () => {
  const reducer = new SessionStateReducer();
  const evt = (content) => ({ kind: 'event', event: { type: 'assistant', timestamp: '2026-07-21T09:00:00Z', message: { content } } });
  const usr = (content) => ({ kind: 'event', event: { type: 'user', timestamp: '2026-07-21T09:00:01Z', message: { content } } });
  reducer.ingest({ projectSlug: 'p', sessionId: 's', entry: evt([readBlock('/Users/me/repo/plans/feat/plan.md')]) });
  reducer.ingest({ projectSlug: 'p', sessionId: 's', entry: evt([createBlock('c1', 'Phase 3', { metadata: { planDir: 'plans/feat' } })]) });
  reducer.ingest({ projectSlug: 'p', sessionId: 's', entry: usr([createResult('c1', 3, 'Phase 3')]) });
  assert.equal(reducer.listTasks('s')[0].planPath, '/Users/me/repo/plans/feat/plan.md');
});

test('listTasks prefers the specific phase file over plan.md when both are tracked', () => {
  const reducer = new SessionStateReducer();
  const evt = (content) => ({ kind: 'event', event: { type: 'assistant', timestamp: '2026-07-21T09:00:00Z', message: { content } } });
  const usr = (content) => ({ kind: 'event', event: { type: 'user', timestamp: '2026-07-21T09:00:01Z', message: { content } } });
  reducer.ingest({ projectSlug: 'p', sessionId: 's', entry: evt([readBlock('/r/plans/feat/plan.md'), readBlock('/r/plans/feat/phase-03.md')]) });
  reducer.ingest({ projectSlug: 'p', sessionId: 's', entry: evt([createBlock('c1', 'P3', { metadata: { planDir: 'plans/feat', phaseFile: 'phase-03.md' } })]) });
  reducer.ingest({ projectSlug: 'p', sessionId: 's', entry: usr([createResult('c1', 3, 'P3')]) });
  assert.equal(reducer.listTasks('s')[0].planPath, '/r/plans/feat/phase-03.md');
});

test('listTasks planPath is empty when nothing in the plan dir was tracked', () => {
  const reducer = new SessionStateReducer();
  const evt = (content) => ({ kind: 'event', event: { type: 'assistant', timestamp: '2026-07-21T09:00:00Z', message: { content } } });
  const usr = (content) => ({ kind: 'event', event: { type: 'user', timestamp: '2026-07-21T09:00:01Z', message: { content } } });
  reducer.ingest({ projectSlug: 'p', sessionId: 's', entry: evt([createBlock('c1', 'P3', { metadata: { planDir: 'plans/untouched' } })]) });
  reducer.ingest({ projectSlug: 'p', sessionId: 's', entry: usr([createResult('c1', 3, 'P3')]) });
  assert.equal(reducer.listTasks('s')[0].planPath, '');
});

test('listTasks returns [] for a known session with no tasks', () => {
  const reducer = new SessionStateReducer();
  reducer.ingest({ projectSlug: 'p', sessionId: 's2', entry: { kind: 'event', event: { type: 'user', timestamp: '2026-07-21T10:00:00Z', message: { content: 'hi' } } } });
  assert.deepEqual(reducer.listTasks('s2'), []);
});

// --- Detail-drawer enrichment: phaseFile, field-merge on update, activity log ---

test('buildTask captures metadata.phaseFile and seeds a created history entry', () => {
  const state = {};
  applyTaskEvent(state, createBlock('tc1', 'P1', {
    metadata: { phase: 1, priority: 'P1', planDir: 'plans/x', phaseFile: 'phase-01-setup.md' },
  }), { owner: 'lead', ts: 1000 });
  resolveTaskCreateResult(state, 'tc1', 'Task #7 created successfully: P1', 'lead');
  const task = state.tasks.get('7');
  assert.equal(task.phaseFile, 'phase-01-setup.md');
  assert.equal(task.history.length, 1);
  assert.deepEqual(task.history[0], { kind: 'created', status: 'pending', ts: 1000, owner: 'lead' });
});

test('a later TaskUpdate merges refined description/subject/activeForm/metadata', () => {
  const state = {};
  applyTaskEvent(state, createBlock('tc1', 'orig subject', { description: 'orig', activeForm: 'Doing' }), { owner: 'lead', ts: 1 });
  resolveTaskCreateResult(state, 'tc1', 'Task #1 created successfully: orig subject', 'lead');
  applyTaskEvent(state, updateBlock('1', 'in_progress', {
    description: 'refined description', subject: 'new subject', activeForm: 'Refining',
    metadata: { priority: 'P0', phaseFile: 'phase-02.md' },
  }), { ts: 2 });
  const task = state.tasks.get('1');
  assert.equal(task.description, 'refined description');
  assert.equal(task.subject, 'new subject');
  assert.equal(task.activeForm, 'Refining');
  assert.equal(task.priority, 'P0');
  assert.equal(task.phaseFile, 'phase-02.md');
});

test('empty/absent update fields never clobber create-time values', () => {
  const state = {};
  applyTaskEvent(state, createBlock('tc1', 'keep me', { description: 'keep desc' }), { owner: 'lead', ts: 1 });
  resolveTaskCreateResult(state, 'tc1', 'Task #1 created successfully: keep me', 'lead');
  applyTaskEvent(state, updateBlock('1', 'completed', { description: '' }), { ts: 2 });
  const task = state.tasks.get('1');
  assert.equal(task.subject, 'keep me');
  assert.equal(task.description, 'keep desc');
});

test('each distinct status change appends one history entry; a repeat does not', () => {
  const state = {};
  applyTaskEvent(state, createBlock('tc1', 'x'), { owner: 'lead', ts: 1 });
  resolveTaskCreateResult(state, 'tc1', 'Task #1 created successfully: x', 'lead');
  applyTaskEvent(state, updateBlock('1', 'in_progress'), { owner: 'devA', ts: 2 });
  applyTaskEvent(state, updateBlock('1', 'in_progress'), { owner: 'devA', ts: 3 }); // repeat → no entry
  applyTaskEvent(state, updateBlock('1', 'completed'), { owner: 'devA', ts: 4 });
  const task = state.tasks.get('1');
  assert.deepEqual(task.history.map((h) => h.status), ['pending', 'in_progress', 'completed']);
  assert.deepEqual(task.history.map((h) => h.ts), [1, 2, 4]);
  assert.equal(task.history[1].owner, 'devA'); // transition owner recorded
});

test('update-before-create preserves the accumulated activity log after resolve', () => {
  const state = {};
  applyTaskEvent(state, updateBlock('4', 'in_progress'), { owner: 'devB', ts: 1 }); // stub
  applyTaskEvent(state, updateBlock('4', 'completed'), { owner: 'devB', ts: 2 });
  applyTaskEvent(state, createBlock('tc4', 'real'), { owner: 'lead', ts: 3 });
  resolveTaskCreateResult(state, 'tc4', 'Task #4 created successfully: real', 'lead');
  const task = state.tasks.get('4');
  assert.equal(task.subject, 'real');
  assert.equal(task.column, 'completed');
  assert.deepEqual(task.history.map((h) => h.status), ['in_progress', 'completed']);
});

test('addBlockedBy on update unions into blockedBy, deduped', () => {
  const state = {};
  applyTaskEvent(state, createBlock('tc1', 'x', { addBlockedBy: [2, 3] }), { ts: 1 });
  resolveTaskCreateResult(state, 'tc1', 'Task #1 created successfully: x');
  applyTaskEvent(state, updateBlock('1', 'in_progress', { addBlockedBy: [3, 4] }), { ts: 2 });
  assert.deepEqual(state.tasks.get('1').blockedBy, ['2', '3', '4']);
});

test('activity log is bounded at 100 entries, oldest dropped', () => {
  const state = {};
  applyTaskEvent(state, createBlock('tc1', 'x'), { ts: 0 }); // ts 0 → no seed entry
  resolveTaskCreateResult(state, 'tc1', 'Task #1 created successfully: x');
  for (let i = 0; i < 150; i++) applyTaskEvent(state, updateBlock('1', `s${i}`), { ts: i + 1 });
  const task = state.tasks.get('1');
  assert.equal(task.history.length, 100);
  assert.equal(task.history[task.history.length - 1].status, 's149');
});

// --- Plan association fallback: a metadata-less phase task still links to its plan ---

test('a metadata-less TaskCreate inherits the session activePlanDir and parses phase from subject', () => {
  const state = { activePlanDir: '/Users/me/repo/plans/260722-2038-fleet-workflow-view-and-launch' };
  applyTaskEvent(state, createBlock('tc1', 'Phase 1: Watcher unblock — surface workflow files'), { owner: 'lead', ts: 1000 });
  resolveTaskCreateResult(state, 'tc1', 'Task #1 created successfully: Phase 1: Watcher unblock', 'lead');
  const task = state.tasks.get('1');
  assert.equal(task.planDir, '/Users/me/repo/plans/260722-2038-fleet-workflow-view-and-launch');
  assert.equal(task.phase, 1);
});

test('explicit metadata.planDir/phase override the activePlanDir/subject fallback', () => {
  const state = { activePlanDir: '/repo/plans/fallback-slug' };
  applyTaskEvent(state, createBlock('tc1', 'Phase 9: x', { metadata: { planDir: 'plans/explicit', phase: 2 } }), { ts: 1 });
  resolveTaskCreateResult(state, 'tc1', 'Task #1 created: x');
  const t = state.tasks.get('1');
  assert.equal(t.planDir, 'plans/explicit'); // metadata wins over activePlanDir
  assert.equal(t.phase, 2); // metadata wins over the "Phase 9" subject
});

test('no activePlanDir and a non-phase subject leaves planDir empty and phase null (stays ad-hoc)', () => {
  const state = {};
  applyTaskEvent(state, createBlock('tc1', 'fix a random bug'), { ts: 1 });
  resolveTaskCreateResult(state, 'tc1', 'Task #1 created: fix a random bug');
  const t = state.tasks.get('1');
  assert.equal(t.planDir, '');
  assert.equal(t.phase, null);
});

test('reducer captures activePlanDir from a Plan Context attachment and stamps metadata-less tasks', () => {
  const reducer = new SessionStateReducer();
  const attach = (text) => ({ kind: 'event', event: { type: 'attachment', timestamp: '2026-07-22T13:00:00Z', cwd: '/repo', attachment: { content: text } } });
  const evt = (content) => ({ kind: 'event', event: { type: 'assistant', timestamp: '2026-07-22T13:00:01Z', message: { content } } });
  const usr = (content) => ({ kind: 'event', event: { type: 'user', timestamp: '2026-07-22T13:00:02Z', message: { content } } });
  reducer.ingest({ projectSlug: 'p', sessionId: 's', entry: attach('## Plan Context\n- Plan: /repo/plans/260722-2038-fw\n- Branch: main\n') });
  reducer.ingest({ projectSlug: 'p', sessionId: 's', entry: evt([createBlock('c1', 'Phase 2: parser')]) });
  reducer.ingest({ projectSlug: 'p', sessionId: 's', entry: usr([createResult('c1', 2, 'Phase 2: parser')]) });
  const task = reducer.listFleetTasks().find((t) => t.id === '2');
  assert.equal(task.planDir, '/repo/plans/260722-2038-fw');
  assert.equal(task.phase, 2);
});

test('a Plan Context of "none" does not set activePlanDir (task stays ad-hoc)', () => {
  const reducer = new SessionStateReducer();
  const attach = (text) => ({ kind: 'event', event: { type: 'attachment', timestamp: '2026-07-22T13:00:00Z', cwd: '/repo', attachment: { content: text } } });
  const evt = (content) => ({ kind: 'event', event: { type: 'assistant', timestamp: '2026-07-22T13:00:01Z', message: { content } } });
  const usr = (content) => ({ kind: 'event', event: { type: 'user', timestamp: '2026-07-22T13:00:02Z', message: { content } } });
  reducer.ingest({ projectSlug: 'p', sessionId: 's', entry: attach('## Plan Context\n- Plan: none\n') });
  reducer.ingest({ projectSlug: 'p', sessionId: 's', entry: evt([createBlock('c1', 'Phase 2: parser')]) });
  reducer.ingest({ projectSlug: 'p', sessionId: 's', entry: usr([createResult('c1', 2, 'Phase 2: parser')]) });
  assert.equal(reducer.listFleetTasks().find((t) => t.id === '2').planDir, '');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorkflowRegistry } from '../../dist/server/workflows/workflow-registry.js';

const ev = (event) => ({ kind: 'event', event });
const FIXED_NOW = Date.parse('2026-07-22T10:05:00Z');
const SCRIPT = `export const meta = {
  name: 'wf-one', description: 'd',
  phases: [ { title: 'Research', detail: 'x' } ],
}
() => agent(\`p\`, { agentType: 'researcher', label: 'topic-a', phase: 'Research' })`;

// Inject a synchronous script reader + zero debounce so emits are deterministic.
function makeRegistry(scriptText = SCRIPT) {
  return new WorkflowRegistry({ debounceMs: 0, now: () => FIXED_NOW, readScript: async () => scriptText });
}

const agentEvent = (workflowId, agentId, agentType) => ({
  projectSlug: 'p', sessionId: 's1', workflowId, agentId, agentMeta: { agentType, spawnDepth: 1 },
  filePath: `/x/s1/subagents/workflows/${workflowId}/agent-${agentId}.jsonl`,
  entry: ev({ type: 'assistant', timestamp: '2026-07-22T10:00:00Z', message: { usage: { output_tokens: 10 }, content: [{ type: 'tool_use', name: 'Read' }] } }),
});

test('lists two workflows in one session with projected summary fields', async () => {
  const reg = makeRegistry();
  reg.ingestEvent(agentEvent('wf_A', 'r1', 'researcher'));
  reg.ingestEvent(agentEvent('wf_B', 'r2', 'researcher'));
  await tick();
  const list = reg.listWorkflows();
  assert.equal(list.length, 2);
  const a = list.find((w) => w.workflowId === 'wf_A');
  assert.equal(a.name, 'wf-one');
  assert.equal(a.agentCount, 1);
  assert.equal(a.tokensTotal, 10);
  assert.equal(a.toolsTotal, 1);
  assert.equal(a.agents[0].label, 'topic-a');
  assert.equal(a.agents[0].phase, 'Research');
});

test('getWorkflow returns detail with agent rows; unknown → null', async () => {
  const reg = makeRegistry();
  reg.ingestEvent(agentEvent('wf_A', 'r1', 'researcher'));
  await tick();
  const detail = reg.getWorkflow('s1', 'wf_A');
  assert.equal(detail.agents.length, 1);
  assert.equal(detail.agents[0].agentId, 'r1');
  assert.equal(reg.getWorkflow('s1', 'nope'), null);
  assert.equal(reg.getWorkflow('nope', 'wf_A'), null);
});

test('removeSession drops the session and emits workflow-removed', async () => {
  const reg = makeRegistry();
  const removed = [];
  reg.on('workflow-removed', (p) => removed.push(p));
  reg.ingestEvent(agentEvent('wf_A', 'r1', 'researcher'));
  await tick();
  assert.equal(reg.listWorkflows().length, 1);
  reg.removeSession('s1');
  assert.equal(reg.listWorkflows().length, 0);
  assert.deepEqual(removed, [{ sessionId: 's1' }]);
});

test('emits workflow-updated with the projected run', async () => {
  const reg = makeRegistry();
  const updates = [];
  reg.on('workflow-updated', (wf) => updates.push(wf));
  reg.ingestEvent(agentEvent('wf_A', 'r1', 'researcher'));
  await tick();
  assert.ok(updates.length >= 1);
  assert.equal(updates.at(-1).workflowId, 'wf_A');
});

test('removeSession cancels a pending debounce so a removed workflow does not resurrect', async () => {
  const reg = new WorkflowRegistry({ debounceMs: 30, now: () => FIXED_NOW, readScript: async () => null });
  const order = [];
  reg.on('workflow-updated', (wf) => order.push(['updated', wf.sessionId]));
  reg.on('workflow-removed', (p) => order.push(['removed', p.sessionId]));
  reg.ingestEvent(agentEvent('wf_A', 'r1', 'researcher')); // schedules a debounced 'workflow-updated'
  reg.removeSession('s1'); // must cancel that pending emit
  await new Promise((r) => setTimeout(r, 60)); // past the debounce window
  const removedIdx = order.findIndex((e) => e[0] === 'removed');
  assert.ok(removedIdx >= 0, 'workflow-removed emitted');
  assert.ok(!order.slice(removedIdx + 1).some((e) => e[0] === 'updated'), 'no update after removal (no resurrection)');
  assert.equal(reg.listWorkflows().length, 0);
});

test('script load retries when the script is not on disk yet for the first event', async () => {
  let calls = 0;
  const reg = new WorkflowRegistry({ debounceMs: 0, now: () => FIXED_NOW, readScript: async () => (++calls === 1 ? null : SCRIPT) });
  reg.ingestEvent(agentEvent('wf_A', 'r1', 'researcher')); // 1st read → null (script not written yet)
  await tick();
  assert.equal(reg.getWorkflow('s1', 'wf_A').name, null); // meta not populated yet
  reg.ingestEvent(agentEvent('wf_A', 'r2', 'researcher')); // 2nd read → script now present
  await tick();
  assert.equal(reg.getWorkflow('s1', 'wf_A').name, 'wf-one'); // meta populated on retry
});

// let the injected async readScript microtask resolve
const tick = () => new Promise((r) => setTimeout(r, 5));

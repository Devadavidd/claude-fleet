import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createWorkflow, applyMeta, applyJournalLine, applyAgentEvent, agentStatus, workflowStatus,
} from '../../dist/server/workflows/workflow-run-fold.js';

const ev = (event) => ({ kind: 'event', event });
const META = {
  agentSpecs: [
    { agentType: 'researcher', label: 'A', phase: 'Research' },
    { agentType: 'researcher', label: 'B', phase: 'Research' },
    { agentType: 'general-purpose', label: 'C', phase: 'Author' },
  ],
};

test('journal started→running, later result→done', () => {
  const wf = createWorkflow({ sessionId: 's1', workflowId: 'wf', projectSlug: 'p' });
  applyJournalLine(wf, ev({ type: 'started', agentId: 'r1' }));
  assert.equal(wf.agents.get('r1').status, 'running');
  applyJournalLine(wf, ev({ type: 'result', agentId: 'r1' }));
  assert.equal(wf.agents.get('r1').status, 'done');
});

test('agent events sum output tokens, count tool_use, and span duration', () => {
  const wf = createWorkflow({ sessionId: 's1', workflowId: 'wf', projectSlug: 'p' });
  const meta = { agentType: 'researcher' };
  applyAgentEvent(wf, 'r1', meta, ev({ type: 'assistant', timestamp: '2026-07-22T10:00:00Z', message: { usage: { output_tokens: 100 }, content: [{ type: 'tool_use', name: 'Read' }] } }));
  applyAgentEvent(wf, 'r1', meta, ev({ type: 'assistant', timestamp: '2026-07-22T10:00:30Z', message: { usage: { output_tokens: 50 }, content: [{ type: 'tool_use', name: 'Grep' }, { type: 'text' }] } }));
  const a = wf.agents.get('r1');
  assert.equal(a.tokens, 150);
  assert.equal(a.toolCount, 2);
  assert.equal(a.lastAt - a.startedAt, 30_000);
});

test('associates label/phase by agentType-bucket positional order', () => {
  const wf = createWorkflow({ sessionId: 's1', workflowId: 'wf', projectSlug: 'p' });
  applyMeta(wf, META);
  // started order interleaves types; each agent still gets the right bucket slot.
  applyAgentEvent(wf, 'r1', { agentType: 'researcher' }, ev({ type: 'assistant', message: {} }));
  applyAgentEvent(wf, 'g1', { agentType: 'general-purpose' }, ev({ type: 'assistant', message: {} }));
  applyAgentEvent(wf, 'r2', { agentType: 'researcher' }, ev({ type: 'assistant', message: {} }));
  assert.deepEqual(pick(wf, 'r1'), { label: 'A', phase: 'Research' });
  assert.deepEqual(pick(wf, 'r2'), { label: 'B', phase: 'Research' });
  assert.deepEqual(pick(wf, 'g1'), { label: 'C', phase: 'Author' });
});

test('overflow past static specs caps to the bucket last spec (phase preserved)', () => {
  const wf = createWorkflow({ sessionId: 's1', workflowId: 'wf', projectSlug: 'p' });
  applyMeta(wf, { agentSpecs: [{ agentType: 'general-purpose', label: 'C', phase: 'Author' }] });
  applyAgentEvent(wf, 'g1', { agentType: 'general-purpose' }, ev({ type: 'assistant', message: {} }));
  applyAgentEvent(wf, 'g2', { agentType: 'general-purpose' }, ev({ type: 'assistant', message: {} }));
  assert.equal(pick(wf, 'g2').phase, 'Author'); // dynamic .map agent still gets the phase
});

test('meta arriving after agents re-associates them', () => {
  const wf = createWorkflow({ sessionId: 's1', workflowId: 'wf', projectSlug: 'p' });
  applyAgentEvent(wf, 'r1', { agentType: 'researcher' }, ev({ type: 'assistant', message: {} }));
  assert.equal(wf.agents.get('r1').phase, null); // no meta yet
  applyMeta(wf, META);
  assert.equal(wf.agents.get('r1').phase, 'Research');
});

test('defensive: raw/unknown entries leave the aggregate untouched', () => {
  const wf = createWorkflow({ sessionId: 's1', workflowId: 'wf', projectSlug: 'p' });
  applyJournalLine(wf, { kind: 'raw', raw: 'garbage' });
  applyAgentEvent(wf, 'x', null, { kind: 'raw', raw: 'garbage' });
  assert.equal(wf.agents.size, 0);
});

test('status derives idle when running but long silent; workflow done when all done', () => {
  const wf = createWorkflow({ sessionId: 's1', workflowId: 'wf', projectSlug: 'p' });
  const now = Date.parse('2026-07-22T10:10:00Z');
  applyAgentEvent(wf, 'r1', { agentType: 'researcher' }, ev({ type: 'assistant', timestamp: '2026-07-22T10:00:00Z', message: {} }));
  assert.equal(agentStatus(wf.agents.get('r1'), now), 'idle'); // 10 min silent, no result
  assert.equal(workflowStatus(wf, now), 'done'); // nothing actively running
  applyJournalLine(wf, ev({ type: 'result', agentId: 'r1' }));
  assert.equal(agentStatus(wf.agents.get('r1'), now), 'done');
});

function pick(wf, id) {
  const a = wf.agents.get(id);
  return { label: a.label, phase: a.phase };
}

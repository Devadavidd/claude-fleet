import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { identifyPath } from '../../dist/server/watchers/transcript-path.js';

const root = path.join(path.sep, 'projects');
const p = (...segs) => path.join(root, ...segs);

test('classifies a main session transcript', () => {
  const info = identifyPath(root, p('slug', 'sess-1.jsonl'));
  assert.equal(info.kind, 'session');
  assert.equal(info.projectSlug, 'slug');
  assert.equal(info.sessionId, 'sess-1');
  assert.equal(info.agentId, undefined);
});

test('classifies a subagent transcript (regression vs the old identify)', () => {
  const info = identifyPath(root, p('slug', 'sess-1', 'subagents', 'agent-abc123.jsonl'));
  assert.equal(info.kind, 'agent');
  assert.equal(info.sessionId, 'sess-1');
  assert.equal(info.agentId, 'abc123');
  assert.equal(info.workflowId, undefined);
});

test('classifies a workflow-agent transcript', () => {
  const info = identifyPath(root, p('slug', 'sess-1', 'subagents', 'workflows', 'wf_X', 'agent-abc123.jsonl'));
  assert.equal(info.kind, 'workflow-agent');
  assert.equal(info.sessionId, 'sess-1');
  assert.equal(info.workflowId, 'wf_X');
  assert.equal(info.agentId, 'abc123');
});

test('classifies a workflow journal', () => {
  const info = identifyPath(root, p('slug', 'sess-1', 'subagents', 'workflows', 'wf_X', 'journal.jsonl'));
  assert.equal(info.kind, 'workflow-journal');
  assert.equal(info.sessionId, 'sess-1');
  assert.equal(info.workflowId, 'wf_X');
  assert.equal(info.agentId, undefined);
});

test('a workflow path is NOT misclassified as a subagent named "workflows"', () => {
  const info = identifyPath(root, p('slug', 'sess-1', 'subagents', 'workflows', 'wf_X', 'agent-abc123.jsonl'));
  assert.notEqual(info.kind, 'agent');
  assert.notEqual(info.agentId, 'workflows');
});

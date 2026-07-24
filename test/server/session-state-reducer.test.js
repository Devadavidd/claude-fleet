import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SessionStateReducer, applyEvent, applyAgentEvent } from '../../dist/server/domain/session-state-reducer.js';
import { identifyPath } from '../../dist/server/watchers/transcript-path.js';
import { summarizeToolUse } from '../../dist/server/domain/tool-call-summarizer.js';
import { parseLine } from '../../dist/server/readers/jsonl-defensive-parser.js';

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'sanitized-session-transcript.jsonl');

function freshState() {
  return {
    sessionId: 's1', projectSlug: 'p1', title: '', firstPrompt: '', status: 'idle',
    currentAction: '', filesTouched: new Set(), subagentCount: 0, subagents: new Map(),
    pendingToolUses: new Set(), pendingQuestion: null, lastActivityAt: null,
  };
}

function fixtureEntries() {
  return fs.readFileSync(FIXTURE, 'utf8').split('\n').filter(Boolean).map((l) => parseLine(l));
}

test('fixture replay: title precedence, files touched, tool_result correlation, final status', () => {
  const state = freshState();
  for (const entry of fixtureEntries()) applyEvent(state, entry);
  assert.equal(state.title, 'Fixture Session Title'); // custom-title wins over first prompt
  assert.match(state.firstPrompt, /first user prompt text/);
  assert.ok(!state.firstPrompt.includes('<command-message>')); // command tags stripped
  assert.deepEqual([...state.filesTouched], ['/tmp/example.js']);
  assert.equal(state.pendingToolUses.size, 0); // tool_result cleared the pending tool_use
  assert.equal(state.status, 'waiting-for-you'); // last assistant turn was plain text
});

test('status transitions: prompt → working, tool_use → working, text reply → waiting', () => {
  const state = freshState();
  applyEvent(state, { kind: 'event', event: { type: 'user', timestamp: '2026-07-21T10:00:00Z', message: { role: 'user', content: 'hello' } } });
  assert.equal(state.status, 'working');
  applyEvent(state, { kind: 'event', event: { type: 'assistant', timestamp: '2026-07-21T10:00:01Z', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }] } } });
  assert.equal(state.status, 'working');
  assert.match(state.currentAction, /Bash/);
  applyEvent(state, { kind: 'event', event: { type: 'assistant', timestamp: '2026-07-21T10:00:02Z', message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] } } });
  assert.equal(state.status, 'waiting-for-you');
});

test('subagent tool_use increments subagentCount', () => {
  const state = freshState();
  applyEvent(state, { kind: 'event', event: { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't2', name: 'Task', input: { description: 'explore repo' } }] } } });
  assert.equal(state.subagentCount, 1);
});

test('raw entries and unknown event types never throw and leave status untouched', () => {
  const state = freshState();
  applyEvent(state, { kind: 'raw', raw: 'garbage' });
  applyEvent(state, { kind: 'event', event: { type: 'totally-new-event-kind', timestamp: '2026-07-21T10:00:00Z' } });
  assert.equal(state.status, 'idle');
  assert.equal(state.lastActivityAt, Date.parse('2026-07-21T10:00:00Z'));
});

test('toCard overlays idle when lastActivityAt is stale (injected clock, no timers)', () => {
  const reducer = new SessionStateReducer({ idleMinutes: 5, now: () => Date.parse('2026-07-21T10:10:00Z') });
  reducer.ingest({ projectSlug: 'p1', sessionId: 's1', entry: { kind: 'event', event: { type: 'user', timestamp: '2026-07-21T10:00:00Z', message: { content: 'hi' } } } });
  const card = reducer.listCards()[0];
  assert.equal(card.status, 'idle'); // 10 min silence > 5 min threshold
});

test('agent events build labeled worker rows: running on tool_use, done on final text', () => {
  const state = freshState();
  const meta = { agentType: 'code-reviewer', description: 'Review repo' };
  applyAgentEvent(state, 'a1', meta, { kind: 'event', event: { type: 'assistant', timestamp: '2026-07-21T10:00:00Z', message: { content: [{ type: 'tool_use', id: 't1', name: 'Grep', input: { pattern: 'foo' } }] } } });
  const agent = state.subagents.get('a1');
  assert.equal(agent.label, 'Review repo');
  assert.equal(agent.status, 'running');
  assert.match(agent.currentAction, /Grep/);
  assert.equal(state.status, 'working'); // worker activity keeps parent working
  applyAgentEvent(state, 'a1', meta, { kind: 'event', event: { type: 'assistant', timestamp: '2026-07-21T10:00:05Z', message: { content: [{ type: 'text', text: 'final report' }] } } });
  assert.equal(state.subagents.get('a1').status, 'done');
  assert.equal(state.lastActivityAt, Date.parse('2026-07-21T10:00:05Z'));
});

test('card exposes agents array and overlays idle on silent running workers', () => {
  const reducer = new SessionStateReducer({ idleMinutes: 5, now: () => Date.parse('2026-07-21T10:10:00Z') });
  reducer.ingest({ projectSlug: 'p1', sessionId: 's1', agentId: 'a1', agentMeta: { description: 'Worker' }, entry: { kind: 'event', event: { type: 'assistant', timestamp: '2026-07-21T10:00:00Z', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }] } } } });
  const card = reducer.listCards()[0];
  assert.equal(card.agents.length, 1);
  assert.equal(card.agents[0].status, 'idle'); // silent 10 min > 5 min threshold
  assert.equal(card.subagentCount, 1);
  reducer.removeAgent('s1', 'a1');
  assert.equal(reducer.listCards()[0].agents.length, 0);
});

test('identifyPath distinguishes session vs subagent transcript paths', () => {
  // Path classification moved to the pure transcript-path module (see
  // transcript-path.test.js for the full matrix incl. workflow paths).
  const sess = identifyPath('/root', '/root/-proj/sess-1.jsonl');
  assert.equal(sess.kind, 'session');
  assert.equal(sess.projectSlug, '-proj');
  assert.equal(sess.sessionId, 'sess-1');
  const agent = identifyPath('/root', '/root/-proj/sess-1/subagents/agent-abc123.jsonl');
  assert.equal(agent.kind, 'agent');
  assert.equal(agent.sessionId, 'sess-1');
  assert.equal(agent.agentId, 'abc123');
});

test('AskUserQuestion surfaces the question and blocks the session; the answer clears it', () => {
  const state = freshState();
  applyEvent(state, { kind: 'event', event: { type: 'assistant', timestamp: '2026-07-21T10:00:00Z', message: { content: [{ type: 'tool_use', id: 'q1', name: 'AskUserQuestion', input: { questions: [{ header: 'Pick', question: 'Which one?', multiSelect: true, options: [{ label: 'A' }, { label: 'B' }] }] } }] } } });
  assert.equal(state.status, 'waiting-for-you');
  assert.equal(state.pendingQuestion.toolUseId, 'q1');
  assert.equal(state.pendingQuestion.questions[0].header, 'Pick');
  assert.deepEqual(state.pendingQuestion.questions[0].options, ['A', 'B']);
  assert.equal(state.pendingQuestion.questions[0].multiSelect, true);
  // The user's answer arrives as a tool_result for that id.
  applyEvent(state, { kind: 'event', event: { type: 'user', timestamp: '2026-07-21T10:00:30Z', message: { content: [{ type: 'tool_result', tool_use_id: 'q1', content: 'A' }] } } });
  assert.equal(state.pendingQuestion, null);
  assert.equal(state.status, 'working');
});

test('a headless is_error result keeps the question pending; the steered user message clears it', () => {
  const state = freshState();
  applyEvent(state, { kind: 'event', event: { type: 'assistant', timestamp: '2026-07-21T10:00:00Z', message: { content: [{ type: 'tool_use', id: 'q1', name: 'AskUserQuestion', input: { questions: [{ header: 'Pick', question: 'Which one?', multiSelect: false, options: [{ label: 'A' }, { label: 'B' }] }] } }] } } });
  // Headless launches can't render the dialog — the harness errors the call
  // instantly while the model still waits for the choice as a user message.
  applyEvent(state, { kind: 'event', event: { type: 'user', timestamp: '2026-07-21T10:00:01Z', message: { content: [{ type: 'tool_result', tool_use_id: 'q1', content: 'Answer questions?', is_error: true }] } } });
  assert.equal(state.pendingQuestion?.toolUseId, 'q1', 'error result must not swallow the question');
  assert.equal(state.status, 'waiting-for-you');
  // The web chips answer via a steered plain user message — that clears it.
  applyEvent(state, { kind: 'event', event: { type: 'user', timestamp: '2026-07-21T10:00:30Z', message: { content: 'A' } } });
  assert.equal(state.pendingQuestion, null);
  assert.equal(state.status, 'working');
});

test('ExitPlanMode surfaces a plan-approval pending question', () => {
  const state = freshState();
  applyEvent(state, { kind: 'event', event: { type: 'assistant', timestamp: '2026-07-21T10:00:00Z', message: { content: [{ type: 'tool_use', id: 'p1', name: 'ExitPlanMode', input: { plan: '...' } }] } } });
  assert.equal(state.status, 'waiting-for-you');
  assert.equal(state.pendingQuestion.kind, 'plan');
});

test('summarizer degrades gracefully on unknown tools and missing input', () => {
  assert.match(summarizeToolUse({ name: 'BrandNewTool', input: { a: 1 } }).summary, /BrandNewTool/);
  assert.equal(summarizeToolUse({}).tool, 'unknown-tool');
  const edit = summarizeToolUse({ name: 'Edit', input: { file_path: '/x/y/main.js', old_string: 'a', new_string: 'b' } });
  assert.equal(edit.isFileWrite, true);
  assert.equal(edit.isFileRead, false);
  assert.match(edit.summary, /main\.js/);
  const read = summarizeToolUse({ name: 'Read', input: { file_path: '/x/y/main.js' } });
  assert.equal(read.isFileRead, true);
  assert.equal(read.isFileWrite, false);
});

test('Read registers a previewable path without polluting the write heatmap', () => {
  const state = freshState();
  applyEvent(state, { kind: 'event', event: { type: 'assistant', timestamp: '2026-07-21T10:00:00Z', message: { content: [{ type: 'tool_use', id: 'r1', name: 'Read', input: { file_path: '/x/y/read-only.js' } }] } } });
  assert.ok(state.readableFiles.has('/x/y/read-only.js')); // previewable via /api/file
  assert.ok(!state.fileTouches.has('/x/y/read-only.js')); // but never counted as a write
  assert.ok(!state.filesTouched.has('/x/y/read-only.js'));
});

test('Write registers the path in both the readable set and the write heatmap', () => {
  const state = freshState();
  applyEvent(state, { kind: 'event', event: { type: 'assistant', timestamp: '2026-07-21T10:00:01Z', message: { content: [{ type: 'tool_use', id: 'w1', name: 'Write', input: { file_path: '/x/y/written.js', content: 'x' } }] } } });
  assert.ok(state.readableFiles.has('/x/y/written.js'));
  assert.ok(state.fileTouches.has('/x/y/written.js'));
  assert.ok(state.filesTouched.has('/x/y/written.js'));
});

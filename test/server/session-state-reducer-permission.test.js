import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionStateReducer } from '../../dist/server/domain/session-state-reducer.js';

// Permission-approval integration on the reducer: setPendingPermission flips
// the card to waiting-for-you, clearPendingPermission releases it (guarded by
// requestId), and lead tool_results emit 'tool-result' for broker GC.

const PERMISSION_QUESTION = {
  toolUseId: 'toolu_1',
  kind: 'permission',
  requestId: 'req-1',
  askedAt: 1000,
  questions: [{ header: 'Permission: Bash', question: '$ npm test', multiSelect: false, options: ['Allow', 'Deny'] }],
};

function userEvent(blocks) {
  // Recent timestamp: an ancient one would decay the card to 'idle' and mask
  // the working/waiting assertions below.
  return {
    kind: 'event',
    event: { type: 'user', timestamp: new Date().toISOString(), message: { role: 'user', content: blocks } },
  };
}

test('setPendingPermission flips an unknown session to waiting-for-you', () => {
  const reducer = new SessionStateReducer({ debounceMs: 0 });
  reducer.setPendingPermission('sess-1', PERMISSION_QUESTION);
  const card = reducer.listCards().find((c) => c.sessionId === 'sess-1');
  assert.equal(card.status, 'waiting-for-you');
  assert.equal(card.pendingQuestion.kind, 'permission');
  assert.equal(card.pendingQuestion.requestId, 'req-1');
  assert.match(card.currentAction, /Permission: Bash/);
});

test('clearPendingPermission releases only the matching request', () => {
  const reducer = new SessionStateReducer({ debounceMs: 0 });
  // A real session (transcript-backed) so the ghost-GC below does not apply.
  reducer.ingest({ projectSlug: 'proj', sessionId: 'sess-1', entry: userEvent('do the thing') });
  reducer.setPendingPermission('sess-1', PERMISSION_QUESTION);
  reducer.clearPendingPermission('sess-1', 'req-OTHER'); // stale resolve → ignored
  assert.equal(reducer.listCards()[0].status, 'waiting-for-you');
  reducer.clearPendingPermission('sess-1', 'req-1');
  const card = reducer.listCards()[0];
  assert.equal(card.pendingQuestion, null);
  assert.equal(card.status, 'working');
});

test('a session minted only by a permission request is dropped on clear (ghost GC)', () => {
  const reducer = new SessionStateReducer({ debounceMs: 0 });
  const removed = [];
  reducer.on('session-removed', (p) => removed.push(p));
  reducer.setPendingPermission('spoofed-sess', PERMISSION_QUESTION);
  assert.equal(reducer.listCards().length, 1);
  reducer.clearPendingPermission('spoofed-sess', 'req-1');
  assert.equal(reducer.listCards().length, 0); // no blank ghost card left behind
  assert.deepEqual(removed, [{ sessionId: 'spoofed-sess' }]);
});

test('clearPendingPermission never clears an AskUserQuestion', () => {
  const reducer = new SessionStateReducer({ debounceMs: 0 });
  reducer.setPendingPermission('sess-1', { ...PERMISSION_QUESTION, kind: 'question', requestId: undefined });
  reducer.clearPendingPermission('sess-1', 'req-1');
  assert.equal(reducer.listCards()[0].pendingQuestion?.kind, 'question');
});

test('lead tool_result emits tool-result for broker GC', () => {
  const reducer = new SessionStateReducer({ debounceMs: 0 });
  const seen = [];
  reducer.on('tool-result', (p) => seen.push(p));
  reducer.ingest({
    projectSlug: 'proj',
    sessionId: 'sess-1',
    entry: userEvent([{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok' }]),
  });
  assert.deepEqual(seen, [{ sessionId: 'sess-1', toolUseId: 'toolu_1' }]);
});

test('subagent events do not emit tool-result', () => {
  const reducer = new SessionStateReducer({ debounceMs: 0 });
  const seen = [];
  reducer.on('tool-result', (p) => seen.push(p));
  reducer.ingest({
    projectSlug: 'proj',
    sessionId: 'sess-1',
    agentId: 'agent-1',
    entry: userEvent([{ type: 'tool_result', tool_use_id: 'toolu_9', content: 'ok' }]),
  });
  assert.equal(seen.length, 0);
});

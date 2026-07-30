import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PermissionRequestBroker } from '../../dist/server/domain/permission-request-broker.js';

// The broker sits between a blocked Claude Code session (hook long-poll) and
// the human's Allow/Deny click. These tests pin the flow, the races (terminal
// answer vs UI answer, server restart re-register), and orphan GC.

const INPUT = {
  sessionId: 'sess-1',
  toolName: 'Bash',
  toolInput: { command: 'npm test' },
  toolUseId: 'toolu_1',
  permissionMode: 'default',
  cwd: '/tmp/proj',
};

test('request emits permission-pending and answer resolves the held poll', async () => {
  const broker = new PermissionRequestBroker();
  const pending = [];
  broker.on('permission-pending', (r) => pending.push(r));
  const resolved = [];
  broker.on('permission-resolved', (r) => resolved.push(r));

  const { requestId } = broker.request(INPUT);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].sessionId, 'sess-1');

  const wait = broker.waitDecision(requestId, 5_000);
  assert.equal(broker.answer(requestId, 'allow'), true);
  assert.equal(await wait, 'allow');
  assert.deepEqual(resolved, [{ requestId, sessionId: 'sess-1', decision: 'allow' }]);
  // Delivered → gone. A late poll 404s (null).
  assert.equal(await broker.waitDecision(requestId, 10), null);
});

test('poll timeout returns "timeout" and the request stays pending', async () => {
  const broker = new PermissionRequestBroker();
  const { requestId } = broker.request(INPUT);
  assert.equal(await broker.waitDecision(requestId, 5), 'timeout');
  assert.equal(broker.listPending('sess-1').length, 1);
  // Answer lands between polls; the next poll delivers it.
  broker.answer(requestId, 'deny');
  assert.equal(await broker.waitDecision(requestId, 5), 'deny');
});

test('re-register of the same (session, toolUse) is idempotent', () => {
  const broker = new PermissionRequestBroker();
  const first = broker.request(INPUT);
  const second = broker.request(INPUT); // hook re-POST after restart/404
  assert.equal(second.requestId, first.requestId);
  assert.equal(broker.listPending('sess-1').length, 1);
});

test('double answer: first wins, second is a no-op', () => {
  const broker = new PermissionRequestBroker();
  const { requestId } = broker.request(INPUT);
  assert.equal(broker.answer(requestId, 'allow'), true);
  assert.equal(broker.answer(requestId, 'deny'), false);
});

test('resolveByToolUse cancels as passthrough (terminal answered first)', async () => {
  const broker = new PermissionRequestBroker();
  const resolved = [];
  broker.on('permission-resolved', (r) => resolved.push(r));
  const { requestId } = broker.request(INPUT);
  const wait = broker.waitDecision(requestId, 5_000);
  broker.resolveByToolUse('sess-1', 'toolu_1');
  assert.equal(await wait, 'passthrough');
  assert.equal(resolved[0].decision, 'passthrough');
  // UI answer afterwards is a no-op.
  assert.equal(broker.answer(requestId, 'allow'), false);
});

test('sweepOrphans cancels only stale requests with no attached waiter', () => {
  let clock = 0;
  const broker = new PermissionRequestBroker({ now: () => clock, orphanMs: 90_000 });
  const resolved = [];
  broker.on('permission-resolved', (r) => resolved.push(r));
  broker.request(INPUT);
  clock = 60_000;
  assert.equal(broker.sweepOrphans(), 0); // not stale yet
  clock = 91_000;
  assert.equal(broker.sweepOrphans(), 1); // hook died → cancel
  assert.equal(resolved[0].decision, 'passthrough');
  assert.equal(broker.listPending().length, 0);
});

test('active long-poll keeps the request alive through sweeps', async () => {
  let clock = 0;
  const broker = new PermissionRequestBroker({ now: () => clock, orphanMs: 90_000 });
  const { requestId } = broker.request(INPUT);
  const wait = broker.waitDecision(requestId, 5_000); // waiter attached
  clock = 200_000;
  assert.equal(broker.sweepOrphans(), 0); // attached waiter → never orphaned
  broker.answer(requestId, 'allow');
  assert.equal(await wait, 'allow');
});

test('maxPending cap refuses new requests (caller fails open)', () => {
  const broker = new PermissionRequestBroker({ maxPending: 2 });
  assert.ok(broker.request({ ...INPUT, toolUseId: 't1' }));
  assert.ok(broker.request({ ...INPUT, toolUseId: 't2' }));
  assert.equal(broker.request({ ...INPUT, toolUseId: 't3' }), null); // at cap
  // Idempotent re-register of an EXISTING request still works at the cap.
  const again = broker.request({ ...INPUT, toolUseId: 't1' });
  assert.ok(again);
});

test('close() flushes held polls with timeout', async () => {
  const broker = new PermissionRequestBroker();
  const { requestId } = broker.request(INPUT);
  const wait = broker.waitDecision(requestId, 60_000);
  broker.close();
  assert.equal(await wait, 'timeout');
  assert.equal(broker.listPending().length, 0);
});

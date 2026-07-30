import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildPermissionRequest, decisionOutput, waitForDecision } = require('../../hooks/fleet-permission-approval-hook.cjs');

// The hook is the in-session half of remote permission approval. These tests
// pin the pure decision logic; fail-open transport behavior is exercised via
// an injected fake transport (no sockets).

const HOOK_INPUT = JSON.stringify({
  session_id: 'sess-1',
  permission_mode: 'default',
  tool_name: 'Bash',
  tool_input: { command: 'npm test' },
  tool_use_id: 'toolu_123',
  cwd: '/tmp/proj',
});

const OPTED_IN = { FLEET_REMOTE_APPROVE: 'on' };

test('buildPermissionRequest maps hook stdin to broker payload (opted-in session)', () => {
  const req = buildPermissionRequest(HOOK_INPUT, OPTED_IN);
  assert.deepEqual(req, {
    sessionId: 'sess-1',
    toolName: 'Bash',
    toolInput: { command: 'npm test' },
    toolUseId: 'toolu_123',
    permissionMode: 'default',
    cwd: '/tmp/proj',
  });
});

test('OPT-IN GATE: without FLEET_REMOTE_APPROVE=on the hook is inert for every session', () => {
  // The desktop-app incident: a session that never opted in must NEVER wait.
  assert.equal(buildPermissionRequest(HOOK_INPUT, {}), null);
  assert.equal(buildPermissionRequest(HOOK_INPUT, { FLEET_REMOTE_APPROVE: 'off' }), null);
  assert.equal(buildPermissionRequest(HOOK_INPUT, { FLEET_REMOTE_APPROVE: '1' }), null); // exact 'on' only
});

test('even an opted-in bypassPermissions session is never intercepted', () => {
  const input = JSON.parse(HOOK_INPUT);
  input.permission_mode = 'bypassPermissions';
  assert.equal(buildPermissionRequest(JSON.stringify(input), OPTED_IN), null);
});

test('malformed stdin fails open (null request)', () => {
  assert.equal(buildPermissionRequest('not json', OPTED_IN), null);
  assert.equal(buildPermissionRequest(JSON.stringify({ tool_name: 'Bash' }), OPTED_IN), null); // no session_id
});

test('decisionOutput emits the PreToolUse decision contract', () => {
  const allow = JSON.parse(decisionOutput('allow'));
  assert.equal(allow.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(allow.hookSpecificOutput.permissionDecision, 'allow');
  assert.match(allow.hookSpecificOutput.permissionDecisionReason, /fleet dashboard/);
  const deny = JSON.parse(decisionOutput('deny'));
  assert.equal(deny.hookSpecificOutput.permissionDecision, 'deny');
});

function scriptedTransport(script) {
  const calls = [];
  return {
    calls,
    transport: async (method, url, payload) => {
      calls.push({ method, url, payload });
      const next = script.shift();
      if (!next) throw new Error('transport script exhausted');
      if (next instanceof Error) throw next;
      return next;
    },
  };
}

const request = buildPermissionRequest(HOOK_INPUT, OPTED_IN);

test('waitForDecision: register then poll until allow', async () => {
  const { transport, calls } = scriptedTransport([
    { status: 200, body: { requestId: 'r1' } },
    { status: 204, body: null }, // still pending → keep polling
    { status: 200, body: { decision: 'allow' } },
  ]);
  assert.equal(await waitForDecision(request, transport), 'allow');
  assert.equal(calls[0].method, 'POST');
  assert.match(calls[1].url, /\/api\/permissions\/r1\/decision$/);
});

test('waitForDecision: server restart (404) re-registers and continues', async () => {
  const { transport } = scriptedTransport([
    { status: 200, body: { requestId: 'r1' } },
    { status: 404, body: null },
    { status: 200, body: { requestId: 'r2' } }, // re-registered
    { status: 200, body: { decision: 'deny' } },
  ]);
  assert.equal(await waitForDecision(request, transport), 'deny');
});

test('waitForDecision: passthrough decision and refused register fail open', async () => {
  const passthrough = scriptedTransport([
    { status: 200, body: { requestId: 'r1' } },
    { status: 200, body: { decision: 'passthrough' } },
  ]);
  assert.equal(await waitForDecision(request, passthrough.transport), null);
  const refused = scriptedTransport([{ status: 500, body: null }]);
  assert.equal(await waitForDecision(request, refused.transport), null);
});

test('waitForDecision: network error propagates (main() maps it to fail-open exit 0)', async () => {
  const { transport } = scriptedTransport([new Error('ECONNREFUSED')]);
  await assert.rejects(() => waitForDecision(request, transport));
});

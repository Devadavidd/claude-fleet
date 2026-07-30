import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { SseServer } from '../../dist/server/http/server.js';

// Integration battery for remote permission approval: the REAL compiled server
// on an ephemeral port and the REAL hook script as a child process — proving
// the safety properties end-to-end over sockets, not just in units:
//   fail-open when the server is down, allow/deny round-trip, mutation guard
//   on the answer click, 404 → re-register, card fold via the reducer contract.

const TOKEN = 'permission-flow-fleet-token';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const hookPath = path.join(repoRoot, 'hooks', 'fleet-permission-approval-hook.cjs');

function stubReducer() {
  const reducer = Object.assign(new EventEmitter(), {
    listCards: () => [], listStates: () => [], listProjectRoots: () => [],
    listFleetTasks: () => [], listTasks: () => null,
    pendingSet: [], pendingCleared: [],
    setPendingPermission(sessionId, question) { this.pendingSet.push({ sessionId, question }); },
    clearPendingPermission(sessionId, requestId) { this.pendingCleared.push({ sessionId, requestId }); },
  });
  return reducer;
}
const stubWatcher = { filePathForSession: () => null, filePathForAgent: () => null, filePathForWorkflowAgent: () => null };

function rawRequest(port, pathname, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: pathname, method, headers },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      },
    );
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}
const json = (s) => { try { return JSON.parse(s); } catch { return null; } };
const postJson = (port, pathname, payload, headers = {}) => rawRequest(port, pathname, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(payload),
});

async function withServer(run) {
  const reducer = stubReducer();
  const server = new SseServer({
    host: '127.0.0.1', port: 0, reducer, watcher: stubWatcher, fleetToken: TOKEN,
  });
  await server.listen();
  const port = server.server.address().port;
  server.port = port;
  try {
    await run({ port, server, reducer });
  } finally {
    await server.close();
  }
}

/** Run the real hook script against a base URL; resolves {code, stdout, ms}.
 * Opts the session in — the hook is inert without FLEET_REMOTE_APPROVE=on. */
function runHook(baseUrl, input) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn('node', [hookPath], { env: { ...process.env, FLEET_URL: baseUrl, FLEET_REMOTE_APPROVE: 'on' } });
    let stdout = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.on('error', reject);
    child.on('exit', (code) => resolve({ code, stdout, ms: Date.now() - started }));
    child.stdin.write(JSON.stringify(input));
    child.stdin.end();
  });
}

const HOOK_INPUT = {
  session_id: 'flow-sess',
  permission_mode: 'default',
  tool_name: 'Bash',
  tool_input: { command: 'npm test' },
  tool_use_id: 'toolu_flow',
  cwd: '/tmp/proj',
};

test('SAFETY: hook fails open fast when no server is listening', async () => {
  // Port 1 on localhost: connection refused immediately.
  const { code, stdout, ms } = await runHook('http://127.0.0.1:1', HOOK_INPUT);
  assert.equal(code, 0);
  assert.equal(stdout, ''); // no decision → Claude Code falls through to its own prompt
  assert.ok(ms < 1500, `fail-open took ${ms}ms`);
});

test('full allow round-trip: real hook process + real server + guarded answer', async () => {
  await withServer(async ({ port, reducer }) => {
    const hookDone = runHook(`http://127.0.0.1:${port}`, HOOK_INPUT);
    // The request lands and folds into the card contract.
    let pending;
    for (let i = 0; i < 50 && !pending; i += 1) {
      await new Promise((r) => setTimeout(r, 20));
      pending = reducer.pendingSet[0];
    }
    assert.ok(pending, 'setPendingPermission never called');
    assert.equal(pending.sessionId, 'flow-sess');
    assert.equal(pending.question.kind, 'permission');
    assert.deepEqual(pending.question.questions[0].options, ['Allow', 'Deny']);
    const requestId = pending.question.requestId;

    // Answer WITHOUT the token first: the guard must refuse.
    const forbidden = await postJson(port, `/api/permissions/${requestId}/answer`, { decision: 'allow' });
    assert.equal(forbidden.status, 403);

    const answered = await postJson(port, `/api/permissions/${requestId}/answer`, { decision: 'allow' }, { 'x-fleet-token': TOKEN });
    assert.equal(answered.status, 200);

    const { code, stdout } = await hookDone;
    assert.equal(code, 0);
    assert.equal(json(stdout)?.hookSpecificOutput?.permissionDecision, 'allow');
    // Card released exactly once for this request.
    assert.deepEqual(reducer.pendingCleared, [{ sessionId: 'flow-sess', requestId }]);
  });
});

test('deny round-trip delivers deny with the fleet-dashboard reason', async () => {
  await withServer(async ({ port, reducer }) => {
    const hookDone = runHook(`http://127.0.0.1:${port}`, HOOK_INPUT);
    let pending;
    for (let i = 0; i < 50 && !pending; i += 1) {
      await new Promise((r) => setTimeout(r, 20));
      pending = reducer.pendingSet[0];
    }
    const requestId = pending.question.requestId;
    await postJson(port, `/api/permissions/${requestId}/answer`, { decision: 'deny' }, { 'x-fleet-token': TOKEN });
    const { stdout } = await hookDone;
    const out = json(stdout)?.hookSpecificOutput;
    assert.equal(out?.permissionDecision, 'deny');
    assert.match(String(out?.permissionDecisionReason), /fleet dashboard/);
  });
});

test('SAFETY: /request refuses non-JSON content types (drive-by page CSRF gate)', async () => {
  await withServer(async ({ port, reducer }) => {
    // A hostile page's simple cross-origin POST is text/plain — must bounce.
    const res = await rawRequest(port, '/api/permissions/request', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({ sessionId: 'spoof', toolName: 'Bash', toolInput: {} }),
    });
    assert.equal(res.status, 415);
    assert.equal(reducer.pendingSet.length, 0); // no card, no chime
  });
});

test('unknown request id: decision poll 404s, bad decision values 400', async () => {
  await withServer(async ({ port }) => {
    const unknown = await rawRequest(port, '/api/permissions/nope/decision');
    assert.equal(unknown.status, 404);
    const bad = await postJson(port, '/api/permissions/nope/answer', { decision: 'yes' }, { 'x-fleet-token': TOKEN });
    assert.equal(bad.status, 400);
    const missing = await postJson(port, '/api/permissions/request', {});
    assert.equal(missing.status, 400); // sessionId required
  });
});

test('hook-status endpoint reports installed=false against an empty settings file', async () => {
  await withServer(async ({ port }) => {
    // FLEET_CLAUDE_SETTINGS is not set in tests → reads the real user settings;
    // assert only the shape so the test never depends on the dev machine state.
    const res = await rawRequest(port, '/api/permissions/hook-status');
    assert.equal(res.status, 200);
    assert.equal(typeof json(res.body)?.installed, 'boolean');
  });
});

test('approval toggle: defaults on, guarded, and routes external asks to the terminal when off', async () => {
  await withServer(async ({ port }) => {
    // Default = on.
    assert.equal(json((await rawRequest(port, '/api/permissions/mode')).body)?.enabled, true);
    // Flip requires the mutation token.
    assert.equal((await postJson(port, '/api/permissions/mode', { enabled: false })).status, 403);
    // Bad payload rejected.
    assert.equal((await postJson(port, '/api/permissions/mode', { enabled: 'no' }, { 'x-fleet-token': TOKEN })).status, 400);
    // Flip off with the token.
    const off = await postJson(port, '/api/permissions/mode', { enabled: false }, { 'x-fleet-token': TOKEN });
    assert.equal(json(off.body)?.enabled, false);
    // An external session's request now passes through (no requestId → hook
    // fails open to the native terminal prompt) instead of registering a card.
    const passed = await postJson(port, '/api/permissions/request', { sessionId: 'ext-sess', toolName: 'Bash' }, { 'content-type': 'application/json' });
    assert.equal(passed.status, 200);
    assert.equal(json(passed.body)?.passthrough, true);
    assert.equal(json(passed.body)?.requestId, undefined);
    // Flip back on → a real request registers again.
    await postJson(port, '/api/permissions/mode', { enabled: true }, { 'x-fleet-token': TOKEN });
    const registered = await postJson(port, '/api/permissions/request', { sessionId: 'ext-sess', toolName: 'Bash' }, { 'content-type': 'application/json' });
    assert.equal(typeof json(registered.body)?.requestId, 'string');
  });
});

test('approval toggle off still routes the REAL hook to a decision-less exit (terminal fallback)', async () => {
  await withServer(async ({ port, server }) => {
    server.port = port;
    await postJson(port, '/api/permissions/mode', { enabled: false }, { 'x-fleet-token': TOKEN });
    const baseUrl = `http://127.0.0.1:${port}`;
    const out = await runHook(baseUrl, { ...HOOK_INPUT, session_id: 'ext-hook-sess' });
    assert.equal(out.code, 0);
    assert.equal(out.stdout.trim(), ''); // no decision emitted → CLI shows its own prompt
  });
});

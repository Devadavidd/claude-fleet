import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { SseServer, validateBaseHost } from '../../dist/server/http/server.js';
import { SECURITY_HEADERS } from '../../dist/server/http/mutation-guard.js';

// End-to-end security-battery parity check for the JS→TS rewrite: boots the
// COMPILED server (dist/server) on an ephemeral port, same as
// sse-workflow-routes.test.js / static-serve.test.js, and re-proves every
// load-bearing guard (Host, Origin, content-type, token, body-size, CSP)
// against real sockets — not just the pure mutation-guard unit tests.

const TOKEN = 'parity-regression-fleet-token';

function stubReducer() {
  return Object.assign(new EventEmitter(), {
    listCards: () => [], listStates: () => [], listProjectRoots: () => [],
    listFleetTasks: () => [], listTasks: () => null,
  });
}
const stubWatcher = { filePathForSession: () => null, filePathForAgent: () => null, filePathForWorkflowAgent: () => null };

// node:http (not fetch) so we can set a foreign Host header — fetch forbids it.
function rawRequest(port, pathname, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: pathname, method, headers },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
      },
    );
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}
const json = (s) => { try { return JSON.parse(s); } catch { return null; } };

// Boot with a known fleetToken and reflect the ephemeral port onto server.port
// (same pattern as the other dist/server suites) so the Host/Origin guards —
// which compare against the constructor's host:port — match real requests.
async function withServer(run, opts = {}) {
  const server = new SseServer({
    host: '127.0.0.1', port: 0,
    reducer: stubReducer(), watcher: stubWatcher,
    fleetToken: TOKEN,
    ...opts,
  });
  await server.listen();
  const port = server.server.address().port;
  server.port = port;
  try {
    await run(port, server);
  } finally {
    await server.close();
  }
}

test('POST mutation: no/wrong x-fleet-token is 403; correct token + json + matching Origin passes the guard (400 on empty body, never 403)', async () => {
  await withServer(async (port) => {
    const origin = `http://127.0.0.1:${port}`;

    const noToken = await rawRequest(port, '/api/launch-settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: '{}',
    });
    assert.equal(noToken.status, 403);
    assert.equal(json(noToken.body)?.error, 'bad or missing token');

    const wrongToken = await rawRequest(port, '/api/launch-settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin, 'x-fleet-token': 'not-the-token' },
      body: '{}',
    });
    assert.equal(wrongToken.status, 403);

    // Empty body ⇒ saveRoots({}.allowedRoots) rejects ("not an array") ⇒ 400.
    // The guard itself must NOT be what stops this request.
    const good = await rawRequest(port, '/api/launch-settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin, 'x-fleet-token': TOKEN },
      body: '{}',
    });
    assert.notEqual(good.status, 403);
    assert.equal(good.status, 400);
  });
});

// requireMutation's JSON-only check returns 415 (Unsupported Media Type), not
// 403 — verified in mutation-guard.js and mirrored by test/server/mutation-guard.test.js
// (`assert.equal(... .status, 415)`). The guard still fully rejects the request
// before it is routed; only the status code differs from a bare 403.
test('a text/plain content-type on a POST mutation is rejected by the JSON-only guard (415)', async () => {
  await withServer(async (port) => {
    const origin = `http://127.0.0.1:${port}`;
    const res = await rawRequest(port, '/api/launch-settings', {
      method: 'POST',
      headers: { 'content-type': 'text/plain', origin, 'x-fleet-token': TOKEN },
      body: '{}',
    });
    assert.equal(res.status, 415);
    assert.equal(json(res.body)?.error, 'application/json required');
  });
});

test('a foreign Host header is rejected before routing, for every method (GET /api/sessions, GET /api/skills, POST)', async () => {
  await withServer(async (port) => {
    const evilHost = 'evil.example.com';

    const sessions = await rawRequest(port, '/api/sessions', { headers: { Host: evilHost } });
    assert.equal(sessions.status, 403);

    const skills = await rawRequest(port, '/api/skills', { headers: { Host: evilHost } });
    assert.equal(skills.status, 403);

    const post = await rawRequest(port, '/api/launch-settings', {
      method: 'POST',
      headers: { Host: evilHost, 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(post.status, 403);
  });
});

test('a cross-origin Origin header is rejected on a POST even with a valid token', async () => {
  await withServer(async (port) => {
    const res = await rawRequest(port, '/api/launch-settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://evil.com', 'x-fleet-token': TOKEN },
      body: '{}',
    });
    assert.equal(res.status, 403);
    assert.equal(json(res.body)?.error, 'forbidden origin');
  });
});

test('a > 1MB JSON body on a POST mutation drops the connection (no 413, never a normal response)', async () => {
  await withServer(async (port) => {
    const origin = `http://127.0.0.1:${port}`;
    // readJsonBody's limit is 1<<20 (1MB); this payload is ~2MB so the guard
    // fires mid-stream (req.destroy()) before the body finishes arriving.
    const oversizedPayload = JSON.stringify({ allowedRoots: ['x'.repeat(2 * 1024 * 1024)] });

    const outcome = await new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => settle({ kind: 'timeout' }), 5000);
      function settle(result) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      }
      const req = http.request({
        host: '127.0.0.1', port, path: '/api/launch-settings', method: 'POST',
        headers: { 'content-type': 'application/json', origin, 'x-fleet-token': TOKEN },
      });
      req.on('response', (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => settle({ kind: 'response', status: res.statusCode, body: data }));
      });
      req.on('error', () => settle({ kind: 'error' }));
      req.on('close', () => settle({ kind: 'closed' }));
      req.write(oversizedPayload);
      req.end();
    });

    assert.notEqual(outcome.kind, 'response', `expected the connection to drop, got a response: ${JSON.stringify(outcome)}`);
    assert.notEqual(outcome.kind, 'timeout', 'connection was neither dropped nor answered within 5s');
  });
});

test('the exact CSP string + X-Frame-Options: DENY are present on a served response', async () => {
  await withServer(async (port) => {
    const res = await rawRequest(port, '/api/sessions');
    assert.equal(res.status, 200);
    const csp = res.headers['content-security-policy'];
    // Byte-for-byte against the real constant, not a re-typed copy.
    assert.equal(csp, SECURITY_HEADERS['Content-Security-Policy']);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /connect-src 'self'/);
    assert.equal(res.headers['x-frame-options'], 'DENY');
  });
});

test('GET /api/file?path=<untracked> is 403 "not a tracked file" (empty reducer state ⇒ nothing tracked)', async () => {
  await withServer(async (port) => {
    const res = await rawRequest(port, `/api/file?path=${encodeURIComponent('/etc/hosts')}`);
    assert.equal(res.status, 403);
    assert.equal(json(res.body)?.error, 'not a tracked file');
  });
});

test('GET /api/skills returns the SkillCatalog shape, ignores query params, and rejects a foreign Host', async () => {
  await withServer(async (port) => {
    const plain = await rawRequest(port, '/api/skills');
    assert.equal(plain.status, 200);
    assert.match(plain.headers['content-type'], /application\/json/);
    const body = json(plain.body);
    assert.ok(body && typeof body === 'object');
    for (const key of ['kit', 'categories', 'workflow', 'agents', 'skills']) {
      assert.ok(key in body, `SkillCatalog missing "${key}"`);
    }
    assert.ok(Array.isArray(body.categories));
    assert.ok(Array.isArray(body.workflow));
    assert.ok(Array.isArray(body.agents));
    assert.ok(Array.isArray(body.skills));
    assert.ok(body.kit && typeof body.kit === 'object');

    // No client-supplied path/query params — a ?path= is ignored, same result.
    const withQuery = await rawRequest(port, '/api/skills?path=/etc/passwd');
    assert.equal(withQuery.status, 200);
    assert.deepEqual(json(withQuery.body), body);

    const foreignHost = await rawRequest(port, '/api/skills', { headers: { Host: 'evil.example.com' } });
    assert.equal(foreignHost.status, 403);
  });
});

test('the server binds to 127.0.0.1 only, never 0.0.0.0', async () => {
  await withServer(async (_port, server) => {
    assert.equal(server.server.address().address, '127.0.0.1');
  });
});

test('validateBaseHost (QA baseUrl loopback guard): non-loopback host rejected, 127.0.0.1 accepted', () => {
  const allowed = ['127.0.0.1', 'localhost'];
  assert.equal(validateBaseHost('http://127.0.0.1:4600/health', allowed), null);
  assert.match(validateBaseHost('http://example.com/', allowed), /not allowed/);
});

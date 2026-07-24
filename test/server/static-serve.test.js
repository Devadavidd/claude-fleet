import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { SseServer } from '../../dist/server/http/server.js';
import { config } from '../../dist/server/config.js';

// Static serving contract for the SPA cutover: the serve directory is
// configurable (FLEET_PUBLIC_DIR → config.publicDir → SseServer option), and —
// because the SPA is a HASH router — there is NO index.html fallback: a miss is
// a real 404 (a fallback would mask missing hashed assets as 200 text/html and
// break module-MIME diagnostics). Traversal guard + security headers must hold
// for every static response.

function stubReducer() {
  return Object.assign(new EventEmitter(), {
    listCards: () => [], listStates: () => [], listProjectRoots: () => [],
    listFleetTasks: () => [], listTasks: () => null,
  });
}
const stubWatcher = { filePathForSession: () => null, filePathForAgent: () => null, filePathForWorkflowAgent: () => null };

function request(port, pathname, { method = 'GET', headers = {} } = {}) {
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
    req.end();
  });
}

// Boot the server against an injected static dir (or the default when omitted).
async function withServer(run, opts = {}) {
  const server = new SseServer({
    host: '127.0.0.1', port: 0,
    reducer: stubReducer(), watcher: stubWatcher,
    ...opts,
  });
  await server.listen();
  const port = server.server.address().port;
  server.port = port; // reflect the ephemeral port so the Host guard matches
  try {
    await run(port);
  } finally {
    await server.close();
  }
}

// A throwaway SPA dir standing in for dist/client.
function makeSpaDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-static-'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>spa-fixture</title>');
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'assets', 'app.css'), 'body{}');
  return dir;
}

test('config.publicDir defaults to the built SPA (dist/client) when FLEET_PUBLIC_DIR is unset', () => {
  // Post-cutover default: the compiled server serves the Vite build at dist/client
  // single-origin. (A path assertion — dist/client is a build artifact, so the
  // serving tests below use an injected fixture dir instead.)
  const distClient = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist', 'client');
  assert.equal(config.publicDir, distClient);
});

test('an injected publicDir is served instead of the default', async () => {
  const dir = makeSpaDir();
  await withServer(async (port) => {
    const res = await request(port, '/');
    assert.equal(res.status, 200);
    assert.match(res.body, /spa-fixture/);
    const css = await request(port, '/assets/app.css');
    assert.equal(css.status, 200);
    assert.match(css.headers['content-type'], /text\/css/);
  }, { publicDir: dir });
});

test('static responses carry the security headers (CSP + X-Frame-Options)', async () => {
  const dir = makeSpaDir();
  await withServer(async (port) => {
    const res = await request(port, '/');
    assert.ok(res.headers['content-security-policy'], 'CSP header present');
    assert.equal(res.headers['x-frame-options'], 'DENY');
  }, { publicDir: dir });
});

test('a missing asset with an extension is a real 404, never index.html', async () => {
  const dir = makeSpaDir();
  await withServer(async (port) => {
    const res = await request(port, '/assets/missing.js');
    assert.equal(res.status, 404);
    assert.doesNotMatch(res.headers['content-type'] ?? '', /text\/html/);
    assert.doesNotMatch(res.body, /spa-fixture/);
  }, { publicDir: dir });
});

test('hash router ⇒ no fallback: an unknown extensionless GET is 404 even with Accept: text/html', async () => {
  const dir = makeSpaDir();
  await withServer(async (port) => {
    const res = await request(port, '/board', { headers: { Accept: 'text/html' } });
    assert.equal(res.status, 404);
    assert.doesNotMatch(res.body, /spa-fixture/);
  }, { publicDir: dir });
});

test('a POST to an unknown route is never masked by static fallback', async () => {
  const dir = makeSpaDir();
  await withServer(async (port) => {
    const res = await request(port, '/unknown', { method: 'POST' });
    assert.equal(res.status, 404);
    assert.doesNotMatch(res.body, /spa-fixture/);
  }, { publicDir: dir });
});

test('path traversal never reads outside the configured dir', async () => {
  const dir = makeSpaDir();
  await withServer(async (port) => {
    // Dotted paths are defused by URL normalization (→ inside the dir → 404);
    // anything that survives hits the startsWith prefix guard (→ 403). Either
    // way the invariant is: no 200, no file content from outside the dir.
    for (const attempt of ['/../../../etc/passwd', '/..%2f..%2f..%2fetc%2fpasswd', '/assets/../../secret']) {
      const res = await request(port, attempt);
      assert.ok([403, 404].includes(res.status), `${attempt} → ${res.status}`);
      assert.doesNotMatch(res.body, /root:/, `${attempt} leaked file content`);
    }
  }, { publicDir: dir });
});

test('/api and /events dispatch is never shadowed by static serving', async () => {
  const dir = makeSpaDir(); // fixture has no api/ or events file
  await withServer(async (port) => {
    const api = await request(port, '/api/sessions');
    assert.equal(api.status, 200); // JSON route, not a 404 from the static dir
    assert.match(api.headers['content-type'], /application\/json/);
  }, { publicDir: dir });
});

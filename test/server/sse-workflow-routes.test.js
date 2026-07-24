import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { SseServer } from '../../dist/server/http/server.js';

// Minimal stubs: the workflow routes only touch this.workflows; reducer/watcher
// just need the methods the constructor/heartbeat may call.
function stubReducer() {
  return Object.assign(new EventEmitter(), {
    listCards: () => [], listStates: () => [], listProjectRoots: () => [],
    listFleetTasks: () => [], listTasks: () => null,
  });
}
const stubWatcher = { filePathForSession: () => null, filePathForAgent: () => null, filePathForWorkflowAgent: () => null };

function stubWorkflows() {
  const detail = { sessionId: 's1', workflowId: 'wf_X', name: 'wf-one', phases: [{ title: 'Research' }], agents: [{ agentId: 'a', phase: 'Research' }] };
  return Object.assign(new EventEmitter(), {
    listWorkflows: () => [{ sessionId: 's1', workflowId: 'wf_X', name: 'wf-one', agentCount: 1, tokensTotal: 10 }],
    getWorkflow: (s, w) => (s === 's1' && w === 'wf_X' ? detail : null),
  });
}

// node:http (not fetch) so we can set the Host header — fetch forbids overriding it.
function get(port, pathname, host) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: pathname, method: 'GET', headers: host ? { Host: host } : {} },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => resolve({ status: res.statusCode, json: safeJson(data) }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}
const safeJson = (s) => { try { return JSON.parse(s); } catch { return null; } };

async function withServer(run) {
  const server = new SseServer({ host: '127.0.0.1', port: 0, reducer: stubReducer(), watcher: stubWatcher, workflows: stubWorkflows() });
  await server.listen();
  const port = server.server.address().port;
  server.port = port; // reflect the ephemeral port so the Host guard matches real requests
  try {
    await run(port);
  } finally {
    await server.close();
  }
}

test('GET /api/workflows returns the fleet list', async () => {
  await withServer(async (port) => {
    const res = await get(port, '/api/workflows');
    assert.equal(res.status, 200);
    assert.equal(res.json.length, 1);
    assert.equal(res.json[0].workflowId, 'wf_X');
    assert.equal(res.json[0].name, 'wf-one');
  });
});

test('GET /api/workflows/:s/:w returns detail; unknown → 404', async () => {
  await withServer(async (port) => {
    const ok = await get(port, '/api/workflows/s1/wf_X');
    assert.equal(ok.status, 200);
    assert.equal(ok.json.agents.length, 1);
    assert.equal(ok.json.agents[0].phase, 'Research');

    const miss = await get(port, '/api/workflows/s1/nope');
    assert.equal(miss.status, 404);
  });
});

test('foreign Host header is rejected (DNS-rebinding guard) on workflow routes', async () => {
  await withServer(async (port) => {
    const res = await get(port, '/api/workflows', 'evil.example.com');
    assert.equal(res.status, 403);
  });
});

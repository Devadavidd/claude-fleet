import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LaunchedRegistry, reapOrphans } from '../../dist/server/launch/launched-registry.js';

const tmp = (name) => path.join(os.tmpdir(), `fleet-test-${process.pid}-${name}.json`);

test('enforces the global concurrency cap', () => {
  const r = new LaunchedRegistry({ maxConcurrent: 2 });
  assert.equal(r.atCapacity(), false);
  r.register('a', { pid: 1, cwd: '/x' });
  r.register('b', { pid: 2, cwd: '/y' });
  assert.equal(r.size(), 2);
  assert.equal(r.atCapacity(), true); // 3rd launch would be refused (429)
});

test('per-cwd busy check blocks a second launch in the same directory', () => {
  const r = new LaunchedRegistry({ maxConcurrent: 5 });
  r.register('a', { pid: 1, cwd: '/home/u/proj' });
  assert.equal(r.cwdBusy('/home/u/proj'), true);
  assert.equal(r.cwdBusy('/home/u/other'), false);
});

test('register / get / remove lifecycle', () => {
  const r = new LaunchedRegistry();
  r.register('s1', { pid: 42, cwd: '/x', model: 'm' });
  assert.equal(r.has('s1'), true);
  assert.equal(r.get('s1').status, 'running');
  assert.deepEqual(r.ids(), ['s1']);
  assert.equal(r.remove('s1'), true);
  assert.equal(r.has('s1'), false);
});

test('kill returns false for an unknown session and never throws', () => {
  const r = new LaunchedRegistry();
  assert.equal(r.kill('nope'), false);
});

test('kill falls back to child.kill when the process-group signal fails', () => {
  const r = new LaunchedRegistry();
  let childKilled = false;
  // A bogus negative pid makes process.kill(-pid) throw (ESRCH) → fall back.
  r.register('s1', { pid: 999999999, child: { kill: () => { childKilled = true; } }, cwd: '/x' });
  assert.equal(r.kill('s1'), true);
  assert.equal(childKilled, true);
});

test('killAll signals every launched session', () => {
  const r = new LaunchedRegistry();
  let kills = 0;
  const child = () => ({ kill: () => { kills += 1; } });
  r.register('a', { pid: 999999998, child: child(), cwd: '/a' });
  r.register('b', { pid: 999999997, child: child(), cwd: '/b' });
  r.killAll();
  assert.equal(kills, 2);
});

test('registry persists pids to the file on register/remove', () => {
  const f = tmp('persist');
  const r = new LaunchedRegistry({ pidFile: f });
  r.register('s1', { pid: 111, cwd: '/x', startedAt: 1 });
  assert.deepEqual(JSON.parse(fs.readFileSync(f, 'utf8')), [{ pid: 111, sessionId: 's1', startedAt: 1 }]);
  r.remove('s1');
  assert.deepEqual(JSON.parse(fs.readFileSync(f, 'utf8')), []);
  fs.rmSync(f, { force: true });
});

test('reapOrphans ignores a missing or malformed pid file', () => {
  assert.equal(reapOrphans('/nonexistent/fleet-x.json'), 0);
  const f = tmp('bad');
  fs.writeFileSync(f, 'not json');
  assert.equal(reapOrphans(f), 0);
  fs.rmSync(f, { force: true });
});

test('reapOrphans NEVER kills a live pid that is not a claude process (recycle-safe)', () => {
  const f = tmp('live');
  // Our own pid IS alive — with isClaude=false it must be skipped, not signalled.
  fs.writeFileSync(f, JSON.stringify([{ pid: process.pid, sessionId: 's', startedAt: 1 }]));
  const reaped = reapOrphans(f, () => false);
  assert.equal(reaped, 0); // this process still running = proof it wasn't killed
  assert.equal(fs.readFileSync(f, 'utf8'), '[]'); // file cleared afterward
  fs.rmSync(f, { force: true });
});

// --- steer control channel ---

test('writeToChannel writes a user message to a steerable child stdin', () => {
  const r = new LaunchedRegistry();
  let written = '';
  const stdin = { writable: true, write: (s) => { written += s; } };
  r.register('s1', { pid: 1, child: { stdin }, cwd: '/x', steerable: true });
  assert.equal(r.writeToChannel('s1', 'Haiku'), true);
  const msg = JSON.parse(written.trim());
  assert.equal(msg.type, 'user');
  assert.equal(msg.message.content, 'Haiku');
  stdin.writable = false;                       // stdin closed → no-op false
  assert.equal(r.writeToChannel('s1', 'x'), false);
  assert.equal(r.writeToChannel('nope', 'x'), false); // unknown id → false
});

test('finish closes the child stdin', () => {
  const r = new LaunchedRegistry();
  let ended = false;
  r.register('s1', { pid: 1, child: { stdin: { writable: true, end: () => { ended = true; } } }, cwd: '/x', steerable: true });
  assert.equal(r.finish('s1'), true);
  assert.equal(ended, true);
});

test('idle-kill reaps a steerable session after the idle window', async () => {
  const r = new LaunchedRegistry({ idleKillMs: 25 });
  let killed = false;
  // Fake pid (group kill throws) → falls back to child.kill.
  r.register('s1', { pid: 999999999, child: { kill: () => { killed = true; } }, cwd: '/x', steerable: true });
  await new Promise((res) => setTimeout(res, 70));
  assert.equal(killed, true);
});

test('touch resets the idle timer, preventing a premature kill', async () => {
  const r = new LaunchedRegistry({ idleKillMs: 50 });
  let killed = false;
  r.register('s1', { pid: 999999999, child: { kill: () => { killed = true; } }, cwd: '/x', steerable: true });
  await new Promise((res) => setTimeout(res, 30));
  r.touch('s1');                                    // reset well before expiry
  await new Promise((res) => setTimeout(res, 30));
  assert.equal(killed, false);                      // 60ms elapsed but timer reset at 30
  await new Promise((res) => setTimeout(res, 45));
  assert.equal(killed, true);
});

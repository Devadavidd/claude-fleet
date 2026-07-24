import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LoopSupervisor } from '../../dist/server/loop/loop-supervisor.js';

// --- fakes ---------------------------------------------------------------

// In-memory job store with the same shape createJobStore returns; hands out
// copies so the supervisor's mutate-then-upsert can't alias internal state.
function memStore() {
  let jobs = [];
  return {
    readJobs: () => jobs.map((j) => ({ ...j })),
    getJob: (id) => { const j = jobs.find((x) => x.id === id); return j ? { ...j } : null; },
    upsertJob: (job) => { const i = jobs.findIndex((x) => x.id === job.id); if (i === -1) jobs.push({ ...job }); else jobs[i] = { ...job }; return job; },
    removeJob: (id) => { const n = jobs.length; jobs = jobs.filter((x) => x.id !== id); return jobs.length !== n; },
    seed: (job) => { jobs.push({ ...job }); },
  };
}

// Mirrors the real LaunchedRegistry closely enough to expose the C1 defect: kill
// invokes the stored child's kill only when a pid/child were actually registered
// (a pid-less 'starting' reservation kills nothing — just like the real one).
function fakeRegistry({ capacity = 3, preCwd = null } = {}) {
  const byId = new Map();
  const killedIds = [];
  const killedChildren = [];
  if (preCwd) byId.set('pre', { cwd: preCwd });
  return {
    atCapacity: () => byId.size >= capacity,
    cwdBusy: (cwd) => [...byId.values()].some((e) => e.cwd === cwd),
    register: (id, entry) => byId.set(id, { ...entry }),        // REPLACE, like the real registry
    remove: (id) => byId.delete(id),
    touch: () => {},
    kill: (id) => {
      const e = byId.get(id);
      killedIds.push(id);
      if (e && typeof e.pid === 'number' && e.child && typeof e.child.kill === 'function') {
        e.child.kill(); killedChildren.push(id);
      }
      return true;
    },
    _size: () => byId.size,
    _ids: () => [...byId.keys()],
    _killedIds: killedIds,
    _killedChildren: killedChildren,
  };
}

// Controllable timer queue. tick() fires the earliest pending timer then lets the
// async cycle + its setImmediate onExit settle.
function fakeClock() {
  let q = [];
  const setTimer = (fn) => { const t = { fn }; q.push(t); return t; };
  const clearTimer = (t) => { q = q.filter((x) => x !== t); };
  return { setTimer, clearTimer, pending: () => q.length, _q: () => q };
}
const flush = () => new Promise((r) => setImmediate(r));
async function tick(clock) { const t = clock._q().shift(); if (t) t.fn(); await flush(); await flush(); }

// launchFn double matching the REAL launchClaude contract: (opts, { onExit, onActivity }).
// onExit fires on a LATER macrotask (setImmediate) so the returned promise always
// resolves first — matching real launchClaude (resolve on spawn, exit later).
function makeLaunch(behavior) {
  let i = -1;
  return async (opts, { onExit }) => {
    i += 1;
    const b = behavior(i, opts) || {};
    if (b.reject) throw new Error(b.reject);
    setImmediate(() => {
      if (b.sentinel !== undefined) {
        const m = opts.task.match(/to the file "([^"]+)"/);
        if (m) { try { fs.writeFileSync(m[1], b.sentinel === true ? opts.sessionId : b.sentinel); } catch { /* ignore */ } }
      }
      if (b.double) { onExit({ error: 'boom' }); onExit({ code: 0 }); }
      else onExit(b.exit ?? { code: 0 });
    });
    return { pid: 1000 + i, child: { kill: () => {} } };
  };
}

function makeSup(overrides = {}) {
  const store = overrides.store ?? memStore();
  const registry = overrides.registry ?? fakeRegistry();
  const clock = fakeClock();
  const sentinelDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-sentinel-'));
  const sup = new LoopSupervisor({
    registry, store, launchFn: overrides.launchFn ?? makeLaunch(() => ({ exit: { code: 0 } })),
    setTimer: clock.setTimer, clearTimer: clock.clearTimer, now: () => 1,
    minIntervalSec: overrides.minIntervalSec ?? 60,
    maxFails: overrides.maxFails ?? 3,
    maxCyclesGoal: overrides.maxCyclesGoal ?? 200,
    sentinelDir,
  });
  return { sup, store, registry, clock, sentinelDir };
}

// --- tests ---------------------------------------------------------------

test('job-mode runs multiple cycles and never self-stops', async () => {
  const { sup, store, clock } = makeSup();
  const job = sup.createJob({ task: 't', cwd: '/a', model: 'm', mode: 'job', intervalSec: 60 });
  for (let n = 0; n < 3; n++) await tick(clock);
  const j = store.getJob(job.id);
  assert.equal(j.cyclesDone, 3);
  assert.equal(j.status, 'running');
  assert.equal(clock.pending(), 1); // exactly one next cycle armed
});

test('goal-mode completes ONLY on a matching-payload sentinel', async () => {
  const launchFn = makeLaunch((i) => (i === 1 ? { sentinel: true } : { exit: { code: 0 } }));
  const { sup, store, clock } = makeSup({ launchFn });
  const job = sup.createJob({ task: 't', cwd: '/a', model: 'm', mode: 'goal', intervalSec: 60 });
  await tick(clock); // cycle 0 → still running
  assert.equal(store.getJob(job.id).status, 'running');
  await tick(clock); // cycle 1 → sentinel matches → completed
  assert.equal(store.getJob(job.id).status, 'completed');
  assert.equal(store.getJob(job.id).cyclesDone, 2);
  assert.equal(clock.pending(), 0); // no further cycle armed
});

test('goal-mode does NOT complete on a wrong sentinel payload', async () => {
  const launchFn = makeLaunch(() => ({ sentinel: 'not-the-session-id' }));
  const { sup, store, clock } = makeSup({ launchFn });
  const job = sup.createJob({ task: 't', cwd: '/a', model: 'm', mode: 'goal', intervalSec: 60 });
  for (let n = 0; n < 3; n++) await tick(clock);
  assert.equal(store.getJob(job.id).status, 'running'); // never completed
});

test('a failing exit that also wrote a sentinel is a failure, not completed', async () => {
  const launchFn = makeLaunch(() => ({ exit: { code: 1 }, sentinel: true }));
  const { sup, store, clock } = makeSup({ launchFn, maxFails: 5 });
  const job = sup.createJob({ task: 't', cwd: '/a', model: 'm', mode: 'goal', intervalSec: 60 });
  await tick(clock);
  const j = store.getJob(job.id);
  assert.notEqual(j.status, 'completed');
  assert.equal(j.consecutiveFailures, 1);
});

test('spawn reject leaks no reservation and trips the breaker', async () => {
  const launchFn = makeLaunch(() => ({ reject: 'ENOENT: claude not found' }));
  const { sup, store, registry, clock } = makeSup({ launchFn, maxFails: 2 });
  const job = sup.createJob({ task: 't', cwd: '/a', model: 'm', mode: 'job', intervalSec: 60 });
  await tick(clock); // reject #1
  assert.equal(registry._size(), 0);            // no leaked 'starting' entry
  assert.equal(store.getJob(job.id).status, 'running');
  await tick(clock); // reject #2 → breaker
  assert.equal(store.getJob(job.id).status, 'paused');
  assert.equal(registry._size(), 0);
  assert.equal(clock.pending(), 0);
});

test('a double onExit (error then exit) counts one cycle and arms one timer', async () => {
  const launchFn = makeLaunch(() => ({ double: true }));
  const { sup, store, clock } = makeSup({ launchFn });
  const job = sup.createJob({ task: 't', cwd: '/a', model: 'm', mode: 'job', intervalSec: 60 });
  await tick(clock);
  assert.equal(store.getJob(job.id).cyclesDone, 1);
  assert.equal(clock.pending(), 1);
});

test('an idle-reap / external SIGTERM (status still running) counts as a failure and trips the breaker', async () => {
  const launchFn = makeLaunch(() => ({ exit: { code: null, signal: 'SIGTERM' } }));
  const { sup, store, clock } = makeSup({ launchFn, maxFails: 2 });
  const job = sup.createJob({ task: 't', cwd: '/a', model: 'm', mode: 'job', intervalSec: 60 });
  await tick(clock);
  assert.equal(store.getJob(job.id).consecutiveFailures, 1); // not a free reschedule
  await tick(clock);
  assert.equal(store.getJob(job.id).status, 'paused');       // breaker trips on repeated hangs
});

test('stop during the spawn window kills the freshly-spawned child and does not reschedule', async () => {
  const store = memStore();
  const registry = fakeRegistry();
  const clock = fakeClock();
  const sentinelDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-sentinel-'));
  const spyChild = { killed: false, kill() { this.killed = true; } };
  let release;
  const launchFn = async (opts, { onExit }) => {
    await new Promise((r) => { release = r; }); // block INSIDE launch (mid-spawn)
    setImmediate(() => onExit({ code: 0 }));
    return { pid: 4242, child: spyChild };
  };
  const sup = new LoopSupervisor({
    registry, store, launchFn, setTimer: clock.setTimer, clearTimer: clock.clearTimer,
    now: () => 1, minIntervalSec: 60, maxFails: 3, maxCyclesGoal: 200, sentinelDir,
  });
  const job = sup.createJob({ task: 't', cwd: '/a', model: 'm', mode: 'job', intervalSec: 60 });
  await tick(clock); // enters #runCycle, parks at the launch await; reservation is live
  assert.equal(registry._size(), 1);
  const sid = registry._ids()[0];
  sup.stopJob(job.id);   // Stop lands mid-spawn (the 'starting' entry has no pid yet)
  release();             // launch now resolves → post-await recheck must kill+remove
  await flush(); await flush();
  assert.equal(store.getJob(job.id).status, 'stopped');
  assert.equal(spyChild.killed, true);         // the REAL arrived child was killed (C1)
  assert.ok(registry._killedChildren.includes(sid));
  assert.equal(registry._size(), 0);
  assert.equal(clock.pending(), 0);            // no cycle rescheduled after Stop
});

test('a live cycle killed by Stop counts no failure and does not resurrect', async () => {
  // onExit is deferred until the test releases it, so we can Stop mid-cycle.
  let release;
  const spyChild = { kill() {} };
  const launchFn = async (opts, { onExit }) => {
    setImmediate(() => { release = () => onExit({ signal: 'SIGTERM', code: null }); });
    return { pid: 77, child: spyChild };
  };
  const store = memStore();
  const registry = fakeRegistry();
  const clock = fakeClock();
  const sentinelDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-sentinel-'));
  const sup = new LoopSupervisor({
    registry, store, launchFn, setTimer: clock.setTimer, clearTimer: clock.clearTimer,
    now: () => 1, minIntervalSec: 60, maxFails: 3, maxCyclesGoal: 200, sentinelDir,
  });
  const job = sup.createJob({ task: 't', cwd: '/a', model: 'm', mode: 'job', intervalSec: 60 });
  await tick(clock);      // cycle live (child registered, onExit pending)
  sup.stopJob(job.id);    // sets 'stopped' BEFORE the kill-driven exit fires
  release();              // now the SIGTERM exit arrives
  await flush(); await flush();
  const j = store.getJob(job.id);
  assert.equal(j.status, 'stopped');
  assert.equal(j.consecutiveFailures, 0); // a user Stop is not counted as a failure
  assert.equal(clock.pending(), 0);       // and never reschedules
});

test('interval is always floored to the minimum (0 and 5 both become 60)', () => {
  const { sup } = makeSup({ minIntervalSec: 60 });
  assert.equal(sup.createJob({ task: 't', cwd: '/a', model: 'm', mode: 'job', intervalSec: 0 }).intervalSec, 60);
  assert.equal(sup.createJob({ task: 't', cwd: '/b', model: 'm', mode: 'job', intervalSec: 5 }).intervalSec, 60);
});

test('a cycle whose cwd is busy skips without counting and reschedules', async () => {
  const registry = fakeRegistry({ preCwd: '/a' }); // a one-shot already holds /a
  const { sup, store, clock } = makeSup({ registry });
  const job = sup.createJob({ task: 't', cwd: '/a', model: 'm', mode: 'job', intervalSec: 60 });
  await tick(clock);
  assert.equal(store.getJob(job.id).cyclesDone, 0); // skipped, not run
  assert.equal(registry._size(), 1);                // only the pre-existing entry
  assert.equal(clock.pending(), 1);                 // retry armed
});

test('createJob rejects a second job in a cwd already reserved by a running job', () => {
  const { sup } = makeSup();
  sup.createJob({ task: 't', cwd: '/a', model: 'm', mode: 'job', intervalSec: 60 });
  assert.throws(() => sup.createJob({ task: 't2', cwd: '/a', model: 'm', mode: 'job', intervalSec: 60 }));
});

test('a completed job releases its cwd so a new job can claim it', async () => {
  const launchFn = makeLaunch(() => ({ sentinel: true }));
  const { sup, clock } = makeSup({ launchFn });
  sup.createJob({ task: 't', cwd: '/a', model: 'm', mode: 'goal', intervalSec: 60 });
  await tick(clock); // completes
  assert.equal(sup.isCwdReserved('/a'), false);
  assert.doesNotThrow(() => sup.createJob({ task: 't2', cwd: '/a', model: 'm', mode: 'job', intervalSec: 60 }));
});

test('resumeJob restarts an interrupted job, re-reserves cwd, and guards status + cwd', () => {
  const store = memStore();
  store.seed({ id: 'x', task: 't', cwd: '/a', model: 'm', mode: 'job', status: 'interrupted', cyclesDone: 2, consecutiveFailures: 3, intervalSec: 60 });
  store.seed({ id: 'y', task: 't', cwd: '/a', model: 'm', mode: 'job', status: 'interrupted', cyclesDone: 0, consecutiveFailures: 0, intervalSec: 60 });
  const { sup, clock } = makeSup({ store });
  assert.equal(sup.resumeJob('x'), true);
  assert.equal(store.getJob('x').status, 'running');
  assert.equal(store.getJob('x').consecutiveFailures, 0); // reset on resume
  assert.equal(sup.isCwdReserved('/a'), true);
  assert.equal(clock.pending(), 1);                       // first cycle armed
  assert.equal(sup.resumeJob('x'), false);                // already running → no-op
  assert.equal(sup.resumeJob('y'), false);                // cwd held by x → refused
});

test('resumeFromDisk reconciles prior running jobs to interrupted and launches nothing', () => {
  const store = memStore();
  store.seed({ id: 'x', task: 't', cwd: '/a', model: 'm', mode: 'job', status: 'running', cyclesDone: 4 });
  let launched = 0;
  const registry = fakeRegistry();
  const clock = fakeClock();
  const sup = new LoopSupervisor({
    registry, store, launchFn: async () => { launched += 1; return { pid: 1, child: { kill() {} } }; },
    setTimer: clock.setTimer, clearTimer: clock.clearTimer, now: () => 1,
    minIntervalSec: 60, maxFails: 3, maxCyclesGoal: 200, sentinelDir: os.tmpdir(),
  });
  assert.equal(sup.resumeFromDisk(), 1);
  assert.equal(store.getJob('x').status, 'interrupted');
  assert.equal(launched, 0);
  assert.equal(clock.pending(), 0);
});

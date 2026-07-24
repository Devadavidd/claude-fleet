import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { LoopJob, LoopJobCycleResult, LoopJobMode } from '../../../shared/types/index.js';
import type { RegisterEntryInput } from '../launch/launched-registry.js';
import type { LoopJobStore } from './loop-job-store.js';

// Turns the fire-once launchClaude() into a supervised 24/7 loop by RELAUNCHING
// a fresh bounded cycle on a cadence — the agent itself has no daemon mode. Every
// launch-path safety brake is reused via the SHARED LaunchedRegistry (global cap,
// per-cwd lock, kill). The loop-level brakes live here: interval floor always
// applied, consecutive-failure circuit breaker, idempotent status-guarded exit
// handling, durable per-job cwd reservation, and a boot reconciliation that never
// re-executes a persisted task.

// Injectable timer handle — real setTimeout/clearTimeout by default, a plain
// object in tests. Only `.unref` is ever inspected, and only if present.
interface TimerLike {
  unref?: () => void;
}

// Thin adapters so the real Node timer functions satisfy the generic TimerLike
// signature above (setTimeout's return IS a TimerLike; clearTimeout's overloads
// don't structurally match an arbitrary object param, hence the narrow cast).
function defaultSetTimer(fn: () => void, ms: number): TimerLike {
  return setTimeout(fn, ms);
}
function defaultClearTimer(t: TimerLike): void {
  clearTimeout(t as NodeJS.Timeout);
}

// Structural subset of LaunchedRegistry that LoopSupervisor actually drives —
// keeps the supervisor testable against a lightweight double.
export interface LoopSupervisorRegistry {
  atCapacity(): boolean;
  cwdBusy(cwd: string): boolean;
  register(sessionId: string, entry: RegisterEntryInput): void;
  remove(id: string): boolean;
  kill(id: string, signal?: NodeJS.Signals): boolean;
  touch?(id: string): void;
}

export interface LoopLaunchParams {
  sessionId: string;
  cwd: string;
  model: string;
  task: string;
  maxTurns: number;
}

export interface LoopLaunchExitInfo {
  code?: number | null;
  signal?: NodeJS.Signals | null;
  error?: string;
}

export interface LoopLaunchHooks {
  onExit: (info: LoopLaunchExitInfo) => void;
  onActivity: () => void;
}

export interface LoopLaunchOutcome {
  pid: number | undefined;
  child: { kill: (signal?: NodeJS.Signals | number) => unknown };
}

// Matches launchClaude()'s contract exactly (chunk B's launch/launch-claude.ts) —
// injectable so tests can pin timing without a real child.
export type LoopLaunchFn = (params: LoopLaunchParams, hooks: LoopLaunchHooks) => Promise<LoopLaunchOutcome>;

export interface LoopSupervisorOptions {
  registry: LoopSupervisorRegistry;
  launchFn: LoopLaunchFn;
  store: LoopJobStore;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => TimerLike;
  clearTimer?: (t: TimerLike) => void;
  minIntervalSec?: number;
  maxFails?: number;
  maxCyclesGoal?: number;
  maxTurns?: number;
  sentinelDir: string;
}

export interface CreateJobParams {
  task: string;
  cwd: string;
  model: string;
  mode?: LoopJobMode | string;
  intervalSec: number;
}

interface CycleState {
  sessionId: string;
  settled: boolean;
  killOnArrival: boolean;
}

interface LoopSupervisorEventMap {
  job: [job: LoopJob];
}

export class LoopSupervisor extends EventEmitter<LoopSupervisorEventMap> {
  private readonly registry: LoopSupervisorRegistry;
  private readonly launchFn: LoopLaunchFn;
  private readonly store: LoopJobStore;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => TimerLike;
  private readonly clearTimer: (t: TimerLike) => void;
  private readonly minIntervalSec: number;
  private readonly maxFails: number;
  private readonly maxCyclesGoal: number;
  private readonly maxTurns: number;
  private readonly sentinelDir: string;
  private readonly timers: Map<string, TimerLike>; // id -> timer handle (one at most per job)
  private readonly activeCwds: Set<string>; // durable per-JOB cwd reservation (whole lifetime, not per-cycle)
  private readonly current: Map<string, CycleState>; // id -> in-flight cycle state
  // Bounded record of every sessionId we've spawned, so the board can filter loop
  // cycles out (they belong on the Always-on page, never the "who needs me" board,
  // and must not each raise a chime/desktop notification).
  private readonly cycleSessions: Set<string>;
  private cycleOrder: string[];
  private readonly cycleCap: number;

  constructor({
    registry, launchFn, store,
    now = () => Date.now(), setTimer = defaultSetTimer, clearTimer = defaultClearTimer,
    minIntervalSec = 60, maxFails = 3, maxCyclesGoal = 200, maxTurns = 40, sentinelDir,
  }: LoopSupervisorOptions) {
    super();
    this.registry = registry;
    this.launchFn = launchFn;
    this.store = store;
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.minIntervalSec = minIntervalSec;
    this.maxFails = maxFails;
    this.maxCyclesGoal = maxCyclesGoal;
    this.maxTurns = maxTurns;
    this.sentinelDir = sentinelDir;
    // Owner-only dir for goal-mode completion sentinels (the agent writes here).
    try { fs.mkdirSync(sentinelDir, { recursive: true, mode: 0o700 }); } catch { /* best-effort */ }
    this.timers = new Map();
    this.activeCwds = new Set();
    this.current = new Map();
    this.cycleSessions = new Set();
    this.cycleOrder = [];
    this.cycleCap = 2000;
  }

  // --- public API ---

  isCwdReserved(cwd: string): boolean { return this.activeCwds.has(cwd); }
  isLoopCycle(sessionId: string): boolean { return this.cycleSessions.has(sessionId); }
  listJobs(): LoopJob[] { return this.store.readJobs(); }

  createJob({ task, cwd, model, mode = 'job', intervalSec }: CreateJobParams): LoopJob {
    if (this.activeCwds.has(cwd)) throw new Error('a loop job is already running in this directory');
    const job: LoopJob = {
      id: randomUUID(),
      task, cwd, model,
      mode: mode === 'goal' ? 'goal' : 'job',
      intervalSec: this.floor(intervalSec),
      status: 'running',
      cyclesDone: 0,
      consecutiveFailures: 0,
      lastResult: null,
      lastRunAt: null,
      createdAt: this.now(),
    };
    this.store.upsertJob(job);
    this.activeCwds.add(cwd);
    this.emit('job', job);
    this.schedule(job.id, 0); // first cycle runs promptly; interval only spaces subsequent ones
    return job;
  }

  stopJob(id: string): boolean {
    const job = this.store.getJob(id);
    if (!job) return false;
    job.status = 'stopped';
    this.store.upsertJob(job);
    this.clear(id);
    this.activeCwds.delete(job.cwd);
    const cycle = this.current.get(id);
    if (cycle) {
      cycle.killOnArrival = true;               // if the child is still spawning, kill it on arrival
      if (cycle.sessionId) this.registry.kill(cycle.sessionId);
    }
    this.emit('job', job);
    return true;
  }

  resumeJob(id: string): boolean {
    const job = this.store.getJob(id);
    if (!job || (job.status !== 'paused' && job.status !== 'interrupted')) return false;
    if (this.activeCwds.has(job.cwd)) return false; // another job holds the tree
    job.status = 'running';
    job.consecutiveFailures = 0;
    this.store.upsertJob(job);
    this.activeCwds.add(job.cwd);
    this.emit('job', job);
    this.schedule(id, 0);
    return true;
  }

  // Boot: NEVER auto-launch a persisted task (the file is untrusted input). Just
  // reconcile prior `running` jobs to `interrupted` so the UI can't show a live
  // badge for a job with no timer/child. Returns how many were reconciled.
  resumeFromDisk(): number {
    let n = 0;
    for (const job of this.store.readJobs()) {
      if (job.status === 'running') { job.status = 'interrupted'; this.store.upsertJob(job); n += 1; }
    }
    return n;
  }

  // Shutdown: clear timers only. Children are SIGTERM'd by server.killLaunched();
  // job status is left on disk for the next boot's reconciliation.
  stopAllTimers(): void {
    for (const t of this.timers.values()) this.clearTimer(t);
    this.timers.clear();
  }

  // --- cycle machinery ---

  private async runCycle(id: string): Promise<void> {
    const job = this.store.getJob(id);
    if (!job || job.status !== 'running') return;                       // stopped/paused → drop
    // Another launch (one-shot or another job's live cycle) holds the tree, or the
    // global cap is full: skip WITHOUT counting a cycle or a failure, retry later.
    if (this.registry.atCapacity() || this.registry.cwdBusy(job.cwd)) {
      this.schedule(id, this.minIntervalSec);
      return;
    }
    const sessionId = randomUUID();
    this.trackCycle(sessionId);
    const sentinelPath = path.join(this.sentinelDir, `${id}-${sessionId}`);
    try { fs.unlinkSync(sentinelPath); } catch { /* no stale sentinel — fine */ }
    // Reserve the registry slot SYNCHRONOUSLY (nothing awaits between the cwd/cap
    // check and here) so a concurrent cycle/one-shot can't also pass the guard.
    this.registry.register(sessionId, { cwd: job.cwd, model: job.model, startedAt: this.now(), status: 'starting' });
    const cycle: CycleState = { sessionId, settled: false, killOnArrival: false };
    this.current.set(id, cycle);

    const task = job.mode === 'goal' ? `${job.task}\n\n${goalInstruction(sentinelPath, sessionId)}` : job.task;
    const onExit = (info: LoopLaunchExitInfo): void => this.onCycleExit(id, sessionId, sentinelPath, cycle, info ?? {});
    const onActivity = (): void => { try { this.registry.touch?.(sessionId); } catch { /* ignore */ } };

    try {
      const { pid, child } = await this.launchFn(
        { sessionId, cwd: job.cwd, model: job.model, task, maxTurns: this.maxTurns },
        { onExit, onActivity },
      );
      // Upgrade the reservation to the LIVE pid+child FIRST, so a kill can actually
      // reach the process. Only then check whether Stop landed during the spawn
      // await (the pid-less `starting` reservation made stopJob's kill a no-op).
      this.registry.register(sessionId, { pid, child, cwd: job.cwd, model: job.model, startedAt: this.now() });
      const fresh = this.store.getJob(id);
      if (!fresh || fresh.status !== 'running' || cycle.killOnArrival) {
        cycle.settled = true;
        this.registry.kill(sessionId); // now hits the real pid/child, not a no-op
        this.registry.remove(sessionId);
        this.current.delete(id);
        return;
      }
    } catch (err) {
      // Pre-spawn reject (ENOENT/EAGAIN): onExit never fires. Release the leaked
      // reservation and count it as a failure so the breaker can trip.
      cycle.settled = true;
      this.registry.remove(sessionId);
      this.current.delete(id);
      this.finishCycle(id, { ok: false, error: String((err as { message?: unknown } | null)?.message ?? err), completed: false });
    }
  }

  private onCycleExit(id: string, sessionId: string, sentinelPath: string, cycle: CycleState, info: LoopLaunchExitInfo): void {
    if (cycle.settled) return;               // ignore the double error+exit fire
    cycle.settled = true;
    this.registry.remove(sessionId);
    this.current.delete(id);
    const job = this.store.getJob(id);
    if (!job || job.status !== 'running') return; // user Stop set 'stopped' before killing → don't count
    // Past the guard, status is still 'running', so this was NOT a user Stop (that
    // sets 'stopped' first). A clean exit (code 0) is success; a crash or an
    // idle-reap/external SIGTERM (code null) is a failure that feeds the breaker,
    // so a repeatedly-hung cycle eventually pauses instead of relaunching forever.
    const ok = !info.error && info.code === 0;
    const completed = ok && job.mode === 'goal' && this.sentinelMatches(sentinelPath, sessionId);
    this.finishCycle(id, { ok, code: info.code ?? null, signal: info.signal ?? null, completed });
  }

  // Shared outcome accounting for a completed cycle (from onExit) and a rejected
  // spawn. Failure/breaker is evaluated BEFORE completion, so a crashed cycle that
  // also wrote a sentinel is a failure, never `completed`.
  private finishCycle(id: string, outcome: {
    ok: boolean; code?: number | null; signal?: NodeJS.Signals | null; error?: string | null; completed: boolean;
  }): void {
    const { ok, code = null, signal = null, error = null, completed } = outcome;
    const job = this.store.getJob(id);
    if (!job || job.status !== 'running') return;
    job.cyclesDone += 1;
    job.lastRunAt = this.now();
    const lastResult: LoopJobCycleResult = { ok, code, signal, error, at: job.lastRunAt };
    job.lastResult = lastResult;
    job.consecutiveFailures = ok ? 0 : job.consecutiveFailures + 1;

    if (job.consecutiveFailures >= this.maxFails) job.status = 'paused';        // circuit breaker
    else if (completed) job.status = 'completed';                               // goal reached (payload-checked)
    else if (job.mode === 'goal' && job.cyclesDone >= this.maxCyclesGoal) job.status = 'paused'; // safety cap

    if (job.status !== 'running') { this.activeCwds.delete(job.cwd); this.clear(id); }
    this.store.upsertJob(job);
    this.emit('job', job);
    if (job.status === 'running') this.schedule(id, this.floor(job.intervalSec));
  }

  private schedule(id: string, delaySec: number): void {
    this.clear(id); // never leave two timers armed for one job
    const t = this.setTimer(() => { this.runCycle(id).catch(() => {}); }, delaySec * 1000);
    if (t && typeof t.unref === 'function') t.unref();
    this.timers.set(id, t);
  }

  private clear(id: string): void {
    const t = this.timers.get(id);
    if (t !== undefined) { this.clearTimer(t); this.timers.delete(id); }
  }

  private floor(sec: number): number { return Math.max(Number(sec) || 0, this.minIntervalSec); }

  private trackCycle(sessionId: string): void {
    this.cycleSessions.add(sessionId);
    this.cycleOrder.push(sessionId);
    if (this.cycleOrder.length > this.cycleCap) {
      const oldest = this.cycleOrder.shift();
      if (oldest) this.cycleSessions.delete(oldest);
    }
  }

  private sentinelMatches(sentinelPath: string, sessionId: string): boolean {
    try { return fs.readFileSync(sentinelPath, 'utf8').trim() === sessionId; }
    catch { return false; }
  }
}

function goalInstruction(sentinelPath: string, sessionId: string): string {
  return `When — and only when — the goal above is fully achieved, write the exact text "${sessionId}" `
    + `to the file "${sentinelPath}" and then stop. Do not create or write that file otherwise.`;
}

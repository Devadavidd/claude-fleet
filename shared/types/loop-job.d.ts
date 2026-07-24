// Always-on loop job contract — mirrors src/loop-supervisor.js createJob() and
// its lifecycle transitions (`loop-job` SSE + /api/loop-jobs payloads).

export type LoopJobMode = 'job' | 'goal';

/**
 * running → stopped (user Stop) | paused (circuit breaker / goal safety cap)
 *         | completed (goal sentinel) | interrupted (crash-safe boot reconcile).
 */
export type LoopJobStatus = 'running' | 'stopped' | 'paused' | 'completed' | 'interrupted';

/** Outcome of the most recent cycle (src/loop-supervisor.js #onCycleExit). */
export interface LoopJobCycleResult {
  ok: boolean;
  code: number | null;
  signal: string | null;
  error: string | null;
  at: number;
}

export interface LoopJob {
  id: string;
  task: string;
  cwd: string;
  model: string;
  mode: LoopJobMode;
  intervalSec: number;
  status: LoopJobStatus;
  cyclesDone: number;
  consecutiveFailures: number;
  lastResult: LoopJobCycleResult | null;
  lastRunAt: number | null;
  createdAt: number;
}

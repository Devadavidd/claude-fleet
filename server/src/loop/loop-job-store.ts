import fs from 'node:fs';
import path from 'node:path';
import type { LoopJob } from '../../../shared/types/index.js';

// Persisted loop-job records — the control state for unattended, repeatedly
// relaunched agents. The file holds task prompts + working directories, so it is
// written owner-only (0600 file, 0700 dir), mirroring launched-registry.ts's pid
// file — NOT launch-settings.ts, which writes world-readable default perms.
// A crashed/foreign write must never be trusted to auto-launch anything; the
// supervisor only ever reconciles persisted `running` jobs to `interrupted` on
// boot (see LoopSupervisor.resumeFromDisk), never re-executes a stored task.

export interface LoopJobStore {
  file: string;
  readJobs(): LoopJob[];
  writeJobs(jobs: LoopJob[]): void;
  getJob(id: string): LoopJob | null;
  upsertJob(job: LoopJob): LoopJob;
  removeJob(id: string): boolean;
}

export function createJobStore(file: string): LoopJobStore {
  function readJobs(): LoopJob[] {
    try {
      // The file is untrusted (crashed/foreign writes must never auto-launch);
      // trust the shape only enough to iterate — every consumer is defensive.
      const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
      return Array.isArray(parsed) ? (parsed as LoopJob[]) : [];
    } catch { return []; } // missing / corrupt file → empty, never throw
  }

  function writeJobs(jobs: LoopJob[]): void {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      fs.writeFileSync(file, JSON.stringify(jobs, null, 2), { mode: 0o600 });
    } catch { /* persistence is best-effort; never crash a cycle over it */ }
  }

  function getJob(id: string): LoopJob | null {
    return readJobs().find((j) => j.id === id) ?? null;
  }

  function upsertJob(job: LoopJob): LoopJob {
    const jobs = readJobs();
    const i = jobs.findIndex((j) => j.id === job.id);
    if (i === -1) jobs.push(job); else jobs[i] = job;
    writeJobs(jobs);
    return job;
  }

  function removeJob(id: string): boolean {
    const jobs = readJobs();
    const next = jobs.filter((j) => j.id !== id);
    const removed = next.length !== jobs.length;
    writeJobs(next);
    return removed;
  }

  return { file, readJobs, writeJobs, getJob, upsertJob, removeJob };
}

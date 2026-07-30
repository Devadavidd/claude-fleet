import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// Tracks the Claude processes the dashboard launched. Every entry is a live
// bypassPermissions child — full-user code execution — so the registry is the
// gate for the concurrency caps and the control handle for stop/reap.
// In-memory for control; a small on-disk pid file lets a *crashed* server reap
// its orphans on next boot (a graceful shutdown SIGTERMs them directly).

// Minimal duck-typed child handle — matches node:child_process.ChildProcess
// structurally, but stays loose so callers (e.g. the loop supervisor's injected
// launchFn) can register a lighter test/production double.
export interface LaunchedChildLike {
  kill?: (signal?: NodeJS.Signals | number) => unknown;
  stdin?: {
    writable: boolean;
    write: (chunk: string) => unknown;
    end: () => unknown;
  } | null;
}

export interface RegisterEntryInput {
  pid?: number;
  cwd: string;
  model?: string;
  startedAt?: number;
  steerable?: boolean;
  supervised?: boolean; // launched without bypassPermissions (fleet-hook approvals)
  status?: string; // callers may pre-set a reservation status (e.g. 'starting')
  child?: LaunchedChildLike;
}

export interface LaunchedEntry extends RegisterEntryInput {
  sessionId: string;
  status: string;
  idleTimer?: NodeJS.Timeout;
  // True while a permission request is pending on this session: a child
  // blocked on the user's Allow/Deny is waiting BY DESIGN, not wedged —
  // idle-kill is suspended until the request resolves.
  idleHeld?: boolean;
}

export interface LaunchedRegistryOptions {
  maxConcurrent?: number;
  pidFile?: string | null;
  idleKillMs?: number;
}

export class LaunchedRegistry {
  private readonly maxConcurrent: number;
  private readonly pidFile: string | null;
  private readonly idleKillMs: number; // > 0 → any launched session idle this long is reaped
  private readonly byId: Map<string, LaunchedEntry>;

  constructor({ maxConcurrent = 3, pidFile = null, idleKillMs = 0 }: LaunchedRegistryOptions = {}) {
    this.maxConcurrent = maxConcurrent;
    this.pidFile = pidFile;
    this.idleKillMs = idleKillMs;
    this.byId = new Map(); // sessionId -> { pid, child, cwd, model, startedAt, status, steerable, idleTimer }
  }

  // (Re)arm the idle-kill timer for a session. Reset on register + any activity
  // (output or steer), so a healthy session — steerable or not — keeps clearing
  // it. It only fires for a launched child that goes fully silent (a steerable
  // child left waiting for input, or any child wedged on a hung tool call): a
  // lingering bypassPermissions process is exactly what must not outlive attention.
  private armIdle(id: string): void {
    if (!this.idleKillMs) return;
    const e = this.byId.get(id);
    if (!e) return;
    if (e.idleTimer) clearTimeout(e.idleTimer);
    if (e.idleHeld) return; // waiting on a permission decision — never reap
    e.idleTimer = setTimeout(() => this.idleReap(id), this.idleKillMs);
    e.idleTimer.unref?.();
  }

  // Suspend idle-kill while the session waits on a human permission decision.
  holdIdle(id: string): void {
    const e = this.byId.get(id);
    if (!e) return;
    e.idleHeld = true;
    if (e.idleTimer) clearTimeout(e.idleTimer);
  }

  // Decision arrived — resume the normal idle clock from now.
  releaseIdle(id: string): void {
    const e = this.byId.get(id);
    if (!e) return;
    e.idleHeld = false;
    this.armIdle(id);
  }

  // Reap an idle session with the same SIGTERM→SIGKILL escalation the manual Stop
  // uses, so a child that ignores SIGTERM can't hold its cap slot / cwd lock forever.
  private idleReap(id: string): void {
    this.kill(id, 'SIGTERM');
    const t = setTimeout(() => { if (this.has(id)) this.kill(id, 'SIGKILL'); }, 5000);
    t.unref?.();
  }

  // Reset the idle timer — called on child output and on every steer.
  touch(id: string): void { this.armIdle(id); }

  // Write a user message into a steerable child's still-open stdin. Resets idle.
  // Clean no-op if the child exited / stdin closed. (Answers are sent this way
  // too — a follow-up message is the reliable steer primitive.)
  writeToChannel(id: string, text: string): boolean {
    const stdin = this.byId.get(id)?.child?.stdin;
    if (!stdin || !stdin.writable) return false;
    try { stdin.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content: String(text) } })}\n`); }
    catch { return false; }
    this.armIdle(id);
    return true;
  }

  // Close stdin so a steerable child finishes its current turn and exits.
  finish(id: string): boolean {
    const stdin = this.byId.get(id)?.child?.stdin;
    if (!stdin || !stdin.writable) return false;
    try { stdin.end(); return true; } catch { return false; }
  }

  // Best-effort snapshot of live pids so a crashed server can reap orphans.
  private persist(): void {
    if (!this.pidFile) return;
    try {
      const rows = [...this.byId.values()]
        .filter((e): e is LaunchedEntry & { pid: number } => typeof e.pid === 'number') // skip 'starting' reservations
        .map((e) => ({ pid: e.pid, sessionId: e.sessionId, startedAt: e.startedAt }));
      fs.mkdirSync(path.dirname(this.pidFile), { recursive: true });
      fs.writeFileSync(this.pidFile, JSON.stringify(rows), { mode: 0o600 }); // owner-only
    } catch { /* pid file is an optimization; never fail a launch over it */ }
  }

  size(): number { return this.byId.size; }
  has(id: string): boolean { return this.byId.has(id); }
  get(id: string): LaunchedEntry | undefined { return this.byId.get(id); }
  ids(): string[] { return [...this.byId.keys()]; }

  // --- caps (red-team: fork-bomb prevention) ---
  atCapacity(): boolean { return this.byId.size >= this.maxConcurrent; }

  // Two autonomous agents in one working tree corrupt each other — never allow it.
  cwdBusy(cwd: string): boolean {
    for (const e of this.byId.values()) if (e.cwd === cwd) return true;
    return false;
  }

  register(sessionId: string, entry: RegisterEntryInput): void {
    const existing = this.byId.get(sessionId);
    if (existing?.idleTimer) clearTimeout(existing.idleTimer); // upgrading a reservation
    this.byId.set(sessionId, { status: 'running', sessionId, ...entry });
    this.armIdle(sessionId);
    this.persist();
  }

  remove(id: string): boolean {
    const existing = this.byId.get(id);
    if (existing?.idleTimer) clearTimeout(existing.idleTimer);
    const ok = this.byId.delete(id);
    this.persist();
    return ok;
  }

  // SIGTERM the child's whole process group (it was spawned `detached`), falling
  // back to the direct child. Returns false if not a launched session.
  kill(id: string, signal: NodeJS.Signals = 'SIGTERM'): boolean {
    const e = this.byId.get(id);
    if (!e) return false;
    if (e.idleTimer) clearTimeout(e.idleTimer);
    if (typeof e.pid === 'number') {
      try { process.kill(-e.pid, signal); return true; } catch { /* group gone — try child */ }
    }
    try { e.child?.kill?.(signal); } catch { /* already dead */ }
    return true;
  }

  killAll(signal: NodeJS.Signals = 'SIGTERM'): void {
    for (const id of this.ids()) this.kill(id, signal);
  }
}

// On startup, SIGTERM any launched child that outlived a *crashed* server (the
// in-memory registry died with it). Reads the pid file; before killing a pid it
// confirms the process is (a) alive and (b) actually a `claude` process — so a
// recycled pid belonging to something unrelated is never killed. Returns count.
export function reapOrphans(pidFile: string | null, isClaude: (pid: number) => boolean = defaultIsClaude): number {
  if (!pidFile) return 0;
  let rows: unknown;
  try { rows = JSON.parse(fs.readFileSync(pidFile, 'utf8')); } catch { return 0; }
  if (!Array.isArray(rows)) return 0;
  let reaped = 0;
  for (const row of rows) {
    const pid = (row as { pid?: unknown } | null)?.pid;
    if (typeof pid !== 'number') continue;
    try { process.kill(pid, 0); } catch { continue; } // not alive
    if (!isClaude(pid)) continue; // pid recycled to a non-claude process — leave it
    try { process.kill(-pid, 'SIGTERM'); reaped += 1; }
    catch { try { process.kill(pid, 'SIGTERM'); reaped += 1; } catch { /* gone */ } }
  }
  try { fs.writeFileSync(pidFile, '[]'); } catch { /* best-effort */ }
  return reaped;
}

// Only reap a pid whose command line is unmistakably one of OUR launches: a
// claude process spawned headless with stream-json plumbing AND one of the two
// permission modes we ever pass (`bypassPermissions` for auto launches,
// `default` for supervised ones). The stream-json requirement deliberately
// excludes the user's interactive `claude` CLI — which may legitimately run
// `--permission-mode default` — so a recycled pid landing on it is never
// group-killed.
function defaultIsClaude(pid: number): boolean {
  try {
    return isOurLaunchCommandLine(execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }));
  } catch { return false; }
}

/** Pure ps-command-line classifier behind defaultIsClaude — exported for tests. */
export function isOurLaunchCommandLine(cmd: string): boolean {
  return /claude/i.test(cmd)
    && /--input-format stream-json/.test(cmd)
    && /--permission-mode (bypassPermissions|default)/.test(cmd);
}

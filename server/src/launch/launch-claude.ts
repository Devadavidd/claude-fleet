import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

// Spawns a headless Claude session (route A, confirmed by both spikes).
// Safety baked in:
//  - argv ARRAY, never a shell string → no command injection via task/cwd/model.
//  - `detached` → own process group, so kill can SIGTERM the whole group.
//  - `--max-turns` → hard cost ceiling.
//
// Lifecycle depends on `steerable` (proven by the control-channel spike):
//  - NOT steerable (default): feed ONE message then EOF stdin → the child runs
//    to `result` and exits cleanly (the proven default launch path — unchanged).
//  - steerable: feed the first message but KEEP stdin open so follow-up messages
//    (and question answers, sent as messages) can be written mid-run. Such a
//    child stays alive after each `result`, exiting only on stdin EOF — so the
//    registry idle-kills it / a Finish action closes stdin.
//
// Resolves only AFTER the child has actually spawned (so the endpoint doesn't
// 202 a launch that immediately ENOENTs); rejects on spawn error. `onActivity`
// fires on child stdout so the caller can reset a steerable session's idle timer.
// `spawnFn` is injectable so the characterization suite can pin the spawn
// contract (argv array, detached, stdin lifecycle) without a real child.

export interface LaunchClaudeParams {
  sessionId: string;
  cwd: string;
  model: string;
  task: string;
  maxTurns: number;
  steerable?: boolean;
  /** When set, the session loads this plugin dir (the /cf skill bundle). */
  pluginDir?: string;
  /**
   * Continue an EXISTING session instead of starting a fresh one: swaps
   * `--session-id` for `--resume <sessionId>` (no --fork-session, so the CLI
   * keeps the same id and appends to the same transcript — the dashboard's
   * watcher/timeline just carry on).
   */
  resume?: boolean;
  /**
   * Extra working folders (desktop-app multi-root): each becomes an
   * `--add-dir` the agent may read/edit in addition to cwd.
   */
  addDirs?: readonly string[];
}

export interface SpawnFnOptions {
  cwd: string;
  detached: boolean;
  stdio: ['pipe', 'pipe', 'pipe'];
}

export type SpawnFn = (command: string, args: readonly string[], options: SpawnFnOptions) => ChildProcess;

export interface LaunchExitInfo {
  code?: number | null;
  signal?: NodeJS.Signals | null;
  error?: string;
  stderr?: string;
}

export interface LaunchClaudeHooks {
  onExit?: (info: LaunchExitInfo) => void;
  onActivity?: () => void;
  spawnFn?: SpawnFn;
}

export interface LaunchClaudeResult {
  pid: number | undefined;
  child: ChildProcess;
}

export function launchClaude(
  { sessionId, cwd, model, task, maxTurns, steerable = false, pluginDir, resume = false, addDirs = [] }: LaunchClaudeParams,
  { onExit, onActivity, spawnFn = spawn }: LaunchClaudeHooks = {},
): Promise<LaunchClaudeResult> {
  const args = [
    '-p',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--permission-mode', 'bypassPermissions',
    ...(resume ? ['--resume', sessionId] : ['--session-id', sessionId]),
    '--model', model,
    '--max-turns', String(maxTurns),
    // Desktop-app multi-root: every extra working folder rides as --add-dir.
    ...addDirs.flatMap((d) => ['--add-dir', d]),
    // The /cf skill bundle rides in as a session-only plugin; omitted entirely
    // when inactive so the legacy argv contract stays byte-identical.
    ...(pluginDir ? ['--plugin-dir', pluginDir] : []),
  ];
  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawnFn('claude', args, { cwd, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); if (stderr.length > 4000) stderr = stderr.slice(-4000); });
    // Any output = the session is alive/working → reset its idle timer.
    child.stdout?.on('data', () => { if (settled) onActivity?.(); });
    // A steer write can lose the race and flush into a just-closed stdin; the
    // resulting async EPIPE/ERR_STREAM_DESTROYED has no other listener and would
    // otherwise crash the whole dashboard. Swallow it — writeToChannel already
    // reports failure via its return value and onExit handles the cleanup.
    child.stdin?.on('error', () => {});

    child.once('spawn', () => {
      settled = true;
      try {
        // stdio is fixed to ['pipe','pipe','pipe'] above, so stdin is always a
        // pipe here; the `!` mirrors the original's unguarded access while
        // strict-null-checks are satisfied — a genuinely-null stdin still
        // throws into the catch below exactly as before.
        child.stdin!.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content: task } })}\n`);
        if (!steerable) child.stdin!.end(); // plain launch: EOF → run to completion + exit
      } catch { /* child died between spawn and write — onExit will fire */ }
      resolve({ pid: child.pid, child });
    });

    child.once('error', (err: Error) => {
      if (!settled) { settled = true; reject(err); return; } // spawn failed (ENOENT, etc.)
      onExit?.({ error: String(err?.message ?? err), stderr });
    });

    child.on('exit', (code, signal) => { if (settled) onExit?.({ code, signal, stderr }); });
  });
}

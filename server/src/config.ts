import os from 'node:os';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Typed, frozen server config — parsed once from env at import time. Every
// field mirrors src/config.js exactly (same env vars, same fallbacks); the only
// addition is `skillsRoot` for the new read-only GET /api/skills scan.

function envInt(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(value) ? value : fallback;
}

function expandHome(p: string): string {
  return p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
}

// Comma-separated env list → trimmed, home-expanded, non-empty entries.
function envList(name: string, fallback: string[] = []): string[] {
  const raw = process.env[name];
  if (!raw) return fallback;
  return raw.split(',').map((s) => expandHome(s.trim())).filter(Boolean);
}

export interface FleetConfig {
  host: string;
  port: number;
  activeMinutes: number;
  idleMinutes: number;
  projectsRoot: string;
  publicDir: string;
  skillsRoot: string;
  cfPluginDir: string;
  cfUpstreamRepo: string;
  fleetToken: string;
  allowedRoots: string[];
  allowedModels: string[];
  launchModel: string;
  maxTurns: number;
  maxConcurrent: number;
  idleKillMin: number;
  launchedPidFile: string;
  uploadsDir: string;
  hiddenSessionsFile: string;
  loopJobsFile: string;
  loopSentinelDir: string;
  loopMinIntervalSec: number;
  loopMaxFails: number;
  loopMaxCyclesGoal: number;
  loopAllowedBaseHosts: string[];
}

export const config = Object.freeze({
  // Server binds localhost only — dashboard is a personal, unauthenticated tool.
  host: '127.0.0.1',
  port: envInt('FLEET_PORT', 4600),
  // A session file counts as "active" (shown on the board, kept polled) while its
  // mtime is within this window. 0 or negative = unlimited — never auto-hide a
  // session, so every session stays on the board until its transcript is deleted.
  // Note: transcripts are never deleted by this tool; "hiding" is display-only.
  activeMinutes: envInt('FLEET_ACTIVE_MINUTES', 0),
  // A session with no events for this long is shown as idle.
  idleMinutes: envInt('FLEET_IDLE_MINUTES', 5),
  projectsRoot: expandHome(process.env.FLEET_PROJECTS_ROOT ?? '~/.claude/projects'),
  // Directory the HTTP server serves the SPA from. Default = the legacy public/
  // tree; FLEET_PUBLIC_DIR overrides it. `||` (not `??`): a set-but-empty env var
  // must fall back too — resolving '' would serve the process CWD. Resolved
  // from this compiled file's own location (dist/server/config.js), not
  // __dirname — nodenext ESM has no __dirname. Default = the built SPA at
  // dist/client (one level up from dist/server), served single-origin in prod.
  publicDir: path.resolve(
    expandHome(
      process.env.FLEET_PUBLIC_DIR
        || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'client'),
    ),
  ),
  // Root the read-only skill-catalog reader scans (GET /api/skills): `<root>/skills/*`
  // + `<root>/agents/*`. Static fallback only — routes call activeSkillsRoot(),
  // which prefers the in-repo cf-plugin bundle the moment it exists on disk.
  skillsRoot: expandHome(process.env.FLEET_SKILLS_ROOT || '~/.claude'),
  // The dashboard-owned /cf skill bundle (plugin-shaped, committed in-repo).
  // Resolved from this compiled file's location (dist/server → repo root).
  cfPluginDir: path.resolve(
    expandHome(
      process.env.FLEET_CF_PLUGIN_DIR
        || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'cf-plugin'),
    ),
  ),
  // Upstream ClaudeKit source the bundle syncs from (private; gh-authenticated).
  cfUpstreamRepo: process.env.FLEET_CF_UPSTREAM || 'claudekit/claudekit-engineer',

  // --- Launch (Plan 1) — all disabled-by-default and localhost-scoped ---
  // Per-run anti-CSRF secret; the SPA echoes it in X-Fleet-Token. Rotates every
  // restart, never persisted.
  fleetToken: randomBytes(24).toString('hex'),
  // A launch is only permitted with cwd canonicalizing under one of these roots.
  // EMPTY = launching disabled (safe default; opt in via FLEET_ALLOWED_ROOTS).
  allowedRoots: envList('FLEET_ALLOWED_ROOTS', []),
  // Strict model whitelist for launches. The full ladder is offered (opus →
  // fable) so the web picker matches the desktop app; the DEFAULT is Opus 4.8
  // (most capable) — set FLEET_LAUNCH_MODEL to a cheaper id to override.
  allowedModels: envList('FLEET_ALLOWED_MODELS', [
    'claude-opus-4-8', 'claude-sonnet-5', 'claude-haiku-4-5-20251001', 'claude-fable-5',
  ]),
  launchModel: process.env.FLEET_LAUNCH_MODEL ?? 'claude-opus-4-8',
  maxTurns: envInt('FLEET_MAX_TURNS', 40), // hard per-launch turn ceiling
  maxConcurrent: envInt('FLEET_MAX_CONCURRENT', 3), // global concurrent-launch cap
  idleKillMin: envInt('FLEET_IDLE_KILL_MIN', 20), // any launched session reaped after this idle (output resets it)
  // Tracks launched pids so a crashed server reaps its orphans on next boot.
  // Under the per-user home dir (0600), NOT world-shared /tmp, so a co-located
  // user can't poison it into killing our processes.
  launchedPidFile: path.join(os.homedir(), '.claude-fleet', `launched-${envInt('FLEET_PORT', 4600)}.json`),
  // Chat-composer attachments (POST /api/uploads) — each batch in its own 0700
  // subdir. Same owner-only home dir posture as launchedPidFile.
  uploadsDir: path.join(os.homedir(), '.claude-fleet', `uploads-${envInt('FLEET_PORT', 4600)}`),
  // Display-only hidden sessions (board clean-up) — transcripts stay untouched.
  hiddenSessionsFile: path.join(os.homedir(), '.claude-fleet', `hidden-sessions-${envInt('FLEET_PORT', 4600)}.json`),

  // --- Always-on loop jobs (a supervisor relaunches bounded cycles 24/7) ---
  // Persisted job control state (0600 file) + per-cycle goal sentinels (0700 dir),
  // same owner-only home dir as launchedPidFile. Boot never re-executes a stored
  // task; it only reconciles prior `running` jobs to `interrupted`.
  loopJobsFile: path.join(os.homedir(), '.claude-fleet', `loop-jobs-${envInt('FLEET_PORT', 4600)}.json`),
  loopSentinelDir: path.join(os.homedir(), '.claude-fleet', `loop-sentinels-${envInt('FLEET_PORT', 4600)}`),
  loopMinIntervalSec: envInt('FLEET_LOOP_MIN_INTERVAL', 60), // hard floor between cycles (hammer/cost brake)
  loopMaxFails: envInt('FLEET_LOOP_MAX_FAILS', 3), // consecutive failed cycles → pause (circuit breaker)
  loopMaxCyclesGoal: envInt('FLEET_LOOP_MAX_CYCLES', 200), // goal-mode safety cap
  // QA-template target hosts the loop agent may be pointed at. Loopback-only by
  // default (guard-rail against pointing an unattended agent off-box); widen via env.
  loopAllowedBaseHosts: envList('FLEET_LOOP_BASE_HOSTS', ['127.0.0.1', 'localhost']),
}) satisfies FleetConfig;

// --- cf-plugin liveness (evaluated per call, NOT frozen at boot) ---
// The bundle can be seeded/synced while the server is running; these helpers
// let the catalog root and the launch flag flip without a restart.

/** True when the bundle exists AND the FLEET_CF_PLUGIN kill-switch is not off. */
export function cfPluginActive(): boolean {
  const flag = (process.env.FLEET_CF_PLUGIN ?? '').toLowerCase();
  if (flag === '0' || flag === 'false') return false;
  return existsSync(path.join(config.cfPluginDir, '.claude-plugin', 'plugin.json'));
}

/**
 * Root the skills catalog scans right now: an explicit FLEET_SKILLS_ROOT always
 * wins; otherwise the cf bundle once seeded; otherwise the legacy ~/.claude.
 */
export function activeSkillsRoot(): string {
  if (process.env.FLEET_SKILLS_ROOT) return config.skillsRoot;
  return cfPluginActive() ? config.cfPluginDir : config.skillsRoot;
}

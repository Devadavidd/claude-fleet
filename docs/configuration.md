# Configuration Reference

Every variable is optional. With nothing set you get a read-only dashboard on `http://127.0.0.1:4600` watching `~/.claude/projects`.

Defaults below are verified against [`server/src/config.ts`](../server/src/config.ts) — that file is the source of truth.

## Server & display

| Var | Default | Meaning |
|-----|---------|---------|
| `FLEET_PORT` | `4600` | HTTP listen port. The host is always `127.0.0.1` (not configurable). Per-port state files under `~/.claude-fleet/` keep multiple instances independent. |
| `FLEET_PROJECTS_ROOT` | `~/.claude/projects` | Transcript root to watch. |
| `FLEET_PUBLIC_DIR` | `dist/client` | SPA bundle directory the server serves. |
| `FLEET_ACTIVE_MINUTES` | `0` | Sessions whose transcript mtime is older than this are hidden from the board. `0` = never hide (default). Display-only — transcripts are never touched. Example: `10080` hides sessions idle > 7 days. |
| `FLEET_IDLE_MINUTES` | `5` | No events for this long → the card shows *idle*. |

## Launch & spawn

Launching is **disabled until `FLEET_ALLOWED_ROOTS` is set** — that's the master switch for every write path (launch, resume-chat steering of fresh spawns, always-on loops).

| Var | Default | Meaning |
|-----|---------|---------|
| `FLEET_ALLOWED_ROOTS` | *(empty — disabled)* | Comma-separated directories agents may run in. Launch cwds must canonicalize under one of them. `~` expands. |
| `FLEET_ALLOWED_MODELS` | `claude-haiku-4-5-20251001, claude-sonnet-5, claude-opus-4-8, claude-fable-5` | Model whitelist for launches (the composer pill offers exactly these). |
| `FLEET_LAUNCH_MODEL` | `claude-haiku-4-5-20251001` | Default model when the composer pill isn't changed — deliberately the cheap one. |
| `FLEET_MAX_TURNS` | `40` | Hard per-launch turn ceiling. |
| `FLEET_MAX_CONCURRENT` | `3` | Global cap on concurrently launched processes. |
| `FLEET_IDLE_KILL_MIN` | `20` | A launched session silent for this many minutes is reaped (any output resets the clock). |

Related state files (created automatically, owner-only permissions): `~/.claude-fleet/launched-<port>.json` (pid tracking for crash-safe orphan reaping), `uploads-<port>/` (composer attachments), `hidden-sessions-<port>.json` (board hide list).

## Always-on loop jobs

Requires `FLEET_ALLOWED_ROOTS`. A supervisor relaunches a fresh headless agent each cycle; these are the brakes:

| Var | Default | Meaning |
|-----|---------|---------|
| `FLEET_LOOP_MIN_INTERVAL` | `60` | Hard floor in seconds between cycle starts. |
| `FLEET_LOOP_MAX_FAILS` | `3` | Consecutive failed cycles → job auto-pauses (circuit breaker). |
| `FLEET_LOOP_MAX_CYCLES` | `200` | Goal-mode safety cap: pause even if the goal sentinel never appears. |
| `FLEET_LOOP_BASE_HOSTS` | `127.0.0.1,localhost` | Hosts the QA-website template may target — loopback-only by default so an unattended agent can't be pointed at external services. |

Job state persists in `~/.claude-fleet/loop-jobs-<port>.json`; on boot, previously `running` jobs are reconciled to `interrupted` — a restart never silently re-executes a stored task.

## Skills catalog

| Var | Default | Meaning |
|-----|---------|---------|
| `FLEET_SKILLS_ROOT` | `~/.claude` | Catalog root override. When set, it always wins. Scans `<root>/skills/*` and `<root>/agents/*`, read-only. |
| `FLEET_CF_PLUGIN_DIR` | `<repo>/cf-plugin` | Where to look for an optional local plugin-shaped skill bundle (not shipped with this repo). Active only if `<dir>/.claude-plugin/plugin.json` exists. |
| `FLEET_CF_PLUGIN` | *(unset)* | Set `0` or `false` to ignore the local bundle even if present. |

Resolution order: explicit `FLEET_SKILLS_ROOT` → live `cf-plugin` bundle → `~/.claude`.

## Example configurations

Read-only observer with a 7-day board window:

```bash
FLEET_ACTIVE_MINUTES=10080 npm start
```

Full setup — launching enabled for two workspaces, Sonnet as the default model:

```bash
FLEET_ALLOWED_ROOTS="$HOME/work/api,$HOME/work/web" \
FLEET_LAUNCH_MODEL=claude-sonnet-5 \
FLEET_MAX_CONCURRENT=5 \
npm start
```

Second instance on another port, watching a copied transcript archive:

```bash
FLEET_PORT=4700 FLEET_PROJECTS_ROOT=~/transcript-archive npm start
```

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
| `FLEET_ALLOWED_MODELS` | `claude-opus-4-8, claude-sonnet-5, claude-haiku-4-5-20251001, claude-fable-5` | Model whitelist for launches (the composer pill offers exactly these). |
| `FLEET_LAUNCH_MODEL` | `claude-opus-4-8` | Default model when the composer pill isn't changed — the most capable one. Set a cheaper id (e.g. `claude-haiku-4-5-20251001`) to trade capability for cost. |
| `FLEET_MAX_TURNS` | `40` | Hard per-launch turn ceiling. |
| `FLEET_MAX_CONCURRENT` | `3` | Global cap on concurrently launched processes. |
| `FLEET_IDLE_KILL_MIN` | `20` | A launched session silent for this many minutes is reaped (any output resets the clock). |

Related state files (created automatically, owner-only permissions): `~/.claude-fleet/launched-<port>.json` (pid tracking for crash-safe orphan reaping), `uploads-<port>/` (composer attachments), `hidden-sessions-<port>.json` (board hide list).

## Remote permission approval

Opt-in via `npm run install-hook` (see the README section); `npm run uninstall-hook` reverts. Environment knobs read by the hook script (not the server):

| Var | Default | Meaning |
|-----|---------|---------|
| `FLEET_REMOTE_APPROVE` | *(unset — hook inert)* | **Opt-in marker.** Set to exactly `on` in a session's environment to route its permission prompts to the dashboard (`FLEET_REMOTE_APPROVE=on claude`). Supervised dashboard launches inject it automatically. Any other value (or absence) leaves the session untouched. |
| `FLEET_URL` | `http://127.0.0.1:4600` | Where the hook reaches the dashboard. Set it if you changed `FLEET_PORT` (supervised launches get the right port injected automatically). |
| `FLEET_CLAUDE_SETTINGS` | `~/.claude/settings.json` | Settings file the installer edits and the hook-status endpoint reads — override for testing only. |

### Auto opt-in for terminal sessions

Typing `FLEET_REMOTE_APPROVE=on` before every `claude` gets old. Enable it once for **every new terminal session**:

```bash
npm run enable-terminal-approve    # backs up + adds a marked block to your shell profile
npm run disable-terminal-approve   # removes only that block
```

It writes an `export FLEET_REMOTE_APPROVE=on` block (clearly marked, idempotent, with a timestamped backup) into your shell profile — `~/.zshrc`, `~/.bashrc`, or `~/.profile` depending on `$SHELL`, overridable with `FLEET_SHELL_PROFILE`. Open a new terminal (or `source` the profile) and every `claude` you start there is dashboard-approvable.

**Scope is deliberately terminal-only.** GUI/Dock launches of the desktop app don't read the shell profile, so they never inherit the marker and can't be frozen waiting on the dashboard. Note two limits: it only affects sessions started *after* you enable it (a session's environment is fixed at launch, so an already-running one can't be upgraded — restart it), and while a session is opted in its prompts are answered on the **dashboard** (the native terminal prompt is suppressed for the duration of the wait).

| Var | Default | Meaning |
|-----|---------|---------|
| `FLEET_SHELL_PROFILE` | *(auto by `$SHELL`)* | Force the profile file `enable-terminal-approve` edits (e.g. a non-standard rc file). |

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

# Getting Started

## Prerequisites

- **Node.js ≥ 20**
- **[Claude Code](https://claude.com/claude-code)** installed and used at least once. The dashboard visualizes the transcripts Claude Code writes to `~/.claude/projects/` — if that directory is empty, the board will be too.

A Claude subscription (Pro/Max) is the intended setup: the dashboard itself never calls the Anthropic API and costs nothing to run. Sessions you launch from it run through your normal Claude Code install and count against whatever plan that uses.

## Install & run

```bash
git clone <this-repo>
cd claude-fleet-dashboard
npm install
npm run build      # tsc → dist/server, Vite → dist/client
npm start          # http://127.0.0.1:4600
```

Open `http://127.0.0.1:4600`. You should see:

- **Overview** (`#/`) — progress rollup and task tree (populated from `plans/` folders in your projects, if you use that convention; empty otherwise).
- **Board** (`#/board`) — one card per Claude Code session, updating live. Start a session in any terminal and watch it appear.

If the board is empty, see [Troubleshooting](#troubleshooting).

For development with hot reload:

```bash
npm run dev        # Vite HMR on 5173 + tsc --watch + node --watch
```

## Enabling launch (optional)

Out of the box the dashboard is **read-only** — it can't start, steer, or resume anything. To launch sessions from the browser, opt in:

```bash
FLEET_ALLOWED_ROOTS="$HOME/projects/my-app,$HOME/sandbox" npm start
```

Why this is gated: a launched session is a **headless Claude Code process with permissions auto-approved**, running in the folder you choose. It can edit files and run commands there without asking. So:

- Only list directories you'd comfortably run `claude --dangerously-skip-permissions` in yourself.
- The allowlist is the boundary for *fresh* launches. Resuming an existing session trusts the transcript's own recorded working directory instead.
- Every mutation additionally requires the per-run anti-CSRF token that only the same-origin SPA holds, and the server never listens beyond `127.0.0.1`.

With launch enabled you get:

- **＋ Launch** — the composer: task text (`/` opens the skill menu), model pill, file attachments, multiple working folders (first = cwd, rest become `--add-dir`).
- **Steering** — launched sessions land on a live session view with a chat box: answer `AskUserQuestion`s, send follow-ups, Finish (clean exit) or Stop.
- **Resume-chat on any card** — message an idle/finished session and it resumes in place (`claude --resume`, same transcript). A transcript that was active in the last ~2 minutes refuses to resume, because another process (your terminal, the desktop app) probably owns it.
- **Always-on loops** (`#/always-on`) — supervised recurring jobs. Cycles respect a ≥60 s interval floor and a consecutive-failure circuit breaker.

Caps that apply to everything launched: model whitelist (`FLEET_ALLOWED_MODELS`), turn ceiling (`FLEET_MAX_TURNS`, default 40), concurrency (`FLEET_MAX_CONCURRENT`, default 3), idle reaper (`FLEET_IDLE_KILL_MIN`, default 20 min).

## Skills catalog

The Skills view (`#/skills`) and the composer's `/` menu scan, in order of preference:

1. `FLEET_SKILLS_ROOT`, if you set it explicitly;
2. a local plugin-shaped bundle at `cf-plugin/` in the repo root, if present (`cf-plugin/.claude-plugin/plugin.json` marks it live) — **this repo ships without one**;
3. otherwise `~/.claude/skills/` and `~/.claude/agents/` — your existing Claude Code skills, with no setup.

The scan is read-only. If you maintain your own skill bundle, drop it at `cf-plugin/` (or point `FLEET_CF_PLUGIN_DIR` at it) and it takes over as the catalog root; set `FLEET_CF_PLUGIN=0` to ignore it.

## Notifications

The 🔔 toggle in the header enables a soft chime when a session finishes and an insistent rising chime plus desktop notification (with the question text) when one **needs your answer**. Sound works even when OS notifications are denied — the browser tab must stay open, but not focused.

## Troubleshooting

**Empty board.** Claude Code has never run on this machine, or transcripts live elsewhere. Check `ls ~/.claude/projects` — if you relocated it, set `FLEET_PROJECTS_ROOT`.

**Port already in use.** Something (often another instance of this dashboard) owns 4600: `FLEET_PORT=4601 npm start`. Note that per-port state files (`~/.claude-fleet/*-<port>.json`) keep instances independent.

**Sessions look stuck on "working".** A session with no events for `FLEET_IDLE_MINUTES` (default 5) flips to idle — a long-running silent tool call can look "working" until then. The timeline view shows the truth.

**Launch button rejects my folder.** The cwd must canonicalize (symlinks resolved) to somewhere under an entry of `FLEET_ALLOWED_ROOTS`.

**"a loop or launch is already active in this directory".** One live launched process per directory — Finish/Stop the running one first, or use another folder.

**No sound/notification.** Click the 🔔 once (browsers require a user gesture before audio), and check the site's notification permission if you want desktop alerts too.

# How It Works

A tour of the architecture for the curious and for contributors. Source layout: TypeScript Node backend in `server/src/`, Svelte 5 SPA in `client/src/`, shared types in `shared/`.

## Pipeline

```
~/.claude/projects/**/*.jsonl          (written by Claude Code, not by us)
        │  chokidar watcher
        ▼
transcript tailer — byte-offset reads, only new bytes ever parsed
        ▼
defensive JSONL parser — unknown/corrupt lines become raw entries, never crashes
        ▼
session-state reducer — status, current action, files touched, subagents,
                        pending questions, token metrics
        ▼
SSE stream (/api/events) ──► Svelte SPA (fleet store → views)
```

- **Watching** (`server/src/watchers/`) — chokidar on the projects root plus per-project `plans/` and wiki watchers. A transcript change triggers a tail from the last byte offset, so cost stays proportional to new output, not transcript size.
- **Parsing** (`server/src/readers/jsonl-defensive-parser.ts`) — the transcript schema is Claude Code's internal format and can change any release. Every line is parsed defensively; anything unrecognized is preserved as a raw entry and rendered as-is instead of taking the server down.
- **Reducing** (`server/src/domain/session-state-reducer.ts`) — folds events into per-session state: working/idle/waiting classification, the current tool action, a 30-minute token-burn window, subagent workers (from `<session>/subagents/agent-*.jsonl`), and any pending `AskUserQuestion`/plan-approval with its options — which is how answer chips appear on cards.
- **Serving** (`server/src/http/server.ts`) — a plain `node:http` server (no framework): JSON APIs, an SSE event stream, and static files for the built SPA, all on one localhost origin.
- **Frontend** (`client/src/`) — Svelte 5 + Vite. One fleet store subscribes to SSE and every view (Overview, Board, session timeline, Terminal, Agents, Files, Always-on, Skills) derives from it. Timeline and terminal fetch on demand via the timeline API.

The Overview's plan/phase/task rollup comes from reading `plans/*/plan.md` and `phase-*.md` files in each project's working directory (frontmatter + `- [x]` checkbox counting) and joining live tasks onto matching phases.

## Safety guarantees (read path)

- **Never writes under `~/.claude/`.** All transcript access is read-only tailing; nothing is locked, renamed, moved, or deleted. Covered by tests (`test/server/`).
- Sessions "hidden" from the board go into `~/.claude-fleet/hidden-sessions-<port>.json` — display-only state, transcripts untouched.
- The file viewer (Files view) serves only paths already present in the touched-file registry; arbitrary path requests are rejected.

## Safety model (write path)

Everything that can spawn a process is opt-in and layered:

1. **Master switch** — `FLEET_ALLOWED_ROOTS` empty (default) disables launching entirely. When set, a launch cwd must canonicalize (symlinks resolved) under an allowed root.
2. **Network posture** — the server binds `127.0.0.1` only. Every response carries `frame-ancestors 'none'` (anti-clickjacking) and a restrictive CSP; mutations require `POST` + `application/json` + a per-run random token (`X-Fleet-Token`) held only by the same-origin SPA — a hostile web page in your browser can neither frame nor forge a launch (`server/src/http/mutation-guard.ts`).
3. **Process caps** — model whitelist, per-launch turn ceiling, global concurrency cap, and an idle reaper for silent processes. Launched pids persist in an owner-only file so a crashed server reaps its orphans on next boot instead of leaking agents.
4. **Resume freshness gate** — chatting with a non-launched session resumes it via `claude --resume <id>`, but only if its transcript has been quiet for ~2 minutes. An actively-written transcript likely belongs to your terminal or the desktop app, and two writers on one session would corrupt it.
5. **Loop brakes** — always-on jobs add an interval floor (≥60 s), a consecutive-failure circuit breaker, a goal-mode cycle cap, and loopback-only QA targets by default. Boot reconciliation marks previously-running jobs `interrupted` rather than re-executing stored tasks.

The honest caveat, stated in the UI too: launched agents run with permissions auto-approved inside your chosen roots. The allowlist is the security boundary — pick it like one.

## Remote permission approval (opt-in hook)

`npm run install-hook` merges a `PreToolUse` entry (matcher `Bash|Edit|Write|MultiEdit|NotebookEdit`) into `~/.claude/settings.json`, pointing at `hooks/fleet-permission-approval-hook.cjs` — a standalone, zero-dependency script. It is **opt-in per session**: inert unless the session env carries `FLEET_REMOTE_APPROVE=on` (supervised launches inject it; terminals opt in with an env prefix). Lesson from the field: the desktop app's "auto" mode is `acceptEdits`, not `bypassPermissions` — a mode-based blocklist froze auto sessions, so activation is an explicit allowlist marker instead.

```
Claude Code session (supervised launch, or FLEET_REMOTE_APPROVE=on terminal)
  └─ PreToolUse hook
       ├─ env FLEET_REMOTE_APPROVE ≠ 'on' or bypassPermissions → exit 0 (inert)
       ├─ POST /api/permissions/request  (300ms-ish fail-open if server absent)
       └─ long-poll GET /api/permissions/:id/decision  (204 → re-poll forever)
Fleet server (server/src/domain/permission-request-broker.ts)
  ├─ folds the request into the card as pendingQuestion kind:'permission'
  │    → SSE → Allow/Deny chips on board/strip/timeline + chime/notification
  ├─ POST /api/permissions/:id/answer (token-guarded) resolves the poll
  ├─ transcript tool_result ('tool-result' reducer event) cancels a request
  │    the terminal answered after a fail-open
  └─ heartbeat sweep cancels requests whose hook process died (Ctrl+C)
```

Safety properties, each pinned by `test/server/remote-permission-approval-flow.test.js` and the phase-1 spike: fail-open when the server is down; auto sessions never intercepted; only the token-guarded answer click authorizes execution; installer backs up `settings.json` and `npm run uninstall-hook` restores. Supervised launches (`--permission-mode default` instead of bypass) reuse this exact path, and the idle reaper holds off while a request is pending.

**Making opt-in less tedious.** `npm run enable-terminal-approve` (`scripts/enable-terminal-remote-approve.cjs`) writes a marked `export FLEET_REMOTE_APPROVE=on` block into the shell profile so every new terminal `claude` opts in without the prefix — terminal-only on purpose, since GUI/Dock desktop launches don't source the profile and so stay safe from the freeze. It can't upgrade an already-running session (the env is fixed at process start), so for external sessions that aren't opted in, the session timeline renders a one-line hint explaining how to opt in (`FLEET_REMOTE_APPROVE=on claude --resume <id>`) rather than silently showing no buttons.

## Data model sketch

A session card is derived state: `sessionId`, project slug (from the transcript path), title (first user prompt), `status` (`working` | `waiting-for-you` | `idle`), current action (latest tool call summary), files touched, token counters and burn rate, subagent rows (`label`, `status`, current action), and the pending question (text + options) when one is open. Timeline entries map 1:1 to transcript events, with Edit/Write payloads rendered as diffs and Bash outputs ANSI-parsed into terminal blocks (progress-bar `\r` churn collapsed).

## Testing

```bash
npm test   # typecheck (server+client configs) → build server → node:test → vitest
```

Backend units (`test/server/`, `node:test`) pin the parser, reducer, summarizer, mutation guard, and launch/loop registries — including the "never writes under ~/.claude" invariant. Client tests run under vitest + Testing Library (`client/`).

# System Architecture

Runtime architecture for the claude-fleet-dashboard: a local read-only web fleet view for Claude Code sessions.

## High-Level Data Flow

```
Disk                      Backend (Node)                  Browser (SPA)
───────────────────────────────────────────────────────────────────────────

~/.claude/projects/       TranscriptWatcher (chokidar)
  {project}/*.jsonl   ───→ → emits: session-event, workflow-event
                          → emits: session-stale, agent-stale
                       
                       SessionStateReducer (fold)
                       ├─ ingest(projectSlug, sessionId, entry)
                       ├─ build SessionCard snapshot
                       └─ emit: session-updated, session-removed
                       
                       WorkflowRegistry (fold)
                       ├─ ingest workflow events
                       └─ emit: workflow-updated, workflow-removed
                       
                       SseServer (HTTP + SSE broadcaster)
                       ├─ SSE: /events (live stream 8 event types)
                       ├─ API: /api/sessions, /api/overview, etc.
                       └─ Static: dist/client/index.html (SPA)
                       
                                                        Browser (fleet-store)
                                                        ├─ SSE listener
                                                        ├─ $state snapshots
                                                        ├─ $derived views
                                                        └─ UI (App.svelte)
```

### Event Lifecycle

1. **Disk:** new tool call written to `~/.claude/projects/{project}/session-{sessionId}.jsonl`
2. **Watcher:** detects file change, reads line, emits `session-event`
3. **Reducer:** ingests event, updates session state, emits `session-updated` (SessionCard snapshot)
4. **SSE:** broadcasts `session-updated` event to all connected clients
5. **Browser:** fleet-store receives event, updates `$state` snapshot, views re-render

## Backend Architecture

### Single-Package Entry Point (`server/src/main.ts`)

Boot sequence:

```typescript
1. Reap orphaned launched children (from prior crash)
2. Create TranscriptWatcher (watch ~/.claude/projects/)
3. Create SessionStateReducer (fold events into SessionCard snapshots)
4. Create WorkflowRegistry (fold workflow events)
5. Wire watcher events → reducer → SSE broadcasts
6. Wire wiki/plan watchers (for `/api/overview`)
7. Create SseServer (HTTP + SSE on port FLEET_PORT)
8. Listen for SIGINT/SIGTERM → graceful shutdown
```

**No async/await at module level.** All wiring happens synchronously at boot.

### HTTP Server (`server/src/http/server.ts`)

Single-file SseServer class (561 LOC, monolithic port from `src/sse-server.js` for 100% parity). Routes are hardcoded inline; 7-way split to `routes/*` deferred post-parity.

#### Security Guard (Applies to All Methods)

**Host/DNS-rebinding guard — executed BEFORE routing:**

```typescript
// Step 1: Extract Host header
const hostHeader = req.headers.host;

// Step 2: Validate Host matches expected origin
const { ok: hostOk, error: hostError } = validateHost(hostHeader, config.host, config.port);
if (!hostOk) {
  res.writeHead(403, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: hostError }));
  return;
}

// Step 3: Route to handler
// (routing only reached if Host is valid)
```

Guard blocks:
- Any Host header not matching `127.0.0.1:4600` (or per-config host:port)
- Prevents DNS-rebinding attacks (a malicious site redirecting to `localhost` or an IP-based rebind)

#### Request Routing

**GET routes (read-only, no guard):**

| Route | Purpose |
|-------|---------|
| `GET /` | Index (SPA root) → `dist/client/index.html` |
| `GET /api/sessions` | List all SessionCard snapshots (active + idle) |
| `GET /api/overview` | Fleet-wide metrics (rollup + task tree) |
| `GET /api/skills` | Skill catalog (read-only scan of `~/.claude/skills/`) |
| `GET /api/workflow-detail/:sessionId/:workflowId` | Single workflow run details |
| `GET /api/timeline/:sessionId` | Session transcript (newest-first) |
| `GET /api/timeline/:sessionId/:agentId` | Subagent timeline |
| `GET /api/file/:path` | Read file from touched registry |
| `GET /events` | SSE stream (keep-alive with 30s heartbeat) |
| `GET /public/*` | Static assets (SPA bundle) |

**POST routes (mutations, guarded):**

| Route | Guard | Purpose |
|-------|-------|---------|
| `POST /api/spawn` | mutation guard | Spawn Claude Code process |
| `POST /api/uploads` | mutation guard | Save chat-composer attachments (JSON base64 → `~/.claude-fleet/uploads-<port>/<uuid>/`, ≤8 files, ≤8MB each; returns absolute paths the client folds into the launch task text) |
| `POST /api/sessions/:id/steer` | mutation guard | Answer a pending question / send a follow-up / finish a steerable launched session (writes a user message into the child's still-open stdin) |
| `POST /api/kill/:sessionId` | mutation guard | Kill launched process |
| `POST /api/workflow-launch` | mutation guard | Launch workflow |
| `POST /api/loop/job/pause/:jobId` | mutation guard | Pause always-on job |
| `POST /api/loop/job/resume/:jobId` | mutation guard | Resume always-on job |
| `POST /api/loop/settings` | mutation guard | Save launch allowed-roots |

#### Mutation Guard (`server/src/http/mutation-guard.ts`)

Per-request validation for every POST. **Order matters** (cheapest checks first, expensive last):

```typescript
export function requireMutation(req, token, { host, port }): MutationResult {
  1. if (req.method !== 'POST') return deny(405);
  2. if (!isJson(req.headers['content-type'])) return deny(415);
  3. if (origin && !isSameOrigin(origin, host, port)) return deny(403);
  4. if (!constantTimeEq(req.headers['x-fleet-token'], token)) return deny(403);
  return { ok: true };
}
```

**Constant-time token comparison:** prevents timing attacks on token guess.

**X-Fleet-Token:** per-run random hex string (24 bytes), rotated on every server restart, never persisted.

#### Response Headers (All Responses)

```typescript
const SECURITY_HEADERS = {
  'X-Frame-Options': 'DENY',
  // Defeats clickjacking: a framed attacker page cannot POST with a valid token
  
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self' 'unsafe-inline'; "
    "frame-ancestors 'none'; connect-src 'self'; "
    "img-src 'self' data:; style-src 'self' 'unsafe-inline'",
  // Explains:
  // - 'unsafe-inline' needed for SPA <script> in index.html (no nonce yet)
  // - connect-src 'self' blocks XSS from exfiltrating token to attacker origin
  // - frame-ancestors 'none' blocks clickjacking
  // - img-src data: allows base64 icons/UI graphics
};
```

### Domain Layer (`server/src/domain/**`)

**SessionStateReducer** (`session-state-reducer.ts` — 493 LOC)
- Ingests raw transcript events (tool calls, responses, errors)
- Builds `SessionCard` snapshot per session (mutable state)
- Emits `session-updated` SSE event for every state change
- Detects stale sessions (no events for N minutes) → emits `session-removed`
- Tracks token burn (output tokens/30min window), idle time, last activity

**TaskRegistry** (`task-registry.ts` — 319 LOC)
- Scans `plans/*/phase-*.md` files for phase progress (checkbox counts)
- Reads `plans/*/plan.md` metadata (title, status)
- Correlates tasks (from task list) with plan phases
- Feeds `GET /api/overview` (progress rollup + task tree)

**SessionMetrics** (`session-metrics.ts`)
- Aggregates file touches (agent → file → session mapping)
- Powers `#/files` heatmap (recency, edit count, responsible agents)

**ToolCallSummarizer** (`tool-call-summarizer.ts`)
- Summarizes long tool outputs for the board card (truncates, highlights)
- Powers the "current action" label on SessionCard

**PermissionRequestBroker** (`permission-request-broker.ts`)
- In-memory bridge between a blocked PreToolUse hook (in any Claude Code session) and the dashboard's Allow/Deny click
- `POST /api/permissions/request` registers (idempotent per session+toolUse); hook long-polls `GET /:id/decision` (204 → re-poll, unbounded wait); token-guarded `POST /:id/answer` resolves
- Emits `permission-pending`/`permission-resolved` → reducer folds them as `pendingQuestion kind:'permission'` (card flips to waiting-for-you) and the launched registry holds/releases idle-kill
- Zombie GC: reducer `tool-result` events cancel terminal-answered requests; heartbeat `sweepOrphans()` cancels requests whose hook process died
- In-session half: `hooks/fleet-permission-approval-hook.cjs` (standalone, fail-open); installer `scripts/install-fleet-permission-hook.cjs` (`npm run install-hook` / `uninstall-hook`)

### Readers (`server/src/readers/**`)

**Read-only, defensive parsing.** Never crashes on corrupt input.

- **timeline-reader.ts:** parse session JSONL, rebuild event stream
- **touched-file-reader.ts:** track file writes (path → sessions → agent)
- **wiki-reader.ts:** scan `docs/wiki/` for shipped work cards
- **plan-reader.ts:** scan `plans/*/` for plan/phase metadata
- **fleet-overview-aggregator.ts:** combine metrics for `/api/overview`
- **skill-catalog-reader.ts:** scan `~/.claude/skills/` and `~/.claude/agents/` (read-only, real-time)

### Watchers (`server/src/watchers/**`)

**Long-lived chokidar instances.** Watch disk for changes, emit events.

- **transcript-watcher.ts:** watch `~/.claude/projects/` (JSONL + metadata files)
- **wiki-watcher.ts:** watch `docs/wiki/` (shipped work changes)
- **plan-watcher.ts:** watch `plans/*/` (phase progress, task metadata)

**Trait:** immediately re-read file on change (not cached).

### Launch Subsystem (`server/src/launch/**`)

**LaunchedRegistry** — tracks Claude processes spawned from the dashboard.

- Stores per-spawn metadata (sessionId, project, cwd, model, turn cap, etc.)
- Reads/writes `~/.claude/state/launched.pid` (locked file, one PID per line)
- Exports `reapOrphans()` — kill orphaned children on boot (crash recovery)

**LaunchSettings** — persists `allowedRoots` to `~/.claude/state/launch-settings.json`.

**LaunchClaude** — spawn process with:
- Environment isolation (inherit parent env + set CLAUDE_CODE_* vars)
- Working-directory realpath + prefix validation (no `../` escapes)
- Model whitelist + turn cap
- Anti-duplicate spawn (same cwd/model, same session reuses existing)

### Loop Subsystem (`server/src/loop/**`)

**LoopSupervisor** (352 LOC) — manages always-on jobs (24/7 agent loops).

- Reads persisted loop jobs from `~/.claude/state/loop-jobs.json`
- On boot: reconciles orphaned jobs to `interrupted` (never re-executes persisted loops)
- Spawns job cycles on a timer (≥ `FLEET_LOOP_MIN_INTERVAL` seconds apart)
- Circuit breaker: auto-pauses after N consecutive failures
- Job store: ACID writes (atomic swap of `loop-jobs.json`)

**Cycle types:**
- **Job mode:** runs forever until manually stopped
- **Goal mode:** stops when agent writes a completion sentinel (with turn cap as safety)

**Job payload:** task name, launch model, base URL (QA template), mode, schedule.

### Workflows (`server/src/workflows/**`)

**WorkflowRegistry** — tracks multi-agent orchestrations (from task → `/ck:workflow-launch`).

- Folds `workflow-event` and `workflow-removed` SSE events
- Provides read-only `GET /api/workflow-detail/:sessionId/:workflowId`
- Emits `workflow-updated` / `workflow-removed` for SSE broadcast

## Frontend Architecture

### App Shell (`client/src/App.svelte`)

Single-page app with hash routing:

```svelte
<Routes>
  <Command />      {/* #/ — landing / command palette */}
  <Board />        {/* #/board — kanban */}
  <Overview />     {/* #/overview — progress rollup */}
  <Agents />       {/* #/agents — all workers */}
  <AlwaysOn />     {/* #/always-on — job loops */}
  <Skills />       {/* #/skills — catalog */}
  <Workflows />    {/* #/workflows — orchestrations */}
  {/* + session detail routes */}
</Routes>
```

### Fleet Store (`client/src/lib/stores/fleet-store.ts`)

Central runes store fed by SSE `/events` stream.

**State tree:**

```typescript
$state export const fleet = {
  // Snapshots (wholesale replaced on SSE event)
  sessions: Map<sessionId, SessionCard>,
  workflows: Map<sessionId:workflowId, WorkflowRun>,
  
  // Metadata
  tasks: FleetTaskRecord[],
  wiki: ShippedCard[],
  skills: SkillCatalog,
  
  // Alerts
  alerts: { message, severity, dismissible },
  
  // UI state
  selectedSessionId: string | null,
  commandOpen: boolean,
};

$derived export const idle = fleet.sessions.values()
  .filter(card => card.status === 'idle');

$derived export const needsYou = fleet.sessions.values()
  .filter(card => card.waitingForAnswer);
```

**SSE event handlers:**

| Event | Action |
|-------|--------|
| `session-updated` | Replace session in Map, update metrics |
| `session-removed` | Delete session, emit alert if removed |
| `overview` | Rebuild tasks + progress |
| `shipped` | Reload wiki |
| `workflow-updated` | Insert/update workflow in Map |
| `workflow-removed` | Delete workflow, emit alert |
| `skills` | Reload catalog (real-time) |
| `heartbeat` | Keep-alive (no action) |

### Views

**Board** (`#/board`) — 3-column kanban (Waiting, Working, Idle).

- SessionCard per session
- Mini-rows for subagents
- Question inline on card if `waitingForAnswer`
- Pulse animation + sound on state change

**Overview** (`#/`) — progress rollup + task tree + velocity + activity stream.

- Task tree: Plans → Phases → Tasks (collapsible)
- Progress bars (tasks done / total)
- Velocity charts (plans shipped/week, tasks done/hour)
- Activity stream (newest transitions)

**Timeline** — newest event at top.

- Tool call with inline input
- File Edit/Write as diffs
- Bash output as colored terminal
- Expandable rows

**Terminal** — all bash commands + output (lead + subagents), newest first.

**Agents** — all workers across fleet (session → workers, type, status, action).

**Skills** — read-only skill catalog with detail drawer.

**Always-on** — job loops + cycle history + pause/resume controls.

## Configuration (`server/src/config.ts`)

Typed, frozen config (read once at boot from environment).

| Env Var | Default | Meaning |
|---------|---------|---------|
| `FLEET_PORT` | `4600` | HTTP listen port (localhost only) |
| `FLEET_ACTIVE_MINUTES` | `0` | Hide sessions inactive >N min (0 = never hide) |
| `FLEET_IDLE_MINUTES` | `5` | Mark session idle after N min with no events |
| `FLEET_PROJECTS_ROOT` | `~/.claude/projects` | Transcript root |
| `FLEET_PUBLIC_DIR` | `dist/client` | SPA root (fallback to legacy public/) |
| `FLEET_SKILLS_ROOT` | (auto) | Override root for skill scan; default = `cf-plugin/` once seeded, else `~/.claude` |
| `FLEET_CF_PLUGIN` | (on) | `0`/`false` disables `--plugin-dir` injection into launches (kill-switch) |
| `FLEET_CF_PLUGIN_DIR` | `<repo>/cf-plugin` | Location of the /cf skill bundle |
| `FLEET_CF_UPSTREAM` | `claudekit/claudekit-engineer` | GitHub repo the bundle syncs from (gh-authenticated) |
| `FLEET_ALLOWED_ROOTS` | (empty) | Comma-separated dirs agents may run in (enable spawn) |
| `FLEET_ALLOWED_MODELS` | (all) | Comma-separated model IDs (whitelist for spawn) |
| `FLEET_LAUNCH_MODEL` | `claude-opus-4-1` | Default model for spawned processes |
| `FLEET_MAX_TURNS` | `100` | Turn cap for spawned processes |
| `FLEET_MAX_CONCURRENT` | `8` | Max concurrent spawned processes |
| `FLEET_IDLE_KILL_MIN` | `30` | Kill spawned process if idle >N min |
| `FLEET_LOOP_MIN_INTERVAL` | `60` | Hard floor (sec) between job cycles |
| `FLEET_LOOP_MAX_FAILS` | `3` | Consecutive failures → auto-pause |
| `FLEET_LOOP_MAX_CYCLES_GOAL` | `200` | Cap cycles in goal mode (safety) |
| `FLEET_LOOP_BASE_HOSTS` | `127.0.0.1,localhost` | Allowed hosts for QA baseUrl |

All env vars are optional (sensible defaults for localhost use).

## Skills Subsystem (/cf bundle)

The dashboard owns a plugin-shaped skill bundle at `cf-plugin/` (committed in-repo),
seeded from the private ClaudeKit upstream and rebranded `/ck:` → `/cf:`.

- **Read side** (`server/src/readers/skill-catalog-reader.ts`): unchanged read-only
  contract; cf-mode brands the kit from `.claude-plugin/plugin.json` + `cf-manifest.json`
  and tags skills with provenance. Legacy `~/.claude` scans still work via
  `FLEET_SKILLS_ROOT`.
- **Write side** (`server/src/skills/`): `skill-name-transform` (ck→cf renames +
  boundary-guarded md rewrites, fenced blocks untouched), `skill-bundle-writer`
  (filtered copy, size caps, sha256 drift hashes, cf-manifest.json), `upstream-sync`
  (gh tarball pinned to release tag+commit, unique staging + atomic swap with
  rollback, operator-installed skills preserved), `skill-install-service`
  (two-step preview/confirm from local path or GitHub).
- **API**: `GET /api/skills/upstream-check` (60s cache); POST `sync-upstream`
  (serialized, 409 while running), `install/preview`, `install/confirm`, `remove` —
  all behind the fleet-token mutation guard because installed skills later run in
  bypassPermissions sessions.
- **Launch integration**: `launchClaude` appends `--plugin-dir <cf-plugin>` for
  spawns and loop cycles while `cfPluginActive()` (bundle exists + `FLEET_CF_PLUGIN`
  not `0`); argv is byte-identical when inactive.

## Serve Models

### Production (`npm start`)

```
1. npm run build (vite + tsc compile to dist/)
2. node dist/server/main.js
   ├─ Load config from env
   ├─ Start watchers
   ├─ Start HTTP server on 127.0.0.1:4600
   └─ Serve dist/client/ (SPA + static assets)
3. Browser opens http://127.0.0.1:4600
   ├─ GET / → dist/client/index.html
   ├─ GET /app.{hash}.js, /style.{hash}.css (Vite output)
   └─ SSE /events (live stream)
```

**Single origin.** All requests (API + SPA) served from same `localhost:4600`.

### Development (`npm run dev`)

```
1. concurrently:
   a) vite --host 127.0.0.1 (HMR on port 5173)
   b) tsc -w → dist/server/main.js
   c) node --watch dist/server/main.js

2. Browser opens http://127.0.0.1:5173
   ├─ GET / → index.html from Vite
   ├─ /api/* → proxy to http://127.0.0.1:4600
   │           (with changeOrigin:true + Origin rewrite)
   ├─ /events → proxy to SSE stream
   └─ HMR websocket (component updates)

3. Backend (separate terminal) logs to stdout
   (easy to tail or attach debugger)
```

**Proxy rewrites:**
- Host: remains Vite port (browser knows)
- Origin: rewritten to backend origin (required by mutation guard)

## Security Invariants Catalog

### Core Principles

**Principle 1:** No auth (localhost only). All security is anti-malicious-web-page.

**Principle 2:** Every POST is gated. GET is read-only; POST requires valid token.

**Principle 3:** Mutations are narrowly scoped. No bulk deletes, no config changes, only spawn/kill/loop-control.

### Invariant List

| # | Domain | Invariant | Enforcement |
|---|--------|-----------|------------|
| S1 | Bind | Server binds to `127.0.0.1:4600` only (localhost) | `config.host` hardcoded, no env override |
| S2 | Auth | No auth system (assume local trust) | N/A |
| S3 | CSRF | Per-run anti-CSRF token (`X-Fleet-Token`) | `randomBytes(24)` at boot, never persisted |
| S4 | Token Pass | Token echoed from SPA to server (custom header) | Vite dev injects token into HTML; prod embeds in index.html |
| S5 | Mutation Ordering | Mutation guard applies to ALL POSTs before routing | `http/server.ts` line ~250 (guard runs first) |
| S6 | Method Gate | Only POST methods allowed for mutations | `requireMutation` checks `req.method === 'POST'` |
| S7 | Content-Type | Only `application/json` accepted for mutations | `requireMutation` checks content-type |
| S8 | Origin Check | Origin header (if present) must match server | `isSameOrigin(origin, host, port)` |
| S9 | Host Guard | Host header validated before routing (DNS-rebinding) | `validateHost()` runs before route resolution |
| S10 | Token Timing | Token compared via constant-time function | `timingSafeEqual()` from `node:crypto` |
| S11 | CSP | Content-Security-Policy applied to all responses | `SECURITY_HEADERS` + `connect-src 'self'` |
| S12 | Clickjacking | X-Frame-Options: DENY (no framing) | Applied to all responses |
| S13 | Frame Ancestors | CSP `frame-ancestors 'none'` (defense in depth) | Applied to all responses |
| S14 | CWD Validation | Spawned process cwd must be realpath + within allowed prefix | `resolveAllowedCwd()` checks both |
| S15 | CWD Prefix | Escape prevention: reject any `../` in requested cwd | `path.relative()` used to detect escapes |
| S16 | Model Whitelist | Spawn uses model from whitelist or default | `isAllowedModel()` checks `FLEET_ALLOWED_MODELS` |
| S17 | Turn Cap | Spawned process limited to N turns (safety) | `--max-turns` passed to spawn command |
| S18 | Max Concurrent | Fleet limits concurrent spawned processes (resource) | `LaunchedRegistry` tracks + rejects if limit exceeded |
| S19 | File Gate | Touched files are allowlisted before serving | `readTouchedFile()` checks registry before read |
| S20 | File Size Cap | Reject files > 512 KB (read-only defense) | `touched-file-reader.ts` enforces cap |
| S21 | Binary Reject | Reject binary files (detect via magic bytes) | Early return if non-UTF8-ish |
| S22 | JSONL Defensive | Corrupt JSONL lines render as raw entries (never crash) | `timeline-reader.ts` wraps in try/catch + fallback |
| S23 | JSON Body Limit | Request body size capped at 1 MB | Enforced by Node server (default) |
| S24 | Permissions | Loop files owned by user (0o600) | `loop-supervisor.ts` sets mode after write |
| S25 | Orphan Reap | On boot, kill orphaned launched children (safety) | `reapOrphans()` runs before any spawn allowed |
| S26 | Loop Never Re-exec | Persisted loops are never re-executed on boot | Reconcile to `interrupted`, only user resume matters |
| S27 | Skills Read-only | `/api/skills` scan only reads dir structure, never executes | Hard constraint in `skill-catalog-reader.ts` |
| S28 | Skills Realpath | Skills scan confined to `FLEET_SKILLS_ROOT` by realpath | `path.join()` + `realpath()` + prefix check |
| S29 | Touched Registry | Only files in registry are servable via `/api/file` | Whitelist membership required |
| S30 | Touched Exact Match | Registry uses exact file path, not prefix | Exact comparison, not startsWith |
| S31 | Touched 512KB Cap | Touched files capped at 512 KB (aggregate? per-file?) | Per-file cap (see S20) |
| S32 | QA Base Hosts | QA job `baseUrl` restricted to allowlist (localhost by default) | `FLEET_LOOP_BASE_HOSTS` parsed, matched |

**Red-team enforced (2026-07-22):**
- C1: Host + Origin guarded before routing ✓
- H6: Host guard placement verified + integrated ✓
- H7: Launch guard ordering verified ✓
- M5: SPA fallback for hash router ✓ (Vite + Node both serve `index.html`)
- S-Bundle: CSP directives pinned ✓

## Performance & Limits

| Metric | Limit | Enforcement |
|--------|-------|------------|
| Max concurrent spawned processes | 8 (default) | `FLEET_MAX_CONCURRENT` env var |
| Max turns per spawn | 100 (default) | `FLEET_MAX_TURNS` env var |
| Idle kill timeout | 30 min (default) | `FLEET_IDLE_KILL_MIN` env var |
| File read size | 512 KB | `touched-file-reader.ts` |
| JSON body POST | 1 MB | Node default |
| SSE heartbeat | 30 sec | `SseServer` periodic broadcast |
| Loop min interval | 60 sec (default) | `FLEET_LOOP_MIN_INTERVAL` env var |
| Loop failure circuit | 3 consecutive failures | `FLEET_LOOP_MAX_FAILS` env var |

## Known Deferred Post-Parity Work

- `http/server.ts` 7-way route split (routes/auth, routes/timeline, routes/skills, etc.)
- Task registry phase-level edit tracking (currently checkpoint-based)
- Workflow cycle tracking (metadata only, no persistence yet)
- Frontend locale/i18n (hardcoded English)
- Subagent nested-worker depth limit (no max depth enforced, UI scalability concern)

See `plans/260722-2032-ts-svelte-rewrite/plan.md` Phase 04 for full post-parity roadmap.

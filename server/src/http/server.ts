import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { PendingQuestion, SessionCard, SseEvent, WorkflowRun } from '../../../shared/types/index.js';
import { PermissionRequestBroker } from '../domain/permission-request-broker.js';
import type { PendingPermission } from '../domain/permission-request-broker.js';
import { summarizeToolUse } from '../domain/tool-call-summarizer.js';
import { readTimeline } from '../readers/timeline-reader.js';
import { aggregateFileTouches } from '../domain/session-metrics.js';
import type { FileTouchSource } from '../domain/session-metrics.js';
import { readTouchedFile } from '../readers/touched-file-reader.js';
import type { TouchedFileSessionState } from '../readers/touched-file-reader.js';
import { readFleetWiki } from '../readers/wiki-reader.js';
import { readFleetPlans } from '../readers/plan-reader.js';
import { buildOverview } from '../readers/fleet-overview-aggregator.js';
import type { FleetTaskRecord } from '../readers/fleet-overview-aggregator.js';
import { scanSkillCatalog } from '../readers/skill-catalog-reader.js';
import { checkUpstream, syncUpstream } from '../skills/upstream-sync.js';
import { SkillInstallService } from '../skills/skill-install-service.js';
import { removeSkillFromBundle } from '../skills/skill-bundle-writer.js';
import { config, activeSkillsRoot, cfPluginActive } from '../config.js';
import { SECURITY_HEADERS, requireMutation, resolveAllowedCwd, isAllowedModel } from './mutation-guard.js';
import { saveUploads, UploadError } from './upload-store.js';
import { suggestDirectories } from './dir-suggest.js';
import {
  loadHiddenSessions, persistHiddenSessions,
  resolveTranscriptDeleteTargets, deleteTranscriptTargets,
} from './hidden-sessions-store.js';
import { serveStatic } from './static.js';
import { launchClaude } from '../launch/launch-claude.js';
import { LaunchedRegistry } from '../launch/launched-registry.js';
import { isForeignWriterFresh } from '../launch/resume-freshness-gate.js';
import { effectiveRoots, saveRoots } from '../launch/launch-settings.js';
import { LoopSupervisor } from '../loop/loop-supervisor.js';
import { createJobStore } from '../loop/loop-job-store.js';
import type { Task } from '../domain/task-registry.js';
import type { WorkflowRunProjection } from '../workflows/workflow-registry.js';

// Ported whole from src/sse-server.js at 100% parity: one SseServer class owns
// HTTP creation, the routing dispatcher (Host/DNS-rebinding guard BEFORE route
// resolution, for ALL methods), heartbeat, client mgmt, and every /events +
// /api/* handler. The routes/* decomposition is deferred to a post-parity
// follow-up — reordering the guard mid-split is exactly the risk this
// single-file port avoids.

/** Structural subset of the session-state reducer this server drives. */
export interface SseReducerLike {
  on(event: 'session-updated', listener: (card: SessionCard) => void): unknown;
  on(event: 'session-removed', listener: (payload: { sessionId: string }) => void): unknown;
  // Permission-approval integration ('tool-result' subscription rides the same
  // overloads). Optional so lightweight test doubles that predate the feature
  // keep working — the server guards every call site.
  on(event: 'tool-result', listener: (payload: { sessionId: string; toolUseId: string }) => void): unknown;
  setPendingPermission?(sessionId: string, question: PendingQuestion): void;
  clearPendingPermission?(sessionId: string, requestId: string): void;
  listCards(): SessionCard[];
  listStates(): Iterable<TouchedFileSessionState & FileTouchSource>;
  listProjectRoots(): Array<string | null | undefined>;
  listFleetTasks(): FleetTaskRecord[];
  listTasks(sessionId: string): Array<Task & { planPath: string }> | null;
  sessionCwd(sessionId: string): string | null;
  sessionLastActivityAt(sessionId: string): number | null;
  removeSession(sessionId: string): void;
}

/** Structural subset of the transcript watcher this server drives (timeline resolution only). */
export interface SseWatcherLike {
  filePathForSession(sessionId: string): string | null;
  filePathForAgent(sessionId: string, agentId: string): string | null;
}

/** Structural subset of the workflow registry this server drives. */
export interface SseWorkflowsLike {
  on(event: 'workflow-updated', listener: (run: WorkflowRunProjection) => void): unknown;
  on(event: 'workflow-removed', listener: (payload: { sessionId: string }) => void): unknown;
  listWorkflows(): WorkflowRunProjection[];
  getWorkflow(sessionId: string, workflowId: string): WorkflowRunProjection | null;
}

export interface SseServerOptions {
  host: string;
  port: number;
  reducer: SseReducerLike;
  watcher: SseWatcherLike;
  workflows?: SseWorkflowsLike | null;
  fleetToken?: string;
  publicDir?: string;
}

export class SseServer {
  host: string;
  port: number;
  publicDir: string;
  fleetToken: string;
  readonly server: http.Server;
  readonly clients: Set<ServerResponse>;
  readonly launched: LaunchedRegistry;
  readonly permissions: PermissionRequestBroker;
  // Runtime toggle: when off, permission asks from EXTERNAL (terminal) sessions
  // are sent back to their own window instead of the dashboard — the user is at
  // the keyboard and wants the native y/n. Launched sessions ignore it (they
  // have no terminal, so the dashboard is their only surface). Default on.
  #remoteApproval = true;
  readonly supervisor: LoopSupervisor;
  readonly skillInstalls: SkillInstallService;
  // Serialize bundle syncs: a second POST while one runs gets a 409 instead of
  // racing the staging/swap. In-process only — the dashboard is single-server.
  #syncInFlight = false;
  // Tiny cache for the unauthenticated upstream-check GET so a hostile page
  // spamming it can't fork a gh process (and burn API quota) per request.
  #upstreamCheck: { at: number; body: unknown } | null = null;
  // Display-only hidden sessions: filtered out of every card surface, persisted
  // across restarts. Transcripts on disk stay untouched.
  readonly #hidden: Set<string> = loadHiddenSessions(config.hiddenSessionsFile);
  // When each dashboard-launched child EXITED (sessionId → epoch ms). Lets the
  // resume freshness gate tell "our own child's final transcript writes" apart
  // from a foreign process still driving the session, and makes a Stop click
  // racing the exit succeed instead of 409ing.
  readonly #recentExits: Map<string, number> = new Map();
  private readonly reducer: SseReducerLike;
  private readonly watcher: SseWatcherLike;
  private readonly workflows: SseWorkflowsLike | null;
  private readonly heartbeat: NodeJS.Timeout;

  constructor({
    host, port, reducer, watcher, workflows = null, fleetToken = '', publicDir = config.publicDir,
  }: SseServerOptions) {
    this.host = host;
    this.port = port;
    this.reducer = reducer;
    this.watcher = watcher;
    // Static root for the SPA. Injected for tests; resolved so the traversal
    // prefix guard in static.ts compares real paths.
    this.publicDir = path.resolve(publicDir);
    // Live workflow runs (multi-agent orchestration). Read-only surface, mirrors
    // the reducer: its 'workflow-updated' is rebroadcast as the 'workflow' SSE event.
    this.workflows = workflows;
    // Per-run anti-CSRF secret handed to the same-origin SPA; echoed back as
    // X-Fleet-Token on the launch/kill mutations.
    this.fleetToken = fleetToken;
    // Tracks dashboard-launched Claude processes (caps + control handle).
    this.launched = new LaunchedRegistry({
      maxConcurrent: config.maxConcurrent,
      pidFile: config.launchedPidFile,
      idleKillMs: config.idleKillMin * 60_000,
    });
    // Always-on loop jobs: a supervisor relaunches bounded launchClaude cycles on a
    // cadence, sharing the SAME registry so cycles obey the global cap + per-cwd
    // lock. launchClaude's (opts, { onExit, onActivity }) contract is exactly what
    // the supervisor calls, so it is injected directly (no adapter).
    this.skillInstalls = new SkillInstallService();
    this.supervisor = new LoopSupervisor({
      registry: this.launched,
      // Loop cycles get the same cf-plugin treatment as one-shot launches:
      // the wrapper injects --plugin-dir whenever the bundle is active.
      launchFn: (params, hooks) => launchClaude({ ...params, pluginDir: activeCfPluginDir() }, hooks),
      store: createJobStore(config.loopJobsFile),
      maxTurns: config.maxTurns,
      minIntervalSec: config.loopMinIntervalSec,
      maxFails: config.loopMaxFails,
      maxCyclesGoal: config.loopMaxCyclesGoal,
      sentinelDir: config.loopSentinelDir,
    });
    this.supervisor.on('job', (job) => this.#broadcastEvent({ type: 'loop-job', data: job }));
    if (workflows) {
      workflows.on('workflow-updated', (wf) => {
        // WorkflowRunProjection widens two best-effort fields (agentType/spawnDepth
        // may be null until the sibling meta.json read resolves) versus the shared
        // WorkflowRun contract, which models every SSE payload as fully populated.
        // This cast is a type bridge only — it forwards the exact runtime value
        // (including nulls) over the wire, matching the untyped JS original.
        this.#broadcastEvent({ type: 'workflow', data: wf as unknown as WorkflowRun });
      });
      workflows.on('workflow-removed', (info) => this.#broadcastEvent({ type: 'workflow-removed', data: info }));
    }
    // Permission-approval broker: PreToolUse hooks long-poll it, the UI answers
    // it, and its pending/resolved edges drive the card + idle-kill hold.
    this.permissions = new PermissionRequestBroker();
    this.permissions.on('permission-pending', (request) => {
      this.reducer.setPendingPermission?.(request.sessionId, permissionQuestion(request));
      this.launched.holdIdle(request.sessionId);
    });
    this.permissions.on('permission-resolved', ({ requestId, sessionId }) => {
      this.reducer.clearPendingPermission?.(sessionId, requestId);
      // Only release the idle clock once NO request is left on the session.
      if (this.permissions.listPending(sessionId).length === 0) this.launched.releaseIdle(sessionId);
    });
    // Terminal-answered / already-resolved tool calls cancel their request.
    reducer.on('tool-result', ({ sessionId, toolUseId }) => this.permissions.resolveByToolUse(sessionId, toolUseId));
    this.clients = new Set();
    this.server = http.createServer((req, res) => this.#route(req, res));
    // Loop-cycle sessions are autonomous (they never "need you"), so keep them off
    // the board and its alerts — they surface on the Always-on page instead.
    reducer.on('session-updated', (card) => {
      if (this.supervisor.isLoopCycle(card.sessionId)) return;
      if (this.#hidden.has(card.sessionId)) return; // hidden cards never reach clients
      this.#broadcastEvent({ type: 'session', data: this.#withLaunched(card) });
    });
    reducer.on('session-removed', (info) => this.#broadcastEvent({ type: 'session-removed', data: info }));
    // Comment-ping heartbeat keeps proxies/browsers from dropping idle streams.
    // The periodic snapshot also lets cards flip to "idle" without any new
    // transcript event — status decay has no event to piggyback on.
    this.heartbeat = setInterval(() => {
      // Piggyback: cancel permission requests whose hook died (Ctrl+C/crash) so
      // their cards don't sit in Waiting forever.
      this.permissions.sweepOrphans();
      for (const client of this.clients) {
        client.write(': ping\n\n');
        writeSse(client, 'snapshot', this.#cardsWithLaunched());
      }
    }, 15_000);
    this.heartbeat.unref();
  }

  listen(): Promise<void> {
    return new Promise((resolve) => this.server.listen(this.port, this.host, resolve));
  }

  close(): Promise<void> {
    clearInterval(this.heartbeat);
    this.permissions.close(); // flush held permission long-polls
    this.supervisor.stopAllTimers();
    for (const client of this.clients) client.end();
    return new Promise((resolve) => this.server.close(() => resolve()));
  }

  // Boot reconciliation: mark prior `running` loop jobs `interrupted` (never
  // re-launch a persisted task — the file is untrusted input). Returns the count.
  reconcileLoopJobs(): number {
    return this.supervisor.resumeFromDisk();
  }

  async #route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      // Reject foreign Host headers: a malicious site resolving its own domain
      // to 127.0.0.1 (DNS rebinding) must not get same-origin transcript reads.
      const host = req.headers.host ?? '';
      if (host !== `${this.host}:${this.port}` && host !== `localhost:${this.port}`) {
        sendJson(res, 403, { error: 'forbidden host' });
        return;
      }
      const url = new URL(req.url ?? '/', `http://${host}`);
      if (url.pathname === '/events') return this.#handleSse(res);
      if (url.pathname === '/api/sessions') return sendJson(res, 200, this.#cardsWithLaunched());
      // Workflows: read-only fleet list + per-run detail (same posture as /api/sessions).
      if (url.pathname === '/api/workflows') {
        return sendJson(res, 200, this.workflows ? this.workflows.listWorkflows() : []);
      }
      const wfMatch = url.pathname.match(/^\/api\/workflows\/([^/]+)\/([^/]+)$/);
      if (wfMatch) {
        const wf = this.workflows?.getWorkflow(decodeURIComponent(wfMatch[1]), decodeURIComponent(wfMatch[2]));
        return sendJson(res, wf ? 200 : 404, wf ?? { error: 'unknown workflow' });
      }
      if (url.pathname === '/api/files') {
        return sendJson(res, 200, aggregateFileTouches(this.reducer.listStates()));
      }
      if (url.pathname === '/api/file') {
        const requested = url.searchParams.get('path') ?? '';
        const result = await readTouchedFile(requested, this.reducer.listStates());
        return sendJson(res, result.status, result.body);
      }
      if (url.pathname === '/api/wiki') {
        return sendJson(res, 200, await readFleetWiki(this.reducer.listProjectRoots()));
      }
      // Fleet-wide Overview: durable plan progress (plans/ on disk) merged with the live
      // task registry + session cards into the four dashboard panels. Read-only, same as /api/files.
      if (url.pathname === '/api/overview') {
        const plans = await readFleetPlans(this.reducer.listProjectRoots());
        return sendJson(res, 200, buildOverview({
          plans,
          liveTasks: this.reducer.listFleetTasks(),
          cards: this.#cardsWithLaunched(),
          now: Date.now(),
        }));
      }
      // Read-only skill-catalog scan. No client-supplied path/query — the root
      // comes solely from server config (cf bundle once seeded, else legacy).
      if (url.pathname === '/api/skills') {
        return sendJson(res, 200, await scanSkillCatalog(activeSkillsRoot()));
      }
      // Upstream version probe (read-only, but reaches GitHub through the
      // user's own gh auth — failures map to 502, never a crash).
      if (url.pathname === '/api/skills/upstream-check') {
        if (this.#upstreamCheck && Date.now() - this.#upstreamCheck.at < 60_000) {
          return sendJson(res, 200, this.#upstreamCheck.body);
        }
        try {
          const result = await checkUpstream({ repo: config.cfUpstreamRepo, bundleDir: config.cfPluginDir });
          this.#upstreamCheck = { at: Date.now(), body: result };
          return sendJson(res, 200, result);
        } catch (err) {
          return sendJson(res, 502, { error: errorMessage(err) });
        }
      }
      // Bundle mutations. Same token guard as /api/spawn — installed skills
      // later run inside bypassPermissions sessions, so this surface is as
      // sensitive as launching one.
      if (url.pathname === '/api/skills/sync-upstream') {
        const gate = requireMutation(req, this.fleetToken, { host: this.host, port: this.port });
        if (!gate.ok) return sendJson(res, gate.status, { error: gate.error });
        const body = (await readJsonBody(req)) as { tag?: unknown } | null;
        const tag = typeof body?.tag === 'string' && body.tag ? body.tag : undefined;
        if (tag !== undefined && !/^[\w.-]+$/.test(tag)) return sendJson(res, 400, { error: 'invalid tag' });
        if (this.#syncInFlight) return sendJson(res, 409, { error: 'a sync is already running' });
        this.#syncInFlight = true;
        try {
          const summary = await syncUpstream({ repo: config.cfUpstreamRepo, tag, bundleDir: config.cfPluginDir });
          this.#upstreamCheck = null; // current tag changed — next check must be fresh
          return sendJson(res, 200, summary);
        } catch (err) {
          return sendJson(res, 502, { error: errorMessage(err) });
        } finally {
          this.#syncInFlight = false;
        }
      }
      if (url.pathname === '/api/skills/install/preview') {
        const gate = requireMutation(req, this.fleetToken, { host: this.host, port: this.port });
        if (!gate.ok) return sendJson(res, gate.status, { error: gate.error });
        const body = (await readJsonBody(req)) as { kind?: unknown; ref?: unknown } | null;
        const ref = typeof body?.ref === 'string' ? body.ref.trim() : '';
        if (!ref) return sendJson(res, 400, { error: 'ref is required' });
        try {
          const record = body?.kind === 'github'
            ? await this.skillInstalls.previewGithub(ref)
            : await this.skillInstalls.previewLocalPath(ref);
          return sendJson(res, 200, {
            previewId: record.id,
            kind: record.kind,
            source: record.source,
            skills: record.skills.map((s) => ({ name: s.name, desc: s.desc })),
          });
        } catch (err) {
          return sendJson(res, 400, { error: errorMessage(err) });
        }
      }
      if (url.pathname === '/api/skills/install/confirm') {
        const gate = requireMutation(req, this.fleetToken, { host: this.host, port: this.port });
        if (!gate.ok) return sendJson(res, gate.status, { error: gate.error });
        const body = (await readJsonBody(req)) as { previewId?: unknown; names?: unknown } | null;
        const previewId = typeof body?.previewId === 'string' ? body.previewId : '';
        const names = Array.isArray(body?.names) ? body.names.filter((n): n is string => typeof n === 'string') : [];
        if (!previewId || !names.length) return sendJson(res, 400, { error: 'previewId and names[] are required' });
        try {
          return sendJson(res, 200, await this.skillInstalls.confirm(previewId, names, config.cfPluginDir));
        } catch (err) {
          return sendJson(res, 409, { error: errorMessage(err) });
        }
      }
      if (url.pathname === '/api/skills/remove') {
        const gate = requireMutation(req, this.fleetToken, { host: this.host, port: this.port });
        if (!gate.ok) return sendJson(res, gate.status, { error: gate.error });
        const body = (await readJsonBody(req)) as { name?: unknown } | null;
        const name = typeof body?.name === 'string' ? body.name : '';
        const removed = name ? await removeSkillFromBundle(config.cfPluginDir, name) : false;
        return sendJson(res, removed ? 200 : 404, removed ? { removed: name } : { error: 'unknown skill' });
      }
      // Chat-composer attachments: saved to the fleet uploads dir, absolute
      // paths returned for the client to fold into the launch task text. Feeds
      // a bypassPermissions agent, so it gets the same token guard as /api/spawn.
      // Body limit is raised route-locally to fit base64-encoded attachments.
      if (url.pathname === '/api/uploads') {
        const gate = requireMutation(req, this.fleetToken, { host: this.host, port: this.port });
        if (!gate.ok) return sendJson(res, gate.status, { error: gate.error });
        const body = await readJsonBody(req, 32 << 20);
        if (body === null) return sendJson(res, 400, { error: 'invalid or oversized JSON body' });
        try {
          return sendJson(res, 200, saveUploads(body, config.uploadsDir));
        } catch (err) {
          if (err instanceof UploadError) return sendJson(res, 400, { error: err.message });
          throw err;
        }
      }
      // Same-origin only (Same-Origin Policy stops a cross-site page reading the
      // body). The SPA fetches this to obtain the token it must present on
      // mutations. Not a secret vs local processes — see Phase 2 threat model.
      if (url.pathname === '/api/fleet-token') {
        return sendJson(res, 200, { token: this.fleetToken });
      }
      // Quick-pick working folders for the launch modal: the configured roots
      // plus every project root the fleet has already seen a session in —
      // exactly the folders the desktop app would offer as recent workspaces.
      // The picker can also type ANY absolute path (validated at spawn time).
      if (url.pathname === '/api/spawn-options') {
        const roots = effectiveRoots(config.allowedRoots);
        const known = (this.reducer.listProjectRoots() ?? []).filter((r): r is string => typeof r === 'string' && !!r);
        return sendJson(res, 200, {
          cwds: [...new Set([...roots, ...known])],
          models: config.allowedModels,
          defaultModel: config.launchModel,
          launching: true, // any existing directory can host a session (desktop-app parity)
        });
      }
      // Path autocomplete for the working-folder picker (directory names only).
      if (url.pathname === '/api/fs-dirs') {
        return sendJson(res, 200, suggestDirectories(url.searchParams.get('prefix') ?? ''));
      }
      // In-app launch config (add/list allowed dirs). Reading is same-origin;
      // writing is a mutation behind the token guard (same level as /api/spawn).
      if (url.pathname === '/api/launch-settings') {
        if (req.method === 'POST') {
          const gate = requireMutation(req, this.fleetToken, { host: this.host, port: this.port });
          if (!gate.ok) return sendJson(res, gate.status, { error: gate.error });
          const body = await readJsonBody(req);
          const result = saveRoots((body as { allowedRoots?: unknown } | null)?.allowedRoots);
          if (!result.ok) return sendJson(res, 400, { error: result.error });
          return sendJson(res, 200, { allowedRoots: effectiveRoots(config.allowedRoots) });
        }
        return sendJson(res, 200, {
          allowedRoots: effectiveRoots(config.allowedRoots),
          envRoots: config.allowedRoots, // env-set roots are not removable from the app
        });
      }
      // The dangerous surface: spawns a bypassPermissions process. Guard FIRST.
      if (url.pathname === '/api/spawn') {
        const gate = requireMutation(req, this.fleetToken, { host: this.host, port: this.port });
        if (!gate.ok) return sendJson(res, gate.status, { error: gate.error });
        return await this.#handleSpawn(req, res);
      }
      // Always-on loop jobs. POST creates a 24/7 relaunch loop (same RCE-adjacent
      // guard as /api/spawn); GET lists them (same-origin read like /api/sessions).
      if (url.pathname === '/api/loop-jobs') {
        if (req.method === 'POST') {
          const gate = requireMutation(req, this.fleetToken, { host: this.host, port: this.port });
          if (!gate.ok) return sendJson(res, gate.status, { error: gate.error });
          return await this.#handleCreateLoopJob(req, res);
        }
        return sendJson(res, 200, this.supervisor.listJobs());
      }
      const loopActionMatch = url.pathname.match(/^\/api\/loop-jobs\/([^/]+)\/(stop|resume)$/);
      if (loopActionMatch) {
        const gate = requireMutation(req, this.fleetToken, { host: this.host, port: this.port });
        if (!gate.ok) return sendJson(res, gate.status, { error: gate.error });
        const id = decodeURIComponent(loopActionMatch[1]);
        if (loopActionMatch[2] === 'stop') {
          return this.supervisor.stopJob(id)
            ? sendJson(res, 202, { stopped: id })
            : sendJson(res, 404, { error: 'unknown loop job' });
        }
        return this.supervisor.resumeJob(id)
          ? sendJson(res, 202, { resumed: id })
          : sendJson(res, 409, { error: 'job is not paused/interrupted (or its directory is busy)' });
      }
      // Hidden sessions: display-only clean-up. Reading the list is same-origin;
      // hide/unhide are mutations (they change what every client sees).
      if (url.pathname === '/api/hidden-sessions') {
        const cards = new Map(this.reducer.listCards().map((c) => [c.sessionId, c.title]));
        return sendJson(res, 200, [...this.#hidden].map((id) => ({ sessionId: id, title: cards.get(id) ?? '' })));
      }
      if (url.pathname === '/api/sessions/bulk-hide') {
        const gate = requireMutation(req, this.fleetToken, { host: this.host, port: this.port });
        if (!gate.ok) return sendJson(res, gate.status, { error: gate.error });
        const body = (await readJsonBody(req)) as { ids?: unknown } | null;
        const ids = Array.isArray(body?.ids)
          ? body.ids.filter((x): x is string => typeof x === 'string').slice(0, 500)
          : [];
        if (!ids.length) return sendJson(res, 400, { error: 'ids[] is required' });
        this.#hide(ids);
        return sendJson(res, 200, { hidden: ids.length });
      }
      const hideMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/(hide|unhide)$/);
      if (hideMatch) {
        const gate = requireMutation(req, this.fleetToken, { host: this.host, port: this.port });
        if (!gate.ok) return sendJson(res, gate.status, { error: gate.error });
        const id = decodeURIComponent(hideMatch[1]);
        if (hideMatch[2] === 'hide') {
          this.#hide([id]);
          return sendJson(res, 200, { hidden: id });
        }
        this.#hidden.delete(id);
        persistHiddenSessions(config.hiddenSessionsFile, this.#hidden);
        // Resurface the card right away if the reducer still knows it.
        const card = this.reducer.listCards().find((c) => c.sessionId === id);
        if (card) this.#broadcastEvent({ type: 'session', data: this.#withLaunched(card) });
        return sendJson(res, 200, { unhidden: id });
      }
      // REAL transcript deletion — the app's only irreversible action. Paths
      // come exclusively from the watcher registry and are confined to
      // projectsRoot; a running launched child is stopped first. This is the
      // deliberate, narrow exception to the "never writes under ~/.claude"
      // posture (user-initiated, single session, no bulk).
      const deleteMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/delete-transcript$/);
      if (deleteMatch) {
        const gate = requireMutation(req, this.fleetToken, { host: this.host, port: this.port });
        if (!gate.ok) return sendJson(res, gate.status, { error: gate.error });
        const id = decodeURIComponent(deleteMatch[1]);
        const filePath = this.watcher.filePathForSession(id);
        if (!filePath) return sendJson(res, 404, { error: 'unknown session' });
        const targets = resolveTranscriptDeleteTargets(filePath, id, config.projectsRoot);
        if (!targets) return sendJson(res, 409, { error: 'transcript lies outside the projects root — refusing to delete' });
        if (this.launched.has(id)) this.launched.kill(id, 'SIGTERM'); // stop our child before removing its transcript
        try {
          deleteTranscriptTargets(targets);
        } catch (err) {
          return sendJson(res, 500, { error: `delete failed: ${errorMessage(err)}` });
        }
        this.#hidden.delete(id); // a deleted session must not linger in the hidden list
        persistHiddenSessions(config.hiddenSessionsFile, this.#hidden);
        this.reducer.removeSession(id);
        this.#broadcastEvent({ type: 'session-removed', data: { sessionId: id } });
        return sendJson(res, 200, { deleted: id });
      }
      // Stop a launched session (only app-launched ones have a control handle).
      const killMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/kill$/);
      if (killMatch) {
        const gate = requireMutation(req, this.fleetToken, { host: this.host, port: this.port });
        if (!gate.ok) return sendJson(res, gate.status, { error: gate.error });
        const id = decodeURIComponent(killMatch[1]);
        if (!this.launched.has(id)) {
          // A Stop click can race the child's own exit (the button lives on a
          // card that updates over SSE). The intent — "no child running" — is
          // already satisfied, so answer success instead of a confusing 409.
          if (this.#recentExits.has(id)) return sendJson(res, 200, { killed: id, alreadyExited: true });
          return sendJson(res, 409, { error: 'not a launched session' });
        }
        this.launched.kill(id, 'SIGTERM');
        // Escalate if it ignores SIGTERM; the timer is unref'd so it can't hold the loop.
        const escalate = setTimeout(() => {
          if (this.launched.has(id)) this.launched.kill(id, 'SIGKILL');
        }, 5000);
        escalate.unref?.();
        return sendJson(res, 202, { killed: id });
      }
      // --- Remote permission approval (PreToolUse hook ⇄ dashboard) ---
      // Display-only: whether the global PreToolUse hook is installed, so the
      // UI can tell "remote approve ready" from "install-hook not run yet".
      if (url.pathname === '/api/permissions/hook-status') {
        return sendJson(res, 200, { installed: fleetHookInstalled() });
      }
      // Read the dashboard-vs-terminal approval toggle (same-origin GET).
      if (url.pathname === '/api/permissions/mode' && req.method === 'GET') {
        return sendJson(res, 200, { enabled: this.#remoteApproval });
      }
      // Flip the toggle (token-guarded — it changes where every opted-in
      // terminal session's prompts land). Broadcast so all dashboards agree.
      if (url.pathname === '/api/permissions/mode' && req.method === 'POST') {
        const gate = requireMutation(req, this.fleetToken, { host: this.host, port: this.port });
        if (!gate.ok) return sendJson(res, gate.status, { error: gate.error });
        const body = (await readJsonBody(req)) as { enabled?: unknown } | null;
        if (typeof body?.enabled !== 'boolean') return sendJson(res, 400, { error: 'enabled must be boolean' });
        this.#remoteApproval = body.enabled;
        this.#broadcastEvent({ type: 'permission-mode', data: { enabled: this.#remoteApproval } });
        return sendJson(res, 200, { enabled: this.#remoteApproval });
      }
      // Hook side: register a blocked tool call. No token (the standalone hook
      // can't hold one) and no authority granted — only the ANSWER authorizes
      // execution. But REQUIRE application/json: a hostile web page's simple
      // cross-origin POST is text/plain (JSON bodies force a CORS preflight we
      // never answer), so this one check keeps drive-by pages from spamming
      // spoofed permission cards. The hook always sends application/json.
      if (url.pathname === '/api/permissions/request' && req.method === 'POST') {
        if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
          return sendJson(res, 415, { error: 'application/json required' });
        }
        const body = (await readJsonBody(req)) as Record<string, unknown> | null;
        if (!body || typeof body.sessionId !== 'string' || !body.sessionId) {
          return sendJson(res, 400, { error: 'sessionId required' });
        }
        // Toggle off → external session answers in its own terminal (no
        // requestId ⇒ the hook fails open to the native prompt). A launched
        // session has no terminal, so it always routes to the dashboard.
        if (!this.#remoteApproval && !this.launched.get(body.sessionId)) {
          return sendJson(res, 200, { passthrough: true });
        }
        const registered = this.permissions.request({
          sessionId: body.sessionId,
          toolName: typeof body.toolName === 'string' ? body.toolName : '',
          toolInput: body.toolInput ?? {},
          toolUseId: typeof body.toolUseId === 'string' ? body.toolUseId : '',
          permissionMode: typeof body.permissionMode === 'string' ? body.permissionMode : '',
          cwd: typeof body.cwd === 'string' ? body.cwd : '',
        });
        // At the pending cap the broker refuses — non-200 makes the hook fail
        // open (normal prompt) instead of queueing unboundedly.
        if (!registered) return sendJson(res, 503, { error: 'too many pending permission requests' });
        return sendJson(res, 200, { requestId: registered.requestId });
      }
      // Hook side: long-poll the decision. 204 = still pending (hook re-polls,
      // making the overall wait unbounded); 404 = unknown (hook re-registers).
      const permDecisionMatch = url.pathname.match(/^\/api\/permissions\/([^/]+)\/decision$/);
      if (permDecisionMatch && req.method === 'GET') {
        const result = await this.permissions.waitDecision(decodeURIComponent(permDecisionMatch[1]), 55_000);
        if (result === null) return sendJson(res, 404, { error: 'unknown request' });
        if (result === 'timeout') { res.writeHead(204, SECURITY_HEADERS); res.end(); return; }
        return sendJson(res, 200, { decision: result });
      }
      // UI side: the Allow/Deny click. This click authorizes code execution in
      // the blocked session — guard it like every other mutation.
      const permAnswerMatch = url.pathname.match(/^\/api\/permissions\/([^/]+)\/answer$/);
      if (permAnswerMatch && req.method === 'POST') {
        const gate = requireMutation(req, this.fleetToken, { host: this.host, port: this.port });
        if (!gate.ok) return sendJson(res, gate.status, { error: gate.error });
        const body = (await readJsonBody(req)) as { decision?: unknown } | null;
        const decision = body?.decision;
        if (decision !== 'allow' && decision !== 'deny') {
          return sendJson(res, 400, { error: 'decision must be allow | deny' });
        }
        const ok = this.permissions.answer(decodeURIComponent(permAnswerMatch[1]), decision);
        return sendJson(res, ok ? 200 : 404, ok ? { answered: decision } : { error: 'unknown or already-decided request' });
      }
      // Steer a running steerable session: answer its question / follow up / finish.
      // Second RCE-adjacent surface (writes into a bypassPermissions stdin) — guard
      // identically to /api/spawn, and gate to launched + steerable only.
      const steerMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/steer$/);
      if (steerMatch) {
        const gate = requireMutation(req, this.fleetToken, { host: this.host, port: this.port });
        if (!gate.ok) return sendJson(res, gate.status, { error: gate.error });
        const id = decodeURIComponent(steerMatch[1]);
        const entry = this.launched.get(id);
        const body = (await readJsonBody(req)) as { type?: unknown; selections?: unknown; text?: unknown; model?: unknown } | null;
        if (body?.type === 'finish') {
          if (!entry || entry.steerable !== true) return sendJson(res, 409, { error: 'not a steerable launched session' });
          this.launched.finish(id);
          return sendJson(res, 202, { finished: id });
        }
        // answer = chosen option label(s) sent as a message (spike-proven path);
        // message = free-text follow-up. Both write a user message to stdin.
        let text = '';
        if (body?.type === 'answer') text = Array.isArray(body.selections) ? body.selections.join(', ') : String(body?.selections ?? '');
        else if (body?.type === 'message') text = typeof body?.text === 'string' ? body.text : '';
        else return sendJson(res, 400, { error: 'type must be answer | message | finish' });
        if (!text.trim()) return sendJson(res, 400, { error: 'empty steer text' });
        if (entry) {
          if (entry.steerable !== true) return sendJson(res, 409, { error: 'session is not steerable' });
          const ok = this.launched.writeToChannel(id, text);
          return sendJson(res, ok ? 202 : 409, ok ? { steered: id } : { error: 'session no longer accepting input' });
        }
        // No live child ⇒ RESUME the session: chat is available on every card
        // (done / idle / observed), not just live launches. Spawns
        // `claude --resume <id>` (same id, same transcript) steerable in the
        // session's own cwd — with the exact validation the launch path has.
        return await this.#handleResume(res, id, text, body?.model);
      }
      const tasksMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/tasks$/);
      if (tasksMatch) {
        const tasks = this.reducer.listTasks(decodeURIComponent(tasksMatch[1]));
        if (tasks === null) return sendJson(res, 404, { error: 'unknown session' });
        return sendJson(res, 200, tasks);
      }
      const timelineMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)(?:\/agents\/([^/]+))?\/timeline$/);
      if (timelineMatch) {
        return await this.#handleTimeline(
          res,
          decodeURIComponent(timelineMatch[1]),
          timelineMatch[2] ? decodeURIComponent(timelineMatch[2]) : null,
          url,
        );
      }
      return await serveStatic(res, url.pathname, this.publicDir);
    } catch (err) {
      sendJson(res, 500, { error: String((err as { message?: unknown } | null)?.message ?? err) });
    }
  }

  #handleSse(res: ServerResponse): void {
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    writeSse(res, 'snapshot', this.#cardsWithLaunched());
    this.clients.add(res);
    res.on('close', () => this.clients.delete(res));
  }

  // Tag a card as dashboard-launched so the UI can show a Stop control on it
  // (only those are steerable/stoppable — terminal-started sessions stay view-only).
  // `model` rides along so the session composer's model pill can show what the
  // child is actually running (fixed at spawn).
  #withLaunched(card: SessionCard): SessionCard {
    const e = this.launched.get(card.sessionId);
    return e ? { ...card, launched: true, steerable: e.steerable === true, model: e.model } : card;
  }

  #cardsWithLaunched(): SessionCard[] {
    return this.reducer.listCards()
      .filter((c) => !this.supervisor.isLoopCycle(c.sessionId)) // loop cycles live on the Always-on page
      .filter((c) => !this.#hidden.has(c.sessionId)) // user chose to hide these
      .map((c) => this.#withLaunched(c));
  }

  // A launched child ended (finished, was stopped, or errored). Free its slot,
  // remember WHEN — the resume gate needs it — and push the card to clients
  // immediately so the ⏹ Stop control disappears: the only other carrier of
  // that state change is the 15s heartbeat snapshot, and a stale Stop invites
  // a doomed /kill click.
  #onLaunchedExit(sessionId: string): void {
    this.launched.remove(sessionId);
    this.#recentExits.set(sessionId, Date.now());
    // Entries only matter for the ~2min freshness window; prune old ones so the
    // map can't grow unbounded on a long-lived server.
    if (this.#recentExits.size > 200) {
      const cutoff = Date.now() - 600_000;
      for (const [id, at] of this.#recentExits) if (at < cutoff) this.#recentExits.delete(id);
    }
    const card = this.reducer.listCards().find((c) => c.sessionId === sessionId);
    if (card && !this.#hidden.has(sessionId) && !this.supervisor.isLoopCycle(sessionId)) {
      this.#broadcastEvent({ type: 'session', data: this.#withLaunched(card) });
    }
  }

  // Hide/unhide bookkeeping shared by the single and bulk routes.
  #hide(ids: readonly string[]): void {
    for (const id of ids) {
      this.#hidden.add(id);
      // Clients drop the card immediately (same event a stale session emits).
      this.#broadcastEvent({ type: 'session-removed', data: { sessionId: id } });
    }
    persistHiddenSessions(config.hiddenSessionsFile, this.#hidden);
  }

  // Stop every launched child — called on graceful server shutdown so a restart
  // never orphans a bypassPermissions process. Stop the loop supervisor's timers
  // FIRST so no cycle relaunches during the (async) shutdown after we kill.
  killLaunched(): void {
    this.supervisor.stopAllTimers();
    this.launched.killAll();
  }

  // Launch: validate → cap-check → spawn a headless Claude → register. The
  // transcript it writes appears on the board via the existing watcher/reducer.
  async #handleSpawn(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readJsonBody(req);
    if (!body || typeof body !== 'object') return sendJson(res, 400, { error: 'invalid JSON body' });
    const b = body as Record<string, unknown>;
    const task = typeof b.task === 'string' ? b.task.trim() : '';
    if (!task) return sendJson(res, 400, { error: 'task is required' });
    // Desktop-app parity: ANY existing directory the user points at can host a
    // session (the anti-CSRF token is the trust boundary; the allow-list is a
    // quick-pick source, not a gate). Every folder is canonicalized + must exist.
    if (typeof b.cwd !== 'string' || !b.cwd.trim()) return sendJson(res, 400, { error: 'cwd is required' });
    const cwdCheck = resolveExistingDir(b.cwd.trim());
    if (!cwdCheck.ok) return sendJson(res, 400, { error: cwdCheck.error });
    // Extra working folders (multi-root, --add-dir). Each must exist too.
    const addDirs: string[] = [];
    if (Array.isArray(b.addDirs)) {
      for (const raw of b.addDirs.slice(0, 8)) {
        if (typeof raw !== 'string' || !raw.trim()) continue;
        const check = resolveExistingDir(raw.trim());
        if (!check.ok) return sendJson(res, 400, { error: `add-dir: ${check.error}` });
        if (check.path !== cwdCheck.path && !addDirs.includes(check.path)) addDirs.push(check.path);
      }
    }
    // Client model must be allow-listed; otherwise fall back to the cheap default.
    const model = isAllowedModel(b.model, config.allowedModels) ? (b.model as string) : config.launchModel;
    // Opt-in: keep stdin open so the session can be steered (answered/followed-up)
    // mid-run. Plain launches stay on the proven EOF-exit path.
    const steerable = b.steerable === true;
    // Opt-in supervised mode: no bypassPermissions — risky tools block on the
    // global fleet hook and are approved from the board. Without the hook a
    // headless default-mode child just auto-denies every gated tool, so refuse
    // to ship a broken session rather than let it limp.
    const supervised = b.supervised === true;
    if (supervised && !fleetHookInstalled()) {
      return sendJson(res, 409, { error: 'supervised launch requires the approval hook — run `npm run install-hook` first' });
    }
    // Caps — fork-bomb + same-tree-corruption guards (red-team C2/failure).
    if (this.launched.atCapacity()) {
      return sendJson(res, 429, { error: `at capacity (${config.maxConcurrent} concurrent launches)` });
    }
    if (this.launched.cwdBusy(cwdCheck.path)) {
      return sendJson(res, 429, { error: 'a launch is already active in this directory' });
    }
    const sessionId = randomUUID();
    // Reserve the slot SYNCHRONOUSLY (no await between the cap check and this)
    // so concurrent POSTs can't all pass atCapacity/cwdBusy before the first
    // registers — that TOCTOU would defeat both the fork-bomb cap and per-cwd=1.
    this.launched.register(sessionId, { cwd: cwdCheck.path, model, steerable, startedAt: Date.now(), status: 'starting' });
    try {
      // Await the actual spawn so we never 202 a launch that immediately fails.
      const { pid, child } = await launchClaude(
        {
          sessionId, cwd: cwdCheck.path, model, task, maxTurns: config.maxTurns, steerable, addDirs, supervised,
          // Point the child's hook at THIS server instance (port may differ from 4600).
          ...(supervised ? { env: { FLEET_URL: `http://${this.host}:${this.port}` } } : {}),
          pluginDir: activeCfPluginDir(),
        },
        {
          onExit: () => this.#onLaunchedExit(sessionId), // cleanup + card refresh on exit/error
          onActivity: () => this.launched.touch(sessionId), // reset idle timer on output
        },
      );
      this.launched.register(sessionId, { pid, child, cwd: cwdCheck.path, model, steerable, supervised, startedAt: Date.now() }); // upgrade
      return sendJson(res, 202, { sessionId, cwd: cwdCheck.path, model, steerable, supervised });
    } catch (err) {
      this.launched.remove(sessionId); // release the reservation on spawn failure
      return sendJson(res, 500, { error: `launch failed: ${String((err as { message?: unknown } | null)?.message ?? err)}` });
    }
  }

  // Resume a not-currently-launched session so ANY card can be chatted with.
  // Guard-rails from #handleSpawn (model whitelist, caps, synchronous slot
  // reservation) plus a freshness check: a transcript that is still moving
  // means some OTHER process (the user's terminal/desktop app) owns the
  // session — two writers on one session id would corrupt it.
  //
  // Deliberately NOT gated on the launch allow-list: the cwd comes from the
  // session's own transcript, i.e. a directory the user ALREADY ran Claude in
  // themselves — chat must always work on every observed card. The allow-list
  // keeps gating FRESH spawns, where the directory choice originates in the
  // browser instead of an existing session.
  async #handleResume(res: ServerResponse, sessionId: string, text: string, modelRaw: unknown): Promise<void> {
    const cwd = this.reducer.sessionCwd(sessionId);
    if (!cwd) return sendJson(res, 404, { error: 'unknown session (no transcript cwd recorded)' });
    const cwdCheck = resolveExistingDir(cwd);
    if (!cwdCheck.ok) return sendJson(res, 409, { error: cwdCheck.error });
    // Fresh transcript activity blocks resume UNLESS it came from our own
    // just-exited child — a finished/stopped in-app session must accept a
    // follow-up message immediately, not after a 2-minute cooldown.
    const lastAt = this.reducer.sessionLastActivityAt(sessionId);
    if (isForeignWriterFresh(lastAt, this.#recentExits.get(sessionId), Date.now())) {
      return sendJson(res, 409, { error: 'session was active moments ago — it may still be running elsewhere (terminal/desktop). Try again shortly.' });
    }
    const model = isAllowedModel(modelRaw, config.allowedModels) ? (modelRaw as string) : config.launchModel;
    if (this.launched.atCapacity()) {
      return sendJson(res, 429, { error: `at capacity (${config.maxConcurrent} concurrent launches)` });
    }
    if (this.launched.cwdBusy(cwdCheck.path)) {
      return sendJson(res, 429, { error: 'a launch is already active in this directory' });
    }
    // Reserve synchronously (same TOCTOU posture as #handleSpawn).
    this.launched.register(sessionId, { cwd: cwdCheck.path, model, steerable: true, startedAt: Date.now(), status: 'starting' });
    try {
      const { pid, child } = await launchClaude(
        { sessionId, cwd: cwdCheck.path, model, task: text, maxTurns: config.maxTurns, steerable: true, resume: true, pluginDir: activeCfPluginDir() },
        {
          onExit: () => this.#onLaunchedExit(sessionId),
          onActivity: () => this.launched.touch(sessionId),
        },
      );
      this.launched.register(sessionId, { pid, child, cwd: cwdCheck.path, model, steerable: true, startedAt: Date.now() });
      return sendJson(res, 202, { resumed: sessionId, model });
    } catch (err) {
      this.launched.remove(sessionId);
      return sendJson(res, 500, { error: `resume failed: ${errorMessage(err)}` });
    }
  }

  // Create + start an always-on loop job. Same validation posture as #handleSpawn
  // (cwd allow-list, model whitelist, global cap), plus the loop brakes: interval
  // floored to the minimum, a durable per-cwd loop lock (409), and a loopback-gated
  // QA baseUrl. createJob schedules the first cycle; the supervisor owns the rest.
  async #handleCreateLoopJob(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readJsonBody(req);
    if (!body || typeof body !== 'object') return sendJson(res, 400, { error: 'invalid JSON body' });
    const b = body as Record<string, unknown>;
    const task = typeof b.task === 'string' ? b.task.trim() : '';
    if (!task) return sendJson(res, 400, { error: 'task is required' });
    const cwdCheck = resolveAllowedCwd(b.cwd, effectiveRoots(config.allowedRoots));
    if (!cwdCheck.ok) return sendJson(res, 400, { error: cwdCheck.error });
    const model = isAllowedModel(b.model, config.allowedModels) ? (b.model as string) : config.launchModel;
    const mode = b.mode === 'goal' ? 'goal' : 'job';
    const intervalSec = clampInt(b.intervalSec, config.loopMinIntervalSec, 86_400, config.loopMinIntervalSec);
    // QA-template baseUrl (optional, discrete field): its host must be allow-listed
    // (loopback by default) so an unattended agent can't be pointed off-box. This is
    // a guard-rail on the template flow, not a hard boundary — the task is user-authored.
    if (b.baseUrl != null && b.baseUrl !== '') {
      const hostErr = validateBaseHost(b.baseUrl, config.loopAllowedBaseHosts);
      if (hostErr) return sendJson(res, 400, { error: hostErr });
    }
    if (this.launched.atCapacity()) {
      return sendJson(res, 429, { error: `at capacity (${config.maxConcurrent} concurrent launches)` });
    }
    // One agent per working tree: reject if a one-shot holds it now, or a loop owns it.
    if (this.launched.cwdBusy(cwdCheck.path) || this.supervisor.isCwdReserved(cwdCheck.path)) {
      return sendJson(res, 409, { error: 'a loop or launch is already active in this directory' });
    }
    try {
      const job = this.supervisor.createJob({ task, cwd: cwdCheck.path, model, mode, intervalSec });
      return sendJson(res, 202, job);
    } catch (err) {
      return sendJson(res, 409, { error: String((err as { message?: unknown } | null)?.message ?? err) });
    }
  }

  async #handleTimeline(res: ServerResponse, sessionId: string, agentId: string | null, url: URL): Promise<void> {
    // Resolve exclusively through the watcher registry — never from raw input —
    // so a crafted id cannot traverse outside the projects root.
    const filePath = agentId
      ? this.watcher.filePathForAgent(sessionId, agentId)
      : this.watcher.filePathForSession(sessionId);
    if (!filePath) return sendJson(res, 404, { error: 'unknown session' });
    const limit = clampInt(url.searchParams.get('limit'), 1, 5000, 1000);
    const sinceRaw = url.searchParams.get('since');
    const since = sinceRaw === null ? null : clampInt(sinceRaw, 0, Number.MAX_SAFE_INTEGER, 0);
    sendJson(res, 200, await readTimeline(filePath, { limit, since }));
  }

  // Ping connected clients that a docs/wiki entry changed; the Shipped view refetches.
  broadcastWiki(): void {
    this.#broadcastEvent({ type: 'wiki-updated', data: { changed: true } });
  }

  // Ping connected clients that a plan/phase file changed on disk; the Overview refetches
  // /api/overview so durable progress (checkbox %, plan status) updates without a reload.
  broadcastOverview(): void {
    this.#broadcastEvent({ type: 'overview-updated', data: { changed: true } });
  }

  // Exhaustiveness gate: if a new SseEvent variant is added to shared/types
  // without a case here, `event` narrows to `never` in the default branch and
  // this fails `tsc` — the compile-time equivalent of the JS original's single
  // untyped #broadcast(eventName, data).
  #broadcastEvent(event: SseEvent): void {
    switch (event.type) {
      case 'snapshot':
      case 'session':
      case 'session-removed':
      case 'wiki-updated':
      case 'overview-updated':
      case 'loop-job':
      case 'workflow':
      case 'workflow-removed':
      case 'permission-mode':
        for (const client of this.clients) writeSse(client, event.type, event.data);
        return;
      default: {
        const _exhaustive: never = event;
        throw new Error(`unhandled SSE event type: ${JSON.stringify(_exhaustive)}`);
      }
    }
  }
}

// Sessions run wherever the user points them (spawn) or wherever their
// transcript says they lived (resume) — validate the directory still exists
// and canonicalize it so the registry's per-cwd lock compares real paths.
// Exported for tests.
export function resolveExistingDir(cwd: string): { ok: true; path: string } | { ok: false; error: string } {
  try {
    const real = fs.realpathSync(cwd);
    if (!fs.statSync(real).isDirectory()) return { ok: false, error: `session directory is not a directory (${cwd})` };
    return { ok: true, path: real };
  } catch {
    return { ok: false, error: `session directory no longer exists (${cwd})` };
  }
}

// The --plugin-dir every dashboard launch gets while the cf bundle is active
// (exists on disk + FLEET_CF_PLUGIN kill-switch not set). Checked per launch,
// not at boot, so a mid-run seed/sync takes effect immediately.
function activeCfPluginDir(): string | undefined {
  return cfPluginActive() ? config.cfPluginDir : undefined;
}

function errorMessage(err: unknown): string {
  return String((err as { message?: unknown } | null)?.message ?? err);
}

// True when the fleet PreToolUse hook entry is present in the user's global
// Claude Code settings (matched by the hook script's filename marker — the
// same marker the installer uses for idempotence).
function fleetHookInstalled(): boolean {
  try {
    const settingsPath = process.env.FLEET_CLAUDE_SETTINGS
      || path.join(os.homedir(), '.claude', 'settings.json');
    const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as {
      hooks?: { PreToolUse?: Array<{ hooks?: Array<{ command?: unknown }> }> };
    };
    return Boolean(parsed?.hooks?.PreToolUse?.some((entry) => entry?.hooks?.some(
      (h) => typeof h?.command === 'string' && h.command.includes('fleet-permission-approval-hook.cjs'),
    )));
  } catch {
    return false; // unreadable/missing settings — treat as not installed
  }
}

// A broker request rendered as the card's pendingQuestion: same shape the
// AskUserQuestion path produces, so every existing waiting-for-you surface
// (board column, NeedsYouStrip, alerts) works unchanged.
function permissionQuestion(request: PendingPermission): PendingQuestion {
  const input = (request.toolInput && typeof request.toolInput === 'object'
    ? request.toolInput : {}) as Record<string, unknown>;
  return {
    toolUseId: request.toolUseId,
    kind: 'permission',
    requestId: request.requestId,
    askedAt: request.askedAt,
    questions: [{
      header: `Permission: ${request.toolName || 'tool'}`,
      question: summarizeToolUse({ name: request.toolName, input }).summary,
      multiSelect: false,
      options: ['Allow', 'Deny'],
    }],
  };
}

function writeSse(res: ServerResponse, eventName: string, data: unknown): void {
  res.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
}

// Reads a bounded JSON request body; resolves null on oversize/parse error
// (caller returns 400) so a malformed body can never throw into the router.
function readJsonBody(req: IncomingMessage, limit = 1 << 20): Promise<unknown> {
  return new Promise((resolve) => {
    let data = '';
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        resolve(null);
        req.destroy();
        return;
      }
      data += chunk;
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(data));
      } catch {
        resolve(null);
      }
    });
    req.on('error', () => resolve(null));
  });
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  res.writeHead(status, { ...SECURITY_HEADERS, 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function clampInt(raw: unknown, min: number, max: number, fallback: number): number {
  const value = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

// A QA-template baseUrl may only target an allow-listed host (loopback by default).
// Returns an error string, or null when acceptable. Exported so the SSRF-guard
// characterization suite can pin exact-hostname matching.
export function validateBaseHost(baseUrl: unknown, allowedHosts: readonly string[]): string | null {
  let u: URL;
  try {
    u = new URL(String(baseUrl));
  } catch {
    return 'baseUrl must be a valid URL';
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'baseUrl must be http(s)';
  if (!allowedHosts.includes(u.hostname)) return `baseUrl host not allowed (permitted: ${allowedHosts.join(', ')})`;
  return null;
}

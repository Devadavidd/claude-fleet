import { config } from './config.js';
import { TranscriptWatcher } from './watchers/transcript-watcher.js';
import { SessionStateReducer } from './domain/session-state-reducer.js';
import type { AgentMeta } from './domain/session-state-reducer.js';
import { WorkflowRegistry } from './workflows/workflow-registry.js';
import { SseServer } from './http/server.js';
import { WikiWatcher } from './watchers/wiki-watcher.js';
import { PlanWatcher } from './watchers/plan-watcher.js';
import { reapOrphans } from './launch/launched-registry.js';
import { sweepOldUploads } from './http/upload-store.js';

// Boot: reap orphaned launched children from a prior crash, wire every watcher
// into the reducer/registries, start the HTTP+SSE server, and shut down
// gracefully on SIGINT/SIGTERM. Ported 1:1 from src/main.js.

// A previous server run may have crashed while launched children were alive.
// Reap those orphans before we start (safe: only kills still-alive claude pids).
const reaped = reapOrphans(config.launchedPidFile);
if (reaped) console.log(`[launch] reaped ${reaped} orphaned launched process(es)`);

// Chat-composer attachments have no other lifecycle — sweep batches older than
// 7 days so the uploads root can't grow forever.
const sweptUploads = sweepOldUploads(config.uploadsDir, 7 * 24 * 60 * 60 * 1000);
if (sweptUploads) console.log(`[uploads] swept ${sweptUploads} stale upload batch(es)`);

const watcher = new TranscriptWatcher(config);
const reducer = new SessionStateReducer(config);
const workflows = new WorkflowRegistry();

// The watcher's agentId/agentMeta are watcher-internal (`string | null` /
// `unknown`, parsed from an untrusted sibling *.meta.json) — narrow them at
// this boundary into the reducer's stricter `AgentMeta` contract.
function narrowAgentMeta(raw: unknown): AgentMeta | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  return {
    agentType: typeof r.agentType === 'string' ? r.agentType : undefined,
    description: typeof r.description === 'string' ? r.description : undefined,
    toolUseId: typeof r.toolUseId === 'string' || r.toolUseId === null ? (r.toolUseId as string | null) : undefined,
  };
}

watcher.on('session-event', (payload) => {
  reducer.ingest({
    projectSlug: payload.projectSlug,
    sessionId: payload.sessionId,
    agentId: payload.agentId ?? undefined,
    agentMeta: narrowAgentMeta(payload.agentMeta),
    entry: payload.entry,
  });
});
watcher.on('session-stale', ({ sessionId }) => reducer.removeSession(sessionId));
watcher.on('agent-stale', ({ sessionId, agentId }) => reducer.removeAgent(sessionId, agentId));
watcher.on('watch-error', (err) => console.error('[watcher]', err instanceof Error ? err.message : String(err)));
// Workflow runs fold from the watcher's workflow streams (independent of the board reducer).
watcher.on('workflow-event', (payload) => workflows.ingestEvent(payload));
watcher.on('workflow-journal', (payload) => workflows.ingestJournal(payload));
watcher.on('session-stale', ({ sessionId }) => workflows.removeSession(sessionId));

const server = new SseServer({
  host: config.host, port: config.port, reducer, watcher, workflows, fleetToken: config.fleetToken,
});

// A prior run may have persisted `running` loop jobs. Do NOT auto-launch them (the
// file is untrusted input); just reconcile them to `interrupted` so the UI is honest
// and the user re-starts any they still want.
const interrupted = server.reconcileLoopJobs();
if (interrupted) console.log(`[loop] marked ${interrupted} interrupted loop job(s) from a prior run (resume manually)`);

const wikiWatcher = new WikiWatcher({ reducer });
wikiWatcher.on('wiki-changed', () => server.broadcastWiki());

const planWatcher = new PlanWatcher({ reducer });
planWatcher.on('plans-changed', () => server.broadcastOverview());

watcher.start();
wikiWatcher.start();
planWatcher.start();
await server.listen();
console.log(`claude-fleet-dashboard watching ${config.projectsRoot}`);
console.log(`open http://${config.host}:${config.port}`);

async function shutdown(): Promise<void> {
  server.killLaunched(); // SIGTERM launched children so a restart never orphans them
  await watcher.stop();
  await wikiWatcher.stop();
  await planWatcher.stop();
  await server.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

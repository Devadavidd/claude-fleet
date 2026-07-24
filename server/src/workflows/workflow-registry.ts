import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { TranscriptEntry, WorkflowAgent, WorkflowRun } from '../../../shared/types/index.js';
import { parseWorkflowScript } from './workflow-script-parser.js';
import {
  createWorkflow, applyMeta, applyJournalLine, applyAgentEvent, agentStatus, workflowStatus,
} from './workflow-run-fold.js';
import type { WorkflowFold, WorkflowFoldAgentMeta } from './workflow-run-fold.js';

// Live registry of workflow runs, folded from the watcher's workflow-event /
// workflow-journal streams. Thin EventEmitter wrapper — all math is in the pure
// workflow-run-fold.ts. Mirrors the reducer's debounced-emit + removeSession shape.
// Emits 'workflow-updated' (one projected run) and 'workflow-removed' ({sessionId}).
const MAX_SCRIPT_ATTEMPTS = 5; // stop retrying a genuinely-absent script after this

export type ReadScriptFn = (filePath: string, workflowId: string) => Promise<string | null>;

export interface WorkflowRegistryOptions {
  debounceMs?: number;
  now?: () => number;
  readScript?: ReadScriptFn;
}

export interface WorkflowEventInput {
  projectSlug: string;
  sessionId: string;
  workflowId: string;
  agentId: string;
  // Opaque payload from the transcript watcher (parsed from an untrusted sibling
  // *.meta.json) — narrowed to WorkflowFoldAgentMeta at this boundary.
  agentMeta: unknown;
  filePath: string;
  entry: TranscriptEntry;
}

export interface WorkflowJournalInput {
  projectSlug: string;
  sessionId: string;
  workflowId: string;
  filePath: string;
  entry: TranscriptEntry;
}

// The shared WorkflowRun/WorkflowAgent contract models agentType/spawnDepth as
// always-populated; internally they may be null (best-effort meta.json read
// failed) — projection below reflects the ACTUAL runtime shape rather than
// coercing, so this local type widens just those two fields.
export interface WorkflowRunProjection extends Omit<WorkflowRun, 'agents'> {
  agents: Array<Omit<WorkflowAgent, 'agentType' | 'spawnDepth'> & { agentType: string | null; spawnDepth: number | null }>;
}

interface WorkflowRegistryEventMap {
  'workflow-updated': [run: WorkflowRunProjection];
  'workflow-removed': [payload: { sessionId: string }];
}

export class WorkflowRegistry extends EventEmitter<WorkflowRegistryEventMap> {
  private readonly workflows: Map<string, Map<string, WorkflowFold>>;
  private readonly debounceMs: number;
  private readonly now: () => number;
  private readonly readScript: ReadScriptFn;
  private readonly timers: Map<string, NodeJS.Timeout>;
  private readonly scriptState: Map<string, 'loading' | 'loaded'>;
  private readonly scriptAttempts: Map<string, number>; // bounds retries when the script isn't on disk yet

  constructor({ debounceMs = 200, now = () => Date.now(), readScript = readScriptFromDisk }: WorkflowRegistryOptions = {}) {
    super();
    this.workflows = new Map(); // sessionId -> Map<workflowId, wf>
    this.debounceMs = debounceMs;
    this.now = now;
    this.readScript = readScript;
    this.timers = new Map(); // `${sessionId}:${workflowId}` -> timeout
    this.scriptState = new Map(); // key -> 'loading' | 'loaded'
    this.scriptAttempts = new Map(); // key -> attempt count
  }

  ingestEvent(p: WorkflowEventInput): void {
    const wf = this.ensure(p);
    this.maybeLoadScript(wf, p.filePath);
    applyAgentEvent(wf, p.agentId, narrowAgentMeta(p.agentMeta), p.entry);
    this.scheduleEmit(wf);
  }

  ingestJournal(p: WorkflowJournalInput): void {
    const wf = this.ensure(p);
    this.maybeLoadScript(wf, p.filePath);
    applyJournalLine(wf, p.entry);
    this.scheduleEmit(wf);
  }

  removeSession(sessionId: string): void {
    if (!this.workflows.delete(sessionId)) return;
    // Cancel pending debounce emits and free per-run bookkeeping for this session,
    // else a queued 'workflow-updated' fires after 'workflow-removed' and the client
    // resurrects the card (and scriptState/attempts would leak over long uptime).
    const prefix = `${sessionId}:`;
    for (const [key, timer] of this.timers) {
      if (key.startsWith(prefix)) { clearTimeout(timer); this.timers.delete(key); }
    }
    for (const key of this.scriptState.keys()) if (key.startsWith(prefix)) this.scriptState.delete(key);
    for (const key of this.scriptAttempts.keys()) if (key.startsWith(prefix)) this.scriptAttempts.delete(key);
    this.emit('workflow-removed', { sessionId });
  }

  listWorkflows(): WorkflowRunProjection[] {
    const now = this.now();
    const out: WorkflowRunProjection[] = [];
    for (const bySession of this.workflows.values()) {
      for (const wf of bySession.values()) out.push(projectWorkflow(wf, now));
    }
    return out.sort((a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0));
  }

  getWorkflow(sessionId: string, workflowId: string): WorkflowRunProjection | null {
    const wf = this.workflows.get(sessionId)?.get(workflowId);
    return wf ? projectWorkflow(wf, this.now()) : null;
  }

  private ensure({ sessionId, projectSlug, workflowId }: { sessionId: string; projectSlug: string; workflowId: string }): WorkflowFold {
    let bySession = this.workflows.get(sessionId);
    if (!bySession) { bySession = new Map(); this.workflows.set(sessionId, bySession); }
    let wf = bySession.get(workflowId);
    if (!wf) { wf = createWorkflow({ sessionId, projectSlug, workflowId }); bySession.set(workflowId, wf); }
    return wf;
  }

  // Best-effort: read the workflow script, parse it, attach meta, then re-emit
  // (labels/phases only appear once the script is available). Retryable — if the
  // first agent/journal event beats the `workflows/scripts/*-wf_X.js` file to disk,
  // a null read leaves the run un-latched so the next event retries, up to a cap.
  private maybeLoadScript(wf: WorkflowFold, filePath: string): void {
    const key = `${wf.sessionId}:${wf.workflowId}`;
    const state = this.scriptState.get(key);
    if (state === 'loaded' || state === 'loading') return;
    const attempts = this.scriptAttempts.get(key) ?? 0;
    if (attempts >= MAX_SCRIPT_ATTEMPTS) { this.scriptState.set(key, 'loaded'); return; } // give up, stay best-effort
    this.scriptState.set(key, 'loading');
    this.scriptAttempts.set(key, attempts + 1);
    Promise.resolve(this.readScript(filePath, wf.workflowId))
      .then((text) => {
        if (text) { this.scriptState.set(key, 'loaded'); applyMeta(wf, parseWorkflowScript(text)); this.scheduleEmit(wf); }
        else this.scriptState.delete(key); // not on disk yet — allow the next event to retry
      })
      .catch(() => this.scriptState.delete(key));
  }

  private scheduleEmit(wf: WorkflowFold): void {
    const key = `${wf.sessionId}:${wf.workflowId}`;
    if (this.debounceMs <= 0) { this.emit('workflow-updated', projectWorkflow(wf, this.now())); return; }
    if (this.timers.has(key)) return;
    const t = setTimeout(() => {
      this.timers.delete(key);
      this.emit('workflow-updated', projectWorkflow(wf, this.now()));
    }, this.debounceMs);
    t.unref?.();
    this.timers.set(key, t);
  }
}

// Narrow the watcher's opaque sibling-meta.json payload to the two fields this
// module cares about — the JSON/transcript boundary the fold math trusts.
function narrowAgentMeta(raw: unknown): WorkflowFoldAgentMeta | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  return {
    agentType: typeof r.agentType === 'string' ? r.agentType : undefined,
    spawnDepth: typeof r.spawnDepth === 'number' ? r.spawnDepth : undefined,
  };
}

// Project the internal aggregate into the read-only shape the API/SSE/view use.
export function projectWorkflow(wf: WorkflowFold, now: number): WorkflowRunProjection {
  const agents = [...wf.agents.values()].map((a) => ({
    agentId: a.agentId, label: a.label, phase: a.phase, agentType: a.agentType, spawnDepth: a.spawnDepth,
    status: agentStatus(a, now), tokens: a.tokens, toolCount: a.toolCount, startedAt: a.startedAt,
    durationMs: a.startedAt != null && a.lastAt != null ? Math.max(0, a.lastAt - a.startedAt) : 0,
  }));
  const startedAts = agents.map((a) => a.startedAt).filter((x): x is number => x != null);
  const lastAts = [...wf.agents.values()].map((a) => a.lastAt).filter((x): x is number => x != null);
  return {
    sessionId: wf.sessionId, projectSlug: wf.projectSlug, workflowId: wf.workflowId,
    name: wf.meta?.name ?? null, description: wf.meta?.description ?? null, phases: wf.meta?.phases ?? [],
    status: workflowStatus(wf, now),
    agentCount: agents.length,
    running: agents.filter((a) => a.status === 'running').length,
    done: agents.filter((a) => a.status === 'done').length,
    tokensTotal: agents.reduce((s, a) => s + a.tokens, 0),
    toolsTotal: agents.reduce((s, a) => s + a.toolCount, 0),
    startedAt: startedAts.length ? Math.min(...startedAts) : null,
    lastActivityAt: lastAts.length ? Math.max(...lastAts) : null,
    agents,
  };
}

// Derive the workflow's script path from a workflow file path:
//   <sessionDir>/subagents/workflows/wf_X/... → <sessionDir>/workflows/scripts/*-wf_X.js
async function readScriptFromDisk(filePath: string, workflowId: string): Promise<string | null> {
  const marker = `${path.sep}subagents${path.sep}`;
  const i = filePath.indexOf(marker);
  if (i < 0) return null;
  const scriptsDir = path.join(filePath.slice(0, i), 'workflows', 'scripts');
  try {
    const names = await fs.readdir(scriptsDir);
    const hit = names.find((n) => n.endsWith(`-${workflowId}.js`));
    return hit ? await fs.readFile(path.join(scriptsDir, hit), 'utf8') : null;
  } catch {
    return null;
  }
}

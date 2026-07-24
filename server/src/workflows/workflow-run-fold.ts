// Pure fold: turn the raw workflow-journal + workflow-agent event streams into a
// per-run aggregate. No fs, no timers, no EventEmitter — all of that lives in
// workflow-registry.ts, so this math is unit-testable in isolation.
//
// A workflow aggregate:
//   { sessionId, projectSlug, workflowId, meta|null, typeCounters, agents:Map }
// agent row: { agentId, agentType, spawnDepth, label, phase, status,
//              tokens, toolCount, startedAt, lastAt }

import type { TranscriptEntry, WorkflowAgentStatus, WorkflowPhaseSpec, WorkflowRunStatus } from '../../../shared/types/index.js';
import type { WorkflowScriptAgentSpec } from './workflow-script-parser.js';

const IDLE_MS = 90_000; // an agent silent this long (still no result) reads as idle

// Meta parsed from the workflow's script (see workflow-script-parser.ts). Wider
// than ParsedWorkflowScript's non-nullable fields so applyMeta's runtime guard
// (`meta && typeof meta === 'object'`) can accept any well-formed-enough object.
export interface WorkflowFoldMeta {
  name?: string | null;
  description?: string | null;
  phases?: WorkflowPhaseSpec[];
  agentSpecs?: WorkflowScriptAgentSpec[];
}

// Sibling agent-<id>.meta.json shape, narrowed at the transcript-watcher boundary.
export interface WorkflowFoldAgentMeta {
  agentType?: string;
  spawnDepth?: number;
}

export interface WorkflowFoldAgent {
  agentId: string;
  agentType: string | null;
  spawnDepth: number | null;
  label: string | null;
  phase: string | null;
  status: 'running' | 'done';
  tokens: number;
  toolCount: number;
  startedAt: number | null;
  lastAt: number | null;
  bucketIndex: number | null;
}

export interface WorkflowFold {
  sessionId: string;
  projectSlug: string;
  workflowId: string;
  meta: WorkflowFoldMeta | null;
  typeCounters: Record<string, number>;
  agents: Map<string, WorkflowFoldAgent>;
}

export function createWorkflow(
  { sessionId, projectSlug, workflowId }: { sessionId: string; projectSlug: string; workflowId: string },
): WorkflowFold {
  return { sessionId, projectSlug, workflowId, meta: null, typeCounters: {}, agents: new Map() };
}

// Attach parsed script meta once, then (re)associate every agent already seen.
export function applyMeta(wf: WorkflowFold, meta: unknown): WorkflowFold {
  wf.meta = meta && typeof meta === 'object' ? meta as WorkflowFoldMeta : null;
  for (const agent of wf.agents.values()) associate(wf, agent);
  return wf;
}

// Journal line → per-agent lifecycle status (running until its `result` lands).
export function applyJournalLine(wf: WorkflowFold, entry: TranscriptEntry): WorkflowFold {
  if (entry.kind !== 'event') return wf;
  const { type, agentId } = entry.event;
  if (typeof agentId !== 'string' || !agentId) return wf;
  const a = ensureAgent(wf, agentId, null);
  if (type === 'result') a.status = 'done';
  else if (type === 'started' && a.status !== 'done') a.status = 'running';
  return wf;
}

// Agent transcript line → tokens (output), tool_use count, and time span. Mirrors
// session-metrics.recordUsage / tool-call-summarizer token+tool accounting.
export function applyAgentEvent(
  wf: WorkflowFold,
  agentId: string,
  agentMeta: WorkflowFoldAgentMeta | null,
  entry: TranscriptEntry,
): WorkflowFold {
  if (entry.kind !== 'event') return wf;
  const ev = entry.event;
  const a = ensureAgent(wf, agentId, agentMeta);
  const ts = Date.parse(ev.timestamp ?? '');
  if (Number.isFinite(ts)) {
    if (a.startedAt == null || ts < a.startedAt) a.startedAt = ts;
    if (a.lastAt == null || ts > a.lastAt) a.lastAt = ts;
  }
  const usage = ev.message?.usage;
  if (usage && typeof usage === 'object') a.tokens += Number(usage.output_tokens) || 0;
  const content = ev.message?.content;
  if (Array.isArray(content)) {
    for (const b of content) if (isToolUseBlock(b)) a.toolCount += 1;
  }
  return wf;
}

function isToolUseBlock(b: unknown): boolean {
  return Boolean(b) && typeof b === 'object' && (b as { type?: unknown }).type === 'tool_use';
}

function ensureAgent(wf: WorkflowFold, agentId: string, agentMeta: WorkflowFoldAgentMeta | null): WorkflowFoldAgent {
  let a = wf.agents.get(agentId);
  if (!a) {
    a = {
      agentId, agentType: agentMeta?.agentType ?? null, spawnDepth: agentMeta?.spawnDepth ?? null,
      label: null, phase: null, status: 'running', tokens: 0, toolCount: 0,
      startedAt: null, lastAt: null, bucketIndex: null,
    };
    wf.agents.set(agentId, a);
    associate(wf, a);
  } else if (a.agentType == null && agentMeta?.agentType) {
    a.agentType = agentMeta.agentType;
    a.spawnDepth = agentMeta.spawnDepth ?? a.spawnDepth;
    associate(wf, a);
  }
  return a;
}

// Assign label/phase by agentType-bucket + positional order against the parsed
// script specs. Metrics stay keyed by the real agentId (always correct); only the
// fine label may swap inside a same-agentType parallel group. A dynamic runtime
// agent count (script `.map`) beyond the static specs caps to the bucket's last
// spec — phase stays correct while the dynamic group is the bucket's tail.
function associate(wf: WorkflowFold, a: WorkflowFoldAgent): void {
  if (!wf.meta || a.agentType == null) return;
  if (a.bucketIndex == null) {
    a.bucketIndex = wf.typeCounters[a.agentType] ?? 0;
    wf.typeCounters[a.agentType] = a.bucketIndex + 1;
  }
  const specs = (wf.meta.agentSpecs ?? []).filter((s) => s.agentType === a.agentType);
  if (specs.length === 0) return;
  const spec = specs[Math.min(a.bucketIndex, specs.length - 1)];
  a.label = spec.label;
  a.phase = spec.phase;
}

// Derived per-agent status with an idle overlay (running but long silent).
export function agentStatus(a: WorkflowFoldAgent, now: number): WorkflowAgentStatus {
  if (a.status === 'done') return 'done';
  if (a.lastAt != null && now - a.lastAt > IDLE_MS) return 'idle';
  return 'running';
}

// Workflow is running while any agent is running (and recently active); else done.
export function workflowStatus(wf: WorkflowFold, now: number): WorkflowRunStatus {
  let anyRunning = false;
  for (const a of wf.agents.values()) if (agentStatus(a, now) === 'running') anyRunning = true;
  return anyRunning ? 'running' : 'done';
}

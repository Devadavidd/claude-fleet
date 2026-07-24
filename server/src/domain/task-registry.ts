// Folds Claude Code's TaskCreate / TaskUpdate tool calls into a per-session task
// registry so the fleet board can render the team's kanban. The transcript
// schema is Claude-Code-internal, so every helper is fail-open: malformed or
// unknown shapes are ignored, never thrown.
//
// TaskCreate's assigned id ("#N") lives in the *tool_result*, not the tool_use,
// so a create is stashed by its tool_use id (state.taskCreates) and resolved
// once that result arrives (resolveTaskCreateResult). TaskUpdate carries the id
// directly and mutates in place.

import type { KanbanColumn, TaskSummary } from '../../../shared/types/index.js';

const IN_PROGRESS = new Set(['in_progress', 'in-progress', 'active', 'running']);
// A TaskCreate whose tool_result is never seen (aborted turn, tail started mid-run)
// would otherwise stash forever. Bound it — oldest evicted first (Map keeps
// insertion order). Healthy transcripts resolve creates within a turn or two.
const MAX_PENDING_CREATES = 256;
// The activity log accumulates one entry per status transition. Bound it so a
// pathologically chatty session can't grow a task unboundedly; oldest dropped.
const MAX_HISTORY = 100;

/** One status transition in a task's bounded activity log. `kind` is only set
 * on the create-time seed entry — later transitions omit it (consumers default
 * to 'status', see fleet-overview-aggregator's activityOf). */
export interface TaskHistoryRecord {
  kind?: string;
  status: string;
  ts: number | null;
  owner: string | null;
}

/** Team kanban task folded from TaskCreate/TaskUpdate tool calls. */
export interface Task {
  id: string;
  subject: string;
  activeForm: string;
  description: string;
  priority: string;
  phase: string | number | null;
  planDir: string;
  phaseFile: string;
  blockedBy: string[];
  status: string;
  column: KanbanColumn;
  owner: string | null;
  createdAt: number | null;
  updatedAt: number | null;
  history: TaskHistoryRecord[];
}

/** A TaskCreate tool_use stashed by its tool_use id, awaiting the tool_result
 * that carries the assigned "#N" task id. */
export interface TaskCreateStash {
  input: Record<string, unknown>;
  owner: string | null;
  ts: number;
  activePlanDir: string;
}

/** Minimal shape of a transcript `tool_use` content block. */
export interface ToolUseBlock {
  type?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

/** Narrow slice of session state this module owns — the reducer's full
 * per-session state (session-state-reducer.ts) satisfies this structurally. */
export interface TaskRegistryState {
  tasks?: Map<string, Task>;
  taskCreates?: Map<string, TaskCreateStash>;
  activePlanDir?: string;
}

/** A task-like value with just the fields planFileSuffixes needs. */
export interface PlanFileRef {
  planDir?: string;
  phaseFile?: string;
}

// Maps a raw task status onto one of the three kanban columns. Unknown/absent
// statuses fall back to "pending" so a task is never dropped from the board.
export function columnFor(status?: string | null): KanbanColumn {
  const s = typeof status === 'string' ? status.toLowerCase() : '';
  if (s === 'completed' || s === 'done') return 'completed';
  if (IN_PROGRESS.has(s)) return 'in_progress';
  return 'pending';
}

interface EnsuredTaskRegistryState extends TaskRegistryState {
  tasks: Map<string, Task>;
  taskCreates: Map<string, TaskCreateStash>;
}

function ensureMaps(state: TaskRegistryState): asserts state is EnsuredTaskRegistryState {
  if (!(state.tasks instanceof Map)) state.tasks = new Map();
  if (!(state.taskCreates instanceof Map)) state.taskCreates = new Map();
}

// Handles a TaskCreate/TaskUpdate tool_use block. Safe to call for any tool_use —
// non-Task blocks are ignored.
export function applyTaskEvent(
  state: TaskRegistryState | null | undefined,
  block: ToolUseBlock | null | undefined,
  { owner = null, ts = 0 }: { owner?: string | null; ts?: number } = {},
): void {
  if (!state || !block || typeof block !== 'object') return;
  const input = block.input && typeof block.input === 'object' ? block.input : {};

  if (block.name === 'TaskCreate') {
    if (typeof block.id !== 'string') return;
    ensureMaps(state);
    // Snapshot the session's active plan AT CREATE TIME so a task is attributed to
    // the plan the session was on then, not whatever it moves to later. Recovers the
    // plan link for phase tasks created without explicit metadata.planDir.
    state.taskCreates.set(block.id, { input, owner, ts, activePlanDir: str(state.activePlanDir) });
    if (state.taskCreates.size > MAX_PENDING_CREATES) {
      const oldest = state.taskCreates.keys().next().value;
      if (oldest !== undefined) state.taskCreates.delete(oldest);
    }
    return;
  }

  if (block.name === 'TaskUpdate') {
    const id = input.taskId != null ? String(input.taskId) : null;
    if (!id) return;
    ensureMaps(state);
    const existing = state.tasks.get(id);
    if (existing) {
      // A later TaskUpdate can refine the free-text/metadata fields, not just the
      // status — merge them so the detail view reflects current state, not just
      // what was known at create time. Empty/absent values never clobber.
      mergeField(existing, 'description', input.description);
      mergeField(existing, 'subject', input.subject);
      mergeField(existing, 'activeForm', input.activeForm);
      mergeMeta(existing, input.metadata);
      mergeBlockedBy(existing, input.addBlockedBy);
      // Owner of this transition: the update's explicit owner, else the emitter.
      const eventOwner = (typeof input.owner === 'string' && input.owner) ? input.owner : owner;
      if (typeof input.status === 'string') {
        existing.status = input.status;
        existing.column = columnFor(input.status);
        pushHistory(existing, input.status, ts, eventOwner);
      }
      if (typeof input.owner === 'string' && input.owner) existing.owner = input.owner;
      else if (owner && !existing.owner) existing.owner = owner;
      if (ts) existing.updatedAt = ts;
    } else {
      // Update arrived before we resolved the create (or the create was never
      // seen) — register a fail-open stub so the task still shows on the board.
      state.tasks.set(id, buildTask(id, {}, {
        status: typeof input.status === 'string' ? input.status : 'pending',
        owner: (typeof input.owner === 'string' && input.owner) || owner,
        ts,
        fallbackPlanDir: str(state.activePlanDir),
      }));
    }
  }
}

// Correlates a TaskCreate's tool_result (which carries the assigned "#N" id)
// with the stashed tool_use input, registering the full task under that id.
export function resolveTaskCreateResult(
  state: TaskRegistryState | null | undefined,
  toolUseId: unknown,
  resultContent: unknown,
  owner: string | null = null,
): void {
  if (!state || typeof toolUseId !== 'string') return;
  ensureMaps(state);
  const stash = state.taskCreates.get(toolUseId);
  if (!stash) return;
  state.taskCreates.delete(toolUseId);
  const id = parseTaskId(resultContent);
  if (!id) return;
  // A TaskUpdate may have raced ahead and left a stub — preserve its status/owner.
  const prior = state.tasks.get(id);
  const task = buildTask(id, stash.input, {
    owner: stash.owner || owner, ts: stash.ts, fallbackPlanDir: stash.activePlanDir,
  });
  if (prior) {
    if (prior.status) { task.status = prior.status; task.column = columnFor(prior.status); }
    if (prior.owner) task.owner = prior.owner;
    if (prior.updatedAt) task.updatedAt = prior.updatedAt;
    // The stub captured the real transition sequence before the create resolved —
    // keep it rather than the create's lone seed entry.
    if (Array.isArray(prior.history) && prior.history.length) task.history = prior.history;
  }
  state.tasks.set(id, task);
}

// Compact per-column counts for the board card. Never throws on a task-less or
// malformed state.
export function taskSummaryFor(state: TaskRegistryState | null | undefined): TaskSummary {
  const summary: TaskSummary = { total: 0, pending: 0, in_progress: 0, completed: 0 };
  if (!state || !(state.tasks instanceof Map)) return summary;
  for (const task of state.tasks.values()) {
    summary.total += 1;
    const col = task.column || columnFor(task.status);
    if (summary[col] != null) summary[col] += 1;
  }
  return summary;
}

function buildTask(
  id: string,
  input: Record<string, unknown>,
  { status = 'pending', owner = null, ts = 0, fallbackPlanDir = '' }:
    { status?: string; owner?: string | null; ts?: number; fallbackPlanDir?: string } = {},
): Task {
  const src = input && typeof input === 'object' ? input : {};
  const meta = src.metadata && typeof src.metadata === 'object' ? src.metadata as Record<string, unknown> : {};
  const subject = str(src.subject);
  return {
    id,
    subject: subject || `(task ${id})`,
    activeForm: str(src.activeForm),
    description: str(src.description),
    priority: str(src.priority) || str(meta.priority),
    // Explicit metadata always wins; else infer the phase ordinal from a
    // "Phase N: …" subject so metadata-less phase tasks still nest under a phase.
    phase: meta.phase != null ? (meta.phase as string | number) : phaseFromSubject(subject),
    // Explicit metadata.planDir wins; else inherit the session's active plan so a
    // task created without a plan reference still links to the plan on the board.
    planDir: str(meta.planDir) || str(fallbackPlanDir),
    phaseFile: str(meta.phaseFile),
    blockedBy: normalizeIds(src.addBlockedBy),
    status,
    column: columnFor(status),
    owner: owner || null,
    createdAt: ts || null,
    updatedAt: ts || null,
    // Activity log seed. Only meaningful with a timestamp — a create/update with
    // an unknown ts contributes no dated entry.
    history: ts ? [{ kind: 'created', status, ts, owner: owner || null }] : [],
  };
}

// Merge a free-text field from a TaskUpdate only when the incoming value is a
// non-empty string — an absent or empty field must never clobber a good value.
function mergeField(task: Task, key: 'description' | 'subject' | 'activeForm', val: unknown): void {
  if (typeof val === 'string' && val) task[key] = val;
}

// Merge the metadata a later TaskUpdate may carry (priority/phase/phaseFile/planDir).
function mergeMeta(task: Task, metadata: unknown): void {
  if (!metadata || typeof metadata !== 'object') return;
  const m = metadata as Record<string, unknown>;
  if (typeof m.priority === 'string' && m.priority) task.priority = m.priority;
  if (m.phase != null) task.phase = m.phase as string | number;
  if (typeof m.phaseFile === 'string' && m.phaseFile) task.phaseFile = m.phaseFile;
  if (typeof m.planDir === 'string' && m.planDir) task.planDir = m.planDir;
}

// Union new blocked-by ids into the task, de-duplicated and bounded like the
// create-time normalizeIds.
function mergeBlockedBy(task: Task, addBlockedBy: unknown): void {
  const add = normalizeIds(addBlockedBy);
  if (!add.length) return;
  if (!Array.isArray(task.blockedBy)) task.blockedBy = [];
  for (const id of add) if (!task.blockedBy.includes(id)) task.blockedBy.push(id);
}

// Append a status transition to the activity log. A re-sent identical status is
// not a transition, so it is skipped; the log is bounded (oldest dropped).
function pushHistory(task: Task, status: string, ts: number, owner: string | null): void {
  if (!Array.isArray(task.history)) task.history = [];
  const last = task.history[task.history.length - 1];
  if (last && last.status === status) return;
  task.history.push({ status, ts: ts || null, owner: owner || null });
  if (task.history.length > MAX_HISTORY) task.history.shift();
}

// Candidate relative path suffixes for a task's plan reference, most-specific
// first. The stored planDir is relative and its real root can differ from the
// session cwd (cross-project team sessions), so the reducer matches these against
// the tracked-file registry to find the actual absolute path rather than build
// one. Empty when there's no plan reference.
export function planFileSuffixes(task?: PlanFileRef | null): string[] {
  if (!task || !task.planDir) return [];
  const dir = String(task.planDir).replace(/\/+$/, '');
  const out: string[] = [];
  if (task.phaseFile) out.push(`${dir}/${task.phaseFile}`);
  out.push(`${dir}/plan.md`);
  return out;
}

// The leading "Phase N" of a task subject → its numeric ordinal. Zero-padding is
// tolerated ("Phase 01"). Non-phase subjects yield null (no phase inferred).
function phaseFromSubject(subject: string): number | null {
  const m = /^\s*phase\s+0*(\d+)\b/i.exec(typeof subject === 'string' ? subject : '');
  return m ? Number(m[1]) : null;
}

function parseTaskId(content: unknown): string | null {
  const m = /Task #(\d+)/i.exec(textOf(content));
  return m ? m[1] : null;
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (typeof b === 'string' ? b : (b && typeof b.text === 'string' ? b.text : '')))
      .join(' ');
  }
  return '';
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function normalizeIds(v: unknown): string[] {
  if (Array.isArray(v)) return v.slice(0, 20).map((x) => String(x));
  if (v != null && typeof v !== 'object') return [String(v)];
  return [];
}

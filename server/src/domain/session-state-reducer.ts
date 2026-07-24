import { EventEmitter } from 'node:events';
import type {
  PendingQuestion,
  PendingQuestionItem,
  SessionCard,
  SessionStatus,
  SubagentCard,
  TranscriptEntry,
  TranscriptEvent,
} from '../../../shared/types/index.js';
import { summarizeToolUse } from './tool-call-summarizer.js';
import { initMetrics, recordUsage, recordFileTouch, recordReadable, tokensForCard } from './session-metrics.js';
import type { TokenTotals, FileTouch } from './session-metrics.js';
import { applyTaskEvent, resolveTaskCreateResult, taskSummaryFor, planFileSuffixes } from './task-registry.js';
import type { Task, TaskCreateStash } from './task-registry.js';
import { phaseFromSkill } from './workflow-phase.js';

/** Loosely-shaped transcript content block (tool_use / tool_result / text) —
 * the schema is Claude-Code-internal, so every field is optional and every
 * consumer narrows defensively before use. */
interface ContentBlock {
  type?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  text?: string;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
}

/** Metadata the watcher attaches to a subagent transcript event. */
export interface AgentMeta {
  agentType?: string;
  description?: string;
  toolUseId?: string | null;
}

/** Per-session fleet-board state folded from the watcher's event stream. */
export interface SessionState {
  sessionId: string;
  projectSlug: string;
  title: string;
  firstPrompt: string;
  status: SessionStatus;
  currentAction: string;
  filesTouched: Set<string>;
  subagentCount: number;
  subagents: Map<string, SubagentCard>;
  pendingToolUses: Set<string>;
  pendingQuestion: PendingQuestion | null;
  tasks: Map<string, Task>;
  taskCreates: Map<string, TaskCreateStash>;
  workflowPhase: string;
  cwd: string;
  activePlanDir: string;
  lastActivityAt: number | null;
  tokens: TokenTotals;
  tokenBuckets: Map<number, number>;
  fileTouches: Map<string, FileTouch>;
  readableFiles: Set<string>;
}

export interface SessionStateReducerOptions {
  idleMinutes?: number;
  debounceMs?: number;
  now?: () => number;
}

interface SessionStateReducerEventMap {
  'session-updated': [card: SessionCard];
  'session-removed': [payload: { sessionId: string }];
}

// Reduces the watcher's event stream into per-session fleet-board state and
// emits debounced 'session-updated' cards. Pure logic lives in applyEvent so
// it can be unit-tested without timers or filesystem.
export class SessionStateReducer extends EventEmitter<SessionStateReducerEventMap> {
  private readonly idleMs: number;
  private readonly debounceMs: number;
  private readonly now: () => number;
  private readonly sessions: Map<string, SessionState>;
  private readonly pendingEmits: Map<string, NodeJS.Timeout>;

  constructor({ idleMinutes = 5, debounceMs = 300, now = Date.now }: SessionStateReducerOptions = {}) {
    super();
    this.idleMs = idleMinutes * 60_000;
    this.debounceMs = debounceMs;
    this.now = now;
    this.sessions = new Map(); // sessionId -> state
    this.pendingEmits = new Map(); // sessionId -> timeout
  }

  ingest({ projectSlug, sessionId, agentId, agentMeta, entry }: {
    projectSlug: string;
    sessionId: string;
    agentId?: string;
    agentMeta?: AgentMeta;
    entry: TranscriptEntry;
  }): void {
    const state = this.getOrCreate(sessionId, projectSlug);
    if (agentId) applyAgentEvent(state, agentId, agentMeta, entry);
    else applyEvent(state, entry);
    this.scheduleEmit(sessionId);
  }

  removeAgent(sessionId: string, agentId: string): void {
    const state = this.sessions.get(sessionId);
    if (state?.subagents.delete(agentId)) this.scheduleEmit(sessionId);
  }

  removeSession(sessionId: string): void {
    if (!this.sessions.delete(sessionId)) return;
    clearTimeout(this.pendingEmits.get(sessionId));
    this.pendingEmits.delete(sessionId);
    this.emit('session-removed', { sessionId });
  }

  listCards(): SessionCard[] {
    return [...this.sessions.values()]
      .map((s) => this.toCard(s))
      .sort((a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0));
  }

  listStates(): SessionState[] {
    return [...this.sessions.values()];
  }

  // Absolute project roots seen across the fleet (from transcript cwd). Feeds the wiki
  // reader so the "Shipped" tab can scan each project's plans/ + docs/wiki/.
  listProjectRoots(): string[] {
    return [...new Set([...this.sessions.values()].map((s) => s.cwd).filter(Boolean))];
  }

  /** The working directory a session's transcript reports — where a resume must run. */
  sessionCwd(sessionId: string): string | null {
    return this.sessions.get(sessionId)?.cwd || null;
  }

  /** Last transcript activity (ms epoch) — guards resume against a session still live elsewhere. */
  sessionLastActivityAt(sessionId: string): number | null {
    return this.sessions.get(sessionId)?.lastActivityAt ?? null;
  }

  toCard(state: SessionState): SessionCard {
    return {
      sessionId: state.sessionId,
      projectSlug: state.projectSlug,
      title: state.title || state.firstPrompt || state.sessionId,
      status: this.effectiveStatus(state),
      currentAction: state.currentAction,
      filesTouched: [...state.filesTouched],
      subagentCount: Math.max(state.subagentCount, state.subagents.size),
      pendingQuestion: state.pendingQuestion,
      agents: [...state.subagents.values()]
        .sort((a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0))
        .map((agent) => ({
          ...agent,
          // A "running" worker that went silent is stalled or dead — overlay
          // idle the same way sessions do, so the board never lies.
          status: agent.status === 'running' && agent.lastActivityAt
            && this.now() - agent.lastActivityAt > this.idleMs ? 'idle' : agent.status,
        })),
      lastActivityAt: state.lastActivityAt,
      tokens: tokensForCard(state, this.now()),
      taskSummary: taskSummaryFor(state),
      workflowPhase: state.workflowPhase || null,
    };
  }

  // Full team task list for the kanban endpoint, sorted by numeric id. Returns
  // null for an unknown session so the route can 404; [] for a session with no
  // tasks yet.
  listTasks(sessionId: string): Array<Task & { planPath: string }> | null {
    const state = this.sessions.get(sessionId);
    if (!state) return null;
    const tasks = state.tasks instanceof Map ? [...state.tasks.values()] : [];
    // Resolve each plan reference to a real tracked file at serve time — the file
    // viewer serves tracked absolute paths, so a relative dir link never opens.
    // Computed fresh; stored tasks untouched.
    return tasks
      .sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0))
      .map((t) => ({ ...t, planPath: this.resolvePlanPath(t) }));
  }

  // Every team task across the whole fleet, flattened with its owning session and a
  // resolved plan path — feeds the Overview aggregator (Plan→Phase→Task tree + activity).
  // Fail-open: sessions without a task Map contribute nothing.
  listFleetTasks(): Array<Task & { sessionId: string; sessionTitle: string; planPath: string }> {
    const out: Array<Task & { sessionId: string; sessionTitle: string; planPath: string }> = [];
    for (const state of this.sessions.values()) {
      if (!(state.tasks instanceof Map)) continue;
      const sessionTitle = state.title || state.firstPrompt || state.sessionId;
      for (const task of state.tasks.values()) {
        out.push({ ...task, sessionId: state.sessionId, sessionTitle, planPath: this.resolvePlanPath(task) });
      }
    }
    return out;
  }

  // Find the real absolute path for a task's plan reference by matching its
  // candidate suffixes against files any session actually read/wrote (the same
  // set the /api/file viewer serves). The stored planDir is relative and its root
  // can differ from the session cwd, so we locate the tracked file rather than
  // construct a path. Prefers the specific phase file, then plan.md, then any
  // tracked file inside the plan dir; '' when nothing matches (UI shows text).
  private resolvePlanPath(task: Task): string {
    const suffixes = planFileSuffixes(task);
    if (!suffixes.length) return '';
    const dirTag = `${String(task.planDir).replace(/\/+$/, '')}/`;
    const files: string[] = [];
    for (const state of this.sessions.values()) {
      if (state.readableFiles instanceof Set) files.push(...state.readableFiles);
    }
    // Try each suffix in priority order (specific phase file, then plan.md)
    // across every tracked file — so specificity wins over file iteration order.
    for (const suf of suffixes) {
      const hit = files.find((f) => f.endsWith(suf));
      if (hit) return hit;
    }
    return files.find((f) => f.includes(dirTag)) || ''; // any tracked file in the plan dir
  }

  private effectiveStatus(state: SessionState): SessionStatus {
    // A session blocked on YOUR answer is never "idle" — it must stay in the
    // Waiting column no matter how long it has sat unanswered.
    if (state.pendingQuestion) return 'waiting-for-you';
    if (state.lastActivityAt && this.now() - state.lastActivityAt > this.idleMs) return 'idle';
    return state.status;
  }

  private getOrCreate(sessionId: string, projectSlug: string): SessionState {
    let state = this.sessions.get(sessionId);
    if (!state) {
      state = {
        sessionId,
        projectSlug,
        title: '',
        firstPrompt: '',
        status: 'idle',
        currentAction: '',
        filesTouched: new Set(),
        subagentCount: 0,
        subagents: new Map(), // agentId -> live worker sub-state
        pendingToolUses: new Set(),
        pendingQuestion: null, // unanswered AskUserQuestion/ExitPlanMode
        tasks: new Map(), // taskId -> team kanban task (from TaskCreate/TaskUpdate)
        taskCreates: new Map(), // tool_use id -> stashed TaskCreate input awaiting its result id
        workflowPhase: '', // best-effort CK stage (plan|cook|test|review|ship) from Skill calls
        cwd: '', // absolute project root (from transcript cwd) — powers the wiki reader
        activePlanDir: '', // plan dir the session is on (from the Plan Context hook) — links metadata-less tasks
        lastActivityAt: null,
        tokens: { output: 0, cacheRead: 0, cacheCreate: 0 },
        tokenBuckets: new Map(),
        fileTouches: new Map(),
        readableFiles: new Set(),
      };
      initMetrics(state);
      this.sessions.set(sessionId, state);
    }
    return state;
  }

  private scheduleEmit(sessionId: string): void {
    if (this.pendingEmits.has(sessionId)) return;
    const timeout = setTimeout(() => {
      this.pendingEmits.delete(sessionId);
      const state = this.sessions.get(sessionId);
      if (state) this.emit('session-updated', this.toCard(state));
    }, this.debounceMs);
    if (typeof timeout === 'object') timeout.unref?.();
    this.pendingEmits.set(sessionId, timeout);
  }
}

// Mutates state from one parsed transcript entry. Exported for unit tests.
export function applyEvent(state: SessionState, entry: TranscriptEntry): void {
  if (entry.kind !== 'event') return; // raw lines carry no state signal
  const event = entry.event;
  const ts = Date.parse(event.timestamp ?? '') || null;
  if (ts) state.lastActivityAt = ts;
  // Transcript lines carry the working directory — capture the real project root once.
  if (!state.cwd && typeof event.cwd === 'string' && event.cwd) state.cwd = event.cwd;
  // The CK hook injects the session's current plan on each turn — track the latest so
  // metadata-less phase tasks created afterward inherit it (see task-registry buildTask).
  const activePlanDir = activePlanDirFromEvent(event);
  if (activePlanDir) state.activePlanDir = activePlanDir;

  switch (event.type) {
    case 'custom-title':
      if (typeof event.customTitle === 'string' && event.customTitle) state.title = event.customTitle;
      return;
    case 'user':
      applyUserEvent(state, event);
      return;
    case 'assistant':
      applyAssistantEvent(state, event);
      return;
    default:
      return; // attachment / system / queue-operation etc. only bump lastActivityAt
  }
}

// Subagent transcripts stream from <session>/subagents/agent-<id>.jsonl.
// Worker activity keeps the parent session "working" even while the lead's
// own turn is silent. Exported for unit tests.
export function applyAgentEvent(
  state: SessionState,
  agentId: string,
  agentMeta: AgentMeta | null | undefined,
  entry: TranscriptEntry,
): void {
  if (entry.kind !== 'event') return;
  const event = entry.event;
  let agent = state.subagents.get(agentId);
  if (!agent) {
    agent = {
      agentId,
      label: agentMeta?.description || agentMeta?.agentType || agentId,
      agentType: agentMeta?.agentType ?? '',
      // Lets the lead timeline map its Task tool_use block to this worker.
      toolUseId: agentMeta?.toolUseId ?? null,
      status: 'running',
      currentAction: 'starting',
      lastActivityAt: null,
    };
    state.subagents.set(agentId, agent);
  }
  const ts = Date.parse(event.timestamp ?? '') || null;
  if (ts) {
    agent.lastActivityAt = ts;
    state.lastActivityAt = Math.max(state.lastActivityAt ?? 0, ts);
  }
  if (event.type === 'assistant') {
    recordUsage(state, event); // worker burn counts toward the parent session
    const blocks = contentBlocks(event.message?.content);
    const toolUses = blocks.filter((b) => b.type === 'tool_use');
    for (const block of toolUses) {
      const summary = summarizeToolUse(block);
      agent.currentAction = summary.summary;
      if (summary.isFileWrite && summary.filePath) {
        state.filesTouched.add(summary.filePath);
        recordFileTouch(state, summary.filePath, ts ?? 0);
      }
      if (summary.filePath && (summary.isFileWrite || summary.isFileRead)) {
        recordReadable(state, summary.filePath);
      }
      // A worker managing the team task list owns the tasks it touches.
      applyTaskEvent(state, block, { owner: agent.label, ts: ts ?? 0 });
    }
    if (toolUses.length > 0) {
      agent.status = 'running';
      state.status = 'working';
    } else if (blocks.some((b) => b.type === 'text')) {
      // A subagent's final plain-text turn IS its return value.
      agent.status = 'done';
      agent.currentAction = 'returned result';
    }
  } else if (event.type === 'user') {
    agent.status = 'running';
    const blocks = contentBlocks(event.message?.content);
    for (const result of blocks.filter((b) => b.type === 'tool_result')) {
      resolveTaskCreateResult(state, result.tool_use_id, result.content, agent.label);
    }
  }
}

function applyUserEvent(state: SessionState, event: TranscriptEvent): void {
  const blocks = contentBlocks(event.message?.content);
  const results = blocks.filter((b) => b.type === 'tool_result');
  for (const result of results) {
    if (result.tool_use_id) state.pendingToolUses.delete(result.tool_use_id);
    // A TaskCreate's assigned id arrives here in the result — register the task.
    resolveTaskCreateResult(state, result.tool_use_id, result.content, 'lead');
    // The answer to a surfaced question just arrived — clear it and resume.
    // EXCEPT an is_error result: a headless (dashboard-launched) session can't
    // render the question dialog, so the harness instantly errors the tool
    // call while the model keeps waiting for the choice as its next user
    // message. Keep the question on the card so the web chips can answer it —
    // the answering user message clears it below (same as an interactive
    // escape/cancel, where the session is genuinely still waiting on you).
    if (state.pendingQuestion && state.pendingQuestion.toolUseId === result.tool_use_id && result.is_error !== true) {
      state.pendingQuestion = null;
      state.status = 'working';
    }
  }
  if (results.length > 0) return; // tool feedback, not a human prompt

  const promptText = extractText(event.message?.content);
  if (promptText && !state.firstPrompt) state.firstPrompt = cleanPrompt(promptText);
  // Human just spoke — the assistant is now expected to work.
  state.pendingQuestion = null;
  state.status = 'working';
  state.currentAction = 'processing prompt';
}

// AskUserQuestion / ExitPlanMode block the session on YOU — pull the actual
// question + options onto the card so you can answer without opening the log.
function extractPendingQuestion(block: ContentBlock): Omit<PendingQuestion, 'askedAt'> | null {
  const input = block.input ?? {};
  if (block.name === 'AskUserQuestion' && Array.isArray(input.questions)) {
    const questions = input.questions as unknown[];
    return {
      toolUseId: block.id ?? '',
      kind: 'question',
      questions: questions.slice(0, 4).map((raw): PendingQuestionItem => {
        const q = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
        const options = Array.isArray(q.options) ? (q.options as unknown[]) : [];
        return {
          header: String(q.header ?? ''),
          question: String(q.question ?? ''),
          multiSelect: Boolean(q.multiSelect),
          options: options.slice(0, 6).map((o) => {
            const opt = (o && typeof o === 'object' ? o : {}) as Record<string, unknown>;
            return String(opt.label ?? '');
          }),
        };
      }),
    };
  }
  if (block.name === 'ExitPlanMode') {
    return {
      toolUseId: block.id ?? '',
      kind: 'plan',
      questions: [{
        header: 'Plan approval',
        question: 'Session is waiting for you to approve its plan.',
        multiSelect: false,
        options: [],
      }],
    };
  }
  return null;
}

function applyAssistantEvent(state: SessionState, event: TranscriptEvent): void {
  recordUsage(state, event);
  const blocks = contentBlocks(event.message?.content);
  const toolUses = blocks.filter((b) => b.type === 'tool_use');
  const ts = Date.parse(event.timestamp ?? '') || 0;
  for (const block of toolUses) {
    if (typeof block.id === 'string') state.pendingToolUses.add(block.id);
    const summary = summarizeToolUse(block);
    state.currentAction = summary.summary;
    if (summary.isFileWrite && summary.filePath) {
      state.filesTouched.add(summary.filePath);
      recordFileTouch(state, summary.filePath, ts);
    }
    if (summary.filePath && (summary.isFileWrite || summary.isFileRead)) {
      recordReadable(state, summary.filePath);
    }
    if (summary.isSubagent) state.subagentCount += 1;
    applyTaskEvent(state, block, { owner: 'lead', ts });
    const phase = phaseFromSkill(block);
    if (phase) state.workflowPhase = phase;
    const question = extractPendingQuestion(block);
    if (question) {
      state.pendingQuestion = { ...question, askedAt: ts };
      state.status = 'waiting-for-you';
    }
  }
  if (state.pendingQuestion) {
    // Blocked on a question — stay waiting regardless of other blocks.
    state.status = 'waiting-for-you';
    state.currentAction = `❓ ${state.pendingQuestion.questions[0]?.header || 'waiting for your answer'}`;
  } else if (toolUses.length > 0) {
    state.status = 'working';
  } else if (blocks.some((b) => b.type === 'text')) {
    // Plain text reply with no tool call: the assistant handed the turn back.
    state.status = 'waiting-for-you';
    state.currentAction = 'replied — waiting for your input';
  }
}

// The CK UserPromptSubmit hook writes a "## Plan Context — Plan: <abs plan dir>"
// block into an attachment entry on each human turn. Pull that plan dir out (ignoring
// the "none" sentinel) so a session's active plan is known even when task creators
// forget to tag TaskCreate with metadata.planDir. Scans only the attachment text and
// caps the slice so a large pasted attachment stays cheap.
function activePlanDirFromEvent(event: TranscriptEvent): string {
  const att = event.attachment;
  if (!att || typeof att !== 'object') return '';
  const record = att as Record<string, unknown>;
  for (const text of [record.content, record.stdout]) {
    if (typeof text !== 'string') continue;
    const m = /-\s*Plan:\s*(\S+)/.exec(text.slice(0, 8000));
    if (m && m[1] !== 'none' && m[1].includes('/plans/')) return m[1];
  }
  return '';
}

function contentBlocks(content: unknown): ContentBlock[] {
  return Array.isArray(content) ? (content as ContentBlock[]) : [];
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return (content as ContentBlock[])
    .filter((b) => b?.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join(' ');
}

// Slash-command turns arrive wrapped in <command-...> tags; strip them so the
// card title shows the human-readable prompt.
function cleanPrompt(text: string): string {
  const stripped = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return stripped.length > 60 ? `${stripped.slice(0, 60)}…` : stripped;
}

// Session board contract — mirrors src/session-state-reducer.js toCard() and
// the task registry projections. Declaration-only: erased at runtime, imported
// type-only by both server (nodenext) and client (bundler).

export type SessionStatus = 'working' | 'waiting-for-you' | 'idle';
export type AgentStatus = 'running' | 'done' | 'idle';
export type KanbanColumn = 'pending' | 'in_progress' | 'completed';

/** One question block of a pending AskUserQuestion / plan approval. */
export interface PendingQuestionItem {
  header: string;
  question: string;
  multiSelect: boolean;
  options: string[];
}

/** Unanswered AskUserQuestion / ExitPlanMode / permission prompt blocking the session. */
export interface PendingQuestion {
  toolUseId: string;
  kind: 'question' | 'plan' | 'permission';
  askedAt: number;
  questions: PendingQuestionItem[];
  /** Permission kind only: broker request id the Allow/Deny answer targets. */
  requestId?: string;
}

/** Live subagent worker row under a session card. */
export interface SubagentCard {
  agentId: string;
  label: string;
  agentType: string;
  toolUseId: string | null;
  status: AgentStatus;
  currentAction: string;
  lastActivityAt: number | null;
}

/** Token burn: totals plus a fixed 30-slot per-minute output series. */
export interface TokenStats {
  output: number;
  cacheRead: number;
  cacheCreate: number;
  perMin: number[];
}

/** Per-column task counts for the board card. */
export interface TaskSummary {
  total: number;
  pending: number;
  in_progress: number;
  completed: number;
}

/** One board card (snapshot + `session` SSE payloads, /api/sessions items). */
export interface SessionCard {
  sessionId: string;
  projectSlug: string;
  title: string;
  status: SessionStatus;
  currentAction: string;
  filesTouched: string[];
  subagentCount: number;
  pendingQuestion: PendingQuestion | null;
  agents: SubagentCard[];
  lastActivityAt: number | null;
  tokens: TokenStats;
  taskSummary: TaskSummary;
  workflowPhase: string | null;
  /** Present only on dashboard-launched sessions (adds Stop/steer controls). */
  launched?: boolean;
  steerable?: boolean;
  /** Model the launched child runs (fixed at spawn) — for the composer pill. */
  model?: string;
}

/** One status transition in a task's bounded activity log. */
export interface TaskHistoryEntry {
  kind: string;
  status: string;
  ts: number | null;
  owner: string | null;
}

/** Team kanban task (from TaskCreate/TaskUpdate folds). */
export interface TeamTask {
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
  history: TaskHistoryEntry[];
  /** Resolved at serve time against tracked files ('' when unresolved). */
  planPath?: string;
}

/** TeamTask flattened fleet-wide with its owning session (Overview feed). */
export interface FleetTask extends TeamTask {
  sessionId: string;
  sessionTitle: string;
}

/** /api/files heatmap entry (fleet-wide write aggregation). */
export interface FileTouchEntry {
  path: string;
  count: number;
  lastAt: number;
  sessions: Array<{ sessionId: string; title: string; lastAt: number }>;
}

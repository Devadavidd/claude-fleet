// Workflow run contract — mirrors src/workflow-registry.js projectWorkflow()
// (`workflow` SSE + /api/workflows payloads).

export type WorkflowAgentStatus = 'running' | 'done' | 'idle';
export type WorkflowRunStatus = 'running' | 'done';

export interface WorkflowPhaseSpec {
  title: string;
  detail?: string;
  model?: string;
}

export interface WorkflowAgent {
  agentId: string;
  label: string | null;
  phase: string | null;
  agentType: string;
  spawnDepth: number;
  status: WorkflowAgentStatus;
  tokens: number;
  toolCount: number;
  startedAt: number | null;
  durationMs: number;
}

export interface WorkflowRun {
  sessionId: string;
  projectSlug: string;
  workflowId: string;
  name: string | null;
  description: string | null;
  phases: WorkflowPhaseSpec[];
  status: WorkflowRunStatus;
  agentCount: number;
  running: number;
  done: number;
  tokensTotal: number;
  toolsTotal: number;
  startedAt: number | null;
  lastActivityAt: number | null;
  agents: WorkflowAgent[];
}

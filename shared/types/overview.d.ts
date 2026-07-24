// Fleet Overview contract — mirrors src/fleet-overview-aggregator.js
// buildOverview() (/api/overview response).

import type { KanbanColumn, TaskSummary } from './session-card.js';
import type { PlanPhase, PlanProgress } from './plan.js';

export interface OverviewRollup {
  plans: { total: number; shipped: number; active: number };
  tasks: TaskSummary;
  phases: { total: number; done: number };
  sessions: { total: number; working: number; waiting: number; idle: number };
  tokensOutput: number;
}

/** Live task as projected into the tree/activity panels. */
export interface OverviewTaskView {
  id: string;
  subject: string;
  description: string;
  status: string;
  column: KanbanColumn;
  owner: string | null;
  priority: string;
  phase: string | number | null;
  blockedBy: string[];
  planDir: string;
  phaseFile: string;
  planPath: string;
  sessionId: string | null;
  sessionTitle: string;
}

export interface OverviewPhaseNode extends PlanPhase {
  tasks: OverviewTaskView[];
}

export interface OverviewPlanNode {
  slug: string;
  project: string;
  title: string;
  status: string;
  shipped: boolean;
  progress: PlanProgress;
  phaseDone: number;
  phaseTotal: number;
  phases: OverviewPhaseNode[];
  /** Tasks matching the plan but no specific phase. */
  looseTasks: OverviewTaskView[];
}

export interface OverviewTree {
  plans: OverviewPlanNode[];
  /** Tasks matching no plan at all — never dropped. */
  adhoc: OverviewTaskView[];
}

export interface OverviewVelocity {
  plansByWeek: Array<{ week: string; count: number }>;
  tasksTodayByHour: Array<{ hour: number; count: number }>;
}

export interface OverviewActivityEntry {
  taskId: string;
  subject: string;
  status: string;
  column: KanbanColumn;
  owner: string | null;
  ts: number | null;
  planSlug: string | null;
  sessionId: string | null;
  sessionTitle: string;
  kind: string;
}

export interface FleetOverview {
  rollup: OverviewRollup;
  tree: OverviewTree;
  velocity: OverviewVelocity;
  activity: OverviewActivityEntry[];
  generatedAt: number;
}

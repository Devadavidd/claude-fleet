import path from 'node:path';
import type {
  FleetOverview,
  KanbanColumn,
  OverviewActivityEntry,
  OverviewRollup,
  OverviewTaskView,
  OverviewTree,
  OverviewVelocity,
  PlanPhase,
  PlanRecord,
  SessionCard,
  TaskSummary,
} from '../../../shared/types/index.js';
import { columnFor } from '../domain/task-registry.js';
import type { Task, TaskHistoryRecord } from '../domain/task-registry.js';

// Pure aggregation for GET /api/overview. Merges durable plan progress (plan-reader) with
// the live fleet task registry (reducer.listFleetTasks) and session cards into one payload
// shaped for the four Overview panels: rollup, tree (Plan→Phase→Task), velocity, activity.
// No I/O, no timers — everything derives from its arguments so it is unit-testable.

const VELOCITY_WEEKS = 8;
const ACTIVITY_LIMIT = 50;

/** A live task flattened fleet-wide with its owning session (reducer.listFleetTasks()
 * output) — the real shape this aggregator consumes. */
export interface FleetTaskRecord extends Task {
  sessionId: string;
  sessionTitle: string;
  planPath: string;
}

/** Projection of a live task carrying every field the reused TaskDetailDrawer
 * renders — a superset of the shared OverviewTaskView contract. */
interface TaskTreeView extends OverviewTaskView {
  history: TaskHistoryRecord[];
  createdAt: number | null;
  updatedAt: number | null;
}

interface PlanTreeNode {
  slug: string;
  project: string;
  title: string;
  status: string;
  shipped: boolean;
  progress: PlanRecord['progress'];
  phaseDone: number;
  phaseTotal: number;
  phases: Array<PlanPhase & { tasks: TaskTreeView[] }>;
  looseTasks: TaskTreeView[];
}

export interface BuildOverviewInput {
  plans?: PlanRecord[];
  liveTasks?: FleetTaskRecord[];
  cards?: SessionCard[];
  now?: number;
}

// plans/<slug>/ (or a bare slug) → the slug. '' when there is no plan reference.
function slugFromPlanDir(planDir: string): string {
  if (typeof planDir !== 'string' || !planDir) return '';
  return path.basename(planDir.replace(/[/\\]+$/, ''));
}

// A task belongs to a phase when its numeric phase matches, or its phaseFile names the file.
function phaseMatches(phase: PlanPhase, task: FleetTaskRecord): boolean {
  if (task.phase != null && phase.num != null && String(phase.num) === String(task.phase)) return true;
  return Boolean(task.phaseFile) && task.phaseFile === phase.file;
}

// Projection of a live task for the tree panel. Carries every field the reused
// TaskDetailDrawer renders (description, plan ref, activity history, timestamps) so a
// task opens with full detail straight from the tree — no per-session refetch.
function taskView(task: FleetTaskRecord): TaskTreeView {
  return {
    id: task.id,
    subject: task.subject || `(task ${task.id})`,
    description: task.description || '',
    status: task.status || 'pending',
    column: task.column || columnFor(task.status),
    owner: task.owner || null,
    priority: task.priority || '',
    phase: task.phase != null ? task.phase : null,
    blockedBy: Array.isArray(task.blockedBy) ? task.blockedBy : [],
    planDir: task.planDir || '',
    phaseFile: task.phaseFile || '',
    planPath: task.planPath || '',
    history: Array.isArray(task.history) ? task.history : [],
    createdAt: task.createdAt || null,
    updatedAt: task.updatedAt || null,
    sessionId: task.sessionId || null,
    sessionTitle: task.sessionTitle || '',
  };
}

function startOfDay(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// Midnight of the Monday on/before `ms` (local time).
function startOfWeek(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  const dow = (d.getDay() + 6) % 7; // 0 = Monday
  d.setDate(d.getDate() - dow);
  return d.getTime();
}

// Local-calendar YYYY-MM-DD. Built from local date parts (not toISOString, which is UTC
// and would label a local-Monday week bucket as the preceding Sunday in +offset zones).
function ymd(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function rollupOf(plans: PlanRecord[], liveTasks: FleetTaskRecord[], cards: SessionCard[]): OverviewRollup {
  const tasks: TaskSummary = { total: 0, pending: 0, in_progress: 0, completed: 0 };
  for (const t of liveTasks) {
    tasks.total += 1;
    const col: KanbanColumn = t.column || columnFor(t.status);
    if (tasks[col] != null) tasks[col] += 1;
  }
  const sessions = { total: cards.length, working: 0, waiting: 0, idle: 0 };
  let tokensOutput = 0;
  for (const c of cards) {
    if (c.status === 'working') sessions.working += 1;
    else if (c.status === 'waiting-for-you') sessions.waiting += 1;
    else sessions.idle += 1;
    tokensOutput += Number(c.tokens?.output) || 0;
  }
  const shipped = plans.filter((p) => p.shipped).length;
  return {
    plans: { total: plans.length, shipped, active: plans.length - shipped },
    tasks,
    phases: {
      total: plans.reduce((n, p) => n + (p.phaseTotal || 0), 0),
      done: plans.reduce((n, p) => n + (p.phaseDone || 0), 0),
    },
    sessions,
    tokensOutput,
  };
}

// Plan→Phase→Task tree. Each plan keeps its phase progress bars; live tasks nest under the
// matching phase, fall to the plan's looseTasks when only the plan matches, or to adhoc when
// no plan matches at all (so a task is never dropped).
function treeOf(plans: PlanRecord[], liveTasks: FleetTaskRecord[]): OverviewTree {
  const byslug = new Map<string, PlanTreeNode>();
  const planNodes: PlanTreeNode[] = plans.map((p) => {
    const node: PlanTreeNode = {
      slug: p.slug, project: p.project, title: p.title, status: p.status, shipped: p.shipped,
      progress: p.progress, phaseDone: p.phaseDone, phaseTotal: p.phaseTotal,
      phases: p.phases.map((ph) => ({ ...ph, tasks: [] as TaskTreeView[] })),
      looseTasks: [],
    };
    byslug.set(p.slug, node);
    return node;
  });
  const adhoc: TaskTreeView[] = [];
  for (const task of liveTasks) {
    const tv = taskView(task);
    const node = byslug.get(slugFromPlanDir(task.planDir));
    if (!node) { adhoc.push(tv); continue; }
    const phase = node.phases.find((ph) => phaseMatches(ph, task));
    (phase ? phase.tasks : node.looseTasks).push(tv);
  }
  return { plans: planNodes, adhoc };
}

// Two throughput series: durable plans-completed per week (last 8 weeks) and today's task
// completions by hour. Historical is day-coarse; today is derived from task history timestamps.
function velocityOf(plans: PlanRecord[], liveTasks: FleetTaskRecord[], now: number): OverviewVelocity {
  const thisWeek = startOfWeek(now);
  const weeks: Array<{ week: string; count: number }> = [];
  for (let i = VELOCITY_WEEKS - 1; i >= 0; i -= 1) {
    weeks.push({ week: ymd(thisWeek - i * 7 * 86_400_000), count: 0 });
  }
  const weekIndex = new Map(weeks.map((w, i) => [w.week, i]));
  for (const p of plans) {
    if (!p.shipped || !p.completed) continue;
    const ms = Date.parse(p.completed);
    if (!Number.isFinite(ms)) continue;
    const idx = weekIndex.get(ymd(startOfWeek(ms)));
    if (idx != null) weeks[idx].count += 1;
  }

  const dayStart = startOfDay(now);
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0 }));
  for (const task of liveTasks) {
    for (const h of Array.isArray(task.history) ? task.history : []) {
      if (!h.ts || h.ts < dayStart) continue;
      if (columnFor(h.status) !== 'completed') continue;
      hours[new Date(h.ts).getHours()].count += 1;
    }
  }
  return { plansByWeek: weeks, tasksTodayByHour: hours };
}

// Newest-first stream of task status transitions across the fleet, bounded.
function activityOf(liveTasks: FleetTaskRecord[]): OverviewActivityEntry[] {
  const entries: OverviewActivityEntry[] = [];
  for (const task of liveTasks) {
    const planSlug = slugFromPlanDir(task.planDir) || null;
    for (const h of Array.isArray(task.history) ? task.history : []) {
      entries.push({
        taskId: task.id,
        subject: task.subject || `(task ${task.id})`,
        status: h.status,
        column: columnFor(h.status),
        owner: h.owner || task.owner || null,
        ts: h.ts || null,
        planSlug,
        sessionId: task.sessionId || null,
        sessionTitle: task.sessionTitle || '',
        kind: h.kind || 'status',
      });
    }
  }
  entries.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  return entries.slice(0, ACTIVITY_LIMIT);
}

export function buildOverview({ plans = [], liveTasks = [], cards = [], now = 0 }: BuildOverviewInput = {}): FleetOverview {
  return {
    rollup: rollupOf(plans, liveTasks, cards),
    tree: treeOf(plans, liveTasks),
    velocity: velocityOf(plans, liveTasks, now),
    activity: activityOf(liveTasks),
    generatedAt: now,
  };
}

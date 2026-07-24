<!-- Fleet-wide Plan → Phase → Task tree (Jira Epic → Story → Sub-task) for the
     Overview landing. Live tasks nest under their matching phase, fall to a
     plan's "Unphased" group when only the plan matches, or an Ad-hoc bucket
     when no plan matches (never dropped). Defaults to plans that actually
     have live tasks — the fleet holds many completed plans. Clicking a task
     opens the shared TaskDetailDrawer (owned here, closed via its onClose). -->
<script lang="ts">
  import TaskDetailDrawer from './TaskDetailDrawer.svelte';
  import OverviewTaskTreeCard from './OverviewTaskTreeCard.svelte';
  import type { OverviewTree, OverviewPlanNode, OverviewTaskView } from '../../../../shared/types/index.js';

  interface Props {
    tree: OverviewTree | null;
  }

  const { tree }: Props = $props();

  type Filter = 'with-tasks' | 'all';
  const FILTERS: readonly [Filter, string][] = [['with-tasks', 'With tasks'], ['all', 'All plans']];

  let expandedKeys = $state(new Set<string>());
  let filter = $state<Filter>('with-tasks');
  let selectedTask = $state<OverviewTaskView | null>(null);

  function toggle(key: string): void {
    const next = new Set(expandedKeys);
    if (next.has(key)) next.delete(key); else next.add(key);
    expandedKeys = next;
  }

  function taskCount(plan: OverviewPlanNode): number {
    return (plan.looseTasks?.length ?? 0) + (plan.phases ?? []).reduce((n, ph) => n + (ph.tasks?.length ?? 0), 0);
  }

  // Client mirror of the session reducer's columnFor, for the plan status dot.
  function statusColumn(status: string | undefined): 'completed' | 'in_progress' | 'pending' {
    const s = (status ?? '').toLowerCase();
    if (s === 'completed' || s === 'complete' || s === 'done') return 'completed';
    if (s === 'in_progress' || s === 'in-progress' || s === 'active' || s === 'running') return 'in_progress';
    return 'pending';
  }

  const DOT_CLASS: Record<string, string> = { completed: 'bg-fleet-success', in_progress: 'bg-fleet-warn', pending: 'bg-fleet-dim' };

  const plans = $derived(tree?.plans ?? []);
  const adhoc = $derived(tree?.adhoc ?? []);
  const withTasksCount = $derived(plans.filter((p) => taskCount(p) > 0).length);
  const hiddenCount = $derived(plans.length - withTasksCount);

  // Newest plan first — slugs are date-prefixed (YYMMDD-HHmm); task count only
  // breaks ties between same-minute slugs.
  const visiblePlans = $derived.by(() => {
    const base = filter === 'all' ? plans : plans.filter((p) => taskCount(p) > 0);
    return [...base].sort((a, b) => (a.slug < b.slug ? 1 : a.slug > b.slug ? -1 : taskCount(b) - taskCount(a)));
  });

  function openTask(task: OverviewTaskView): void {
    selectedTask = task;
  }
</script>

<div class="flex items-center gap-2 mb-3" data-testid="task-tree-toolbar">
  {#each FILTERS as [key, label] (key)}
    <button
      type="button"
      onclick={() => { filter = key; }}
      class={`text-[11px] font-mono px-2.5 py-1 rounded-md cursor-pointer border ${filter === key ? 'border-fleet-accent text-fleet-accent bg-fleet-accent/10' : 'border-fleet-border text-fleet-dim'}`}
    >
      {label}
    </button>
  {/each}
  <span class="text-[11px] text-fleet-faint font-mono ml-auto">
    {filter === 'all' ? `${plans.length} plans` : `${withTasksCount} with tasks · ${hiddenCount} idle hidden`}
  </span>
</div>

<div class="flex flex-col gap-1.5" data-testid="task-tree">
  {#each visiblePlans as plan (plan.project + '/' + plan.slug)}
    {@const planKey = `plan:${plan.project}/${plan.slug}`}
    {@const planOpen = expandedKeys.has(planKey)}
    {@const planDone = statusColumn(plan.status) === 'completed'}
    <!-- Progress from the durable phase-completion ratio (or 100% once the plan is
         marked completed) — NOT the raw phase-file checkbox %, which stays 0 for
         completed plans whose authoring todos were never ticked. -->
    {@const planPct = planDone ? 100 : plan.phaseTotal ? Math.round((plan.phaseDone / plan.phaseTotal) * 100) : plan.progress.pct}
    <div class="border border-fleet-border rounded-xl bg-fleet-panel-deep overflow-hidden" data-testid="task-tree-plan">
      <button type="button" onclick={() => toggle(planKey)} class="flex items-center gap-2.5 w-full text-left px-3.5 py-2.5 cursor-pointer">
        <span class="text-fleet-dim text-[10px] w-2 flex-none">{planOpen ? '▾' : '▸'}</span>
        <span class={`w-1.5 h-1.5 rounded-sm flex-none ${DOT_CLASS[statusColumn(plan.status)]}`}></span>
        <span class="text-[13.5px] font-semibold text-fleet-text flex-1 min-w-0 truncate">{plan.title || plan.slug}</span>
        <span class="w-[70px] h-1.5 bg-fleet-panel-deep border border-fleet-border rounded overflow-hidden flex-none">
          <span class="block h-full bg-fleet-success" style={`width:${planPct}%`}></span>
        </span>
        <span class="text-[11px] text-fleet-muted font-mono flex-none">{plan.phaseDone}/{plan.phaseTotal} · {taskCount(plan)} tasks</span>
      </button>

      {#if planOpen}
        <div class="pl-7 pr-3.5 pb-3 flex flex-col gap-2.5">
          {#each plan.phases as phase (phase.file)}
            {@const phaseKey = `phase:${plan.project}/${plan.slug}:${phase.file}`}
            {@const phaseOpen = expandedKeys.has(phaseKey)}
            {@const hasTasks = phase.tasks.length > 0}
            {@const phaseCol = phase.done ? 'completed' : statusColumn(phase.status)}
            {@const phaseDoneCol = phaseCol === 'completed'}
            {@const phaseTaskDone = phase.tasks.filter((t) => t.column === 'completed').length}
            <!-- Show the live-task progress (what actually expands below) when the
                 phase has tasks; otherwise the phase's own completion — never the
                 raw 0/N checkbox count on a phase that is already done. -->
            {@const phaseCountText = hasTasks
              ? `${phaseTaskDone}/${phase.tasks.length}`
              : phaseDoneCol ? `${phase.total || 0}/${phase.total || 0}` : `${phase.checked}/${phase.total}`}
            <div class="border-l-2 border-fleet-border pl-3">
              <button type="button" onclick={() => toggle(phaseKey)} disabled={!hasTasks} class="flex items-center gap-2 w-full text-left cursor-pointer disabled:cursor-default mb-1.5">
                <span class="text-[10px] text-fleet-dim w-2 flex-none">{hasTasks ? (phaseOpen ? '▾' : '▸') : '·'}</span>
                <span class={`w-1.5 h-1.5 rounded-sm flex-none ${DOT_CLASS[phaseCol]}`}></span>
                <span class="text-xs font-medium text-fleet-muted-2">{phase.title || phase.file}</span>
                <span class={`text-[9.5px] font-mono uppercase tracking-wide rounded px-1.5 border ${phaseDoneCol ? 'text-fleet-success border-fleet-success/40' : 'text-fleet-dim border-fleet-border'}`}>{phase.status || 'pending'}</span>
                <span class={`text-[10.5px] font-mono ml-auto ${phaseDoneCol ? 'text-fleet-success' : 'text-fleet-faint'}`}>{phaseCountText}</span>
              </button>
              {#if phaseOpen && hasTasks}
                <div class="flex flex-col gap-1.5">
                  {#each phase.tasks as task (task.id)}
                    <OverviewTaskTreeCard {task} onOpen={() => openTask(task)} />
                  {/each}
                </div>
              {/if}
            </div>
          {/each}

          {#if plan.looseTasks.length}
            <div>
              <div class="text-[11px] text-fleet-dim mb-1.5">Unphased</div>
              <div class="flex flex-col gap-1.5">
                {#each plan.looseTasks as task (task.id)}
                  <OverviewTaskTreeCard {task} onOpen={() => openTask(task)} />
                {/each}
              </div>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  {/each}

  {#if adhoc.length}
    {@const adhocOpen = expandedKeys.has('adhoc')}
    <div class="border border-fleet-border rounded-xl bg-fleet-panel-deep overflow-hidden" data-testid="task-tree-adhoc">
      <button type="button" onclick={() => toggle('adhoc')} class="flex items-center gap-2.5 w-full text-left px-3.5 py-2.5 cursor-pointer">
        <span class="text-fleet-dim text-[10px] w-2 flex-none">{adhocOpen ? '▾' : '▸'}</span>
        <span class="text-[13.5px] font-semibold text-fleet-text flex-1 truncate">Ad-hoc / unassigned</span>
        <span class="text-[11px] text-fleet-muted font-mono flex-none">{adhoc.length} tasks</span>
      </button>
      {#if adhocOpen}
        <div class="pl-7 pr-3.5 pb-3 flex flex-col gap-1.5">
          {#each adhoc as task (task.id)}
            <OverviewTaskTreeCard {task} onOpen={() => openTask(task)} />
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  {#if !visiblePlans.length && !adhoc.length}
    <div class="text-fleet-faint text-xs py-5 text-center">
      {plans.length ? 'No plans have live tasks right now.' : 'No plans found yet.'}
    </div>
  {/if}
</div>

<TaskDetailDrawer task={selectedTask} onClose={() => { selectedTask = null; }} />

<!-- Shared right-side "task detail" drawer (Jira-style): one task's description,
     metadata, blocked-by, plan link, and status activity log over a backdrop.
     Read-only; never mutates a task. Fully prop-driven (task + onClose) so both
     the Overview task tree and a later session Kanban can host it. -->
<script lang="ts">
  import type { KanbanColumn, TaskHistoryEntry } from '../../../../shared/types/index.js';

  // Superset of the fields OverviewTaskView and TeamTask both carry — deliberately
  // wider than either single contract so this drawer stays reusable across both.
  export interface DrawerTask {
    id: string;
    subject: string;
    description?: string | null;
    status?: string;
    column?: KanbanColumn;
    owner?: string | null;
    priority?: string | null;
    phase?: string | number | null;
    blockedBy?: string[];
    planDir?: string;
    phaseFile?: string;
    planPath?: string;
    createdAt?: number | null;
    updatedAt?: number | null;
    history?: TaskHistoryEntry[];
  }

  interface Props {
    task: DrawerTask | null;
    onClose: () => void;
  }

  const { task, onClose }: Props = $props();

  const STATUS_LABEL: Record<string, string> = { pending: 'To do', in_progress: 'In progress', completed: 'Done' };

  function statusLabel(t: DrawerTask): string {
    return (t.column && STATUS_LABEL[t.column]) || t.status || 'To do';
  }

  function historyDot(status: string): string {
    const s = status.toLowerCase();
    if (s === 'completed' || s === 'done') return 'bg-fleet-success';
    if (s === 'in_progress' || s === 'in-progress' || s === 'active' || s === 'running') return 'bg-fleet-warn';
    return 'bg-fleet-dim';
  }

  function timeShort(ts: number | null | undefined): string {
    if (!ts) return '';
    const d = new Date(ts);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function planDisplay(t: DrawerTask): string {
    if (t.planDir && t.phaseFile) return `${t.planDir}/${t.phaseFile}`;
    return t.planDir || t.phaseFile || '';
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') onClose();
  }

  // Only listen while a task is actually shown — reruns whenever `task` changes.
  $effect(() => {
    if (!task) return;
    document.addEventListener('keydown', onKeydown);
    return () => document.removeEventListener('keydown', onKeydown);
  });
</script>

{#if task}
  <div class="fixed inset-0 z-40" data-testid="task-drawer-backdrop">
    <button
      type="button"
      class="absolute inset-0 w-full h-full bg-black/50 cursor-default"
      aria-label="Close task detail"
      onclick={onClose}
    ></button>
    <div
      class="fixed right-0 top-0 h-screen w-[420px] max-w-full bg-fleet-surface border-l border-fleet-border-strong p-5 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label="Task detail"
      data-testid="task-drawer"
    >
      <button type="button" onclick={onClose} aria-label="Close" class="absolute top-4 right-4 text-fleet-dim cursor-pointer hover:text-fleet-text">✕</button>

      <div class="flex items-center gap-2.5 pr-8 mb-4">
        <h2 class="text-[15px] font-semibold text-fleet-text m-0 flex-1 min-w-0">{task.subject || `(task ${task.id})`}</h2>
        <span class="text-[10.5px] font-mono uppercase tracking-wide text-fleet-muted border border-fleet-border rounded px-1.5 flex-none">{statusLabel(task)}</span>
      </div>

      <div class="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-fleet-muted mb-4 pb-4 border-b border-fleet-border">
        <span>ID <span class="text-fleet-text font-mono">#{task.id}</span></span>
        {#if task.priority}<span>Priority <span class="text-fleet-text">{task.priority}</span></span>{/if}
        {#if task.owner}<span>Owner <span class="text-fleet-text">{task.owner}</span></span>{/if}
        {#if task.phase != null && task.phase !== ''}<span>Phase <span class="text-fleet-text">{task.phase}</span></span>{/if}
        {#if timeShort(task.createdAt)}<span>Created <span class="text-fleet-text">{timeShort(task.createdAt)}</span></span>{/if}
        {#if timeShort(task.updatedAt)}<span>Updated <span class="text-fleet-text">{timeShort(task.updatedAt)}</span></span>{/if}
      </div>

      {#if task.description}
        <div class="mb-4">
          <div class="text-[11px] font-semibold text-fleet-faint uppercase tracking-wide mb-1.5">Description</div>
          <div class="text-[13px] text-fleet-muted leading-snug whitespace-pre-wrap">{task.description}</div>
        </div>
      {/if}

      {#if task.blockedBy?.length}
        <div class="mb-4">
          <div class="text-[11px] font-semibold text-fleet-faint uppercase tracking-wide mb-1.5">Blocked by</div>
          <div class="flex flex-wrap gap-1.5">
            {#each task.blockedBy as id (id)}
              <span class="text-[11.5px] bg-[#1a2030] border border-fleet-border-strong rounded-full px-2.5 py-0.5 text-fleet-muted">#{id}</span>
            {/each}
          </div>
        </div>
      {/if}

      {#if planDisplay(task)}
        <div class="mb-4">
          <div class="text-[11px] font-semibold text-fleet-faint uppercase tracking-wide mb-1.5">Plan</div>
          <a href={`#/file/${encodeURIComponent(task.planPath || planDisplay(task))}`} class="text-[12.5px] text-fleet-accent">📄 {planDisplay(task)}</a>
        </div>
      {/if}

      {#if task.history?.length}
        <div>
          <div class="text-[11px] font-semibold text-fleet-faint uppercase tracking-wide mb-1.5">Activity</div>
          <div class="flex flex-col gap-1.5">
            {#each task.history as h, i (i)}
              <div class="flex items-center gap-2 text-xs text-fleet-muted">
                <span class={`w-1.5 h-1.5 rounded-full flex-none ${historyDot(h.status)}`}></span>
                <span>{h.kind === 'created' ? 'created' : `→ ${h.status}`}</span>
                {#if timeShort(h.ts)}<span class="text-fleet-faint">{timeShort(h.ts)}</span>{/if}
                {#if h.owner}<span class="text-fleet-faint">{h.owner}</span>{/if}
              </div>
            {/each}
          </div>
        </div>
      {/if}
    </div>
  </div>
{/if}

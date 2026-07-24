<!-- Per-session "Tasks": the team's task list as a 3-column kanban (To do /
     In progress / Done) from GET /api/sessions/:id/tasks. Clicking a card opens
     the SHARED TaskDetailDrawer (imported, not rebuilt). Split from the legacy
     session-kanban-view.js; TeamTask is a superset of DrawerTask's fields, so
     it's passed straight through. -->
<script lang="ts">
  import TaskDetailDrawer from './TaskDetailDrawer.svelte';
  import type { TeamTask, KanbanColumn } from '../../../../shared/types/index.js';

  interface Props {
    sessionId: string;
  }

  const { sessionId }: Props = $props();

  const COLUMNS: { key: KanbanColumn; title: string }[] = [
    { key: 'pending', title: 'To do' },
    { key: 'in_progress', title: 'In progress' },
    { key: 'completed', title: 'Done' },
  ];

  let tasks = $state<TeamTask[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let openTask = $state<TeamTask | null>(null);
  let loadSeq = 0;

  async function load(): Promise<void> {
    const seq = ++loadSeq;
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/tasks`);
      if (!res.ok) throw new Error(res.status === 404 ? 'Session not found — it may have gone stale.' : `Could not load tasks (${res.status}).`);
      const data = (await res.json()) as unknown;
      if (seq !== loadSeq) return;
      tasks = Array.isArray(data) ? (data as TeamTask[]) : [];
      error = null;
    } catch (err) {
      if (seq !== loadSeq) return;
      if (!tasks.length) error = err instanceof Error ? err.message : 'Failed to load tasks — is the server running?';
    } finally {
      if (seq === loadSeq) loading = false;
    }
  }

  $effect(() => { void sessionId; void load(); });

  function tasksFor(col: KanbanColumn): TeamTask[] {
    return tasks.filter((t) => t.column === col);
  }
</script>

<div class="p-4" data-testid="session-kanban">
  {#if loading && !tasks.length}
    <div class="text-fleet-faint text-sm text-center py-10">Loading tasks…</div>
  {:else if error && !tasks.length}
    <div class="text-fleet-faint text-sm text-center py-10">{error}</div>
  {:else if !tasks.length}
    <div class="text-fleet-faint text-sm text-center py-10">No team tasks in this session yet.</div>
  {:else}
    <div class="grid grid-cols-3 gap-3 items-start" data-testid="kanban-columns">
      {#each COLUMNS as col (col.key)}
        <div class="bg-fleet-panel border border-fleet-border rounded-xl p-3 flex flex-col gap-2" data-testid={`kanban-col-${col.key}`}>
          <div class="flex items-center justify-between text-xs font-semibold text-fleet-muted">
            <span>{col.title}</span>
            <span class="font-mono text-fleet-dim">{tasksFor(col.key).length}</span>
          </div>
          {#each tasksFor(col.key) as task (task.id)}
            <button
              type="button"
              onclick={() => { openTask = task; }}
              class="text-left bg-fleet-panel-deep border border-fleet-border-strong rounded-lg px-2.5 py-2 cursor-pointer"
              data-testid="kanban-task-card"
            >
              <div class="text-[12.5px] text-fleet-text leading-snug">{task.subject || `(task ${task.id})`}</div>
              {#if task.blockedBy?.length}
                <div class="text-[10.5px] text-fleet-warn mt-1">⛔ blocked by {task.blockedBy.join(', ')}</div>
              {/if}
            </button>
          {/each}
        </div>
      {/each}
    </div>
  {/if}
  <TaskDetailDrawer task={openTask} onClose={() => { openTask = null; }} />
</div>

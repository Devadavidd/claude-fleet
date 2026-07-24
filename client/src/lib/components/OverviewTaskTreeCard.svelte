<!-- One task row within the Overview task tree — dot colored by kanban column,
     subject (struck through when completed), owner/priority, and a blocked-by
     note. Clicking opens the task in the tree's TaskDetailDrawer via onOpen. -->
<script lang="ts">
  import type { OverviewTaskView } from '../../../../shared/types/index.js';

  interface Props {
    task: OverviewTaskView;
    onOpen: () => void;
  }

  const { task, onOpen }: Props = $props();

  const DOT_CLASS: Record<string, string> = {
    completed: 'bg-fleet-success',
    in_progress: 'bg-fleet-warn',
    pending: 'bg-fleet-dim',
  };
</script>

<div class="flex flex-col gap-0.5">
  <button
    type="button"
    onclick={onOpen}
    class="flex items-center gap-2.5 w-full text-left bg-fleet-panel border border-fleet-border rounded-lg px-2.5 py-1.5 cursor-pointer"
    data-testid="task-tree-task"
  >
    <span class={`w-2 h-2 rounded-full flex-none ${DOT_CLASS[task.column] ?? 'bg-fleet-dim'}`}></span>
    <span class="text-[12.5px] text-fleet-text flex-1 min-w-0 truncate" class:line-through={task.column === 'completed'}>
      {task.subject || `(task ${task.id})`}
    </span>
    {#if task.priority}
      <span class="text-[10px] text-fleet-dim font-mono flex-none">{task.priority}</span>
    {/if}
    {#if task.owner}
      <span class="text-[10px] text-fleet-dim font-mono flex-none">{task.owner}</span>
    {/if}
  </button>
  {#if task.blockedBy.length}
    <div class="text-[10.5px] text-fleet-warn/80 pl-4">⛔ blocked by {task.blockedBy.join(', ')}</div>
  {/if}
</div>

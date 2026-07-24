<!-- Recent-activity panel for the Overview landing: newest-first feed of task
     status transitions across the whole fleet (bounded `activity` array from
     /api/overview). Read-only presentation, no store access of its own. -->
<script lang="ts">
  import type { OverviewActivityEntry } from '../../../../shared/types/index.js';

  interface Props {
    activity: OverviewActivityEntry[] | null;
  }

  const { activity }: Props = $props();

  const rows = $derived(activity ?? []);

  function relativeTime(ts: number): string {
    const secs = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (secs < 60) return `${secs}s ago`;
    if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
    return `${Math.round(secs / 3600)}h ago`;
  }

  const DOT_CLASS: Record<string, string> = { completed: 'bg-fleet-success', in_progress: 'bg-fleet-warn', pending: 'bg-fleet-dim' };
</script>

<div class="flex flex-col gap-3" data-testid="activity-stream">
  {#if !rows.length}
    <div class="text-fleet-faint text-xs py-4 text-center">No task activity yet.</div>
  {:else}
    {#each rows as e (`${e.sessionId ?? ''}#${e.taskId}#${e.ts ?? 0}`)}
      <div class="flex gap-2.5">
        <span class={`w-2 h-2 rounded-full flex-none mt-1 ${DOT_CLASS[e.column] ?? 'bg-fleet-dim'}`}></span>
        <div class="min-w-0 flex-1">
          <div class="text-[12.5px] text-fleet-text leading-snug truncate">
            <span class="text-fleet-dim font-mono">#{e.taskId}</span> {e.subject}
          </div>
          <div class="text-[11px] text-fleet-muted mt-0.5 flex gap-1.5 flex-wrap">
            <span>{e.kind === 'created' ? 'created' : `→ ${e.status ?? ''}`}</span>
            {#if e.owner}<span>· {e.owner}</span>{/if}
            {#if e.planSlug}<span>· {e.planSlug}</span>{/if}
            {#if e.ts}<span>· {relativeTime(e.ts)}</span>{/if}
          </div>
        </div>
      </div>
    {/each}
  {/if}
</div>

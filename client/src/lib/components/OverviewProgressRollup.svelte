<!-- Fleet-wide progress rollup for the Overview landing: % bars (plans shipped /
     phases done / tasks done) plus stat tiles (plans/tasks/phases/sessions/
     output tokens). Pure presentation over the /api/overview `rollup` slice. -->
<script lang="ts">
  import type { OverviewRollup } from '../../../../shared/types/index.js';

  interface Props {
    rollup: OverviewRollup | null;
  }

  const { rollup }: Props = $props();

  function pct(done: number, total: number): number {
    return total > 0 ? Math.round((done / total) * 100) : 0;
  }

  function formatTokens(n: number): string {
    const v = Number(n) || 0;
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
    return String(v);
  }

  const isEmpty = $derived(!rollup || (rollup.plans.total === 0 && rollup.tasks.total === 0));

  const bars = $derived.by(() => {
    if (!rollup) return [];
    return [
      { label: 'Plans shipped', done: rollup.plans.shipped, total: rollup.plans.total, color: 'var(--color-fleet-accent)' },
      { label: 'Phases done', done: rollup.phases.done, total: rollup.phases.total, color: 'var(--color-fleet-success)' },
      { label: 'Tasks done', done: rollup.tasks.completed, total: rollup.tasks.total, color: 'var(--color-fleet-success)' },
    ];
  });

  const tiles = $derived.by(() => {
    if (!rollup) return [];
    const { plans, tasks, phases, sessions, tokensOutput } = rollup;
    return [
      { label: 'Plans', value: String(plans.total), sub: `${plans.shipped} shipped · ${plans.active} active` },
      { label: 'Tasks', value: String(tasks.total), sub: `${tasks.in_progress} in progress · ${tasks.pending} to do` },
      { label: 'Phases', value: String(phases.total), sub: `${phases.done} done` },
      { label: 'Sessions', value: String(sessions.total), sub: `${sessions.working} working · ${sessions.waiting} waiting` },
      { label: 'Output tokens', value: formatTokens(tokensOutput), sub: 'live sessions' },
    ];
  });
</script>

<div class="border border-fleet-border rounded-2xl bg-fleet-panel-deep p-5" data-testid="progress-rollup">
  {#if isEmpty}
    <div class="text-fleet-faint text-xs py-4 text-center">No plans or live tasks yet.</div>
  {:else}
    <div class="grid grid-cols-3 gap-3 mb-4">
      {#each bars as bar (bar.label)}
        <div class="bg-fleet-panel border border-fleet-border rounded-[13px] px-4 py-3.5">
          <div class="flex justify-between items-baseline mb-2">
            <span class="text-[12.5px] text-fleet-text font-medium">{bar.label}</span>
            <span class="text-xs font-mono text-fleet-muted">{bar.done}/{bar.total}</span>
          </div>
          <div class="h-2 bg-fleet-panel-deep border border-fleet-border rounded-md overflow-hidden">
            <div class="h-full rounded-md" style={`background:${bar.color}; width:${pct(bar.done, bar.total)}%`}></div>
          </div>
          <div class="text-[11px] text-fleet-faint mt-1.5">{pct(bar.done, bar.total)}% complete</div>
        </div>
      {/each}
    </div>
    <div class="grid gap-3" style="grid-template-columns: repeat(auto-fit, minmax(150px, 1fr))">
      {#each tiles as tile (tile.label)}
        <div class="bg-fleet-panel border border-fleet-border rounded-[13px] px-4 py-3.5">
          <div class="text-2xl font-bold font-mono tracking-tight text-fleet-text">{tile.value}</div>
          <div class="text-[11px] text-fleet-muted uppercase tracking-wide mt-1">{tile.label}</div>
          <div class="text-[11px] text-fleet-faint mt-1">{tile.sub}</div>
        </div>
      {/each}
    </div>
  {/if}
</div>

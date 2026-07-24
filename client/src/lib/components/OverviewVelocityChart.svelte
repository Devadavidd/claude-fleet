<!-- Velocity panel for the Overview landing: two hand-rolled inline-SVG bar
     charts (no chart library) — durable throughput (plans shipped/week over
     the last 8 weeks) and live throughput (tasks done today by hour). -->
<script lang="ts">
  import type { OverviewVelocity } from '../../../../shared/types/index.js';

  interface Props {
    velocity: OverviewVelocity | null;
  }

  const { velocity }: Props = $props();

  interface ChartDatum { label: string; count: number }
  interface Bar { x: number; y: number; w: number; h: number; label: string; count: number }

  const W = 300, H = 70, PAD_B = 14, PAD_T = 4;

  // Evenly-spaced bars in a fixed viewBox; height scales to the series max.
  function bars(data: ChartDatum[]): Bar[] {
    const max = Math.max(1, ...data.map((d) => d.count));
    const n = data.length || 1;
    const slot = W / n;
    const barW = Math.max(2, slot * 0.62);
    const chartH = H - PAD_B - PAD_T;
    return data.map((d, i) => {
      const h = (d.count / max) * chartH;
      return { x: i * slot + (slot - barW) / 2, y: PAD_T + (chartH - h), w: barW, h: Math.max(0, h), label: d.label, count: d.count };
    });
  }

  // Sparse baseline labels: first, middle, last — keeps it readable without crowding.
  function labelIndexes(n: number): number[] {
    return [...new Set([0, Math.floor(n / 2), n - 1])];
  }

  function slotCenter(i: number, n: number): number {
    return i * (W / n) + (W / n) / 2;
  }

  const plansByWeek = $derived<ChartDatum[]>((velocity?.plansByWeek ?? []).map((w) => ({ label: w.week.slice(5), count: w.count })));
  const tasksByHour = $derived<ChartDatum[]>((velocity?.tasksTodayByHour ?? []).map((h) => ({ label: String(h.hour), count: h.count })));
  const plansTotal = $derived(plansByWeek.reduce((n, d) => n + d.count, 0));
  const hoursTotal = $derived(tasksByHour.reduce((n, d) => n + d.count, 0));
</script>

<div class="flex flex-col gap-4" data-testid="velocity-chart">
  <div>
    <div class="text-xs text-fleet-muted mb-2">Plans shipped / week (last 8w)</div>
    {#if !plansByWeek.length || plansTotal === 0}
      <div class="text-fleet-faint text-[11px]">nothing yet in this window</div>
    {:else}
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" class="w-full h-[70px]">
        {#each bars(plansByWeek) as b, i (i)}
          <rect x={b.x} y={b.y} width={b.w} height={b.h} rx="1.5" fill={b.count > 0 ? 'var(--color-fleet-accent)' : 'var(--color-fleet-border)'}>
            <title>{b.label}: {b.count}</title>
          </rect>
        {/each}
        {#each labelIndexes(plansByWeek.length) as i (i)}
          <text x={slotCenter(i, plansByWeek.length)} y={H - 3} text-anchor="middle" fill="var(--color-fleet-faint)" class="text-[9px] font-mono">{plansByWeek[i]?.label}</text>
        {/each}
      </svg>
    {/if}
  </div>
  <div>
    <div class="text-xs text-fleet-muted mb-2">Tasks done today / hour</div>
    {#if !tasksByHour.length || hoursTotal === 0}
      <div class="text-fleet-faint text-[11px]">nothing yet in this window</div>
    {:else}
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" class="w-full h-[70px]">
        {#each bars(tasksByHour) as b, i (i)}
          <rect x={b.x} y={b.y} width={b.w} height={b.h} rx="1.5" fill={b.count > 0 ? 'var(--color-fleet-success)' : 'var(--color-fleet-border)'}>
            <title>{b.label}: {b.count}</title>
          </rect>
        {/each}
        {#each labelIndexes(tasksByHour.length) as i (i)}
          <text x={slotCenter(i, tasksByHour.length)} y={H - 3} text-anchor="middle" fill="var(--color-fleet-faint)" class="text-[9px] font-mono">{tasksByHour[i]?.label}</text>
        {/each}
      </svg>
    {/if}
  </div>
</div>

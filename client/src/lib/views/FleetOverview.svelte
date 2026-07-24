<!-- COMMAND landing (#/): fleet-wide Jira-style dashboard. Fetches /api/overview
     and refetches (debounced ~300ms) on any session delta or 'overview-updated'
     bump — matching the legacy fleet-overview-view.js refetch policy, just
     folded into one $effect instead of manual SSE subscriptions. Layout:
     progress rollup → needs-you strip → task tree + velocity/activity side
     column (Fleet.dc.html COMMAND CENTER section, translated to Tailwind). -->
<script lang="ts">
  import { fleetStore } from '../fleet-store.svelte.js';
  import NeedsYouStrip from '../components/NeedsYouStrip.svelte';
  import OverviewProgressRollup from '../components/OverviewProgressRollup.svelte';
  import OverviewTaskTree from '../components/OverviewTaskTree.svelte';
  import OverviewVelocityChart from '../components/OverviewVelocityChart.svelte';
  import OverviewActivityStream from '../components/OverviewActivityStream.svelte';
  import type { FleetOverview as FleetOverviewData } from '../../../../shared/types/index.js';

  let overview = $state<FleetOverviewData | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let loadSeq = 0;

  async function load(): Promise<void> {
    const seq = ++loadSeq;
    try {
      const res = await fetch('/api/overview');
      if (!res.ok) throw new Error(`(${res.status})`);
      const data = (await res.json()) as FleetOverviewData;
      if (seq !== loadSeq) return; // a newer request already resolved
      overview = data;
      error = null;
    } catch {
      if (seq !== loadSeq) return;
      if (!overview) error = 'Failed to load overview — is the server running?';
    } finally {
      if (seq === loadSeq) loading = false;
    }
  }

  $effect(() => {
    // Reactive deps: refetch (debounced) on any overview-version bump or
    // session-map delta — reading both here is what wires the dependency.
    void fleetStore.overviewVersion;
    void fleetStore.sessions;
    const timer = setTimeout(() => { void load(); }, 300);
    return () => clearTimeout(timer);
  });
</script>

<div class="p-6 max-w-[1360px] mx-auto flex flex-col gap-4.5" data-testid="fleet-overview">
  {#if loading && !overview}
    <div class="text-fleet-faint text-sm text-center py-10">Loading fleet overview…</div>
  {:else if error && !overview}
    <div class="text-fleet-faint text-sm text-center py-10">{error}</div>
  {:else}
    <OverviewProgressRollup rollup={overview?.rollup ?? null} />
    <NeedsYouStrip />
    <div class="grid gap-4 items-start" style="grid-template-columns: minmax(0,1.7fr) minmax(300px,1fr)">
      <section class="bg-fleet-panel border border-fleet-border rounded-2xl p-4.5">
        <div class="flex items-center justify-between mb-3.5">
          <span class="text-[11px] font-semibold tracking-wide text-fleet-muted uppercase">Task distribution · Plan → Phase → Task</span>
          <span class="text-[11px] text-fleet-faint font-mono">Epic · Story · Sub-task</span>
        </div>
        <OverviewTaskTree tree={overview?.tree ?? null} />
      </section>
      <div class="flex flex-col gap-4">
        <section class="bg-fleet-panel border border-fleet-border rounded-2xl p-4.5">
          <div class="text-[11px] font-semibold tracking-wide text-fleet-muted uppercase mb-3.5">Velocity</div>
          <OverviewVelocityChart velocity={overview?.velocity ?? null} />
        </section>
        <section class="bg-fleet-panel border border-fleet-border rounded-2xl p-4.5">
          <div class="text-[11px] font-semibold tracking-wide text-fleet-muted uppercase mb-3.5">Recent activity</div>
          <OverviewActivityStream activity={overview?.activity ?? null} />
        </section>
      </div>
    </div>
  {/if}
</div>

<!-- App shell: 250px sidebar + header/content column. Wires the SSE store,
     router, anti-CSRF token, and app-level alerter once on mount; the first
     pointer/keyboard gesture unlocks Web Audio so chimes can play. The view
     switch routes every hash to its Svelte view; the header's launch button
     opens the Launch-session modal mounted here. -->
<script lang="ts">
  import { router, navigate } from './lib/router.svelte.js';
  import { fleetStore } from './lib/fleet-store.svelte.js';
  import { initFleetAlerts } from './lib/fleet-alerts.svelte.js';
  import { loadFleetToken } from './lib/auth.js';
  import { unlockAudio } from './lib/audio.js';
  import type { ViewType } from './lib/router.svelte.js';

  import Sidebar from './lib/components/Sidebar.svelte';
  import AppHeader from './lib/components/AppHeader.svelte';
  import LaunchSessionModal from './lib/components/LaunchSessionModal.svelte';

  import FleetOverview from './lib/views/FleetOverview.svelte';
  import FleetBoard from './lib/views/FleetBoard.svelte';
  import AgentsFleet from './lib/views/AgentsFleet.svelte';
  import WorkflowsFleet from './lib/views/WorkflowsFleet.svelte';
  import AlwaysOn from './lib/views/AlwaysOn.svelte';
  import FileTreeHeatmap from './lib/views/FileTreeHeatmap.svelte';
  import ShippedWiki from './lib/views/ShippedWiki.svelte';
  import SkillsCatalog from './lib/views/SkillsCatalog.svelte';
  import SessionView from './lib/views/SessionView.svelte';
  import FileContent from './lib/views/FileContent.svelte';

  const VIEW_TITLES: Record<ViewType, string> = {
    overview: 'Overview',
    board: 'Board',
    agents: 'Agents',
    workflows: 'Workflows',
    'always-on': 'Always-on',
    files: 'Files',
    shipped: 'Shipped',
    skills: 'Skills',
    session: 'Session',
    file: 'File',
  };

  const title = $derived(VIEW_TITLES[router.route.view] ?? 'Fleet');
  let launchOpen = $state(false);

  let audioUnlocked = false;
  function unlockOnFirstGesture(): void {
    if (audioUnlocked) return;
    audioUnlocked = true;
    unlockAudio();
  }

  $effect(() => {
    router.start();
    fleetStore.initFleet();
    void loadFleetToken();
    initFleetAlerts(() => [...fleetStore.sessions.values()]);
    window.addEventListener('pointerdown', unlockOnFirstGesture);
    window.addEventListener('keydown', unlockOnFirstGesture);
    return () => {
      router.stop();
      fleetStore.destroyFleet();
      window.removeEventListener('pointerdown', unlockOnFirstGesture);
      window.removeEventListener('keydown', unlockOnFirstGesture);
    };
  });
</script>

<main
  data-testid="app-shell"
  class="min-h-screen grid grid-cols-[250px_minmax(0,1fr)] bg-fleet-bg text-fleet-text font-sans"
>
  <Sidebar />
  <div class="flex flex-col min-w-0 h-screen overflow-hidden">
    <AppHeader {title} launch={() => (launchOpen = true)} />
    <div class="flex-1 overflow-y-auto min-h-0">
      {#if router.route.view === 'board'}
        <FleetBoard />
      {:else if router.route.view === 'agents'}
        <AgentsFleet />
      {:else if router.route.view === 'workflows'}
        <WorkflowsFleet />
      {:else if router.route.view === 'always-on'}
        <AlwaysOn />
      {:else if router.route.view === 'files'}
        <FileTreeHeatmap />
      {:else if router.route.view === 'shipped'}
        <ShippedWiki />
      {:else if router.route.view === 'skills'}
        <SkillsCatalog />
      {:else if router.route.view === 'session'}
        <SessionView />
      {:else if router.route.view === 'file'}
        <FileContent />
      {:else}
        <FleetOverview />
      {/if}
    </div>
  </div>
  <LaunchSessionModal open={launchOpen} onClose={() => (launchOpen = false)} />
</main>

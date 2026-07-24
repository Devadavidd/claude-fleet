<!-- Session detail (#/session/:id[/terminal|/tasks][/agent/:aid]): a sub-nav of
     three tabs that deep-link via the hash router, so a direct link to
     /terminal or /tasks selects that tab on load. Timeline honors `agentId`
     (a worker's own transcript) — the other two tabs are session-wide only. -->
<script lang="ts">
  import { router, navigate } from '../router.svelte.js';
  import SessionTimeline from '../components/SessionTimeline.svelte';
  import SessionTerminal from '../components/SessionTerminal.svelte';
  import SessionKanban from '../components/SessionKanban.svelte';
  import SessionComposer from '../components/SessionComposer.svelte';
  import type { SessionTab } from '../router.svelte.js';

  const sessionId = $derived(router.route.sessionId ?? '');
  const agentId = $derived(router.route.agentId);
  const tab = $derived(router.route.sessionTab);

  const TABS: { key: SessionTab; label: string; hash: (id: string) => string }[] = [
    { key: 'timeline', label: 'Timeline', hash: (id) => `#/session/${encodeURIComponent(id)}` },
    { key: 'terminal', label: 'Terminal', hash: (id) => `#/session/${encodeURIComponent(id)}/terminal` },
    { key: 'tasks', label: 'Tasks', hash: (id) => `#/session/${encodeURIComponent(id)}/tasks` },
  ];
</script>

<div class="flex flex-col h-full min-h-0" data-testid="session-view">
  <nav class="flex items-center gap-1 px-4 py-2.5 border-b border-fleet-border flex-none" data-testid="session-subnav">
    {#each TABS as t (t.key)}
      <button
        type="button"
        class={`text-xs font-medium px-3 py-1.5 rounded-md cursor-pointer ${tab === t.key ? 'bg-fleet-panel text-fleet-text' : 'text-fleet-dim'}`}
        onclick={() => navigate(t.hash(sessionId))}
        aria-current={tab === t.key ? 'page' : undefined}
        data-testid={`session-tab-${t.key}`}
      >
        {t.label}
      </button>
    {/each}
  </nav>
  <div class="flex-1 overflow-y-auto min-h-0">
    {#if !sessionId}
      <div class="p-6 text-fleet-faint text-sm text-center">No session selected.</div>
    {:else if tab === 'terminal'}
      <SessionTerminal {sessionId} />
    {:else if tab === 'tasks'}
      <SessionKanban {sessionId} />
    {:else}
      <SessionTimeline {sessionId} {agentId} />
    {/if}
  </div>
  {#if sessionId}
    <!-- Chat bar for dashboard-launched sessions (answer / steer / finish / stop). -->
    <SessionComposer {sessionId} />
  {/if}
</div>

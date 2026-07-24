<!-- 250px workspace sidebar: logo, nav (per-item icon + active state + count
     pill), live-SSE widget, static user card. Layout/colors translated from
     the designer mockup (Fleet.dc.html ~L37-89) into Tailwind utilities. -->
<script lang="ts">
  import { router, navigate, type ViewType } from '../router.svelte.js';
  import { fleetStore } from '../fleet-store.svelte.js';
  import NavIcon from './NavIcon.svelte';

  interface NavItem {
    label: string;
    hash: string;
    view: ViewType;
  }

  const NAV_ITEMS: NavItem[] = [
    { label: 'Overview', hash: '#/', view: 'overview' },
    { label: 'Board', hash: '#/board', view: 'board' },
    { label: 'Agents', hash: '#/agents', view: 'agents' },
    { label: 'Workflows', hash: '#/workflows', view: 'workflows' },
    { label: 'Always-on', hash: '#/always-on', view: 'always-on' },
    { label: 'Files', hash: '#/files', view: 'files' },
    { label: 'Shipped', hash: '#/shipped', view: 'shipped' },
    { label: 'Skills', hash: '#/skills', view: 'skills' },
  ];

  // Board's pill mirrors the board's own leftmost column: only sessions that
  // are actually blocked on a reply, not every waiting-for-you card.
  const waitingCount = $derived(
    [...fleetStore.sessions.values()].filter(
      (c) => c.status === 'waiting-for-you' && c.pendingQuestion,
    ).length,
  );

  function countFor(view: ViewType): number | null {
    return view === 'board' && waitingCount > 0 ? waitingCount : null;
  }
</script>

<aside
  class="w-[250px] flex-none bg-fleet-surface border-r border-fleet-border flex flex-col h-screen sticky top-0 p-3.5"
  data-testid="sidebar"
>
  <div class="flex items-center gap-2.5 px-2 pb-5">
    <div class="w-[30px] h-[30px] rounded-[9px] bg-gradient-to-br from-fleet-accent to-fleet-accent-deep flex items-center justify-center shadow-[0_4px_14px_rgba(125,123,255,0.4)]">
      <svg width="17" height="17" viewBox="0 0 16 16" fill="none"><path d="M8 1.5 14 5v6L8 14.5 2 11V5z" stroke="#fff" stroke-width="1.3" stroke-linejoin="round"/><path d="M8 1.5V8m0 0 6-3M8 8l-6-3M8 8v6.5" stroke="#fff" stroke-width="1.1" opacity=".8"/></svg>
    </div>
    <div class="min-w-0">
      <div class="font-bold text-[15px] tracking-tight leading-tight">Fleet</div>
      <div class="text-[10.5px] text-fleet-accent tracking-wide font-mono">/cf · claude fleet</div>
    </div>
  </div>

  <div class="text-[10px] font-semibold tracking-widest text-fleet-faint px-2.5 pb-1.5">WORKSPACE</div>
  <nav class="flex flex-col gap-0.5">
    {#each NAV_ITEMS as item (item.view)}
      {@const active = router.route.view === item.view}
      {@const count = countFor(item.view)}
      <button
        type="button"
        onclick={() => navigate(item.hash)}
        class={`flex items-center gap-2.5 w-full text-left border-0 cursor-pointer px-2.5 py-2 rounded-[9px] text-[13.5px] font-medium ${active ? 'bg-fleet-accent/15 text-fleet-text' : 'text-fleet-muted hover:text-fleet-text'}`}
      >
        <span class={`w-4 h-4 flex flex-none ${active ? 'text-fleet-accent' : 'text-fleet-dim'}`}>
          <NavIcon view={item.view} />
        </span>
        <span class="flex-1 min-w-0 truncate">{item.label}</span>
        {#if count}
          <span class="text-[11px] font-mono text-fleet-warn bg-fleet-warn/15 rounded-full px-1.5 flex-none">{count}</span>
        {/if}
      </button>
    {/each}
  </nav>

  <div class="mt-auto flex flex-col gap-2.5">
    <div class="bg-fleet-panel border border-fleet-border rounded-[11px] px-3 py-2.5">
      <div class="flex items-center gap-1.5 text-xs text-fleet-muted mb-2">
        <span class={`w-1.5 h-1.5 rounded-full ${fleetStore.connectionUp ? 'bg-fleet-success' : 'bg-red-500'}`}></span>
        {fleetStore.connectionUp ? 'Live · SSE connected' : 'reconnecting…'}
      </div>
      <div class="flex justify-between text-[11px] text-fleet-dim font-mono">
        <span>{fleetStore.sessions.size} active</span><span>127.0.0.1:4600</span>
      </div>
      <div class="flex items-center gap-1.5 mt-2 pt-2 border-t border-fleet-border">
        <span class="w-1.5 h-1.5 rounded-sm bg-fleet-accent flex-none"></span>
        <span class="text-[11px] text-fleet-muted">Claude Engineer</span>
      </div>
    </div>
    <div class="flex items-center gap-2 px-1.5">
      <div class="w-[26px] h-[26px] rounded-full bg-gradient-to-br from-[#3a4152] to-[#232935] flex items-center justify-center text-[11px] font-semibold text-fleet-text">DN</div>
      <div class="min-w-0 flex-1">
        <div class="text-xs font-medium truncate">daianit / lead</div>
        <div class="text-[10.5px] text-fleet-dim">Observer + operator</div>
      </div>
    </div>
  </div>
</aside>

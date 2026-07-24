<!-- Tier-2 event timeline for one session (or one worker's own transcript when
     agentId is set). Reads like the Claude desktop app: OLDEST at top, newest
     at the bottom, and the view sticks to the bottom while new events stream
     in (unless you scroll up to read history — then it stays put). The
     server's ?since=<total> is polled so a live session appends without a
     full refetch. Each entry's absolute index (offset + position) keys the
     {#each} — stable across polls, since new events only ever extend `total`,
     never shift earlier ones. -->

<script lang="ts">
  import { fleetStore } from '../fleet-store.svelte.js';
  import TimelineEntry from './TimelineEntry.svelte';
  import type { TranscriptEntry, TimelineResponse } from '../../../../shared/types/index.js';

  interface Props {
    sessionId: string;
    agentId: string | null;
  }

  const { sessionId, agentId }: Props = $props();

  let events = $state<TranscriptEntry[]>([]);
  let total = $state(0);
  let offset = $state(0);
  let loading = $state(true);
  let error = $state<string | null>(null);

  function basePath(): string {
    const suffix = agentId ? `/agents/${encodeURIComponent(agentId)}` : '';
    return `/api/sessions/${encodeURIComponent(sessionId)}${suffix}`;
  }

  async function fetchTimeline(query: string): Promise<TimelineResponse | null> {
    try {
      const res = await fetch(`${basePath()}/timeline${query}`);
      if (!res.ok) { error = `Session not found (${res.status}) — it may have gone stale.`; return null; }
      return (await res.json()) as TimelineResponse;
    } catch {
      error = 'Failed to load timeline — is the server running?';
      return null;
    }
  }

  async function loadInitial(): Promise<void> {
    loading = true;
    const data = await fetchTimeline('?limit=1000');
    if (data) { events = data.events; total = data.total; offset = data.offset; error = null; }
    loading = false;
  }

  async function pollAppend(): Promise<void> {
    const data = await fetchTimeline(`?since=${total}`);
    if (data && data.total > total) { events = [...events, ...data.events]; total = data.total; error = null; }
  }

  $effect(() => {
    void sessionId; void agentId; // new identity → reset and reload from scratch
    events = []; total = 0; offset = 0; error = null;
    follow = true;
    void loadInitial();
    const timer = setInterval(() => { void pollAppend(); }, 2500);
    return () => clearInterval(timer);
  });

  // Chat-style ordering: oldest → newest, view pinned to the bottom.
  const displayRows = $derived(
    events.map((e, i) => ({ entry: e, idx: offset + i })),
  );

  // --- bottom-follow scrolling (desktop-app feel) ---
  // The scrollable element is the SessionView content wrapper, found from a
  // sentinel at the end of the list. `follow` flips off when the user scrolls
  // up to read history and back on when they return near the bottom.
  let bottomEl = $state<HTMLElement | null>(null);
  let follow = true;

  function scroller(): HTMLElement | null {
    return (bottomEl?.closest('.overflow-y-auto') as HTMLElement | null) ?? null;
  }

  function onScroll(): void {
    const s = scroller();
    if (s) follow = s.scrollTop + s.clientHeight >= s.scrollHeight - 80;
  }

  $effect(() => {
    const s = scroller(); // re-runs once the sentinel binds
    if (!s) return;
    s.addEventListener('scroll', onScroll);
    return () => s.removeEventListener('scroll', onScroll);
  });

  $effect(() => {
    void total; // fires on initial load and every appended batch
    if (!follow) return;
    requestAnimationFrame(() => {
      const s = scroller();
      if (s) s.scrollTop = s.scrollHeight;
    });
  });

  interface ToolMeta { name: string; detail: string }

  // tool_use_id -> {name, detail}, scanned across every known assistant event,
  // so a tool_result (which only carries the id) can label + style itself.
  const toolMeta = $derived.by((): Map<string, ToolMeta> => {
    const map = new Map<string, ToolMeta>();
    for (const entry of events) {
      if (entry.kind !== 'event' || entry.event.type !== 'assistant') continue;
      const blocks = Array.isArray(entry.event.message?.content) ? (entry.event.message.content as unknown[]) : [];
      for (const raw of blocks) {
        const b = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
        if (b?.type !== 'tool_use' || typeof b.id !== 'string') continue;
        const input = (b.input && typeof b.input === 'object' ? b.input : {}) as Record<string, unknown>;
        const detail = typeof input.description === 'string'
          ? input.description
          : typeof input.command === 'string' ? String(input.command).slice(0, 100) : '';
        map.set(b.id, { name: String(b.name ?? 'tool'), detail });
      }
    }
    return map;
  });

  // Task/Agent tool_use id -> spawned worker's agentId, for "open worker →" links.
  const agentIdByToolUseId = $derived.by((): Map<string, string> => {
    const map = new Map<string, string>();
    for (const agent of fleetStore.sessions.get(sessionId)?.agents ?? []) {
      if (agent.toolUseId) map.set(agent.toolUseId, agent.agentId);
    }
    return map;
  });
</script>

<div class="p-4 flex flex-col" data-testid="session-timeline">
  {#if loading && !events.length}
    <div class="text-fleet-faint text-sm text-center py-10">Loading timeline…</div>
  {:else if error && !events.length}
    <div class="text-fleet-faint text-sm text-center py-10">{error}</div>
  {:else if !events.length}
    <div class="text-fleet-faint text-sm text-center py-10">No events in this session yet.</div>
  {:else}
    {#if offset > 0}
      <div class="text-[11px] text-fleet-faint text-center py-2">{offset} earlier events not shown</div>
    {/if}
    {#each displayRows as row (row.idx)}
      <TimelineEntry entry={row.entry} {toolMeta} {agentIdByToolUseId} {sessionId} />
    {/each}
  {/if}
  <div bind:this={bottomEl} aria-hidden="true"></div>
</div>

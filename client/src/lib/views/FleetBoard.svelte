<!-- Tier-1 Kanban: 🟡 Waiting for you | 🟢 Working | ⚪ Idle. Column membership
     mirrors public/fleet-board-view.js's `columnFor` exactly.

     Anti-click-swallow mechanism: ONE keyed {#each cards as card (card.sessionId)}
     iterates a STABLE first-seen-insertion projection of fleetStore.sessions
     (never re-sorted here — the store's Map already preserves insertion order).
     A card's wrapper is NEVER destroyed/recreated by a status or column change;
     both its column (grid-column) and its visual rank (order, ~50ms debounced)
     are expressed purely as inline styles on that one persistent element —
     matching the legacy fleet-board-view.js note "it appends once, sorts via
     style.order", generalized so even a column change never re-creates a node. -->
<script lang="ts">
  import { fleetStore } from '../fleet-store.svelte.js';
  import { fleetMutate } from '../auth.js';
  import SessionCard from '../components/SessionCard.svelte';
  import type { SessionCard as SessionCardType } from '../../../../shared/types/index.js';

  type BoardColumnKey = 'waiting' | 'working' | 'idle';

  const COLUMNS: { key: BoardColumnKey; label: string; dotClass: string; gridColumn: number }[] = [
    { key: 'waiting', label: '🟡 Waiting for you', dotClass: 'bg-fleet-warn', gridColumn: 1 },
    { key: 'working', label: '🟢 Working', dotClass: 'bg-fleet-success', gridColumn: 2 },
    { key: 'idle', label: '⚪ Idle', dotClass: 'bg-fleet-dim', gridColumn: 3 },
  ];

  function columnFor(c: SessionCardType): BoardColumnKey {
    if (c.status === 'working') return 'working';
    if (c.status === 'waiting-for-you') return c.pendingQuestion ? 'waiting' : 'idle';
    return 'idle';
  }

  function gridColumnOf(c: SessionCardType): number {
    return COLUMNS.find((col) => col.key === columnFor(c))!.gridColumn;
  }

  const cards = $derived<SessionCardType[]>([...fleetStore.sessions.values()]);

  const counts = $derived.by(() => {
    const tally: Record<BoardColumnKey, number> = { waiting: 0, working: 0, idle: 0 };
    for (const c of cards) tally[columnFor(c)] += 1;
    return tally;
  });

  // --- board clean-up: bulk-hide the idle column + hidden panel to restore ---
  let clearArmed = $state(false); // first click arms, second executes
  let hiddenList = $state<Array<{ sessionId: string; title: string }>>([]);
  let hiddenOpen = $state(false);

  async function clearIdle(): Promise<void> {
    if (!clearArmed) { clearArmed = true; setTimeout(() => (clearArmed = false), 4000); return; }
    clearArmed = false;
    const ids = cards.filter((c) => columnFor(c) === 'idle').map((c) => c.sessionId);
    if (!ids.length) return;
    try { await fleetMutate('/api/sessions/bulk-hide', { ids }); } catch { /* SSE reconciles */ }
    void refreshHidden();
  }

  async function refreshHidden(): Promise<void> {
    try {
      const res = await fetch('/api/hidden-sessions');
      if (res.ok) hiddenList = (await res.json()) as Array<{ sessionId: string; title: string }>;
    } catch { /* panel just shows stale data */ }
  }

  async function unhide(id: string): Promise<void> {
    try { await fleetMutate(`/api/sessions/${encodeURIComponent(id)}/unhide`); } catch { return; }
    hiddenList = hiddenList.filter((h) => h.sessionId !== id);
  }

  // Refetch whenever the session map changes — a hide lands as a
  // session-removed delta, so the panel picks the new entry up right away.
  $effect(() => {
    void fleetStore.sessions;
    const t = setTimeout(() => void refreshHidden(), 300);
    return () => clearTimeout(t);
  });

  // Per-column masonry on ONE flat grid: implicit rows are a fine 8px unit and
  // every slot spans ceil((cardHeight + gap) / unit) rows, so columns no longer
  // share full-card-height rows — a tall card in one column can't stretch the
  // row and punch vertical holes into its neighbor columns. Heights are kept
  // fresh via ResizeObserver (cards grow/shrink as live status lines change).
  const MASONRY_ROW_PX = 8; // implicit grid-auto-rows height, must match auto-rows-[8px]
  const MASONRY_GAP_PX = 14; // vertical gap encoded into the span (matches gap-x-3.5)

  function masonrySpan(slot: HTMLElement): { destroy: () => void } | void {
    const card = (slot.firstElementChild as HTMLElement | null) ?? slot;
    const apply = () => {
      const rows = Math.max(2, Math.ceil((card.offsetHeight + MASONRY_GAP_PX) / MASONRY_ROW_PX));
      slot.style.gridRowEnd = `span ${rows}`;
    };
    apply();
    if (typeof ResizeObserver === 'undefined') return; // jsdom tests: single static measure
    const ro = new ResizeObserver(apply);
    ro.observe(card);
    return { destroy: () => ro.disconnect() };
  }

  // Visual sort ONLY, debounced so a burst of deltas doesn't thrash layout. A
  // shared global rank still sorts each column correctly: with dense packing
  // (grid-flow-row-dense on the grid) every order-modified item is placed into
  // the EARLIEST free span-sized row range of its explicit grid-column, so each
  // column stacks compactly from the top and same-column items keep their rank.
  // Without dense, the forward-only placement cursor pushes a column's first
  // card below cards of other columns that ranked earlier globally.
  let rankById = $state<Map<string, number>>(new Map());

  $effect(() => {
    const snapshot = cards; // reactive dependency — reruns per store delta
    const timer = setTimeout(() => {
      const ranked = [...snapshot].sort((a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0));
      const next = new Map<string, number>();
      ranked.forEach((c, i) => next.set(c.sessionId, i));
      rankById = next;
    }, 50);
    return () => clearTimeout(timer);
  });
</script>

<div class="p-5 flex flex-col gap-3" data-testid="fleet-board">
  <div class="grid grid-cols-3 gap-3.5">
    {#each COLUMNS as col (col.key)}
      <div class="bg-fleet-panel border border-fleet-border rounded-xl px-3 py-2.5 flex items-center gap-2" data-testid={`board-column-${col.key}`}>
        <span class={`w-2 h-2 rounded-full flex-none ${col.dotClass}`}></span>
        <span class="text-[12.5px] font-semibold text-fleet-text">{col.label}</span>
        <span class="text-[11px] font-mono text-fleet-dim ml-auto" data-testid={`board-column-count-${col.key}`}>{counts[col.key]}</span>
        {#if col.key === 'idle' && counts.idle > 0}
          <button
            type="button"
            onclick={() => void clearIdle()}
            class={`text-[10.5px] rounded-md px-1.5 py-0.5 cursor-pointer border ${clearArmed ? 'text-fleet-warn border-fleet-warn-border bg-fleet-warn/10 font-semibold' : 'text-fleet-dim border-fleet-border-strong hover:text-fleet-text'}`}
            title="Hide every idle card (transcripts stay on disk)"
            data-testid="clear-idle"
          >{clearArmed ? 'Sure? Click again' : 'Clear'}</button>
        {/if}
      </div>
    {/each}
  </div>

  {#if hiddenList.length}
    <div class="flex flex-col gap-1" data-testid="hidden-panel">
      <button
        type="button"
        onclick={() => (hiddenOpen = !hiddenOpen)}
        class="text-[11px] text-fleet-dim hover:text-fleet-text cursor-pointer w-fit"
        data-testid="hidden-toggle"
      >{hiddenOpen ? '▾' : '▸'} Hidden ({hiddenList.length})</button>
      {#if hiddenOpen}
        <div class="flex flex-col gap-1 bg-fleet-panel border border-fleet-border rounded-xl p-2 max-h-[220px] overflow-y-auto">
          {#each hiddenList as h (h.sessionId)}
            <div class="flex items-center gap-2 text-[11.5px]">
              <span class="truncate flex-1 text-fleet-muted">{h.title || h.sessionId}</span>
              <button type="button" onclick={() => void unhide(h.sessionId)} class="text-fleet-accent cursor-pointer" data-testid="unhide-btn">Restore</button>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  <div class="grid grid-cols-3 grid-flow-row-dense auto-rows-[8px] gap-x-3.5 items-start" data-testid="fleet-board-grid">
    {#each cards as card (card.sessionId)}
      {@const column = columnFor(card)}
      <!-- style: directives (NOT one reactive style attribute): Svelte writes them
           via setProperty per-key, so a rank/column update can never clobber the
           grid-row-end that masonrySpan sets imperatively on the same element. -->
      <div
        use:masonrySpan
        style:grid-column={gridColumnOf(card)}
        style:order={rankById.get(card.sessionId) ?? 0}
        data-testid="board-card-slot"
        data-session-id={card.sessionId}
        data-column={column}
      >
        <SessionCard {card} />
      </div>
    {/each}
  </div>

  {#if cards.length === 0}
    <div class="text-center text-fleet-faint text-xs py-5">Nothing here</div>
  {/if}
</div>

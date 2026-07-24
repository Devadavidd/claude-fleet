<!-- Amber "needs you" strip on the Overview landing: every waiting-for-you
     session, live questions surfaced before plain turn-completions. Each row
     deep-links straight to the session. Hidden entirely when nothing waits. -->
<script lang="ts">
  import { fleetStore } from '../fleet-store.svelte.js';
  import { navigate } from '../router.svelte.js';
  import type { SessionCard } from '../../../../shared/types/index.js';

  // Question sessions first; Array.sort is stable so ties keep the store's
  // insertion order (never re-derived — matches the board's own ordering rule).
  const rows = $derived(
    [...fleetStore.sessions.values()]
      .filter((c) => c.status === 'waiting-for-you')
      .sort((a, b) => Number(Boolean(b.pendingQuestion)) - Number(Boolean(a.pendingQuestion))),
  );

  function summaryFor(card: SessionCard): string {
    const q = card.pendingQuestion?.questions[0];
    if (q) return q.question || q.header || 'Needs your input';
    return 'Turn complete — review the result';
  }

  function open(sessionId: string): void {
    navigate(`#/session/${encodeURIComponent(sessionId)}`);
  }
</script>

{#if rows.length}
  <div
    class="border border-fleet-warn-border bg-gradient-to-b from-fleet-warn/[0.09] to-fleet-warn/[0.03] rounded-2xl px-4 py-3.5"
    data-testid="needs-you-strip"
  >
    <div class="flex items-center gap-2 mb-2.5">
      <span class="w-2 h-2 rounded-full bg-fleet-warn shadow-[0_0_8px_#fbbf24]"></span>
      <span class="text-[12.5px] font-semibold text-fleet-warn tracking-wide">NEEDS YOU · {rows.length}</span>
    </div>
    <div class="flex flex-col gap-2">
      {#each rows as card (card.sessionId)}
        <button
          type="button"
          onclick={() => open(card.sessionId)}
          class="flex items-center gap-3 w-full text-left bg-fleet-panel border border-fleet-border-strong rounded-[10px] px-3.5 py-2.5 cursor-pointer"
          data-testid="needs-you-row"
        >
          <span class="text-[12.5px] font-semibold text-fleet-text flex-none max-w-[44%] truncate">{card.title}</span>
          <span class="text-xs text-fleet-muted flex-1 min-w-0 truncate">{summaryFor(card)}</span>
          <span class="text-[11px] font-mono text-fleet-accent flex-none">answer →</span>
        </button>
      {/each}
    </div>
  </div>
{/if}

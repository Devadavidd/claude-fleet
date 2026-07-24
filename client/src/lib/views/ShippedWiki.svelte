<!-- "Shipped" tab (#/shipped): a fleet-wide, human-readable retrospective of
     what Claude has built, sourced from /api/wiki (each project's docs/wiki
     entries). Refetches when fleetStore.wikiVersion bumps. The server already
     orders cards shipped-first/newest — rendered as-is, no client re-sort. -->
<script lang="ts">
  import { fleetStore } from '../fleet-store.svelte.js';
  import ShippedWikiCard from '../components/ShippedWikiCard.svelte';
  import type { FleetWiki } from '../../../../shared/types/index.js';

  let wiki = $state<FleetWiki>({ projects: [], cards: [] });
  let loading = $state(true);
  let loadSeq = 0;

  async function load(): Promise<void> {
    const seq = ++loadSeq;
    try {
      const res = await fetch('/api/wiki');
      if (!res.ok) return;
      const data = (await res.json()) as FleetWiki;
      if (seq !== loadSeq) return;
      wiki = data;
    } catch {
      // Offline/parse failure: keep the last good render (fail-soft).
    } finally {
      if (seq === loadSeq) loading = false;
    }
  }

  $effect(() => {
    void fleetStore.wikiVersion; // refetch dependency
    void load();
  });
</script>

<div class="p-6 max-w-[880px] mx-auto flex flex-col gap-4" data-testid="shipped-wiki">
  {#if loading && !wiki.cards.length}
    <div class="text-fleet-faint text-sm text-center py-10">Loading shipped work…</div>
  {:else if !wiki.cards.length}
    <div class="text-fleet-faint text-sm text-center py-10">No shipped work yet — run /cf:wiki in a project to generate entries.</div>
  {:else}
    {#each wiki.cards as card (card.project + '/' + card.slug)}
      <ShippedWikiCard {card} />
    {/each}
  {/if}
</div>

<!-- One Shipped-tab card: badges + the plain-language wiki body. The markdown
     body is mounted via bind:this + $effect (never {@html} — wiki bodies are
     untrusted transcript-derived text, and markdown-renderer already returns
     a real DOM node built with textContent throughout). -->
<script lang="ts">
  import { renderMarkdown } from '../markdown-renderer.js';
  import type { WikiCard } from '../../../../shared/types/index.js';

  interface Props {
    card: WikiCard;
  }

  const { card }: Props = $props();

  let bodyEl = $state<HTMLDivElement>();
  let lessonsEl = $state<HTMLDivElement>();

  // Drop the leading H1 (shown as the card title) and split off a trailing
  // "Gotchas" section into a collapsible so the card stays skimmable.
  const parsed = $derived.by(() => {
    if (!card.summarized || !card.body) return { body: '', lessons: '' };
    let body = card.body.replace(/^#\s+.*\n?/, '');
    const cut = body.search(/^##\s+Gotchas/im);
    let lessons = '';
    if (cut >= 0) {
      lessons = body.slice(cut).replace(/^##\s+.*\n?/, '');
      body = body.slice(0, cut);
    }
    return { body: body.trim(), lessons: lessons.trim() };
  });

  $effect(() => {
    if (bodyEl && parsed.body) bodyEl.replaceChildren(renderMarkdown(parsed.body));
  });

  $effect(() => {
    if (lessonsEl && parsed.lessons) lessonsEl.replaceChildren(renderMarkdown(parsed.lessons));
  });
</script>

<article class="bg-fleet-panel border border-fleet-border rounded-2xl p-4.5" data-testid="wiki-card">
  <div class="flex items-center gap-2 mb-2.5">
    <span class={`w-2 h-2 rounded-full flex-none ${card.shipped ? 'bg-fleet-success' : 'bg-fleet-dim'}`}></span>
    <span class="text-[14px] font-semibold text-fleet-text">{card.plainTitle}</span>
  </div>
  <div class="flex flex-wrap gap-1.5 mb-3">
    <span class={`text-[10.5px] font-mono rounded-full px-2 py-0.5 ${card.shipped ? 'text-fleet-success bg-fleet-success/10' : 'text-fleet-dim bg-fleet-border/40'}`}>
      {card.shipped ? 'shipped' : card.status}
    </span>
    {#if card.completed}<span class="text-[10.5px] font-mono text-fleet-dim">{card.completed}</span>{/if}
    <span class="text-[10.5px] font-mono text-fleet-accent bg-fleet-accent/10 rounded-full px-2 py-0.5">{card.project}</span>
    {#if card.branch}<span class="text-[10.5px] font-mono text-fleet-dim">{card.branch}</span>{/if}
    {#each card.tags as tag (tag)}
      <span class="text-[10.5px] font-mono text-fleet-muted bg-fleet-border/40 rounded-full px-2 py-0.5">{tag}</span>
    {/each}
  </div>

  {#if card.summarized && card.body}
    <div class="text-[13px] text-fleet-muted leading-relaxed" bind:this={bodyEl}></div>
    {#if parsed.lessons}
      <details class="mt-3">
        <summary class="text-xs text-fleet-dim cursor-pointer">Gotchas & lessons</summary>
        <div class="text-[13px] text-fleet-muted leading-relaxed mt-2" bind:this={lessonsEl}></div>
      </details>
    {/if}
  {:else}
    <div class="text-xs text-fleet-dim italic">Not yet summarized — run /cf:wiki to generate a plain-language entry.</div>
  {/if}

  <div class="text-[10.5px] text-fleet-faint font-mono mt-3 pt-3 border-t border-fleet-border">plans/{card.slug}/plan.md</div>
</article>

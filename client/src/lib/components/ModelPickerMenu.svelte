<!-- Desktop-app-style model pill: a small button showing the current model
     that opens a popup list (checkmark on the active row) — replaces the bare
     <select>. `onSelect` absent ⇒ read-only view (a running session's model is
     fixed at spawn), shown with a lock note instead of selectable rows. -->
<script lang="ts">
  interface Props {
    models: string[];
    selected: string;
    onSelect?: (model: string) => void;
    /** Note shown under the list when the pick is informational only. */
    lockedNote?: string;
    testid?: string;
  }

  const { models, selected, onSelect, lockedNote = '', testid = 'model-menu' }: Props = $props();

  let open = $state(false);
  let rootEl = $state<HTMLElement | null>(null);

  // Short display name: strip vendor prefix/date suffix noise for the pill.
  function shortName(id: string): string {
    return id.replace(/^claude-/, '').replace(/-\d{8}$/, '');
  }

  function pick(m: string): void {
    onSelect?.(m);
    open = false;
  }

  function onDocClick(e: MouseEvent): void {
    if (rootEl && !rootEl.contains(e.target as Node)) open = false;
  }

  $effect(() => {
    if (!open) return;
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  });
</script>

<div class="relative" bind:this={rootEl} data-testid={testid}>
  <button
    type="button"
    onclick={() => (open = !open)}
    class="text-[11.5px] font-mono text-fleet-muted bg-[#1a2030] border border-fleet-border-strong rounded-lg px-2.5 py-1 cursor-pointer hover:text-fleet-text"
    aria-haspopup="listbox"
    aria-expanded={open}
    data-testid={`${testid}-pill`}
  >{shortName(selected) || 'model'}</button>

  {#if open}
    <div
      class="absolute bottom-full right-0 mb-2 min-w-[220px] rounded-xl border border-fleet-border-strong bg-fleet-surface shadow-[0_10px_30px_rgba(0,0,0,0.5)] py-1.5 z-30"
      role="listbox"
      data-testid={`${testid}-popup`}
    >
      <div class="px-3 py-1 text-[11px] font-semibold text-fleet-faint">Models</div>
      {#each models as m (m)}
        <button
          type="button"
          role="option"
          aria-selected={m === selected}
          disabled={!onSelect}
          onclick={() => pick(m)}
          class="w-full text-left px-3 py-1.5 flex items-center gap-2 cursor-pointer disabled:cursor-default hover:bg-fleet-accent/10"
          data-testid={`${testid}-option-${m}`}
        >
          <span class={`text-[12.5px] ${m === selected ? 'text-fleet-text' : 'text-fleet-muted'}`}>{shortName(m)}</span>
          <span class="flex-1"></span>
          {#if m === selected}<span class="text-fleet-accent text-[12px]">✓</span>{/if}
        </button>
      {/each}
      {#if lockedNote}
        <div class="px-3 pt-1.5 mt-1 border-t border-fleet-border text-[10.5px] text-fleet-faint leading-snug">{lockedNote}</div>
      {/if}
    </div>
  {/if}
</div>

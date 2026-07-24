<!-- Per-nav-item glyphs, copied verbatim from the designer mockup's inline SVGs
     (docs/design/fleet-redesign/Fleet.dc.html ~L53-59) for every view the
     mockup defines. `workflows` has no mockup icon (the feature predates it) —
     a small 3-node network glyph is added in the same stroke style. -->
<script lang="ts">
  import type { ViewType } from '../router.svelte.js';

  interface Props {
    view: ViewType;
  }

  const { view }: Props = $props();
</script>

{#if view === 'overview'}
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1.6" y="1.6" width="5.4" height="5.4" rx="1.4" stroke="currentColor" stroke-width="1.3"/><rect x="9" y="1.6" width="5.4" height="5.4" rx="1.4" stroke="currentColor" stroke-width="1.3"/><rect x="1.6" y="9" width="5.4" height="5.4" rx="1.4" stroke="currentColor" stroke-width="1.3"/><rect x="9" y="9" width="5.4" height="5.4" rx="1.4" stroke="currentColor" stroke-width="1.3"/></svg>
{:else if view === 'board'}
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1.6" y="2" width="3.4" height="12" rx="1.1" stroke="currentColor" stroke-width="1.3"/><rect x="6.3" y="2" width="3.4" height="8.4" rx="1.1" stroke="currentColor" stroke-width="1.3"/><rect x="11" y="2" width="3.4" height="10.2" rx="1.1" stroke="currentColor" stroke-width="1.3"/></svg>
{:else if view === 'agents'}
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="3.4" r="2" stroke="currentColor" stroke-width="1.3"/><circle cx="3.4" cy="12" r="2" stroke="currentColor" stroke-width="1.3"/><circle cx="12.6" cy="12" r="2" stroke="currentColor" stroke-width="1.3"/><path d="M8 5.4v2.2M8 7.6 4.2 10.4M8 7.6l3.8 2.8" stroke="currentColor" stroke-width="1.2"/></svg>
{:else if view === 'workflows'}
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="3" cy="3" r="1.8" stroke="currentColor" stroke-width="1.3"/><circle cx="13" cy="8" r="1.8" stroke="currentColor" stroke-width="1.3"/><circle cx="3" cy="13" r="1.8" stroke="currentColor" stroke-width="1.3"/><path d="M4.6 3.9 11.3 7.2M4.6 12.1 11.3 8.8" stroke="currentColor" stroke-width="1.2"/></svg>
{:else if view === 'always-on'}
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4.2 5.5A4 4 0 1 1 3 8.4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M4.4 2.6v3h-3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
{:else if view === 'files'}
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 1.8h4.2L12 5.4V14a.6.6 0 0 1-.6.6H4A.6.6 0 0 1 3.4 14V2.4A.6.6 0 0 1 4 1.8Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M8 1.9V5.6h3.7" stroke="currentColor" stroke-width="1.2"/></svg>
{:else if view === 'shipped'}
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 1.7 14 5v6l-6 3.3L2 11V5z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="m5.6 7.8 1.7 1.7 3.4-3.4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
{:else if view === 'skills'}
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 1.5l1.6 4.3 4.4 1.7-4.4 1.7L8 13.5 6.4 9.2 2 7.5l4.4-1.7z" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/></svg>
{/if}

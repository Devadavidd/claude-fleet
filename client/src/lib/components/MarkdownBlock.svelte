<!-- Mounts markdown-renderer.ts's XSS-safe DOM tree into a `.md` container.
     Shared by the file viewer, shipped wiki, and session timeline so rendered
     markdown looks identical everywhere (never {@html} — the source is
     untrusted transcript/file text; the renderer builds nodes via textContent).
     bind:this MUST be $state to stay reactive, and `source` is read before the
     ref guard so the effect re-runs whenever the text changes. -->
<script lang="ts">
  import { renderMarkdown } from '../markdown-renderer.js';

  interface Props {
    source: string;
    class?: string;
  }

  const { source, class: className = '' }: Props = $props();

  let el = $state<HTMLDivElement>();

  $effect(() => {
    const md = source ?? '';
    if (el) el.replaceChildren(renderMarkdown(md));
  });
</script>

<div bind:this={el} class={`md ${className}`}></div>

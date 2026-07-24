<!-- Bash output rendered as a colored ANSI terminal block. Split from the legacy
     tool-event-renderers.js/session-terminal-view.js pattern: CR-rewrites
     (progress bars) collapse to their final line, then SGR sequences become
     safe `ansi-fg-*`/`ansi-bg-*`/`ansi-bold` spans (see style.css `.terminal`).
     Mounted via bind:this + $effect — never {@html} — since the fragment
     ansiToFragment() builds is DOM-API-only (untrusted transcript text). -->
<script lang="ts">
  import { ansiToFragment, collapseCarriageReturns } from '../ansi-to-html.js';

  interface Props {
    text: string;
  }

  const { text }: Props = $props();

  let el: HTMLPreElement | undefined;

  $effect(() => {
    if (!el) return;
    el.replaceChildren(ansiToFragment(collapseCarriageReturns(text)));
  });
</script>

<pre bind:this={el} class="terminal" data-testid="terminal-output"></pre>

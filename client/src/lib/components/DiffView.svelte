<!-- Edit/MultiEdit/Write diff renderer: each old→new pair as a red (removed) line
     followed by a green (added) line, split from the legacy tool-event-renderers.js
     appendToolInput() Edit/Write branch. Write has no "old" side (a new file), so
     a pair with an empty oldText renders only its green line — never an empty
     red block. Untrusted transcript text throughout → text bindings only. -->
<script lang="ts">
  interface DiffPair {
    oldText: string;
    newText: string;
  }

  interface Props {
    filePath: string;
    pairs: DiffPair[];
  }

  const { filePath, pairs }: Props = $props();
</script>

<div data-testid="diff-view">
  {#if filePath}
    <div class="text-[11px] text-fleet-dim font-mono mb-1.5" data-testid="diff-view-path">{filePath}</div>
  {/if}
  {#each pairs as pair, i (i)}
    <div class="rounded-md overflow-hidden mb-1.5 last:mb-0">
      {#if pair.oldText}
        <pre
          class="m-0 px-2.5 py-1.5 bg-[#2d1620] text-[#fb7185] font-mono text-xs whitespace-pre-wrap break-words"
          data-testid="diff-del"
        >{pair.oldText}</pre>
      {/if}
      {#if pair.newText}
        <pre
          class="m-0 px-2.5 py-1.5 bg-[#10261a] text-[#4ade80] font-mono text-xs whitespace-pre-wrap break-words"
          data-testid="diff-add"
        >{pair.newText}</pre>
      {/if}
    </div>
  {/each}
</div>

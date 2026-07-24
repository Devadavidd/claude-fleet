<!-- Timeline/terminal row wrapper for one tool_use / tool_result: a clickable
     header (icon + tool name + target file/command detail) that toggles the
     body open/closed, plus an "open worker →" link for Task/Agent spawns.
     Auto-expanded by default (defaultOpen) — the lead wants everything visible
     without clicking; split from the legacy tool-event-renderers.js row/summary
     pattern so DiffView/TerminalOutput/plain-JSON bodies can all reuse it. -->
<script lang="ts">
  import { untrack } from 'svelte';
  import type { Snippet } from 'svelte';

  interface Props {
    icon: string;
    name: string;
    detail?: string;
    isError?: boolean;
    defaultOpen?: boolean;
    isSubagent?: boolean;
    agentHref?: string | null;
    children?: Snippet;
  }

  const {
    icon,
    name,
    detail = '',
    isError = false,
    defaultOpen = true,
    isSubagent = false,
    agentHref = null,
    children,
  }: Props = $props();

  // Only the INITIAL value of defaultOpen seeds `open` — a later prop change
  // (e.g. re-parenting to a different entry) must not yank a user's manual
  // toggle back open/closed, so the read is deliberately untracked.
  let open = $state(untrack(() => defaultOpen));
</script>

<div
  class={`rounded-lg border overflow-hidden mb-1.5 ${isError ? 'border-[#5c2836]' : 'border-fleet-border'} bg-[#0f131a]`}
  data-testid="tool-event"
  data-tool-name={name}
>
  <button
    type="button"
    class="w-full flex items-center gap-2 text-left px-3 py-2 font-mono cursor-pointer"
    onclick={() => { open = !open; }}
    data-testid="tool-event-header"
  >
    <span class={`text-xs font-semibold flex-none ${isError ? 'text-fleet-warn' : 'text-fleet-text'}`}>{icon} {name}</span>
    {#if detail}
      <span class="text-[12px] text-fleet-success flex-1 min-w-0 truncate" data-testid="tool-event-detail">{detail}</span>
    {/if}
    {#if isSubagent && agentHref}
      <a
        href={agentHref}
        class="text-[11px] text-fleet-accent flex-none"
        onclick={(e) => e.stopPropagation()}
        data-testid="tool-event-agent-link"
      >
        open worker →
      </a>
    {/if}
  </button>
  {#if open}
    <div class="px-3 pb-3" data-testid="tool-event-body">
      {@render children?.()}
    </div>
  {/if}
</div>

<!-- Per-session "Terminal": lead + every worker's Bash commands merged by time,
     NEWEST command at top. Worker commands are tagged [label]; a command still
     awaiting its result shows a blinking cursor (see style.css .term-cursor).
     Reuses the timeline API (no extra server surface) via extractBashPairs —
     split from the legacy session-terminal-view.js. -->
<script lang="ts">
  import { fleetStore } from '../fleet-store.svelte.js';
  import TerminalOutput from './TerminalOutput.svelte';
  import { extractBashPairs } from '../extract-bash-pairs.js';
  import type { BashPair } from '../extract-bash-pairs.js';
  import type { TimelineResponse } from '../../../../shared/types/index.js';

  interface Props {
    sessionId: string;
  }

  const { sessionId }: Props = $props();

  const agents = $derived(fleetStore.sessions.get(sessionId)?.agents ?? []);

  let pairs = $state<BashPair[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);

  async function fetchPairs(base: string, label: string, isWorker: boolean): Promise<BashPair[]> {
    try {
      const res = await fetch(`${base}/timeline?limit=1000`);
      if (!res.ok) return [];
      const data = (await res.json()) as TimelineResponse;
      return extractBashPairs(data.events, { label, isWorker });
    } catch {
      return [];
    }
  }

  async function refresh(): Promise<void> {
    const sources = [
      { base: `/api/sessions/${encodeURIComponent(sessionId)}`, label: '', isWorker: false },
      ...agents.map((a) => ({
        base: `/api/sessions/${encodeURIComponent(sessionId)}/agents/${encodeURIComponent(a.agentId)}`,
        label: a.label || a.agentType || a.agentId,
        isWorker: true,
      })),
    ];
    try {
      const settled = await Promise.all(sources.map((s) => fetchPairs(s.base, s.label, s.isWorker)));
      const merged = settled.flat();
      // Newest first; tie-break lead before workers.
      merged.sort((a, b) => (b.ts - a.ts) || (Number(a.isWorker) - Number(b.isWorker)));
      pairs = merged;
      error = null;
    } catch {
      error = 'Failed to load terminal — is the server running?';
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void sessionId; void agents.length; // refetch when the agent roster changes too
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 2500);
    return () => clearInterval(timer);
  });
</script>

<div class="p-4 flex flex-col gap-2.5" data-testid="session-terminal">
  {#if loading && !pairs.length}
    <div class="text-fleet-faint text-sm text-center py-10">Loading terminal…</div>
  {:else if error && !pairs.length}
    <div class="text-fleet-faint text-sm text-center py-10">{error}</div>
  {:else if !pairs.length}
    <div class="text-fleet-faint text-sm text-center py-10">No shell commands in this session yet.</div>
  {:else}
    {#each pairs as pair (pair.id)}
      <div class="border-b border-fleet-border pb-2.5 last:border-0" data-testid="terminal-entry">
        <div class="flex items-center gap-1.5 flex-wrap font-mono text-[12.5px]">
          <span class="text-fleet-success font-semibold flex-none">$</span>
          {#if pair.isWorker}
            <span class="text-fleet-accent flex-none" data-testid="terminal-worker-tag">[{pair.sourceLabel}]</span>
          {/if}
          <span class="text-fleet-text break-words">{pair.command || pair.detail || '(command)'}</span>
          {#if pair.running}
            <span class="term-cursor" data-testid="term-cursor"></span>
          {/if}
        </div>
        {#if !pair.running}
          <div class="pl-4 mt-1">
            <TerminalOutput text={pair.output || '(no output)'} />
          </div>
        {/if}
      </div>
    {/each}
  {/if}
</div>

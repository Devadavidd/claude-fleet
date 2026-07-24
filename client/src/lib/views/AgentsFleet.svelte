<!-- Fleet-wide agents tab (#/agents): every subagent worker across every live
     session, grouped session → workers. Data is the same SessionCard.agents
     the board consumes (fleetStore.sessions) — no separate fetch needed. -->
<script lang="ts">
  import { fleetStore } from '../fleet-store.svelte.js';
  import { navigate } from '../router.svelte.js';
  import type { SessionCard, SubagentCard } from '../../../../shared/types/index.js';

  const sessionsWithAgents = $derived(
    [...fleetStore.sessions.values()]
      .filter((c) => c.agents.length > 0)
      .sort((a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0)),
  );

  const totalWorkers = $derived(sessionsWithAgents.reduce((n, c) => n + c.agents.length, 0));
  const runningWorkers = $derived(sessionsWithAgents.flatMap((c) => c.agents).filter((a) => a.status === 'running').length);

  function projectLabel(card: SessionCard): string {
    return card.projectSlug.replace(/^-Users-[^-]+-?/, '') || card.projectSlug;
  }

  function sessionDot(card: SessionCard): string {
    if (card.status === 'working') return 'bg-fleet-success';
    if (card.status === 'waiting-for-you') return 'bg-fleet-warn';
    return 'bg-fleet-dim';
  }

  const AGENT_DOT_CLASS: Record<SubagentCard['status'], string> = { running: 'bg-fleet-success', idle: 'bg-fleet-warn', done: 'bg-fleet-dim' };
  const AGENT_STATUS_LABEL: Record<SubagentCard['status'], string> = { running: 'running', done: 'done', idle: 'stalled' };

  function openSession(sessionId: string): void {
    navigate(`#/session/${encodeURIComponent(sessionId)}`);
  }

  function openAgent(sessionId: string, agentId: string, e: MouseEvent): void {
    e.stopPropagation();
    navigate(`#/session/${encodeURIComponent(sessionId)}/agent/${encodeURIComponent(agentId)}`);
  }
</script>

<div class="p-6 flex flex-col gap-4" data-testid="agents-fleet">
  {#if sessionsWithAgents.length}
    <div class="text-xs text-fleet-muted">{totalWorkers} workers across {sessionsWithAgents.length} sessions — {runningWorkers} running</div>
  {/if}

  {#if !sessionsWithAgents.length}
    <div class="text-fleet-faint text-sm text-center py-10">No subagent workers in any active session.</div>
  {:else}
    {#each sessionsWithAgents as card (card.sessionId)}
      <section class="bg-fleet-panel border border-fleet-border rounded-xl p-3.5 flex flex-col gap-2" data-testid="agents-session">
        <button type="button" onclick={() => openSession(card.sessionId)} class="flex items-center gap-2.5 text-left cursor-pointer">
          <span class={`w-2 h-2 rounded-full flex-none ${sessionDot(card)}`}></span>
          <span class="text-[13.5px] font-semibold text-fleet-text">{card.title}</span>
          <span class="text-[11.5px] text-fleet-dim font-mono">{projectLabel(card)}</span>
        </button>
        {#each card.agents as agent (agent.agentId)}
          <button
            type="button"
            onclick={(e) => openAgent(card.sessionId, agent.agentId, e)}
            class="flex items-center gap-2 bg-[#131720] border-l-2 border-fleet-accent rounded-md px-2.5 py-1.5 text-left cursor-pointer"
            data-testid="agents-fleet-row"
          >
            <span class={`w-1.5 h-1.5 rounded-full flex-none ${AGENT_DOT_CLASS[agent.status]}`}></span>
            <span class="text-[11.5px] text-fleet-text font-medium">🤖 {agent.label}</span>
            <span class="text-[10.5px] text-fleet-dim font-mono">{agent.agentType}</span>
            <span class="text-[10.5px] text-fleet-muted font-mono truncate">— {AGENT_STATUS_LABEL[agent.status]}: {agent.currentAction}</span>
          </button>
        {/each}
      </section>
    {/each}
  {/if}
</div>

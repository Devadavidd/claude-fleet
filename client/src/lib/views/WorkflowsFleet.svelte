<!-- Fleet-wide Workflows tab (#/workflows): every multi-agent workflow run
     across the fleet, reproducing the native "Background tasks" panel — per
     run, agent rows grouped by phase with label · tokens · tools · time ·
     status. Read-only; live via fleetStore.workflows (the 'workflow' SSE). -->
<script lang="ts">
  import { fleetStore } from '../fleet-store.svelte.js';
  import { formatDuration, formatTokens, workflowStatusLabel, sortWorkflows, displayLabel } from '../workflow-view-format.js';
  import type { WorkflowRun, WorkflowAgent } from '../../../../shared/types/index.js';

  const workflows = $derived(sortWorkflows([...fleetStore.workflows.values()]));
  const runningCount = $derived(workflows.filter((w) => w.status === 'running').length);

  // Workflows aren't in the SSE snapshot — hydrate on mount so settled runs
  // reappear on a fresh load / reconnect (running ones self-heal via deltas).
  $effect(() => {
    let alive = true;
    fetch('/api/workflows')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: WorkflowRun[] | null) => { if (alive && data) fleetStore.hydrateWorkflows(data); })
      .catch(() => { /* offline — SSE deltas still populate live */ });
    return () => { alive = false; };
  });

  let expandedKeys = $state(new Set<string>());

  function key(wf: WorkflowRun): string {
    return `${wf.sessionId}:${wf.workflowId}`;
  }

  function toggle(k: string): void {
    const next = new Set(expandedKeys);
    if (next.has(k)) next.delete(k); else next.add(k);
    expandedKeys = next;
  }

  interface PhaseGroup { title: string; agents: WorkflowAgent[] }

  // Orders agents into their declared phases, leftover phase/none last —
  // mirrors the native panel's phase sections.
  function groupByPhase(wf: WorkflowRun): PhaseGroup[] {
    const agents = wf.agents;
    const groups: PhaseGroup[] = [];
    const seen = new Set<WorkflowAgent>();
    for (const phase of wf.phases) {
      const inPhase = agents.filter((a) => a.phase === phase.title);
      inPhase.forEach((a) => seen.add(a));
      groups.push({ title: phase.title, agents: inPhase });
    }
    const leftover = agents.filter((a) => !seen.has(a));
    if (leftover.length) groups.push({ title: groups.length ? '—' : '', agents: leftover });
    return groups.filter((g) => g.agents.length);
  }
</script>

<div class="p-6 flex flex-col gap-3" data-testid="workflows-fleet">
  {#if workflows.length}
    <div class="text-xs text-fleet-muted">{workflows.length} workflow{workflows.length > 1 ? 's' : ''} — {runningCount} running</div>
  {/if}

  {#if !workflows.length}
    <div class="text-fleet-faint text-sm text-center py-10">No workflows running. Launch one with the Launch button (workflow toggle).</div>
  {:else}
    {#each workflows as wf (key(wf))}
      {@const k = key(wf)}
      {@const open = expandedKeys.has(k)}
      <section class="bg-fleet-panel border border-fleet-border rounded-xl p-3.5 flex flex-col gap-2" data-testid="workflow-run-row">
        <button type="button" onclick={() => toggle(k)} class="flex items-center gap-2.5 text-left cursor-pointer w-full">
          <span class="text-[10px] text-fleet-dim w-2 flex-none">{open ? '▾' : '▸'}</span>
          <span class={`w-2 h-2 rounded-full flex-none ${wf.status === 'running' ? 'bg-fleet-success' : 'bg-fleet-dim'}`}></span>
          <span class="text-[13.5px] font-semibold text-fleet-text flex-1 min-w-0 truncate">{wf.name || wf.workflowId}</span>
          <span class="text-[11px] font-mono text-fleet-muted flex-none">{workflowStatusLabel(wf)}</span>
        </button>
        {#if wf.description}
          <div class="text-xs text-fleet-muted pl-4.5">{wf.description}</div>
        {/if}
        <div class="text-[11px] text-fleet-dim font-mono pl-4.5">{wf.agentCount} agents · {formatTokens(wf.tokensTotal)} tokens · {wf.toolsTotal} tools</div>

        {#if open}
          <div class="flex flex-col gap-1.5 pl-4.5">
            {#each groupByPhase(wf) as group (group.title || 'none')}
              {#if group.title}
                <div class="text-[10.5px] text-fleet-faint font-mono uppercase tracking-wide mt-1">{group.title}</div>
              {/if}
              {#each group.agents as agent (agent.agentId)}
                <div
                  class="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-3 bg-fleet-panel-deep border-l-2 border-fleet-accent rounded-md px-2.5 py-1.5"
                  data-testid="workflow-agent-row"
                >
                  <span class="flex items-center gap-1.5 min-w-0">
                    <span class={`w-1.5 h-1.5 rounded-full flex-none ${agent.status === 'running' ? 'bg-fleet-success' : agent.status === 'idle' ? 'bg-fleet-warn' : 'bg-fleet-dim'}`}></span>
                    <span class="text-[11.5px] text-fleet-text font-medium truncate">🤖 {displayLabel(agent)}</span>
                  </span>
                  <span class="text-[10.5px] text-fleet-dim font-mono">{agent.agentType}</span>
                  <span class="text-[10.5px] text-fleet-muted font-mono">{formatTokens(agent.tokens)}</span>
                  <span class="text-[10.5px] text-fleet-muted font-mono">{agent.toolCount} tools</span>
                  <span class="text-[10.5px] text-fleet-muted font-mono">{formatDuration(agent.durationMs)}</span>
                </div>
              {/each}
            {/each}
          </div>
        {/if}
      </section>
    {/each}
  {/if}
</div>

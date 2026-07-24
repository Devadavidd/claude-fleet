<!-- One live subagent worker row under a session card: 🤖 + label + status +
     current action. Click deep-links to that worker's timeline; stopPropagation
     so the click doesn't also open the parent session (mirrors the legacy
     agent-row handler in public/fleet-session-card.js). -->
<script lang="ts">
  import { navigate } from '../router.svelte.js';
  import type { SubagentCard } from '../../../../shared/types/index.js';

  interface Props {
    agent: SubagentCard;
    sessionId: string;
  }

  const { agent, sessionId }: Props = $props();

  // Mirrors legacy AGENT_STATUS_LABELS verbatim: an idle worker reads "stalled".
  const AGENT_STATUS_LABELS: Record<SubagentCard['status'], string> = {
    running: 'running',
    done: 'done',
    idle: 'stalled',
  };

  const dotClass = $derived(
    agent.status === 'running' ? 'bg-fleet-success' : agent.status === 'idle' ? 'bg-fleet-warn' : 'bg-fleet-dim',
  );

  function open(e: MouseEvent | KeyboardEvent): void {
    e.stopPropagation();
    navigate(`#/session/${encodeURIComponent(sessionId)}/agent/${encodeURIComponent(agent.agentId)}`);
  }
</script>

<div
  class="flex items-center gap-1.5 bg-[#131720] border-l-2 border-fleet-accent rounded-md px-2 py-1 min-w-0 cursor-pointer"
  onclick={open}
  onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') open(e); }}
  role="button"
  tabindex="0"
  data-testid="subagent-row"
>
  <span class={`w-1.5 h-1.5 rounded-full flex-none ${dotClass}`}></span>
  <span class="text-[11.5px] text-fleet-text font-medium flex-none max-w-[40%] truncate">🤖 {agent.label}</span>
  <span class="text-[10.5px] text-fleet-muted font-mono flex-1 min-w-0 truncate">
    — {AGENT_STATUS_LABELS[agent.status] ?? agent.status}: {agent.currentAction}
  </span>
</div>

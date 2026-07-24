<!-- Board card: title, project slug, status dot/label, action, question chips,
     subagent rows, token-burn sparkline, files/tasks/time meta strip. Pulses
     (fleetPulse, style.css) while waiting-for-you — same as the legacy card's
     `.pulse` class in public/fleet-dashboard.css. Clicking the body opens the
     session; nested interactive rows/chips stopPropagation their own clicks. -->
<script lang="ts">
  import { navigate } from '../router.svelte.js';
  import SubagentRow from './SubagentRow.svelte';
  import QuestionChips from './QuestionChips.svelte';
  import SessionDismissMenu from './SessionDismissMenu.svelte';
  import LaunchedControls from './LaunchedControls.svelte';
  import type { SessionCard as SessionCardType } from '../../../../shared/types/index.js';

  interface Props {
    card: SessionCardType;
  }

  const { card }: Props = $props();

  function formatTokens(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return String(n);
  }

  function relativeTime(ts: number): string {
    const secs = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (secs < 60) return `${secs}s ago`;
    if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
    return `${Math.round(secs / 3600)}h ago`;
  }

  const projectSlug = $derived(card.projectSlug.replace(/^-Users-[^-]+-?/, '') || card.projectSlug);
  // A finished turn with no pending question reads as "done" (green check, not
  // a dot); both it and "needs answer" share the underlying 'waiting-for-you'
  // status (and both pulse) — mirrors public/fleet-session-card.js exactly.
  const isDone = $derived(card.status === 'waiting-for-you' && !card.pendingQuestion);
  const isWaiting = $derived(card.status === 'waiting-for-you');
  const statusLabel = $derived(
    isDone ? 'done' : isWaiting ? 'needs answer' : card.status === 'working' ? 'working' : 'idle',
  );
  const dotClass = $derived(card.status === 'working' ? 'bg-fleet-success' : isWaiting ? 'bg-fleet-warn' : 'bg-fleet-dim');

  const perMin = $derived(card.tokens.perMin);
  const hasBurn = $derived(card.tokens.output > 0 || perMin.some(Boolean));
  const sparkPoints = $derived.by(() => {
    if (perMin.length < 2) return '';
    const max = Math.max(...perMin, 1);
    return perMin.map((v, i) => `${(i / (perMin.length - 1)) * 100},${18 - (v / max) * 16}`).join(' ');
  });
  const burnLabel = $derived.by(() => {
    const rate = perMin.length ? perMin.slice(-5).reduce((a, b) => a + b, 0) / 5 : 0;
    return `${formatTokens(card.tokens.output)} out · ${formatTokens(card.tokens.cacheRead)} cache · ${Math.round(rate)}/min`;
  });

  function openSession(): void {
    navigate(`#/session/${encodeURIComponent(card.sessionId)}`);
  }
</script>

<div
  class={`bg-fleet-panel border border-fleet-border-strong rounded-xl p-3.5 cursor-pointer ${isWaiting ? 'fleet-pulse' : ''}`}
  onclick={openSession}
  onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') openSession(); }}
  role="button"
  tabindex="0"
  data-testid="session-card"
  data-session-id={card.sessionId}
>
  <div class="flex items-start gap-1.5">
    <div class="font-semibold text-[13.5px] text-fleet-text leading-snug mb-0.5 truncate flex-1">{card.title}</div>
    <SessionDismissMenu sessionId={card.sessionId} />
  </div>
  <div class="text-[11.5px] text-fleet-dim font-mono mb-2.5 truncate">{projectSlug}</div>

  <div class="flex items-center gap-1.5 mb-2">
    {#if isDone}
      <span class="text-fleet-success font-bold text-xs leading-none">✓</span>
    {:else}
      <span class={`w-2 h-2 rounded-full flex-none ${dotClass}`}></span>
    {/if}
    <span class="text-xs font-medium text-fleet-text">{statusLabel}</span>
    {#if card.launched}
      <span class="ml-auto text-[10px] font-mono text-fleet-accent border border-[#33346a] rounded-full px-1.5">
        {card.steerable ? 'steerable' : 'launched'}
      </span>
    {/if}
  </div>

  <div class="text-[11.5px] text-fleet-muted font-mono truncate mb-2.5">{card.currentAction}</div>

  {#if card.pendingQuestion}
    <QuestionChips {card} />
  {/if}

  {#if card.launched}
    <LaunchedControls {card} />
  {/if}

  {#if card.agents.length}
    <div class="flex flex-col gap-1 mb-2.5">
      {#each card.agents as agent (agent.agentId)}
        <SubagentRow {agent} sessionId={card.sessionId} />
      {/each}
    </div>
  {/if}

  {#if hasBurn}
    <div class="flex items-center gap-2 mb-2.5 flex-wrap">
      <svg viewBox="0 0 100 18" preserveAspectRatio="none" class="w-[84px] h-[18px] flex-none">
        <polyline points={sparkPoints} fill="none" stroke="var(--color-fleet-accent)" stroke-width="1.6" />
      </svg>
      <span class="text-[10.5px] text-fleet-dim font-mono">{burnLabel}</span>
    </div>
  {/if}

  <div class="flex gap-3.5 flex-wrap text-[11px] text-fleet-dim font-mono pt-2 border-t border-fleet-border">
    <span>{card.filesTouched.length} files</span>
    {#if card.taskSummary.total}
      <span class="text-fleet-success">✓ {card.taskSummary.completed}/{card.taskSummary.total}</span>
    {/if}
    {#if card.subagentCount}
      <span>{card.subagentCount} agents</span>
    {/if}
    <span class="ml-auto">{card.lastActivityAt ? relativeTime(card.lastActivityAt) : ''}</span>
  </div>
</div>

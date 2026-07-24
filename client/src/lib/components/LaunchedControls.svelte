<!-- Control row for a dashboard-launched session: Stop (kill) on every launched
     card, plus Finish + a free-text follow-up on steerable ones — restoring the
     legacy public/fleet-session-card.js patchLaunched() affordances so an
     autonomous bypassPermissions session can always be halted/steered from the
     UI (not just by the idle reaper). All actions stopPropagation so they never
     open the session behind the card; fail-soft — the next SSE delta reconciles. -->
<script lang="ts">
  import { fleetHeaders } from '../auth.js';
  import type { SessionCard } from '../../../../shared/types/index.js';

  interface Props {
    card: SessionCard;
  }

  const { card }: Props = $props();
  const steerable = $derived(card.launched === true && card.steerable === true);

  let followUp = $state('');
  let busy = $state(false);

  async function post(url: string, body?: unknown): Promise<void> {
    busy = true;
    try {
      await fetch(url, { method: 'POST', headers: fleetHeaders(), body: body ? JSON.stringify(body) : undefined });
    } catch {
      // Fail-soft: offline / non-2xx just means the action didn't land this click.
    } finally {
      busy = false;
    }
  }

  const base = $derived(`/api/sessions/${encodeURIComponent(card.sessionId)}`);

  function stop(e: MouseEvent): void { e.stopPropagation(); void post(`${base}/kill`); }
  function finish(e: MouseEvent): void { e.stopPropagation(); void post(`${base}/steer`, { type: 'finish' }); }
  function sendFollowUp(e: MouseEvent | KeyboardEvent): void {
    e.stopPropagation();
    const text = followUp.trim();
    if (!text) return;
    followUp = '';
    void post(`${base}/steer`, { type: 'message', text });
  }
</script>

<div class="flex flex-col gap-1.5 mb-2.5" data-testid="launched-controls">
  <div class="flex gap-1.5">
    <button
      type="button" disabled={busy} onclick={stop}
      class="text-[11px] bg-fleet-warn/10 border border-fleet-warn-border text-fleet-warn-text rounded-lg px-2.5 py-1 cursor-pointer disabled:opacity-60"
      data-testid="launched-stop"
    >⏹ Stop</button>
    {#if steerable}
      <button
        type="button" disabled={busy} onclick={finish}
        class="text-[11px] bg-fleet-chip border border-fleet-border-strong text-fleet-muted rounded-lg px-2.5 py-1 cursor-pointer disabled:opacity-60"
        data-testid="launched-finish"
      >✓ Finish</button>
    {/if}
  </div>
  {#if steerable}
    <div class="flex gap-1.5">
      <input
        bind:value={followUp}
        placeholder="Follow up…"
        onclick={(e) => e.stopPropagation()}
        onkeydown={(e) => { if (e.key === 'Enter') sendFollowUp(e); }}
        class="flex-1 min-w-0 bg-fleet-bg border border-fleet-border-strong rounded-lg px-2 py-1 text-[11.5px] text-fleet-text outline-none"
        data-testid="launched-followup-input"
      />
      <button
        type="button" disabled={busy || !followUp.trim()} onclick={sendFollowUp}
        class="text-[11px] bg-gradient-to-br from-fleet-accent to-fleet-accent-deep text-white rounded-lg px-2.5 py-1 cursor-pointer disabled:opacity-60"
        data-testid="launched-followup-send"
      >Send</button>
    </div>
  {/if}
</div>

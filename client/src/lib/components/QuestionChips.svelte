<!-- Surfaces the pending AskUserQuestion/plan-approval right on the card (and
     inside the session composer). A steerable launched session's option chips
     are clickable and POST the answer via /api/sessions/:id/steer (fail-soft
     on non-2xx — the next SSE delta reconciles real state either way);
     otherwise chips are read-only spans. Single-select questions send on
     click; multiSelect questions toggle chips locally and send the whole
     selection with the Answer button. -->
<script lang="ts">
  import { fleetMutate } from '../auth.js';
  import type { SessionCard } from '../../../../shared/types/index.js';

  interface Props {
    card: SessionCard;
  }

  const { card }: Props = $props();
  const pending = $derived(card.pendingQuestion);
  // Answerable when the child can be steered — or when it is NOT ours/alive at
  // all, in which case the steer endpoint resumes the session with the answer.
  // Only a launched-but-unsteerable (stdin closed) child stays read-only.
  const canAnswer = $derived(card.launched === true ? card.steerable === true : true);

  // Per-question toggled options for multiSelect questions, keyed by question
  // index. Reset only when a DIFFERENT question block arrives: the effect must
  // key on a derived primitive (string compares by value), because card objects
  // are rebuilt wholesale on every SSE snapshot/delta — keying on the object
  // would wipe an in-progress selection mid-click.
  const pendingId = $derived(pending?.toolUseId ?? '');
  let picked = $state<Record<number, string[]>>({});
  $effect(() => { void pendingId; picked = {}; });

  async function send(selections: string[]): Promise<void> {
    try {
      await fleetMutate(`/api/sessions/${encodeURIComponent(card.sessionId)}/steer`, { type: 'answer', selections });
    } catch {
      // Fail-soft: offline/non-2xx just means the answer wasn't sent this click.
    }
  }

  function onChipClick(qIndex: number, multi: boolean, label: string, e: MouseEvent): void {
    e.stopPropagation(); // never also open the session behind the card
    if (!multi) { void send([label]); return; }
    const current = picked[qIndex] ?? [];
    picked = {
      ...picked,
      [qIndex]: current.includes(label) ? current.filter((l) => l !== label) : [...current, label],
    };
  }

  function submitMulti(qIndex: number, e: MouseEvent): void {
    e.stopPropagation();
    const selections = picked[qIndex] ?? [];
    if (selections.length) void send(selections);
  }
</script>

{#if pending}
  <div class="bg-fleet-warn/[0.07] border border-[#4a3f18] rounded-lg px-2.5 py-2 mb-2.5" data-testid="question-chips">
    <div class="text-[11px] font-semibold text-fleet-dim mb-1">
      {canAnswer ? '👤 Answer it below' : '👤 Lead is waiting for your answer'}
    </div>
    {#each pending.questions as q, i (i)}
      <div class="mb-1.5 last:mb-0">
        {#if q.header}
          <div class="text-[11px] font-semibold text-fleet-warn mb-1">
            ❓ {q.header}{q.multiSelect ? ' (multi)' : ''}
          </div>
        {/if}
        {#if q.question}
          <div class="text-xs text-fleet-muted leading-snug mb-1.5">{q.question}</div>
        {/if}
        <div class="flex flex-wrap gap-1.5 items-center">
          {#each q.options as label (label)}
            {#if canAnswer}
              {@const on = q.multiSelect && (picked[i] ?? []).includes(label)}
              <button
                type="button"
                class={`text-[11.5px] border rounded-full px-2.5 py-0.5 cursor-pointer ${on ? 'bg-fleet-accent/25 border-fleet-accent text-fleet-text' : 'bg-[#1a2030] border-[#33346a] text-fleet-accent'}`}
                aria-pressed={q.multiSelect ? on : undefined}
                onclick={(e) => onChipClick(i, q.multiSelect, label, e)}
              >
                {label}
              </button>
            {:else}
              <span class="text-[11.5px] bg-[#1a2030] border border-[#33346a] text-fleet-accent rounded-full px-2.5 py-0.5">
                {label}
              </span>
            {/if}
          {/each}
          {#if canAnswer && q.multiSelect}
            <button
              type="button"
              disabled={!(picked[i] ?? []).length}
              onclick={(e) => submitMulti(i, e)}
              class="text-[11.5px] bg-gradient-to-br from-fleet-accent to-fleet-accent-deep text-white rounded-full px-3 py-0.5 cursor-pointer disabled:opacity-50"
              data-testid={`question-multi-send-${i}`}
            >Answer</button>
          {/if}
        </div>
      </div>
    {/each}
  </div>
{/if}

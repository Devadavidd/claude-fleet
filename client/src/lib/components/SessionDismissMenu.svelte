<!-- ✕ menu available on EVERY session (card corner + session composer):
     Hide (default — display-only, transcript untouched) and Delete forever
     (the app's only irreversible action — armed by a first click, executed by
     a confirming second click in red). All clicks stopPropagation so they
     never open the session behind the card. -->
<script lang="ts">
  import { fleetMutate } from '../auth.js';

  interface Props {
    sessionId: string;
  }

  const { sessionId }: Props = $props();

  let open = $state(false);
  let armedDelete = $state(false); // first "Delete forever…" click arms; second executes
  let busy = $state(false);
  let error = $state<string | null>(null);
  let rootEl = $state<HTMLElement | null>(null);

  async function post(action: 'hide' | 'delete-transcript'): Promise<void> {
    busy = true;
    error = null;
    try {
      const res = await fleetMutate(`/api/sessions/${encodeURIComponent(sessionId)}/${action}`);
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        error = data.error ?? `failed (${res.status})`;
        return;
      }
      open = false; // success — the SSE session-removed drops the card
    } catch {
      error = 'network error';
    } finally {
      busy = false;
    }
  }

  function toggle(e: MouseEvent): void {
    e.stopPropagation();
    open = !open;
    armedDelete = false;
    error = null;
  }

  function onHide(e: MouseEvent): void {
    e.stopPropagation();
    void post('hide');
  }

  function onDelete(e: MouseEvent): void {
    e.stopPropagation();
    if (!armedDelete) { armedDelete = true; return; } // step 1: arm
    void post('delete-transcript'); // step 2: execute
  }

  function onDocClick(e: MouseEvent): void {
    if (rootEl && !rootEl.contains(e.target as Node)) { open = false; armedDelete = false; }
  }

  $effect(() => {
    if (!open) return;
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  });
</script>

<div class="relative" bind:this={rootEl} data-testid="session-dismiss-menu">
  <button
    type="button"
    onclick={toggle}
    title="Hide or delete this session"
    aria-haspopup="menu"
    aria-expanded={open}
    class="w-6 h-6 flex items-center justify-center rounded-md text-fleet-dim hover:text-fleet-text hover:bg-[#1a2030] cursor-pointer"
    data-testid="dismiss-toggle"
  >✕</button>

  {#if open}
    <div
      class="absolute right-0 top-full mt-1 min-w-[210px] rounded-xl border border-fleet-border-strong bg-fleet-surface shadow-[0_10px_30px_rgba(0,0,0,0.5)] py-1 z-40"
      role="menu"
    >
      <button
        type="button" role="menuitem" disabled={busy} onclick={onHide}
        class="w-full text-left px-3 py-1.5 text-[12px] text-fleet-text hover:bg-fleet-accent/10 cursor-pointer disabled:opacity-60"
        data-testid="dismiss-hide"
      >Hide from dashboard <span class="text-fleet-faint">(transcript kept)</span></button>
      <button
        type="button" role="menuitem" disabled={busy} onclick={onDelete}
        class={`w-full text-left px-3 py-1.5 text-[12px] cursor-pointer disabled:opacity-60 ${armedDelete ? 'bg-red-950/60 text-red-300 font-semibold' : 'text-[#d66a6a] hover:bg-red-950/40'}`}
        data-testid="dismiss-delete"
      >{armedDelete ? '⚠ Click again — deletes transcript FOREVER' : 'Delete forever… (desktop app loses it too)'}</button>
      {#if error}<div class="px-3 py-1 text-[11px] text-fleet-warn" data-testid="dismiss-error">{error}</div>{/if}
    </div>
  {/if}
</div>

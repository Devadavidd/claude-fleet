<!-- Chat input bar pinned under the session detail — EVERY session is
     chattable: a live steerable launch gets its stdin steered; any other card
     (done / idle / observed) is RESUMED server-side (`claude --resume`, same
     session id + transcript) with the typed message as the next turn. The
     model pill is fixed while a child runs and selectable when a send would
     resume. Renders nothing only when the card isn't in the store yet. -->
<script lang="ts">
  import { fleetStore } from '../fleet-store.svelte.js';
  import { fleetMutate } from '../auth.js';
  import { formatAttachmentBlock } from '../chat-launch-compose.js';
  import { encodeFilesForUpload, addFilesWithCaps, uploadNameFor } from '../file-upload-encoding.js';
  import QuestionChips from './QuestionChips.svelte';
  import SlashSuggestTextarea from './SlashSuggestTextarea.svelte';
  import ModelPickerMenu from './ModelPickerMenu.svelte';
  import SessionDismissMenu from './SessionDismissMenu.svelte';

  interface Props {
    sessionId: string;
  }

  const { sessionId }: Props = $props();
  const card = $derived(fleetStore.sessions.get(sessionId));
  const live = $derived(card?.launched === true && card?.steerable === true);
  // A launched-but-not-steerable child owns the cwd and closed its stdin —
  // the only control is Stop; everything else can type (send = steer or resume).
  const canType = $derived(card !== undefined && (live || card?.launched !== true));

  let text = $state('');
  let busy = $state(false);
  let sendError = $state<string | null>(null);
  let attachments = $state<File[]>([]);

  // Shared caps guard — same behavior as the Launch modal's attach surface.
  function onFilesPicked(e: Event): void {
    const input = e.currentTarget as HTMLInputElement;
    const picked = Array.from(input.files ?? []);
    input.value = ''; // re-picking the same file re-fires change
    const result = addFilesWithCaps(attachments, picked);
    attachments = result.files;
    sendError = result.error;
  }

  // Model choice for the RESUME path (a running child's model is fixed).
  interface SpawnOptions { models: string[]; defaultModel: string }
  let models = $state<string[]>([]);
  let resumeModel = $state('');
  $effect(() => {
    if (card?.launched) return; // live sessions show the fixed model instead
    void (async () => {
      try {
        const res = await fetch('/api/spawn-options');
        if (!res.ok) return;
        const data = (await res.json()) as SpawnOptions;
        models = data.models ?? [];
        if (!resumeModel) resumeModel = data.defaultModel ?? '';
      } catch { /* pill just stays hidden */ }
    })();
  });

  // Returns false + surfaces the server error when the action didn't land — a
  // steer into a just-exited session must not vanish silently.
  async function post(url: string, body?: unknown): Promise<boolean> {
    busy = true;
    try {
      const res = await fleetMutate(url, body);
      if (res.ok) { sendError = null; return true; }
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      sendError = data.error ?? `request failed (${res.status})`;
      return false;
    } catch {
      sendError = 'network error — is the server running?';
      return false;
    } finally {
      busy = false;
    }
  }

  const base = $derived(`/api/sessions/${encodeURIComponent(sessionId)}`);

  async function sendMessage(): Promise<void> {
    let t = text.trim();
    if (!t && !attachments.length) return;
    // Attachments upload FIRST (same endpoint as the Launch modal); their
    // absolute paths ride inside the message so the agent reads them from disk.
    if (attachments.length) {
      busy = true;
      try {
        const res = await fleetMutate('/api/uploads', { files: await encodeFilesForUpload(attachments) });
        const data = (await res.json().catch(() => ({}))) as { paths?: string[]; error?: string };
        if (!res.ok || !Array.isArray(data.paths)) {
          sendError = `Upload failed: ${data.error ?? `(${res.status})`}`;
          return;
        }
        t = [t, formatAttachmentBlock(data.paths)].filter(Boolean).join('\n\n');
      } finally {
        busy = false;
      }
    }
    text = '';
    attachments = []; // uploaded paths now live inside the message text
    // The server steers a live child and RESUMES anything else; the model only
    // applies on the resume path (ignored while a child is running).
    const ok = await post(`${base}/steer`, { type: 'message', text: t, model: resumeModel || undefined });
    // Restore the full composed message (attachment paths included) on failure
    // so a retry never re-uploads the same batch.
    if (!ok && !text) text = t;
  }
</script>

{#if card}
  <!-- Desktop-app-style composer: one rounded box, textarea on top, controls on
       a slim bottom row inside the box, ⏎ sends / shift+⏎ makes a newline. -->
  <div class="flex-none px-4 pb-4 pt-2" data-testid="session-composer">
    {#if card.pendingQuestion}
      <QuestionChips {card} />
    {/if}
    {#if sendError}
      <div class="text-[11.5px] text-fleet-warn mb-1.5" data-testid="composer-error">{sendError}</div>
    {/if}
    <div class="rounded-2xl border border-fleet-border-strong bg-fleet-surface focus-within:border-fleet-accent px-4 pt-3 pb-2 flex flex-col gap-1">
      {#if canType}
        <SlashSuggestTextarea
          bind:value={text}
          rows={2}
          placeholder={live ? 'Message this session… Type "/" for skills' : 'Continue this session… Type "/" for skills'}
          testid="composer-input"
          onSubmit={() => void sendMessage()}
        />
      {:else}
        <span class="text-[12px] text-fleet-faint py-1">
          Launched without steering — it runs to completion on its own.
        </span>
      {/if}
      {#if attachments.length}
        <ul class="m-0 p-0 list-none flex flex-wrap gap-1.5" data-testid="composer-attachment-list">
          {#each attachments as f, i (uploadNameFor(f) + i)}
            <li class="flex items-center gap-1.5 text-[11px] text-fleet-muted font-mono bg-[#1a2030] border border-fleet-border-strong rounded-full px-2 py-0.5">
              <span class="truncate max-w-[220px]">{uploadNameFor(f)}</span>
              <button type="button" class="text-fleet-dim cursor-pointer" aria-label={`Remove ${uploadNameFor(f)}`} onclick={() => (attachments = attachments.filter((_, idx) => idx !== i))}>✕</button>
            </li>
          {/each}
        </ul>
      {/if}
      <div class="flex items-center gap-2">
        {#if canType}
          <label class="text-[12px] text-fleet-accent cursor-pointer" title="Attach files">
            📎
            <input type="file" multiple class="hidden" onchange={onFilesPicked} data-testid="composer-attach-input" />
          </label>
          <label class="text-[12px] text-fleet-accent cursor-pointer" title="Attach a whole folder">
            📁
            <input type="file" multiple webkitdirectory class="hidden" onchange={onFilesPicked} data-testid="composer-attach-folder-input" />
          </label>
        {/if}
        <span class="text-[10.5px] text-fleet-faint font-mono truncate">
          {#if live}⏎ send · ⇧⏎ newline · / skills{:else if canType}⏎ send (resumes this session) · / skills{/if}
        </span>
        <div class="flex-1"></div>
        {#if card.launched && card.model}
          <!-- The child's model is fixed at spawn — the pill shows it, the
               popup explains where to pick a different one. -->
          <ModelPickerMenu
            models={[card.model]}
            selected={card.model}
            lockedNote="Model is fixed for a running session — pick one in the Launch dialog."
            testid="composer-model-menu"
          />
        {:else if !card.launched && models.length}
          <ModelPickerMenu
            models={models}
            selected={resumeModel}
            onSelect={(m) => (resumeModel = m)}
            testid="composer-model-menu"
          />
        {/if}
        {#if live}
          <button
            type="button" disabled={busy} onclick={() => void post(`${base}/steer`, { type: 'finish' })}
            title="Close input — the session finishes its turn and exits cleanly"
            class="text-[11.5px] text-fleet-muted border border-fleet-border-strong rounded-lg px-2.5 py-1 cursor-pointer disabled:opacity-60 hover:text-fleet-text"
            data-testid="composer-finish"
          >✓ Finish</button>
        {/if}
        {#if card.launched}
          <button
            type="button" disabled={busy} onclick={() => void post(`${base}/kill`)}
            class="text-[11.5px] text-[#d6b566] border border-[#4a3f18] bg-fleet-warn/10 rounded-lg px-2.5 py-1 cursor-pointer disabled:opacity-60"
            data-testid="composer-stop"
          >⏹ Stop</button>
        {/if}
        <SessionDismissMenu {sessionId} />
        {#if canType}
          <button
            type="button" disabled={busy || (!text.trim() && !attachments.length)} onclick={() => void sendMessage()}
            aria-label="Send message"
            class="w-8 h-8 flex items-center justify-center bg-gradient-to-br from-fleet-accent to-fleet-accent-deep text-white rounded-lg cursor-pointer disabled:opacity-40"
            data-testid="composer-send"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        {/if}
      </div>
    </div>
  </div>
{/if}

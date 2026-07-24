<!-- "Launch session" modal — THE single launch surface (the interim #/new page
     folded back into a dialog per design feedback). Prompt + skill picker
     (live /api/skills catalog) + file attachments (POST /api/uploads) +
     cwd/model, steerable ON by default so the session can be answered right
     from the web. On 202 it closes and navigates STRAIGHT into #/session/:id
     — the timeline self-heals while the child's transcript appears. -->
<script lang="ts">
  import { fleetMutate } from '../auth.js';
  import { navigate } from '../router.svelte.js';
  import { composeLaunchTask } from '../chat-launch-compose.js';
  import { encodeFilesForUpload, addFilesWithCaps, uploadNameFor } from '../file-upload-encoding.js';
  import SettingsModal from './SettingsModal.svelte';
  import SlashSuggestTextarea from './SlashSuggestTextarea.svelte';
  import ModelPickerMenu from './ModelPickerMenu.svelte';
  import WorkingFolderPicker from './WorkingFolderPicker.svelte';

  interface Props {
    open: boolean;
    onClose: () => void;
  }

  const { open, onClose }: Props = $props();

  interface SpawnOptions {
    cwds: string[];
    models: string[];
    defaultModel: string;
    launching: boolean;
  }

  let options = $state<SpawnOptions | null>(null);
  let loading = $state(true);
  let prompt = $state('');
  // Desktop-app multi-root: folders[0] = cwd, the rest become --add-dir.
  let folders = $state<string[]>([]);
  let model = $state('');
  let steerable = $state(true); // chat default: keep the session answerable
  let asWorkflow = $state(false);
  let attachments = $state<File[]>([]);
  let submitting = $state(false);
  let error = $state<string | null>(null);
  let settingsOpen = $state(false);
  let loadSeq = 0;

  async function loadOptions(): Promise<void> {
    const seq = ++loadSeq;
    loading = true;
    try {
      const res = await fetch('/api/spawn-options');
      if (!res.ok) throw new Error(`(${res.status})`);
      const data = (await res.json()) as SpawnOptions;
      if (seq !== loadSeq) return;
      options = data;
      // Keep the user's picks across a reload; seed the primary folder from
      // the quick-pick list only when nothing is chosen yet.
      if (!folders.length && data.cwds[0]) folders = [data.cwds[0]];
      if (!data.models.includes(model)) model = data.defaultModel;
      error = null;
    } catch {
      if (seq !== loadSeq) return;
      options = null;
      error = 'Failed to load launch options — is the server running?';
    } finally {
      if (seq === loadSeq) loading = false;
    }
  }

  // Reset the form + (re)fetch options every time the modal opens. Skill choice
  // is typed directly as a slash command in the prompt (desktop-app style) —
  // the SlashSuggestTextarea recommends /cf:<skill> as you type.
  $effect(() => {
    if (!open) return;
    prompt = '';
    steerable = true;
    asWorkflow = false;
    attachments = [];
    error = null;
    void loadOptions();
  });

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') onClose();
  }

  $effect(() => {
    if (!open) return;
    document.addEventListener('keydown', onKeydown);
    return () => document.removeEventListener('keydown', onKeydown);
  });

  // Shared caps guard (file-upload-encoding.ts) — one behavior for every
  // attach surface. Handles both the file picker and the folder picker.
  function onFilesPicked(e: Event): void {
    const input = e.currentTarget as HTMLInputElement;
    const picked = Array.from(input.files ?? []);
    input.value = ''; // re-picking the same file re-fires change
    const result = addFilesWithCaps(attachments, picked);
    attachments = result.files;
    error = result.error;
  }

  function removeAttachment(i: number): void {
    attachments = attachments.filter((_, idx) => idx !== i);
  }

  async function submit(): Promise<void> {
    const goal = prompt.trim();
    if (!goal) { error = 'Describe what the session should do.'; return; }
    if (!folders.length) { error = 'Add at least one working folder.'; return; }
    submitting = true;
    error = null;
    try {
      let attachmentPaths: string[] = [];
      if (attachments.length) {
        const res = await fleetMutate('/api/uploads', { files: await encodeFilesForUpload(attachments) });
        const data = (await res.json().catch(() => ({}))) as { paths?: string[]; error?: string };
        if (!res.ok || !Array.isArray(data.paths)) {
          error = `Upload failed: ${data.error ?? `(${res.status})`}`;
          return;
        }
        attachmentPaths = data.paths;
      }
      const task = composeLaunchTask({ prompt: goal, attachmentPaths, asWorkflow });
      const res = await fleetMutate('/api/spawn', {
        task, cwd: folders[0], addDirs: folders.slice(1), model, steerable,
      });
      const data = (await res.json().catch(() => ({}))) as { sessionId?: string; error?: string };
      if (res.status === 202 && data.sessionId) {
        onClose();
        navigate(`#/session/${encodeURIComponent(data.sessionId)}`); // straight into the chat
        return;
      }
      error = `Launch failed (${res.status}): ${data.error ?? 'unknown error'}`;
    } catch {
      error = 'Network error — is the server running?';
    } finally {
      submitting = false;
    }
  }

  function closeSettings(): void {
    settingsOpen = false;
    void loadOptions();
  }
</script>

{#if open}
  <div class="fixed inset-0 z-40 bg-black/60 flex items-center justify-center p-5" data-testid="launch-modal-backdrop">
    <button type="button" class="absolute inset-0 w-full h-full cursor-default" aria-label="Close launch modal" onclick={onClose}></button>
    <div
      class="relative w-full max-w-[560px] max-h-[92vh] overflow-y-auto bg-fleet-surface border border-fleet-border-strong rounded-2xl p-6 flex flex-col gap-4"
      role="dialog"
      aria-modal="true"
      aria-label="Launch a session"
      data-testid="launch-session-modal"
    >
      <div class="flex items-center gap-2.5">
        <div class="w-[26px] h-[26px] rounded-lg bg-gradient-to-br from-fleet-accent to-fleet-accent-deep flex items-center justify-center flex-none">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/></svg>
        </div>
        <h3 class="m-0 text-[16px] font-semibold flex-1">Launch a session</h3>
        <button type="button" onclick={onClose} aria-label="Close" class="text-fleet-dim cursor-pointer hover:text-fleet-text">✕</button>
      </div>

      {#if loading}
        <div class="text-fleet-faint text-sm text-center py-6">Loading…</div>
      {:else if options && !options.launching}
        <div class="flex flex-col gap-3">
          <p class="m-0 text-[12.5px] text-fleet-muted">Launching is disabled — no allowed directories are configured yet.</p>
          <button type="button" onclick={() => (settingsOpen = true)} class="text-[12.5px] text-fleet-accent text-left cursor-pointer" data-testid="launch-open-settings">⚙ Configure directories</button>
        </div>
      {:else if options}
        <!-- The desktop-app composer box: slash-aware prompt on top, controls
             (attach · model pill · send hint) on a slim row inside the box. -->
        <div class="rounded-2xl border border-fleet-border-strong bg-fleet-bg focus-within:border-fleet-accent px-4 pt-3 pb-2 flex flex-col gap-1">
          <SlashSuggestTextarea
            bind:value={prompt}
            rows={5}
            placeholder={'What should this session do? Type "/" for skills…'}
            testid="launch-task-input"
            onSubmit={() => void submit()}
            menuPlacement="below"
          />
          <div class="flex items-center gap-2">
            <label class="text-[12px] text-fleet-accent cursor-pointer" title="Attach files">
              📎
              <input type="file" multiple class="hidden" onchange={onFilesPicked} data-testid="chat-attach-input" />
            </label>
            <label class="text-[12px] text-fleet-accent cursor-pointer" title="Attach a whole folder">
              📁
              <input type="file" multiple webkitdirectory class="hidden" onchange={onFilesPicked} data-testid="chat-attach-folder-input" />
            </label>
            <span class="text-[10.5px] text-fleet-faint font-mono">⏎ launch · ⇧⏎ newline · / skills</span>
            <div class="flex-1"></div>
            <ModelPickerMenu models={options.models} selected={model} onSelect={(m) => (model = m)} testid="launch-model-menu" />
          </div>
        </div>

        {#if attachments.length}
          <ul class="m-0 p-0 list-none flex flex-col gap-1" data-testid="chat-attachment-list">
            {#each attachments as f, i (f.name + i)}
              <li class="flex items-center gap-2 text-[12px] text-fleet-muted font-mono">
                <span class="truncate">{uploadNameFor(f)}</span>
                <span class="text-fleet-faint">{(f.size / 1024).toFixed(0)}KB</span>
                <button type="button" class="text-fleet-dim cursor-pointer" aria-label={`Remove ${f.name}`} onclick={() => removeAttachment(i)}>✕</button>
              </li>
            {/each}
          </ul>
        {/if}

        <WorkingFolderPicker bind:folders quickPicks={options.cwds} />

        <label class="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" bind:checked={steerable} data-testid="launch-steerable-checkbox" />
          <span class="text-[12.5px] text-fleet-muted">Keep open so I can answer / follow up (steerable)</span>
        </label>
        <label class="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" bind:checked={asWorkflow} data-testid="launch-workflow-checkbox" />
          <span class="text-[12.5px] text-fleet-muted">Run as a workflow (multi-agent orchestration)</span>
        </label>

        <div class="flex gap-2 bg-fleet-warn/10 border border-[#4a3f18] rounded-lg px-3 py-2.5 text-[11.5px] text-[#d6b566] leading-relaxed">
          <span class="flex-none">⚠</span>
          <span>Runs an auto-approving agent that can edit and execute anything under the chosen directory.</span>
        </div>
        {#if error}<div class="text-[12px] text-fleet-warn" data-testid="launch-error">{error}</div>{/if}
        <button type="button" onclick={submit} disabled={submitting} class="w-full bg-gradient-to-br from-fleet-accent to-fleet-accent-deep text-white border-0 rounded-lg px-4 py-2.5 text-[13.5px] font-semibold cursor-pointer disabled:opacity-60" data-testid="launch-submit">
          {submitting ? 'Starting…' : 'Launch session'}
        </button>
      {:else if error}
        <div class="text-[12.5px] text-fleet-warn text-center py-4" data-testid="launch-error">{error}</div>
      {/if}

      <SettingsModal open={settingsOpen} onClose={closeSettings} />
    </div>
  </div>
{/if}

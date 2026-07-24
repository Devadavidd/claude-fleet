<!-- Launch-settings editor: add/remove allowed launch directories. envRoots
     (server env-configured) are read-only, mirroring legacy public/launch-form.js's
     renderSettings step. Opened either directly or via the new-chat composer's "disabled"
     state link. -->
<script lang="ts">
  import { fleetHeaders } from '../auth.js';

  interface Props {
    open: boolean;
    onClose: () => void;
  }

  const { open, onClose }: Props = $props();

  interface LaunchSettings {
    allowedRoots: string[];
    envRoots: string[];
  }

  let settings = $state<LaunchSettings | null>(null);
  let loading = $state(false);
  let newRoot = $state('');
  let saving = $state(false);
  let error = $state<string | null>(null);
  let loadSeq = 0;

  async function load(): Promise<void> {
    const seq = ++loadSeq;
    loading = true;
    try {
      const res = await fetch('/api/launch-settings');
      if (!res.ok) throw new Error(`(${res.status})`);
      const data = (await res.json()) as LaunchSettings;
      if (seq !== loadSeq) return;
      settings = data;
      error = null;
    } catch {
      if (seq !== loadSeq) return;
      settings = null;
      error = 'Failed to load launch settings.';
    } finally {
      if (seq === loadSeq) loading = false;
    }
  }

  // (Re)load fresh every time the modal opens.
  $effect(() => {
    if (!open) return;
    newRoot = '';
    error = null;
    void load();
  });

  // App-saved directories only — env-configured roots are shown separately
  // and are never included in the save payload (server treats them as fixed).
  const editableRoots = $derived.by(() => {
    if (!settings) return [];
    const envSet = new Set(settings.envRoots);
    return settings.allowedRoots.filter((r) => !envSet.has(r));
  });

  function addRoot(): void {
    const value = newRoot.trim();
    if (!value || !settings) return;
    settings = { ...settings, allowedRoots: [...settings.allowedRoots, value] };
    newRoot = '';
  }

  function removeRoot(root: string): void {
    if (!settings) return;
    settings = { ...settings, allowedRoots: settings.allowedRoots.filter((r) => r !== root) };
  }

  async function save(): Promise<void> {
    if (!settings) return;
    saving = true;
    error = null;
    try {
      const res = await fetch('/api/launch-settings', {
        method: 'POST',
        headers: fleetHeaders(),
        body: JSON.stringify({ allowedRoots: editableRoots }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { error = data.error ?? 'Save failed'; return; }
      onClose();
    } catch {
      error = 'Network error — is the server running?';
    } finally {
      saving = false;
    }
  }
</script>

{#if open}
  <div class="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-5" data-testid="settings-modal-backdrop">
    <button type="button" class="absolute inset-0 w-full h-full cursor-default" aria-label="Close launch settings" onclick={onClose}></button>
    <div
      class="relative w-full max-w-[460px] bg-fleet-surface border border-fleet-border-strong rounded-2xl p-6 flex flex-col gap-4"
      role="dialog"
      aria-modal="true"
      aria-label="Launch settings"
      data-testid="settings-modal"
    >
      <div class="flex items-center gap-2.5">
        <h3 class="m-0 text-[15px] font-semibold flex-1">Launch settings</h3>
        <button type="button" onclick={onClose} aria-label="Close" class="text-fleet-dim cursor-pointer hover:text-fleet-text">✕</button>
      </div>
      <div class="text-[11.5px] text-fleet-warn-text bg-fleet-warn/10 border border-fleet-warn-border rounded-lg px-3 py-2.5 leading-relaxed">
        A launched agent can read/write/run anything your user can — the directory only sets where it starts. Add only directories you would run an agent in yourself.
      </div>
      {#if loading}
        <div class="text-fleet-faint text-sm text-center py-4">Loading…</div>
      {:else if settings}
        <div class="flex flex-col gap-1.5">
          <span class="text-[11px] font-semibold text-fleet-muted">Allowed launch directories</span>
          <div class="flex flex-col gap-1.5" data-testid="settings-root-list">
            {#each editableRoots as root (root)}
              <div class="flex items-center gap-2 bg-fleet-bg border border-fleet-border rounded-lg px-2.5 py-1.5">
                <span class="text-[12px] font-mono text-fleet-text flex-1 truncate">{root}</span>
                <button type="button" onclick={() => removeRoot(root)} class="text-fleet-dim cursor-pointer hover:text-fleet-warn text-xs" aria-label={`Remove ${root}`}>✕</button>
              </div>
            {/each}
            {#if !editableRoots.length}
              <div class="text-[11.5px] text-fleet-faint">No directories configured yet.</div>
            {/if}
          </div>
        </div>
        <div class="flex gap-2">
          <input
            bind:value={newRoot}
            placeholder="/absolute/path/to/project"
            class="flex-1 bg-fleet-bg border border-fleet-border-strong rounded-lg px-2.5 py-2 text-[12.5px] font-mono text-fleet-text outline-none"
            data-testid="settings-add-input"
            onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addRoot(); } }}
          />
          <button type="button" onclick={addRoot} class="text-[12px] text-fleet-accent border border-fleet-accent-border rounded-lg px-3 cursor-pointer" data-testid="settings-add-button">Add</button>
        </div>
        {#if settings.envRoots.length}
          <div class="text-[11px] text-fleet-faint">Also allowed via env (fixed): {settings.envRoots.join(', ')}</div>
        {/if}
        {#if error}<div class="text-[12px] text-fleet-warn" data-testid="settings-error">{error}</div>{/if}
        <button
          type="button"
          onclick={save}
          disabled={saving}
          class="w-full bg-gradient-to-br from-fleet-accent to-fleet-accent-deep text-white border-0 rounded-lg px-4 py-2.5 text-[13px] font-semibold cursor-pointer disabled:opacity-60"
          data-testid="settings-save"
        >{saving ? 'Saving…' : 'Save'}</button>
      {:else if error}
        <div class="text-[12px] text-fleet-warn text-center py-4" data-testid="settings-error">{error}</div>
      {/if}
    </div>
  </div>
{/if}

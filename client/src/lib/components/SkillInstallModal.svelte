<!-- Two-step skill install into the cf bundle: pick a source (local path or
     GitHub owner/repo[#subpath]) → preview lists the skills found → the lead
     ticks the ones to install → confirm copies them in. The preview step is
     deliberate security friction: installed skills later run inside
     bypassPermissions sessions, so nothing installs sight-unseen. -->
<script lang="ts">
  import { fleetHeaders } from '../auth.js';

  interface PreviewSkill {
    name: string;
    desc: string;
  }

  interface Props {
    open: boolean;
    onClose: () => void;
    onInstalled: () => void;
  }

  const { open, onClose, onInstalled }: Props = $props();

  let kind = $state<'local' | 'github'>('local');
  let ref = $state('');
  let busy = $state(false);
  let error = $state('');
  let previewId = $state('');
  let previewSkills = $state<PreviewSkill[]>([]);
  let chosen = $state<Record<string, boolean>>({});

  function reset(): void {
    ref = '';
    error = '';
    previewId = '';
    previewSkills = [];
    chosen = {};
    busy = false;
  }

  function close(): void {
    reset();
    onClose();
  }

  async function runPreview(): Promise<void> {
    if (!ref.trim() || busy) return;
    busy = true;
    error = '';
    try {
      const res = await fetch('/api/skills/install/preview', {
        method: 'POST',
        headers: fleetHeaders(),
        body: JSON.stringify({ kind, ref: ref.trim() }),
      });
      const data = (await res.json()) as { previewId?: string; skills?: PreviewSkill[]; error?: string };
      if (!res.ok || !data.previewId) throw new Error(data.error || `preview failed (${res.status})`);
      previewId = data.previewId;
      previewSkills = data.skills ?? [];
      chosen = Object.fromEntries(previewSkills.map((s) => [s.name, true]));
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }

  async function runConfirm(): Promise<void> {
    const names = Object.entries(chosen).filter(([, on]) => on).map(([name]) => name);
    if (!previewId || !names.length || busy) return;
    busy = true;
    error = '';
    try {
      const res = await fetch('/api/skills/install/confirm', {
        method: 'POST',
        headers: fleetHeaders(),
        body: JSON.stringify({ previewId, names }),
      });
      const data = (await res.json()) as { installed?: string[]; skipped?: string[]; error?: string };
      if (!res.ok) throw new Error(data.error || `install failed (${res.status})`);
      if (data.installed?.length) onInstalled(); // partial success still refreshes the catalog
      // Never report clean success for names the server refused to install.
      if (data.skipped?.length || !data.installed?.length) {
        throw new Error(
          data.installed?.length
            ? `installed ${data.installed.join(', ')} — skipped unsafe name(s): ${data.skipped!.join(', ')}`
            : `nothing installed — skipped unsafe name(s): ${(data.skipped ?? []).join(', ')}`,
        );
      }
      close();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      busy = false;
      // A consumed preview can't be retried — force a fresh one.
      previewId = '';
      previewSkills = [];
    }
  }
</script>

{#if open}
  <div class="fixed inset-0 z-40 flex items-center justify-center" data-testid="skill-install-modal">
    <button type="button" class="absolute inset-0 w-full h-full bg-black/50 cursor-default" aria-label="Close install dialog" onclick={close}></button>
    <div class="relative bg-fleet-surface border border-fleet-border-strong rounded-2xl p-5 w-[480px] max-w-[92vw] max-h-[80vh] overflow-y-auto flex flex-col gap-4" role="dialog" aria-modal="true" aria-label="Install skill">
      <div class="flex items-center">
        <span class="text-[15px] font-bold">Install skills into /cf</span>
        <button type="button" onclick={close} aria-label="Close" class="ml-auto text-fleet-dim cursor-pointer hover:text-fleet-text">✕</button>
      </div>

      {#if !previewId}
        <div class="flex gap-1.5">
          <button type="button" onclick={() => (kind = 'local')} class={`text-xs px-2.5 py-1.5 rounded-lg border cursor-pointer ${kind === 'local' ? 'border-fleet-accent text-fleet-accent bg-fleet-accent/10' : 'border-fleet-border-strong text-fleet-muted'}`}>Local path</button>
          <button type="button" onclick={() => (kind = 'github')} class={`text-xs px-2.5 py-1.5 rounded-lg border cursor-pointer ${kind === 'github' ? 'border-fleet-accent text-fleet-accent bg-fleet-accent/10' : 'border-fleet-border-strong text-fleet-muted'}`}>GitHub</button>
        </div>
        <input
          bind:value={ref}
          data-testid="skill-install-ref"
          placeholder={kind === 'local' ? '/path/to/skill-or-folder (e.g. a project .claude/skills)' : 'owner/repo or owner/repo#subpath'}
          class="bg-fleet-bg border border-fleet-border-strong rounded-lg px-3 py-2 text-[13px] text-fleet-text outline-none w-full"
        />
        <button
          type="button"
          data-testid="skill-install-preview"
          onclick={runPreview}
          disabled={busy || !ref.trim()}
          class="bg-fleet-accent text-white text-[13px] rounded-lg px-4 py-2 cursor-pointer disabled:opacity-50 self-start"
        >
          {busy ? 'Scanning…' : 'Preview'}
        </button>
      {:else}
        <div class="text-[12px] text-fleet-muted">Found {previewSkills.length} skill(s). Review before installing — these will run in launched sessions.</div>
        <div class="flex flex-col gap-1.5 max-h-[40vh] overflow-y-auto" data-testid="skill-install-list">
          {#each previewSkills as s (s.name)}
            <label class="flex items-start gap-2 text-[13px] text-fleet-text bg-fleet-panel border border-fleet-border rounded-lg px-3 py-2 cursor-pointer">
              <input type="checkbox" bind:checked={chosen[s.name]} class="mt-0.5" />
              <span class="font-mono font-semibold">{s.name}</span>
              <span class="text-fleet-muted text-[12px] leading-snug">{s.desc}</span>
            </label>
          {/each}
        </div>
        <button
          type="button"
          data-testid="skill-install-confirm"
          onclick={runConfirm}
          disabled={busy}
          class="bg-fleet-accent text-white text-[13px] rounded-lg px-4 py-2 cursor-pointer disabled:opacity-50 self-start"
        >
          {busy ? 'Installing…' : 'Install selected'}
        </button>
      {/if}

      {#if error}
        <div class="text-[12px] text-fleet-warn" data-testid="skill-install-error">{error}</div>
      {/if}
    </div>
  </div>
{/if}

<!-- Desktop-app-style working-folder chips for the launch modal: the FIRST
     folder is the session cwd, every further one becomes an --add-dir the
     agent may work in too (multi-root, exactly like adding folders to a new
     desktop-app code session). "＋ Add folder" opens a path input that
     autocompletes from GET /api/fs-dirs and quick-picks known project roots.
     Folders are POINTED AT, never uploaded — size does not matter. -->
<script lang="ts">
  interface Props {
    /** Chosen folders; index 0 is the primary cwd. */
    folders: string[];
    /** Quick-pick candidates (allowed roots + fleet-known project roots). */
    quickPicks?: string[];
  }

  let { folders = $bindable(), quickPicks = [] }: Props = $props();

  let adding = $state(false);
  let input = $state('');
  let dirSuggestions = $state<string[]>([]);
  let fetchSeq = 0;

  // Path autocomplete, newest-request-wins (typing fast must never show stale results).
  async function refreshSuggestions(): Promise<void> {
    const seq = ++fetchSeq;
    try {
      const res = await fetch(`/api/fs-dirs?prefix=${encodeURIComponent(input)}`);
      if (!res.ok || seq !== fetchSeq) return;
      const data = (await res.json()) as Array<{ path: string }>;
      if (seq === fetchSeq) dirSuggestions = data.map((d) => d.path);
    } catch { /* suggestions are best-effort */ }
  }

  const shownQuickPicks = $derived(
    quickPicks.filter((p) => !folders.includes(p) && (!input.trim() || p.toLowerCase().includes(input.trim().toLowerCase()))).slice(0, 6),
  );
  const shownDirs = $derived(dirSuggestions.filter((p) => !folders.includes(p)).slice(0, 8));

  function add(pathToAdd: string): void {
    const p = pathToAdd.trim();
    if (!p) return;
    if (!folders.includes(p)) folders = [...folders, p];
    input = '';
    dirSuggestions = [];
    adding = false;
  }

  function remove(i: number): void {
    folders = folders.filter((_, idx) => idx !== i);
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter') { e.preventDefault(); add(input.trim() || shownDirs[0] || ''); }
    if (e.key === 'Escape') { e.preventDefault(); adding = false; input = ''; dirSuggestions = []; }
  }

  /** Short display: home-relative when possible, last two segments otherwise. */
  function shortPath(p: string): string {
    const parts = p.split('/').filter(Boolean);
    return parts.length <= 2 ? p : `…/${parts.slice(-2).join('/')}`;
  }
</script>

<div class="flex flex-col gap-1.5" data-testid="working-folder-picker">
  <span class="text-[11px] font-semibold text-fleet-muted">Working folders</span>
  <div class="flex flex-wrap items-center gap-1.5">
    {#each folders as f, i (f)}
      <span
        class="flex items-center gap-1.5 text-[11.5px] font-mono bg-[#1a2030] border border-fleet-border-strong rounded-lg px-2.5 py-1 text-fleet-text"
        title={f}
        data-testid={`working-folder-chip-${i}`}
      >
        {#if i === 0}<span class="text-fleet-accent" title="Primary working directory (cwd)">📂</span>{:else}<span class="text-fleet-dim">📁</span>{/if}
        <span class="truncate max-w-[220px]">{shortPath(f)}</span>
        <button type="button" class="text-fleet-dim cursor-pointer hover:text-fleet-text" aria-label={`Remove ${f}`} onclick={() => remove(i)}>✕</button>
      </span>
    {/each}
    <button
      type="button"
      onclick={() => { adding = !adding; if (adding) void refreshSuggestions(); }}
      class="text-[11.5px] text-fleet-accent border border-dashed border-fleet-border-strong rounded-lg px-2.5 py-1 cursor-pointer hover:border-fleet-accent"
      data-testid="add-working-folder"
    >＋ Add folder</button>
  </div>

  {#if adding}
    <div class="relative" data-testid="folder-input-panel">
      <input
        bind:value={input}
        oninput={() => void refreshSuggestions()}
        onkeydown={onKeydown}
        placeholder="/absolute/path/to/folder (or pick below)"
        class="w-full bg-fleet-bg border border-fleet-border-strong rounded-lg px-3 py-2 text-[12.5px] font-mono text-fleet-text outline-none"
        data-testid="folder-path-input"
      />
      <div class="mt-1 rounded-xl border border-fleet-border-strong bg-fleet-surface py-1 max-h-[220px] overflow-y-auto">
        {#each shownQuickPicks as p (p)}
          <button type="button" class="w-full text-left px-3 py-1.5 text-[12px] font-mono text-fleet-accent hover:bg-fleet-accent/10 cursor-pointer truncate" onclick={() => add(p)} data-testid="folder-quick-pick">
            ★ {p}
          </button>
        {/each}
        {#each shownDirs as p (p)}
          <button type="button" class="w-full text-left px-3 py-1.5 text-[12px] font-mono text-fleet-muted hover:bg-fleet-accent/10 cursor-pointer truncate" onclick={() => add(p)} data-testid="folder-dir-suggestion">
            {p}
          </button>
        {/each}
        {#if !shownQuickPicks.length && !shownDirs.length}
          <div class="px-3 py-1.5 text-[11.5px] text-fleet-faint">Type an absolute path…</div>
        {/if}
      </div>
    </div>
  {/if}
</div>

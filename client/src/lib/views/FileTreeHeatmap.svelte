<!-- #/files: fleet-wide "which files are the agents touching" view. Files
     grouped by directory, colored by write recency (red = just written,
     cooling to gray), each row lists responsible sessions. Refetches
     (debounced) on any session delta. Split from the legacy
     file-tree-heatmap-view.js. -->
<script lang="ts">
  import { fleetStore } from '../fleet-store.svelte.js';
  import { navigate } from '../router.svelte.js';
  import FilePreviewPanel from '../components/FilePreviewPanel.svelte';
  import type { FileTouchEntry } from '../../../../shared/types/index.js';

  let files = $state<FileTouchEntry[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let previewPath = $state<string | null>(null);

  async function load(): Promise<void> {
    try {
      const res = await fetch('/api/files');
      if (!res.ok) throw new Error(String(res.status));
      files = (await res.json()) as FileTouchEntry[];
      error = null;
    } catch {
      error = 'Failed to load /api/files';
    } finally {
      loading = false;
    }
  }

  let firstLoad = true;
  $effect(() => {
    void fleetStore.sessions; // reactive dep: refetch (debounced) on any session delta
    if (firstLoad) { firstLoad = false; void load(); return; }
    const timer = setTimeout(() => { void load(); }, 3000);
    return () => clearTimeout(timer);
  });

  interface DirGroup { dir: string; files: FileTouchEntry[] }

  const groups = $derived.by((): DirGroup[] => {
    const byDir = new Map<string, FileTouchEntry[]>();
    for (const f of files) {
      const slash = f.path.lastIndexOf('/');
      const dir = slash > 0 ? f.path.slice(0, slash) : '/';
      if (!byDir.has(dir)) byDir.set(dir, []);
      byDir.get(dir)!.push(f);
    }
    return [...byDir.entries()].map(([dir, list]) => ({ dir, files: list }));
  });

  function heatColor(ageMs: number): string {
    if (ageMs < 60_000) return '#f87171';
    if (ageMs < 5 * 60_000) return '#fb923c';
    if (ageMs < 15 * 60_000) return '#facc15';
    if (ageMs < 60 * 60_000) return '#4ade80';
    return '#6b7280';
  }

  function ageLabel(ageMs: number): string {
    const mins = Math.round(ageMs / 60_000);
    if (mins < 1) return 'now';
    if (mins < 60) return `${mins}m`;
    return `${Math.round(mins / 60)}h`;
  }

  function fileName(path: string): string {
    return path.slice(path.lastIndexOf('/') + 1);
  }

  function openFile(path: string): void {
    navigate(`#/file/${encodeURIComponent(path)}`);
  }
</script>

<div class="p-6 flex gap-4 items-start" data-testid="file-tree-heatmap">
  <div class="flex-1 min-w-0 flex flex-col gap-4">
    {#if loading && !files.length}
      <div class="text-fleet-faint text-sm text-center py-10">Loading files…</div>
    {:else if error && !files.length}
      <div class="text-fleet-faint text-sm text-center py-10">{error}</div>
    {:else if !files.length}
      <div class="text-fleet-faint text-sm text-center py-10">No files touched by any active session yet.</div>
    {:else}
      {#each groups as group (group.dir)}
        <section class="bg-fleet-panel border border-fleet-border rounded-xl p-3.5 flex flex-col gap-1.5" data-testid="heatmap-dir">
          <div class="text-[11px] text-fleet-dim font-mono">{group.dir}</div>
          {#each group.files as file (file.path)}
            <div
              class="flex items-center gap-2 text-[12px]"
              data-testid="heatmap-file"
              onmouseenter={() => { previewPath = file.path; }}
            >
              <span class="w-1.5 h-1.5 rounded-full flex-none" style={`background:${heatColor(Date.now() - file.lastAt)}`}></span>
              <button type="button" onclick={() => openFile(file.path)} class="text-fleet-text cursor-pointer" data-testid="heatmap-file-open">
                {fileName(file.path)}
              </button>
              <span class="text-fleet-dim font-mono">×{file.count}</span>
              <span class="text-fleet-faint font-mono">{ageLabel(Date.now() - file.lastAt)}</span>
              {#each file.sessions as s (s.sessionId)}
                <a href={`#/session/${encodeURIComponent(s.sessionId)}`} class="text-fleet-accent text-[11px]">{s.title.slice(0, 32)}</a>
              {/each}
            </div>
          {/each}
        </section>
      {/each}
    {/if}
  </div>
  {#if previewPath}
    <FilePreviewPanel filePath={previewPath} onClose={() => { previewPath = null; }} />
  {/if}
</div>

<!-- Hover/click file preview used by the file-tree heatmap: a compact read-only
     pane fetching the same /api/file the full FileContent view uses, syntax
     highlighted, with a close control. Split from the legacy
     file-preview-panel.js + file-content-view.js's code pane. -->
<script lang="ts">
  import { highlightCode } from '../code-highlighter.js';

  interface Props {
    filePath: string;
    onClose: () => void;
  }

  const { filePath, onClose }: Props = $props();

  interface FileData {
    path: string;
    content?: string;
    size: number;
    binary?: boolean;
  }

  let data = $state<FileData | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);
  // $state (not plain let): bind:this to a non-reactive var means an effect that
  // guards on the ref first short-circuits before subscribing to `data` and
  // never re-runs once the ref and content arrive. Mirrors FileContent.svelte.
  let codeEl = $state<HTMLPreElement>();
  let loadSeq = 0;

  async function load(): Promise<void> {
    const seq = ++loadSeq;
    loading = true;
    try {
      const res = await fetch(`/api/file?path=${encodeURIComponent(filePath)}`);
      const body = (await res.json().catch(() => ({}))) as FileData & { error?: string };
      if (seq !== loadSeq) return;
      if (!res.ok) { error = body.error ?? `HTTP ${res.status}`; data = null; return; }
      data = body;
      error = null;
    } catch {
      if (seq !== loadSeq) return;
      error = 'Server unreachable.';
      data = null;
    } finally {
      if (seq === loadSeq) loading = false;
    }
  }

  $effect(() => { void filePath; void load(); });
  // Read reactive state (data/content) UNCONDITIONALLY so the effect subscribes
  // and re-runs on load — then guard on the mounted ref last.
  $effect(() => {
    const content = data?.content ?? '';
    const show = !!data && !data.binary;
    if (codeEl && show) codeEl.replaceChildren(highlightCode(content));
  });
</script>

<aside class="w-[360px] flex-none bg-fleet-panel border border-fleet-border rounded-xl overflow-hidden flex flex-col" data-testid="file-preview-panel">
  <div class="flex items-center gap-2 px-3 py-2 border-b border-fleet-border">
    <span class="text-[11px] font-mono text-fleet-dim flex-1 min-w-0 truncate">{filePath}</span>
    <button type="button" onclick={onClose} aria-label="Close preview" class="text-fleet-dim cursor-pointer" data-testid="file-preview-close">✕</button>
  </div>
  <div class="flex-1 overflow-auto p-3">
    {#if loading && !data}
      <div class="text-fleet-faint text-xs text-center py-6">Loading…</div>
    {:else if error && !data}
      <div class="text-fleet-faint text-xs text-center py-6">{error}</div>
    {:else if data?.binary}
      <div class="text-fleet-faint text-xs text-center py-6">Binary file — not rendered.</div>
    {:else}
      <pre bind:this={codeEl} class="font-mono text-[11.5px] whitespace-pre-wrap break-words"></pre>
    {/if}
  </div>
</aside>

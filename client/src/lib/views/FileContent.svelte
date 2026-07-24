<!-- #/file/<path>: in-browser viewer for a file some session has touched.
     Server only serves paths in the touched-files registry (never arbitrary
     paths). Markdown defaults to a Rendered view (toggle to Raw); other files
     get line numbers + light syntax highlight; binary files show a size
     indicator only. Always fetches LIVE disk content (reload button) — this
     view has no mockup screen, styled in the app's existing design language.
     Split from the legacy file-content-view.js. -->
<script lang="ts">
  import { router } from '../router.svelte.js';
  import { renderMarkdown } from '../markdown-renderer.js';
  import { highlightCode } from '../code-highlighter.js';

  interface FileData {
    path: string;
    content?: string;
    size: number;
    truncated?: boolean;
    mtime?: number;
    binary?: boolean;
  }

  const filePath = $derived(router.route.filePath ?? '');
  const isMarkdown = $derived(/\.(md|markdown|mdx)$/i.test(filePath));

  let data = $state<FileData | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let mode = $state<'rendered' | 'raw'>('rendered');
  // $state (not plain let): bind:this to a plain variable is NOT reactive, so an
  // effect that guarded on the ref first would short-circuit before reading any
  // reactive state and never re-run once the ref (and data) arrived.
  let mdEl = $state<HTMLDivElement>();
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

  $effect(() => {
    void filePath;
    mode = isMarkdown ? 'rendered' : 'raw'; // md defaults to pretty, matches legacy
    void load();
  });

  // Read the reactive state (data/content/mode/isMarkdown) UNCONDITIONALLY so the
  // effect subscribes to it and re-runs on load, reload, and toggle — then guard
  // on the mounted ref last.
  $effect(() => {
    const content = data?.content ?? '';
    const show = !!data && !data.binary && isMarkdown && mode === 'rendered';
    if (mdEl && show) mdEl.replaceChildren(renderMarkdown(content));
  });

  $effect(() => {
    const content = data?.content ?? '';
    const show = !!data && !data.binary && !(isMarkdown && mode === 'rendered');
    if (codeEl && show) codeEl.replaceChildren(highlightCode(content));
  });

  const codeLines = $derived((data?.content ?? '').split('\n'));

  function sizeLabel(bytes: number): string {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
</script>

<div class="p-6 max-w-[1100px] mx-auto flex flex-col gap-3" data-testid="file-content">
  {#if loading && !data}
    <div class="text-fleet-faint text-sm text-center py-10">Loading file…</div>
  {:else if error && !data}
    <div class="text-fleet-faint text-sm text-center py-10">{error}</div>
  {:else if data}
    <div class="flex items-center gap-3 bg-fleet-panel border border-fleet-border rounded-xl px-4 py-2.5">
      <span class="text-xs font-mono text-fleet-text flex-1 min-w-0 truncate">{data.path}</span>
      <span class="text-[11px] font-mono text-fleet-dim flex-none">
        {sizeLabel(data.size)}
        {#if data.mtime}· modified {new Date(data.mtime).toLocaleTimeString()}{/if}
        {#if data.truncated}· ⚠ truncated at 512 KB{/if}
      </span>
      {#if isMarkdown && !data.binary}
        <button type="button" onclick={() => { mode = mode === 'rendered' ? 'raw' : 'rendered'; }} class="text-[11px] text-fleet-accent cursor-pointer" data-testid="file-content-toggle">
          {mode === 'rendered' ? '</> raw' : '👁 rendered'}
        </button>
      {/if}
      <button type="button" onclick={load} class="text-[11px] text-fleet-accent cursor-pointer" data-testid="file-content-reload">↻ reload</button>
    </div>

    {#if data.binary}
      <div class="text-fleet-faint text-sm text-center py-10" data-testid="file-content-binary">Binary file — {sizeLabel(data.size)}, not rendered.</div>
    {:else if isMarkdown && mode === 'rendered'}
      <div bind:this={mdEl} class="md bg-fleet-panel border border-fleet-border rounded-xl p-5" data-testid="file-content-markdown"></div>
    {:else}
      <div class="flex bg-fleet-panel border border-fleet-border rounded-xl overflow-x-auto font-mono text-[12.5px]" data-testid="file-content-code">
        <pre class="text-fleet-faint text-right px-3 py-3 select-none border-r border-fleet-border">{codeLines.map((_, i) => i + 1).join('\n')}</pre>
        <pre bind:this={codeEl} class="px-3 py-3 flex-1 min-w-0"></pre>
      </div>
    {/if}
  {/if}
</div>

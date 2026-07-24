<!-- Renders ONE parsed transcript entry (SessionTimeline's per-row unit): user
     tool_result rows (paired with their tool_use via toolMeta), markdown-
     rendered user/assistant text (via MarkdownBlock), assistant tool_use rows
     (Edit/Write → DiffView, everything else → a readable body from
     tool-input-format: Bash command / subagent prompt / key:value params), and
     dim meta rows for bookkeeping events. Hook-plumbing (PreToolUse/PostToolUse
     success spam) is dropped entirely — split from the legacy
     tool-event-renderers.js renderEntry()/toolUseRow(). -->
<script lang="ts">
  import ToolEvent from './ToolEvent.svelte';
  import DiffView from './DiffView.svelte';
  import TerminalOutput from './TerminalOutput.svelte';
  import MarkdownBlock from './MarkdownBlock.svelte';
  import { resultText } from '../extract-bash-pairs.js';
  import { toolBody } from '../tool-input-format.js';
  import type { TranscriptEntry, TranscriptEvent } from '../../../../shared/types/index.js';

  interface ToolMeta {
    name: string;
    detail: string;
  }

  interface Props {
    entry: TranscriptEntry;
    toolMeta: Map<string, ToolMeta>;
    agentIdByToolUseId: Map<string, string>;
    sessionId: string;
  }

  const { entry, toolMeta, agentIdByToolUseId, sessionId }: Props = $props();

  interface RawBlock {
    type?: unknown;
    id?: unknown;
    name?: unknown;
    input?: unknown;
    tool_use_id?: unknown;
    content?: unknown;
    is_error?: unknown;
    text?: unknown;
  }

  function asBlock(b: unknown): RawBlock | null {
    return b && typeof b === 'object' ? (b as RawBlock) : null;
  }

  function blocksOf(content: unknown): RawBlock[] {
    if (!Array.isArray(content)) return [];
    return (content as unknown[]).map(asBlock).filter((b): b is RawBlock => b !== null);
  }

  function clip(text: string, max = 4000): string {
    return text.length > max ? `${text.slice(0, max)}… (+${text.length - max} chars)` : text;
  }

  function timeLabel(ts: string | undefined): string {
    const n = Date.parse(ts ?? '');
    return Number.isFinite(n) ? new Date(n).toLocaleTimeString() : '';
  }

  function inputOf(block: RawBlock): Record<string, unknown> {
    return block.input && typeof block.input === 'object' ? (block.input as Record<string, unknown>) : {};
  }

  // One-line header detail shown next to the tool name (target file, command…).
  function toolHeaderDetail(input: Record<string, unknown>): string {
    const file = input.file_path ?? input.notebook_path;
    if (typeof file === 'string') return file;
    if (typeof input.description === 'string' && input.description) return input.description;
    if (typeof input.command === 'string') return input.command.slice(0, 100);
    if (typeof input.pattern === 'string') return String(input.pattern);
    if (typeof input.url === 'string') return String(input.url);
    if (typeof input.prompt === 'string') return input.prompt.slice(0, 100);
    return '';
  }

  function diffPairs(input: Record<string, unknown>): { oldText: string; newText: string }[] {
    if (Array.isArray(input.edits)) {
      return (input.edits as Record<string, unknown>[]).map((e) => ({
        oldText: clip(String(e.old_string ?? '')),
        newText: clip(String(e.new_string ?? '')),
      }));
    }
    if (input.old_string !== undefined) {
      return [{ oldText: clip(String(input.old_string ?? '')), newText: clip(String(input.new_string ?? '')) }];
    }
    if (input.content !== undefined) return [{ oldText: '', newText: clip(String(input.content)) }];
    return [];
  }

  // custom-title/queue-operation/system/last-prompt/attachment bookkeeping —
  // returns null for hook_* attachments (hidden entirely, pure noise).
  function metaRowText(event: TranscriptEvent): string | null {
    if (event.type === 'custom-title') return `session renamed → ${String(event.customTitle ?? '')}`;
    if (event.type === 'queue-operation') return `queued: ${clip(String(event.content ?? ''), 120)}`;
    if (event.type === 'attachment') {
      const attachment = (event.attachment && typeof event.attachment === 'object' ? event.attachment : {}) as Record<string, unknown>;
      const type = typeof attachment.type === 'string' ? attachment.type : 'unknown';
      if (type.startsWith('hook_')) return null;
      const hookName = typeof attachment.hookName === 'string' ? ` ${attachment.hookName}` : '';
      return `attachment: ${type}${hookName}`;
    }
    if (event.type === 'system') return `system: ${String(event.subtype ?? '')}`;
    if (event.type === 'last-prompt') return null;
    return event.type;
  }
</script>

{#if entry.kind === 'raw'}
  <div class="text-[11px] text-fleet-faint font-mono py-1" data-testid="timeline-raw">raw: {entry.raw}</div>
{:else if entry.event.type === 'user'}
  {@const blocks = blocksOf(entry.event.message?.content)}
  {@const results = blocks.filter((b) => b.type === 'tool_result')}
  {#if results.length}
    {#each results as result, i (i)}
      {@const meta = toolMeta.get(String(result.tool_use_id ?? ''))}
      {@const isBash = meta?.name === 'Bash'}
      {@const out = clip(resultText(result.content) || '(no output)', 20000)}
      <ToolEvent
        icon={result.is_error ? '⚠' : isBash ? '▸' : '↳'}
        name={meta?.name ?? 'result'}
        detail={meta?.detail ?? ''}
        isError={Boolean(result.is_error)}
        defaultOpen={isBash || Boolean(result.is_error)}
      >
        {#if isBash}
          <TerminalOutput text={out} />
        {:else}
          <pre class="m-0 px-2.5 py-1.5 bg-fleet-panel border border-fleet-border rounded-md font-mono text-xs whitespace-pre-wrap break-words">{out}</pre>
        {/if}
      </ToolEvent>
    {/each}
  {:else}
    {@const text = typeof entry.event.message?.content === 'string' ? entry.event.message.content : blocks.filter((b) => b.type === 'text').map((b) => String(b.text ?? '')).join('\n')}
    {#if text}
      <div class="border-l-[3px] border-fleet-accent bg-fleet-panel rounded-r-md px-3.5 py-2 mb-1.5" data-testid="timeline-user-text">
        <div class="text-[10.5px] text-fleet-dim font-mono mb-1">{timeLabel(entry.event.timestamp)} · you</div>
        <MarkdownBlock source={clip(text, 12000)} class="text-[13px] text-fleet-text leading-relaxed" />
      </div>
    {/if}
  {/if}
{:else if entry.event.type === 'assistant'}
  {@const blocks = blocksOf(entry.event.message?.content)}
  {#each blocks as block, i (i)}
    {#if block.type === 'text' && typeof block.text === 'string' && block.text.trim()}
      <div class="border-l-[3px] border-fleet-border-strong px-3.5 py-1.5 mb-1.5" data-testid="timeline-assistant-text">
        <div class="text-[10.5px] text-fleet-dim font-mono mb-1">{timeLabel(entry.event.timestamp)} · agent</div>
        <MarkdownBlock source={clip(block.text, 12000)} class="text-[13px] text-fleet-muted leading-relaxed" />
      </div>
    {:else if block.type === 'tool_use'}
      {@const input = inputOf(block)}
      {@const isSubagent = block.name === 'Task' || block.name === 'Agent'}
      {@const agentId = typeof block.id === 'string' ? agentIdByToolUseId.get(block.id) : undefined}
      <ToolEvent
        icon={isSubagent ? '🤖' : '🔧'}
        name={String(block.name ?? 'tool')}
        detail={toolHeaderDetail(input)}
        isSubagent={isSubagent}
        agentHref={agentId ? `#/session/${encodeURIComponent(sessionId)}/agent/${encodeURIComponent(agentId)}` : null}
      >
        {#if block.name === 'Edit' || block.name === 'MultiEdit' || block.name === 'Write'}
          <DiffView filePath={String(input.file_path ?? '')} pairs={diffPairs(input)} />
        {:else}
          {@const body = toolBody(String(block.name ?? 'tool'), input)}
          {#if body.kind === 'command'}
            <pre class="m-0 px-2.5 py-1.5 bg-fleet-panel border border-fleet-border rounded-md font-mono text-xs whitespace-pre-wrap break-words text-fleet-text" data-testid="tool-body-command">{clip(body.text ?? '', 4000)}</pre>
          {:else if body.kind === 'text'}
            <pre class="m-0 px-2.5 py-1.5 bg-fleet-panel border border-fleet-border rounded-md text-[12.5px] whitespace-pre-wrap break-words text-fleet-muted" data-testid="tool-body-text">{clip(body.text ?? '', 4000)}</pre>
          {:else if body.kind === 'params'}
            <div class="flex flex-col gap-1 bg-fleet-panel border border-fleet-border rounded-md px-2.5 py-1.5" data-testid="tool-body-params">
              {#each body.params ?? [] as [key, value] (key)}
                <div class="flex gap-2 text-xs font-mono">
                  <span class="text-fleet-dim flex-none">{key}</span>
                  <span class="text-fleet-muted break-words min-w-0 whitespace-pre-wrap">{clip(value, 2000)}</span>
                </div>
              {/each}
            </div>
          {/if}
        {/if}
      </ToolEvent>
    {/if}
  {/each}
{:else}
  {@const metaText = metaRowText(entry.event)}
  {#if metaText}
    <div class="text-[11px] text-fleet-faint font-mono py-1" data-testid="timeline-meta">{metaText}</div>
  {/if}
{/if}

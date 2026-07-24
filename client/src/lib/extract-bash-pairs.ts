// Pairs each Bash tool_use with its tool_result (by tool_use_id) across a list
// of parsed timeline entries, producing shell entries the terminal view renders.
// Pure and DOM-free so it can be unit-tested. A command whose result hasn't
// landed yet is emitted as prompt-only with running:true.
//
// Transcript event shape is Claude-Code-internal and untrusted, so blocks are
// read as `unknown` and narrowed defensively rather than trusted at face value.

import type { TranscriptEntry } from '../../../shared/types/index.js';

/** Untyped content block read off an untrusted transcript event. */
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

function asRawBlock(b: unknown): RawBlock | null {
  return b && typeof b === 'object' ? (b as RawBlock) : null;
}

// tool_result content is either a plain string or an array of text/image blocks.
export function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return (content as unknown[])
    .map((raw) => {
      const b = asRawBlock(raw);
      if (typeof raw === 'string') return raw;
      if (b?.type === 'text') return typeof b.text === 'string' ? b.text : '';
      if (b?.type === 'image') return '[image]';
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

export interface BashPairSource {
  label?: string;
  isWorker?: boolean;
}

interface PendingBashCommand {
  id: string;
  ts: number;
  command: string;
  detail: string;
}

/** One shell entry the terminal view renders. */
export interface BashPair extends PendingBashCommand {
  output: string;
  isError: boolean;
  running: boolean;
  sourceLabel: string;
  isWorker: boolean;
}

// entries: parsed timeline entries ({kind:'event', event}). source: {label, isWorker}.
export function extractBashPairs(entries: TranscriptEntry[], source: BashPairSource = {}): BashPair[] {
  const pending = new Map<string, PendingBashCommand>();
  const pairs: BashPair[] = [];
  const label = source.label ?? '';
  const isWorker = Boolean(source.isWorker);
  for (const entry of entries) {
    if (entry.kind !== 'event') continue;
    const event = entry.event;
    const ts = Date.parse(event.timestamp ?? '') || 0;
    const content = event.message?.content;
    const blocks: unknown[] = Array.isArray(content) ? content : [];
    if (event.type === 'assistant') {
      for (const raw of blocks) {
        const b = asRawBlock(raw);
        if (b?.type === 'tool_use' && b.name === 'Bash' && typeof b.id === 'string') {
          const input = b.input && typeof b.input === 'object' ? (b.input as { command?: unknown; description?: unknown }) : {};
          pending.set(b.id, {
            id: b.id,
            ts,
            command: String(input.command ?? ''),
            detail: typeof input.description === 'string' ? input.description : '',
          });
        }
      }
    } else if (event.type === 'user') {
      for (const raw of blocks) {
        const b = asRawBlock(raw);
        if (b?.type === 'tool_result' && typeof b.tool_use_id === 'string' && pending.has(b.tool_use_id)) {
          const cmd = pending.get(b.tool_use_id)!;
          pending.delete(b.tool_use_id);
          pairs.push({
            ...cmd,
            output: resultText(b.content),
            isError: Boolean(b.is_error),
            running: false,
            sourceLabel: label,
            isWorker,
          });
        }
      }
    }
  }
  // Commands still awaiting a result — the worker/lead is running them now.
  for (const cmd of pending.values()) {
    pairs.push({ ...cmd, output: '', isError: false, running: true, sourceLabel: label, isWorker });
  }
  return pairs;
}

// Turns a tool_use `input` object into a readable timeline body so the
// transcript reads like the Claude Code CLI, not a raw JSON dump. Edit/Write
// diffs are rendered by DiffView in the caller; everything else routes here.
//
// - Bash: the command IS the payload → show it as a shell line.
// - Task/Agent: the delegation prompt is the useful content → show it as text.
// - Anything else: compact `key: value` lines, minus keys already surfaced in
//   the row header (so nothing is repeated), collapsing to `empty` when the
//   header already said everything (e.g. a Read with only a file_path).

export type ToolBodyKind = 'command' | 'text' | 'params' | 'empty';

export interface ToolBody {
  kind: ToolBodyKind;
  /** command (kind='command') or prompt/text body (kind='text'). */
  text?: string;
  /** key/value lines for the generic case (kind='params'). */
  params?: [string, string][];
}

// Keys the row header (toolHeaderDetail) already shows — never echo them below.
const HEADER_KEYS = new Set(['description', 'command', 'file_path', 'notebook_path']);

function stringify(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function toolBody(name: string, input: Record<string, unknown>): ToolBody {
  if (name === 'Bash' && typeof input.command === 'string') {
    return { kind: 'command', text: input.command };
  }
  if ((name === 'Task' || name === 'Agent') && typeof input.prompt === 'string') {
    return { kind: 'text', text: input.prompt };
  }
  const params = Object.entries(input)
    .filter(([key]) => !HEADER_KEYS.has(key))
    .map(([key, value]): [string, string] => [key, stringify(value)])
    .filter(([, value]) => value !== '');
  if (!params.length) return { kind: 'empty' };
  return { kind: 'params', params };
}

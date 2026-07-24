import path from 'node:path';

const FILE_WRITING_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const FILE_READING_TOOLS = new Set(['Read']);
const SUBAGENT_TOOLS = new Set(['Task', 'Agent']);

/** Minimal shape of a transcript `tool_use` content block. */
export interface ToolUseBlock {
  type?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

export interface ToolUseSummary {
  tool: string;
  filePath: string | null;
  isFileWrite: boolean;
  isFileRead: boolean;
  isSubagent: boolean;
  summary: string;
}

// Turns a tool_use block into a one-line human summary for the fleet board.
// Unknown tools degrade to name + truncated input instead of failing.
export function summarizeToolUse(block?: ToolUseBlock | null): ToolUseSummary {
  const tool = typeof block?.name === 'string' ? block.name : 'unknown-tool';
  const input = block?.input && typeof block.input === 'object' ? block.input : {};
  const filePath = pickFilePath(input);
  return {
    tool,
    filePath,
    isFileWrite: FILE_WRITING_TOOLS.has(tool) && Boolean(filePath),
    isFileRead: FILE_READING_TOOLS.has(tool) && Boolean(filePath),
    isSubagent: SUBAGENT_TOOLS.has(tool),
    summary: buildSummary(tool, input, filePath),
  };
}

function pickFilePath(input: Record<string, unknown>): string | null {
  const p = input.file_path ?? input.notebook_path ?? null;
  return typeof p === 'string' ? p : null;
}

function buildSummary(tool: string, input: Record<string, unknown>, filePath: string | null): string {
  switch (tool) {
    case 'Edit':
    case 'Write':
    case 'MultiEdit':
    case 'NotebookEdit':
    case 'Read':
      return `${tool} ${filePath ? path.basename(filePath) : trunc(text(input), 60)}`;
    case 'Bash':
      return `Bash: ${trunc(text(input.description) || text(input.command), 70)}`;
    case 'Grep':
      return `Grep: ${trunc(text(input.pattern), 60)}`;
    case 'Glob':
      return `Glob: ${trunc(text(input.pattern), 60)}`;
    case 'Task':
    case 'Agent':
      return `Subagent: ${trunc(text(input.description) || text(input.prompt), 70)}`;
    case 'WebFetch':
      return `WebFetch: ${trunc(text(input.url), 70)}`;
    case 'WebSearch':
      return `WebSearch: ${trunc(text(input.query), 70)}`;
    case 'Skill':
      return `Skill: ${trunc(text(input.skill), 40)}`;
    case 'TodoWrite':
      return 'TodoWrite: updating task list';
    default:
      return `${tool}: ${trunc(JSON.stringify(input), 80)}`;
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function trunc(str: string, max: number): string {
  const clean = str.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

// Parse a workflow script's `export const meta = {...}` header and its
// `agent(prompt, { agentType, label, phase, ... })` option objects — as TEXT
// only, never executed (the script comes from ~/.claude/** and is untrusted).
//
// Returns { name, description, phases:[{title,detail}], agentSpecs:[{label,phase,agentType}] }
// in source order. Defensive: any parse failure fails open to empty fields so the
// UI degrades to agentType/spawnDepth + "—" phase rather than crashing.

export interface WorkflowScriptPhase {
  title: string;
  detail: string;
}

export interface WorkflowScriptAgentSpec {
  agentType: string;
  label: string | null;
  phase: string | null;
}

export interface ParsedWorkflowScript {
  name: string | null;
  description: string | null;
  phases: WorkflowScriptPhase[];
  agentSpecs: WorkflowScriptAgentSpec[];
}

// `text` originates from an untrusted on-disk script file, hence `unknown`.
export function parseWorkflowScript(text: unknown): ParsedWorkflowScript {
  try {
    const t = typeof text === 'string' ? text : '';
    const metaBlock = extractBlock(t, 'meta');
    return {
      name: firstMatch(metaBlock, /name:\s*['"]([^'"]+)['"]/) ?? null,
      description: firstMatch(metaBlock, /description:\s*['"]([^'"]+)['"]/) ?? null,
      phases: parsePhases(metaBlock),
      agentSpecs: parseAgentSpecs(t),
    };
  } catch {
    return { name: null, description: null, phases: [], agentSpecs: [] };
  }
}

// Slice out a `{...}` object literal following the first `key` occurrence, by
// brace-depth counting. Meta/option literals hold no braces inside their strings,
// so a naive counter is safe here (KISS).
function extractBlock(text: string, key: string): string {
  const at = text.indexOf(`${key} =`) >= 0 ? text.indexOf(`${key} =`) : text.indexOf(`${key}:`);
  const open = at >= 0 ? text.indexOf('{', at) : -1;
  if (open < 0) return '';
  let depth = 0;
  for (let j = open; j < text.length; j += 1) {
    if (text[j] === '{') depth += 1;
    else if (text[j] === '}' && (depth -= 1) === 0) return text.slice(open, j + 1);
  }
  return '';
}

function extractArray(text: string, key: string): string {
  const at = text.indexOf(`${key}:`);
  const open = at >= 0 ? text.indexOf('[', at) : -1;
  if (open < 0) return '';
  let depth = 0;
  for (let j = open; j < text.length; j += 1) {
    if (text[j] === '[') depth += 1;
    else if (text[j] === ']' && (depth -= 1) === 0) return text.slice(open, j + 1);
  }
  return '';
}

function parsePhases(metaBlock: string): WorkflowScriptPhase[] {
  const arr = extractArray(metaBlock, 'phases');
  const out: WorkflowScriptPhase[] = [];
  const re = /\{\s*title:\s*'([^']*)'(?:\s*,\s*detail:\s*'([^']*)')?[^}]*\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(arr))) out.push({ title: m[1] ?? '', detail: m[2] ?? '' });
  return out;
}

// Each `agent(...)` options object starts with an `agentType:` key (the CK
// workflow convention). Anchor on those and read label/phase from the window up
// to the next agentType mark — robust to the huge template-literal prompts in
// between. Labels may be single/double-quoted or backtick template strings.
function parseAgentSpecs(text: string): WorkflowScriptAgentSpec[] {
  const marks: Array<{ agentType: string; idx: number }> = [];
  const re = /agentType:\s*'([^']+)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) marks.push({ agentType: m[1] ?? '', idx: m.index });
  const specs: WorkflowScriptAgentSpec[] = [];
  for (let i = 0; i < marks.length; i += 1) {
    const win = text.slice(marks[i].idx, i + 1 < marks.length ? marks[i + 1].idx : Math.min(text.length, marks[i].idx + 400));
    specs.push({
      agentType: marks[i].agentType,
      label: firstMatch(win, /label:\s*(?:'([^']*)'|`([^`]*)`|"([^"]*)")/, [1, 2, 3]) ?? null,
      phase: firstMatch(win, /phase:\s*'([^']*)'/) ?? null,
    });
  }
  return specs;
}

function firstMatch(text: string, re: RegExp, groups: number[] = [1]): string | null {
  const m = re.exec(text);
  if (!m) return null;
  for (const g of groups) if (m[g] != null) return m[g] as string;
  return null;
}

// Best-effort workflow-phase signal for the card's phase strip. A CK skill
// invocation (a `Skill` tool_use) names the current stage of the plan→cook→
// test→review→ship pipeline. Returns null for non-Skill / unrecognized skills
// so the strip stays hidden unless there is a real signal.
//
// Matching is substring-based on the skill name so it is robust to the `ck:`,
// `ck-`, and bare-name spellings (e.g. `ck:plan`, `ck-plan`, `plan`). Order
// matters only in that each needle is distinctive; `review` matches
// `code-review`, `test` matches `web-testing`.
export const WORKFLOW_PHASES = ['plan', 'cook', 'test', 'review', 'ship'] as const;

export type WorkflowPhaseName = (typeof WORKFLOW_PHASES)[number];

const SKILL_NEEDLES: ReadonlyArray<readonly [string, WorkflowPhaseName]> = [
  ['plan', 'plan'],
  ['cook', 'cook'],
  ['test', 'test'],
  ['review', 'review'],
  ['ship', 'ship'],
];

/** Minimal shape of a `tool_use` content block this module reads. */
export interface SkillToolUseBlock {
  name?: string;
  input?: { skill?: unknown };
}

export function phaseFromSkill(block?: SkillToolUseBlock | null): WorkflowPhaseName | null {
  if (!block || block.name !== 'Skill') return null;
  const skill = typeof block.input?.skill === 'string' ? block.input.skill.toLowerCase() : '';
  if (!skill) return null;
  for (const [needle, phase] of SKILL_NEEDLES) if (skill.includes(needle)) return phase;
  return null;
}

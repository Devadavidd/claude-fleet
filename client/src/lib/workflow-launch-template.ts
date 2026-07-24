// Wrap a plain goal into a prompt that asks the launched (headless) Claude to use
// the Workflow tool. The workflow only launches BECAUSE this prompt explicitly asks
// for it — we never force the tool. Pure + testable; the server independently
// re-validates cwd/model/caps, so this template carries no trust.
export function workflowLaunchPrompt(goal: unknown): string {
  const g = typeof goal === 'string' ? goal.trim() : '';
  if (!g) return '';
  return [
    'Use a workflow (the Workflow tool for multi-agent orchestration) to accomplish the goal below.',
    'Author a workflow script with clearly named phases and bounded, parallel agents, then run it.',
    'Keep the phase and agent counts proportional to the task — do not over-fan-out.',
    '',
    `GOAL: ${g}`,
  ].join('\n');
}

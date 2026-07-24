import { workflowLaunchPrompt } from './workflow-launch-template.js';

// Composes the ONE task string a chat launch sends to /api/spawn. The server
// contract stays unchanged — skill choice and attachments ride inside the text:
//  - the skill directive names the Skill tool id (`cf:<name>` in the bundled
//    catalog) in natural language, so it works regardless of whether headless
//    print-mode resolves slash commands, and degrades to plain instructions;
//  - attachments are absolute paths the upload endpoint returned — the launched
//    agent reads them straight from disk.
// Pure + unit-tested; the server independently re-validates cwd/model/caps.

export interface ChatLaunchInput {
  prompt: string;
  /** Catalog skill name (directory name, no prefix), '' / null = no skill. */
  skillName?: string | null;
  /** Absolute paths returned by POST /api/uploads. */
  attachmentPaths?: readonly string[];
  /** Wrap the whole composed text in the multi-agent workflow preamble. */
  asWorkflow?: boolean;
}

/** Normalize a catalog name to the plugin Skill-tool id (`cf:<name>`). */
export function skillToolId(skillName: string): string {
  const bare = skillName.trim().replace(/^\/+/, '').replace(/^cf:/, '');
  return bare ? `cf:${bare}` : '';
}

export function composeLaunchTask({
  prompt, skillName = null, attachmentPaths = [], asWorkflow = false,
}: ChatLaunchInput): string {
  const goal = prompt.trim();
  if (!goal) return '';
  const parts: string[] = [];
  // A prompt typed as a slash command (desktop-app style, e.g. "/cf:plan …")
  // goes through VERBATIM — the CLI resolves it as the skill invocation itself,
  // so wrapping it in a directive would only get in the way.
  const toolId = skillName && !goal.startsWith('/') ? skillToolId(skillName) : '';
  if (toolId) {
    parts.push(
      `First activate the skill "${toolId}" with the Skill tool (use "${toolId.slice(3)}" if that exact id is not listed), then follow it to complete the task below.`,
    );
  }
  parts.push(goal);
  const block = formatAttachmentBlock(attachmentPaths);
  if (block) parts.push(block);
  const composed = parts.join('\n\n');
  return asWorkflow ? workflowLaunchPrompt(composed) : composed;
}

/** The attachment list block appended to a message ('' when nothing valid). */
export function formatAttachmentBlock(attachmentPaths: readonly string[]): string {
  const paths = attachmentPaths.filter((p) => typeof p === 'string' && p.trim());
  if (!paths.length) return '';
  return ['Attached files (read them from disk):', ...paths.map((p) => `- ${p}`)].join('\n');
}

import { test, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';
import TimelineEntry from './TimelineEntry.svelte';
import type { TranscriptEntry } from '../../../../shared/types/index.js';

afterEach(() => cleanup());

const NO_META = new Map<string, { name: string; detail: string }>();
const NO_AGENTS = new Map<string, string>();

function assistantText(text: string): TranscriptEntry {
  return {
    kind: 'event',
    event: {
      type: 'assistant',
      timestamp: '2026-07-23T00:00:00.000Z',
      message: { content: [{ type: 'text', text }] },
    },
  };
}

test('assistant markdown is rendered to real elements, not shown as raw source', async () => {
  render(TimelineEntry, {
    entry: assistantText('## Root cause\n\nThe **bold** fix is done.'),
    toolMeta: NO_META,
    agentIdByToolUseId: NO_AGENTS,
    sessionId: 's1',
  });
  await tick();

  const row = screen.getByTestId('timeline-assistant-text');
  // The heading and emphasis became DOM elements…
  expect(row.querySelector('h2')?.textContent).toBe('Root cause');
  expect(row.querySelector('strong')?.textContent).toBe('bold');
  // …and the literal markdown markers are gone from the text.
  expect(row.textContent).not.toContain('## Root cause');
  expect(row.textContent).not.toContain('**bold**');
});

test('a Bash tool_use shows the command as a shell line, not a JSON blob', async () => {
  const entry: TranscriptEntry = {
    kind: 'event',
    event: {
      type: 'assistant',
      timestamp: '2026-07-23T00:00:00.000Z',
      message: {
        content: [
          { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'git status', description: 'check tree' } },
        ],
      },
    },
  };
  render(TimelineEntry, { entry, toolMeta: NO_META, agentIdByToolUseId: NO_AGENTS, sessionId: 's1' });
  await tick();

  const body = screen.getByTestId('tool-body-command');
  expect(body.textContent).toBe('git status');
  expect(body.textContent).not.toContain('{'); // no raw JSON braces
});

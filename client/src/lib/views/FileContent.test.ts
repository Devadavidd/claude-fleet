import { test, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/svelte';
import FileContent from './FileContent.svelte';
import { router } from '../router.svelte.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function routeTo(filePath: string): void {
  router.route = { view: 'file', sessionId: null, agentId: null, sessionTab: 'timeline', filePath, showBack: true };
}

test('renders code content into the viewer once the fetch resolves', async () => {
  // Regression: the mount effect guarded on the bind:this ref (a plain, non-
  // reactive let) FIRST and short-circuited before reading `data`, so it never
  // re-ran after the file loaded — line numbers showed but the body stayed empty.
  routeTo('/proj/foo.ts');
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({ path: '/proj/foo.ts', content: 'const answer = 42;', size: 18 }),
  })));
  render(FileContent);

  await waitFor(() => expect(screen.getByTestId('file-content-code')).toBeInTheDocument());
  await waitFor(() => expect(screen.getByTestId('file-content')).toHaveTextContent('const answer = 42;'));
});

test('renders a markdown file into the rendered view', async () => {
  routeTo('/proj/notes.md');
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({ path: '/proj/notes.md', content: '# Title\n\nhello world', size: 20 }),
  })));
  render(FileContent);

  await waitFor(() => expect(screen.getByTestId('file-content-markdown')).toBeInTheDocument());
  await waitFor(() => expect(screen.getByTestId('file-content')).toHaveTextContent('hello world'));
});

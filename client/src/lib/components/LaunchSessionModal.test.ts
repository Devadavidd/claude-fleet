import { test, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/svelte';
import LaunchSessionModal from './LaunchSessionModal.svelte';
import { loadFleetToken } from '../auth.js';
import { resetSkillEntriesCache } from '../skill-catalog-cache.js';

// The single launch surface (modal). Covers: skill directive in the composed task, attachment upload flow,
// steerable-by-default, and straight-to-session navigation on 202.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetSkillEntriesCache();
  location.hash = '';
});

interface StubOpts {
  spawnStatus?: number;
  uploadStatus?: number;
}

// Routes every fetch this view (and its nested SettingsModal) can make;
// unhandled paths throw so a wiring mistake fails loud instead of hanging.
function stubFetch({ spawnStatus = 202, uploadStatus = 200 }: StubOpts = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/fleet-token') return { ok: true, json: async () => ({ token: 'test-token' }) };
    if (url === '/api/spawn-options') {
      return {
        ok: true,
        json: async () => ({
          cwds: ['/repo/a', '/repo/b'],
          models: ['sonnet-4.5', 'opus-4.1'],
          defaultModel: 'sonnet-4.5',
          launching: true,
        }),
      };
    }
    if (url === '/api/skills') {
      return {
        ok: true,
        json: async () => ({ skills: [{ name: 'brainstorm', desc: 'Debate solutions', cat: 'core' }] }),
      };
    }
    if (url === '/api/uploads') {
      return {
        ok: uploadStatus === 200,
        status: uploadStatus,
        json: async () => (uploadStatus === 200 ? { paths: ['/tmp/uploads/u1/shot.png'] } : { error: 'too big' }),
      };
    }
    if (url === '/api/spawn') {
      return {
        ok: spawnStatus === 202,
        status: spawnStatus,
        json: async () => (spawnStatus === 202 ? { sessionId: 'sess-42' } : { error: 'boom' }),
      };
    }
    if (url.startsWith('/api/fs-dirs')) return { ok: true, json: async () => ([{ path: '/repo/b/sub' }]) };
    if (url === '/api/launch-settings') return { ok: true, json: async () => ({ allowedRoots: [], envRoots: [] }) };
    throw new Error(`unexpected fetch: ${url} ${init?.method ?? 'GET'}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function spawnBody(fetchMock: ReturnType<typeof stubFetch>): Record<string, unknown> {
  const call = fetchMock.mock.calls.find(([u]) => String(u) === '/api/spawn');
  expect(call).toBeTruthy();
  return JSON.parse((call![1] as RequestInit).body as string) as Record<string, unknown>;
}

test('renders the composer once options resolve — steerable ON by default', async () => {
  stubFetch();
  render(LaunchSessionModal, { open: true, onClose: () => {} });
  await waitFor(() => expect(screen.getByTestId('launch-task-input')).toBeInTheDocument());
  expect(screen.getByTestId('working-folder-picker')).toBeInTheDocument();
  expect(screen.getByTestId('working-folder-chip-0')).toHaveTextContent('repo/a'); // seeded primary
  expect(screen.getByTestId('launch-model-menu-pill')).toBeInTheDocument();
  expect(screen.getByTestId('launch-steerable-checkbox')).toBeChecked();
});

test('submit POSTs /api/spawn with the token and navigates straight into the session', async () => {
  const fetchMock = stubFetch();
  await loadFleetToken();
  render(LaunchSessionModal, { open: true, onClose: () => {} });
  await waitFor(() => expect(screen.getByTestId('launch-task-input')).toBeInTheDocument());
  await fireEvent.input(screen.getByTestId('launch-task-input'), { target: { value: 'Fix the flaky test' } });
  await fireEvent.click(screen.getByTestId('launch-submit'));

  await waitFor(() => expect(location.hash).toBe('#/session/sess-42'));
  const call = fetchMock.mock.calls.find(([u]) => String(u) === '/api/spawn');
  expect(((call![1] as RequestInit).headers as Record<string, string>)['x-fleet-token']).toBe('test-token');
  expect(spawnBody(fetchMock)).toMatchObject({ task: 'Fix the flaky test', steerable: true, cwd: '/repo/a', addDirs: [] });
});

test('a typed slash command goes through VERBATIM (desktop-app style)', async () => {
  const fetchMock = stubFetch();
  render(LaunchSessionModal, { open: true, onClose: () => {} });
  await waitFor(() => expect(screen.getByTestId('launch-task-input')).toBeInTheDocument());
  await fireEvent.input(screen.getByTestId('launch-task-input'), { target: { value: '/cf:brainstorm design the API' } });
  await fireEvent.click(screen.getByTestId('launch-submit'));

  await waitFor(() => expect(location.hash).toBe('#/session/sess-42'));
  expect(String(spawnBody(fetchMock).task)).toBe('/cf:brainstorm design the API');
});

test('typing "/" in the prompt opens the skill suggestion menu from the catalog', async () => {
  stubFetch();
  render(LaunchSessionModal, { open: true, onClose: () => {} });
  await waitFor(() => expect(screen.getByTestId('launch-task-input')).toBeInTheDocument());
  await waitFor(async () => {
    await fireEvent.input(screen.getByTestId('launch-task-input'), { target: { value: '/bra' } });
    expect(screen.getByTestId('slash-option-brainstorm')).toBeInTheDocument();
  });
});

test('the model pill opens a desktop-style popup and selects a model', async () => {
  const fetchMock = stubFetch();
  render(LaunchSessionModal, { open: true, onClose: () => {} });
  await waitFor(() => expect(screen.getByTestId('launch-model-menu-pill')).toBeInTheDocument());
  await fireEvent.click(screen.getByTestId('launch-model-menu-pill'));
  await fireEvent.click(screen.getByTestId('launch-model-menu-option-opus-4.1'));
  await fireEvent.input(screen.getByTestId('launch-task-input'), { target: { value: 'go' } });
  await fireEvent.click(screen.getByTestId('launch-submit'));
  await waitFor(() => expect(location.hash).toBe('#/session/sess-42'));
  expect(spawnBody(fetchMock).model).toBe('opus-4.1');
});

test('attachments upload first, and their returned paths land in the task text', async () => {
  const fetchMock = stubFetch();
  render(LaunchSessionModal, { open: true, onClose: () => {} });
  await waitFor(() => expect(screen.getByTestId('chat-attach-input')).toBeInTheDocument());
  await fireEvent.input(screen.getByTestId('launch-task-input'), { target: { value: 'review this screenshot' } });
  const file = new File([new Uint8Array([1, 2, 3])], 'shot.png', { type: 'image/png' });
  await fireEvent.change(screen.getByTestId('chat-attach-input'), { target: { files: [file] } });
  await waitFor(() => expect(screen.getByTestId('chat-attachment-list')).toHaveTextContent('shot.png'));
  await fireEvent.click(screen.getByTestId('launch-submit'));

  await waitFor(() => expect(location.hash).toBe('#/session/sess-42'));
  const uploadCall = fetchMock.mock.calls.find(([u]) => String(u) === '/api/uploads');
  expect(uploadCall).toBeTruthy();
  const uploadBody = JSON.parse((uploadCall![1] as RequestInit).body as string) as { files: Array<{ name: string }> };
  expect(uploadBody.files[0].name).toBe('shot.png');
  expect(String(spawnBody(fetchMock).task)).toContain('- /tmp/uploads/u1/shot.png');
});

test('a failed upload blocks the launch and surfaces the server error', async () => {
  const fetchMock = stubFetch({ uploadStatus: 400 });
  render(LaunchSessionModal, { open: true, onClose: () => {} });
  await waitFor(() => expect(screen.getByTestId('chat-attach-input')).toBeInTheDocument());
  await fireEvent.input(screen.getByTestId('launch-task-input'), { target: { value: 'x' } });
  const file = new File([new Uint8Array([1])], 'big.bin');
  await fireEvent.change(screen.getByTestId('chat-attach-input'), { target: { files: [file] } });
  await fireEvent.click(screen.getByTestId('launch-submit'));

  await waitFor(() => expect(screen.getByTestId('launch-error')).toHaveTextContent('too big'));
  expect(fetchMock.mock.calls.find(([u]) => String(u) === '/api/spawn')).toBeUndefined();
});

test('adding a second working folder sends it as addDirs (desktop multi-root)', async () => {
  const fetchMock = stubFetch();
  render(LaunchSessionModal, { open: true, onClose: () => {} });
  await waitFor(() => expect(screen.getByTestId('add-working-folder')).toBeInTheDocument());
  await fireEvent.click(screen.getByTestId('add-working-folder'));
  await fireEvent.input(screen.getByTestId('folder-path-input'), { target: { value: '/repo/b' } });
  await fireEvent.keyDown(screen.getByTestId('folder-path-input'), { key: 'Enter' });
  await waitFor(() => expect(screen.getByTestId('working-folder-chip-1')).toHaveTextContent('repo/b'));

  await fireEvent.input(screen.getByTestId('launch-task-input'), { target: { value: 'work across both' } });
  await fireEvent.click(screen.getByTestId('launch-submit'));
  await waitFor(() => expect(location.hash).toBe('#/session/sess-42'));
  expect(spawnBody(fetchMock)).toMatchObject({ cwd: '/repo/a', addDirs: ['/repo/b'] });
});

test('shows the server error text on a non-2xx /api/spawn response', async () => {
  stubFetch({ spawnStatus: 400 });
  render(LaunchSessionModal, { open: true, onClose: () => {} });
  await waitFor(() => expect(screen.getByTestId('launch-task-input')).toBeInTheDocument());
  await fireEvent.input(screen.getByTestId('launch-task-input'), { target: { value: 'Do something' } });
  await fireEvent.click(screen.getByTestId('launch-submit'));
  await waitFor(() => expect(screen.getByTestId('launch-error')).toHaveTextContent('boom'));
});

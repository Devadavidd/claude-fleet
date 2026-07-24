import { test, expect, afterEach, vi } from 'vitest';
import { render, screen, within, fireEvent, cleanup, waitFor } from '@testing-library/svelte';
import SessionKanban from './SessionKanban.svelte';
import type { TeamTask } from '../../../../shared/types/index.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function task(overrides: Partial<TeamTask> = {}): TeamTask {
  return {
    id: 't1',
    subject: 'Implement thing',
    activeForm: 'Implementing thing',
    description: 'Some description',
    priority: 'high',
    phase: 1,
    planDir: 'plans/demo',
    phaseFile: 'phase-01.md',
    blockedBy: [],
    status: 'pending',
    column: 'pending',
    owner: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    history: [],
    ...overrides,
  };
}

test('renders 3 columns populated from GET /api/sessions/:id/tasks', async () => {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => [
      task({ id: 't1', column: 'pending', subject: 'To do thing' }),
      task({ id: 't2', column: 'in_progress', subject: 'Doing thing' }),
      task({ id: 't3', column: 'completed', subject: 'Done thing' }),
    ],
  }));
  vi.stubGlobal('fetch', fetchMock);
  render(SessionKanban, { props: { sessionId: 's1' } });

  await waitFor(() => expect(screen.getByTestId('kanban-columns')).toBeInTheDocument());
  expect(screen.getByTestId('kanban-col-pending')).toBeInTheDocument();
  expect(screen.getByTestId('kanban-col-in_progress')).toBeInTheDocument();
  expect(screen.getByTestId('kanban-col-completed')).toBeInTheDocument();
  expect(within(screen.getByTestId('kanban-col-pending')).getByText('To do thing')).toBeInTheDocument();
  expect(within(screen.getByTestId('kanban-col-in_progress')).getByText('Doing thing')).toBeInTheDocument();
  expect(within(screen.getByTestId('kanban-col-completed')).getByText('Done thing')).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledWith('/api/sessions/s1/tasks');
});

test('clicking a task card opens the shared TaskDetailDrawer', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [task()] })));
  render(SessionKanban, { props: { sessionId: 's1' } });

  await waitFor(() => expect(screen.getByText('Implement thing')).toBeInTheDocument());
  expect(screen.queryByTestId('task-drawer')).not.toBeInTheDocument();

  await fireEvent.click(screen.getByTestId('kanban-task-card'));

  expect(screen.getByTestId('task-drawer')).toBeInTheDocument();
});

test('shows an empty state when the session has no tasks', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [] })));
  render(SessionKanban, { props: { sessionId: 's1' } });

  await waitFor(() => expect(screen.getByText(/No team tasks in this session yet/)).toBeInTheDocument());
});

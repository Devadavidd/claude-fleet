import { test, expect, afterEach } from 'vitest';
import { render, screen, within, fireEvent, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';
import OverviewTaskTree from './OverviewTaskTree.svelte';
import type { OverviewTree } from '../../../../shared/types/index.js';

// @testing-library/svelte does not auto-register teardown in this project's
// vitest setup — without this, each render() below would stack onto the
// previous test's still-mounted DOM tree.
afterEach(() => cleanup());

function makeTree(): OverviewTree {
  return {
    plans: [
      {
        slug: '260101-0000-demo-plan',
        project: 'demo',
        title: 'Demo Plan',
        status: 'in_progress',
        shipped: false,
        progress: { checked: 1, total: 2, pct: 50 },
        phaseDone: 0,
        phaseTotal: 1,
        phases: [
          {
            file: 'phase-01-setup.md',
            title: 'Phase 1 — Setup',
            num: 1,
            status: 'in_progress',
            checked: 1,
            total: 2,
            pct: 50,
            done: false,
            tasks: [
              {
                id: 't1',
                subject: 'Wire the store',
                description: '',
                status: 'in_progress',
                column: 'in_progress',
                owner: 'dev',
                priority: 'high',
                phase: 1,
                blockedBy: [],
                planDir: 'plans/260101-0000-demo-plan',
                phaseFile: 'phase-01-setup.md',
                planPath: 'plans/260101-0000-demo-plan/phase-01-setup.md',
                sessionId: 's1',
                sessionTitle: 'Demo session',
              },
            ],
          },
        ],
        looseTasks: [],
      },
    ],
    adhoc: [
      {
        id: 'a1',
        subject: 'Fix a typo',
        description: '',
        status: 'pending',
        column: 'pending',
        owner: null,
        priority: 'low',
        phase: null,
        blockedBy: [],
        planDir: '',
        phaseFile: '',
        planPath: '',
        sessionId: null,
        sessionTitle: '',
      },
    ],
  };
}

test('renders the plan collapsed, then expands to reveal its phase and task', async () => {
  render(OverviewTaskTree, { tree: makeTree() });
  expect(screen.getByTestId('task-tree-plan')).toBeInTheDocument();
  expect(screen.getByText('Demo Plan')).toBeInTheDocument();
  expect(screen.queryByText('Wire the store')).not.toBeInTheDocument(); // collapsed by default

  await fireEvent.click(screen.getByText('Demo Plan'));
  await tick();
  await fireEvent.click(screen.getByText('Phase 1 — Setup'));
  await tick();

  expect(screen.getByText('Wire the store')).toBeInTheDocument();
});

test('renders the Ad-hoc bucket and expands it', async () => {
  render(OverviewTaskTree, { tree: makeTree() });
  expect(screen.getByTestId('task-tree-adhoc')).toBeInTheDocument();
  expect(screen.getByText('Ad-hoc / unassigned')).toBeInTheDocument();
  expect(screen.queryByText('Fix a typo')).not.toBeInTheDocument();

  await fireEvent.click(screen.getByText('Ad-hoc / unassigned'));
  await tick();

  expect(screen.getByText('Fix a typo')).toBeInTheDocument();
});

test('clicking a task opens the shared TaskDetailDrawer', async () => {
  render(OverviewTaskTree, { tree: makeTree() });
  await fireEvent.click(screen.getByText('Demo Plan'));
  await tick();
  await fireEvent.click(screen.getByText('Phase 1 — Setup'));
  await tick();
  await fireEvent.click(screen.getByText('Wire the store'));
  await tick();

  const drawer = screen.getByTestId('task-drawer');
  expect(within(drawer).getByText('Wire the store')).toBeInTheDocument();
  expect(within(drawer).getByText('dev')).toBeInTheDocument(); // owner
});

// A completed plan whose phase-file checkboxes were never ticked (checked 0/5)
// but whose status is completed, with one completed live task under the phase.
function makeDoneTree(): OverviewTree {
  return {
    plans: [
      {
        slug: '260101-0000-done-plan',
        project: 'demo',
        title: 'Done Plan',
        status: 'completed',
        shipped: true,
        progress: { checked: 0, total: 5, pct: 0 },
        phaseDone: 1,
        phaseTotal: 1,
        phases: [
          {
            file: 'phase-01.md',
            title: 'Loop engine',
            num: 1,
            status: 'completed',
            checked: 0,
            total: 5,
            pct: 0,
            done: true,
            tasks: [
              {
                id: 'd1', subject: 'Ship loop engine', description: '', status: 'completed',
                column: 'completed', owner: 'lead', priority: 'high', phase: 1, blockedBy: [],
                planDir: 'plans/260101-0000-done-plan', phaseFile: 'phase-01.md',
                planPath: 'plans/260101-0000-done-plan/phase-01.md', sessionId: 's1', sessionTitle: 'x',
              },
            ],
          },
        ],
        looseTasks: [],
      },
    ],
    adhoc: [],
  };
}

test('a completed phase shows live-task progress (1/1), never the unticked 0/5 checkboxes', async () => {
  render(OverviewTaskTree, { tree: makeDoneTree() });
  await fireEvent.click(screen.getByText('Done Plan'));
  await tick();
  expect(screen.getByText('1/1')).toBeInTheDocument();      // matches the one child task
  expect(screen.queryByText('0/5')).not.toBeInTheDocument(); // never the stale checkbox count
});

test('a completed plan renders a full (100%) progress bar and a green phase indicator', async () => {
  const { container } = render(OverviewTaskTree, { tree: makeDoneTree() });
  const fill = container.querySelector('.bg-fleet-success[style*="width"]');
  expect(fill?.getAttribute('style')?.replace(/\s/g, '')).toContain('width:100%');

  await fireEvent.click(screen.getByText('Done Plan'));
  await tick();
  // the phase's COMPLETED status badge is rendered in the success color
  const badge = screen.getByText('completed');
  expect(badge.className).toContain('text-fleet-success');
});

test('renders an empty state when there are no plans and no ad-hoc tasks', () => {
  render(OverviewTaskTree, { tree: { plans: [], adhoc: [] } });
  expect(screen.getByText('No plans found yet.')).toBeInTheDocument();
});

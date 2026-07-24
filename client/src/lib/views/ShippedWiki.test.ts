import { test, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/svelte';
import ShippedWiki from './ShippedWiki.svelte';
import type { FleetWiki } from '../../../../shared/types/index.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function wiki(overrides: Partial<FleetWiki> = {}): FleetWiki {
  return {
    projects: ['demo'],
    cards: [
      {
        slug: '260101-0000-demo-plan',
        project: 'demo',
        status: 'done',
        shipped: true,
        summarized: true,
        plainTitle: 'Shipped the demo plan',
        title: '# Shipped the demo plan',
        body: '# Shipped the demo plan\n\nIt works well.',
        completed: '2026-01-01',
        updatedMs: Date.now(),
        branch: 'main',
        tags: ['feature'],
      },
    ],
    ...overrides,
  };
}

test('fetches /api/wiki and renders a card per entry, with its markdown body mounted', async () => {
  const fetchMock = vi.fn(async () => ({ ok: true, json: async () => wiki() }));
  vi.stubGlobal('fetch', fetchMock);
  render(ShippedWiki);

  await waitFor(() => expect(screen.getByTestId('wiki-card')).toBeInTheDocument());
  expect(screen.getByText('Shipped the demo plan')).toBeInTheDocument();
  expect(screen.getByText('It works well.')).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledWith('/api/wiki');
});

test('renders cards that share a slug across projects (keyed by project+slug, no crash)', async () => {
  // Regression: the fleet aggregates plans/wiki across projects, and the SAME
  // plan slug legitimately recurs in different projects. Keying the {#each} by
  // slug alone threw Svelte's each_key_duplicate and hung the view on "Loading".
  const dup = wiki({
    cards: [
      { ...wiki().cards[0], slug: 'shared-slug', project: 'proj-a', plainTitle: 'Card A' },
      { ...wiki().cards[0], slug: 'shared-slug', project: 'proj-b', plainTitle: 'Card B' },
    ],
  });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => dup })));
  render(ShippedWiki);

  await waitFor(() => expect(screen.getAllByTestId('wiki-card')).toHaveLength(2));
  expect(screen.getByText('Card A')).toBeInTheDocument();
  expect(screen.getByText('Card B')).toBeInTheDocument();
});

test('shows an empty state when there are no cards', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => wiki({ cards: [] }) })));
  render(ShippedWiki);

  await waitFor(() => expect(screen.getByText(/No shipped work yet/)).toBeInTheDocument());
});

test('fails soft (empty state, no throw) when the fetch rejects', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
  render(ShippedWiki);

  await waitFor(() => expect(screen.getByText(/No shipped work yet/)).toBeInTheDocument());
});

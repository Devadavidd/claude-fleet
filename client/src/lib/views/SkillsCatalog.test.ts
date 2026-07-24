import { test, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/svelte';
import SkillsCatalog from './SkillsCatalog.svelte';

afterEach(() => cleanup());

function cardFor(name: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-skill-name="${name}"]`);
  if (!el) throw new Error(`no skill card for ${name}`);
  return el;
}

test('renders a skill card sourced from the bundled fixture', () => {
  render(SkillsCatalog);
  expect(cardFor('agent-browser')).toBeInTheDocument();
  expect(screen.getAllByTestId('skill-card').length).toBeGreaterThan(1);
});

test('the security category chip narrows the grid to that category only', async () => {
  render(SkillsCatalog);

  // Fixture has exactly one 'security' skill (cti-expert) among 84 total.
  await fireEvent.click(screen.getByTestId('skills-category-security'));

  const cards = screen.getAllByTestId('skill-card');
  expect(cards).toHaveLength(1);
  expect(cardFor('cti-expert')).toBeInTheDocument();
});

test('clicking a skill card opens SkillDetailDrawer with its description', async () => {
  render(SkillsCatalog);

  await fireEvent.click(cardFor('agent-browser'));

  const drawer = screen.getByTestId('skill-drawer');
  expect(drawer).toBeInTheDocument();
  expect(within(drawer).getByText(/Automate browsers and apps/)).toBeInTheDocument();
});

test('workflow strip renders /cf: prefixed steps from the fixture', () => {
  render(SkillsCatalog);
  const strip = screen.getByTestId('skills-workflow-strip');
  expect(within(strip).getByText('/cf:plan')).toBeInTheDocument();
  expect(within(strip).getByText('/cf:code-review')).toBeInTheDocument();
  expect(within(strip).queryByText(/\/ck:/)).not.toBeInTheDocument();
});

test('kit header shows the Claude Fleet /cf branding, never ClaudeKit', () => {
  render(SkillsCatalog);
  expect(screen.getByText('Claude Fleet /cf')).toBeInTheDocument();
  // Branding assertion is scoped to the kit title — skill DESCRIPTIONS may
  // legitimately mention ClaudeKit (e.g. plans-kanban's blurb).
  expect(screen.queryByText('ClaudeKit Engineer')).not.toBeInTheDocument();
});

test('manage controls stay hidden on fixture data (no live managed catalog)', () => {
  render(SkillsCatalog);
  expect(screen.queryByTestId('skills-manage-controls')).not.toBeInTheDocument();
  // Drawer opened from fixture data must not offer Remove either.
  expect(screen.queryByTestId('skill-remove')).not.toBeInTheDocument();
});

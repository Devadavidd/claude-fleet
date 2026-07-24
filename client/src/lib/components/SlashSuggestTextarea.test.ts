import { test, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import SlashSuggestTextarea from './SlashSuggestTextarea.svelte';
import { resetSkillEntriesCache } from '../skill-catalog-cache.js';

// Pins the desktop-style slash menu: typing "/" recommends catalog skills,
// Enter/Tab accepts into the text, Enter with the menu closed submits.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetSkillEntriesCache();
});

function stubSkills() {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({ skills: [
      { name: 'brainstorm', desc: 'Debate solutions', cat: 'core' },
      { name: 'plan', desc: 'Plan implementations', cat: 'core' },
    ] }),
  })));
}

async function typeSlash(value: string) {
  const input = screen.getByTestId('slash-textarea') as HTMLTextAreaElement;
  await fireEvent.input(input, { target: { value } });
  return input;
}

test('typing "/bra" opens the menu with the matching skill; Enter accepts it', async () => {
  stubSkills();
  const onSubmit = vi.fn();
  render(SlashSuggestTextarea, { value: '', onSubmit });
  await waitFor(async () => {
    await typeSlash('/bra');
    expect(screen.getByTestId('slash-menu')).toBeInTheDocument();
  });
  expect(screen.getByTestId('slash-option-brainstorm')).toBeInTheDocument();

  const input = screen.getByTestId('slash-textarea') as HTMLTextAreaElement;
  await fireEvent.keyDown(input, { key: 'Enter' });
  expect(input.value).toMatch(/^\/cf:brainstorm /);
  expect(onSubmit).not.toHaveBeenCalled(); // Enter consumed by the menu
  expect(screen.queryByTestId('slash-menu')).not.toBeInTheDocument();
});

test('Enter with no menu open submits; shift+Enter does not', async () => {
  stubSkills();
  const onSubmit = vi.fn();
  render(SlashSuggestTextarea, { value: '', onSubmit });
  const input = await typeSlash('hello there');
  await fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
  expect(onSubmit).not.toHaveBeenCalled();
  await fireEvent.keyDown(input, { key: 'Enter' });
  expect(onSubmit).toHaveBeenCalledTimes(1);
});

test('a bare "/cf:" lists the ENTIRE catalog, not a truncated top-8', async () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ name: `skill-${String(i).padStart(2, '0')}`, desc: `d${i}`, cat: 'x' }));
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ skills: many }) })));
  render(SlashSuggestTextarea, { value: '' });
  await waitFor(async () => {
    await typeSlash('/cf:');
    expect(screen.getByTestId('slash-menu')).toBeInTheDocument();
  });
  expect(screen.getAllByTestId(/^slash-option-/)).toHaveLength(30);
});

test('menuPlacement="below" drops the menu under the textarea (modal anti-clip)', async () => {
  stubSkills();
  render(SlashSuggestTextarea, { value: '', menuPlacement: 'below' });
  await waitFor(async () => {
    await typeSlash('/bra');
    expect(screen.getByTestId('slash-menu')).toBeInTheDocument();
  });
  expect(screen.getByTestId('slash-menu').className).toContain('top-full');
  expect(screen.getByTestId('slash-menu').className).not.toContain('bottom-full');
});

test('mid-sentence slashes never open the menu; Escape closes it', async () => {
  stubSkills();
  render(SlashSuggestTextarea, { value: '' });
  await typeSlash('read /etc/hosts');
  expect(screen.queryByTestId('slash-menu')).not.toBeInTheDocument();

  await waitFor(async () => {
    await typeSlash('/pl');
    expect(screen.getByTestId('slash-menu')).toBeInTheDocument();
  });
  await fireEvent.keyDown(screen.getByTestId('slash-textarea'), { key: 'Escape' });
  expect(screen.queryByTestId('slash-menu')).not.toBeInTheDocument();
});

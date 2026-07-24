import { test, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import App from './App.svelte';

// Proves the toolchain chain end-to-end: Svelte 5 runes compile, jsdom mounts,
// @testing-library/svelte renders, jest-dom matchers apply — and the real
// shell (sidebar + header) mounts for the default '#/' (Overview) route.
test('the app shell mounts under jsdom', () => {
  render(App);
  expect(screen.getByTestId('app-shell')).toBeInTheDocument();
  expect(screen.getByTestId('sidebar')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Overview' })).toBeVisible();
});

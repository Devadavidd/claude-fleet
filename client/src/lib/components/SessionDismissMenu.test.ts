import { test, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import SessionDismissMenu from './SessionDismissMenu.svelte';

// Pins the dismiss contract: Hide posts immediately; Delete needs TWO clicks
// (arm → execute) and hits the irreversible endpoint only on the second.

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubFetch() {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => (
    { ok: true, status: 200, json: async () => ({}) }
  ));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

test('Hide posts /hide on a single click', async () => {
  const fetchMock = stubFetch();
  render(SessionDismissMenu, { sessionId: 's1' });
  await fireEvent.click(screen.getByTestId('dismiss-toggle'));
  await fireEvent.click(screen.getByTestId('dismiss-hide'));
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  expect(String(fetchMock.mock.calls[0][0])).toBe('/api/sessions/s1/hide');
});

test('Delete forever requires TWO clicks — first only arms', async () => {
  const fetchMock = stubFetch();
  render(SessionDismissMenu, { sessionId: 's1' });
  await fireEvent.click(screen.getByTestId('dismiss-toggle'));

  const del = screen.getByTestId('dismiss-delete');
  await fireEvent.click(del);
  expect(fetchMock).not.toHaveBeenCalled(); // armed, nothing fired
  expect(del).toHaveTextContent(/Click again/);

  await fireEvent.click(del);
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  expect(String(fetchMock.mock.calls[0][0])).toBe('/api/sessions/s1/delete-transcript');
});

test('a server refusal surfaces inline instead of closing the menu', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => (
    { ok: false, status: 409, json: async () => ({ error: 'transcript lies outside the projects root' }) }
  )));
  render(SessionDismissMenu, { sessionId: 's1' });
  await fireEvent.click(screen.getByTestId('dismiss-toggle'));
  await fireEvent.click(screen.getByTestId('dismiss-hide'));
  await waitFor(() => expect(screen.getByTestId('dismiss-error')).toHaveTextContent('outside the projects root'));
});

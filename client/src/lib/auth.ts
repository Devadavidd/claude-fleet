// Per-run anti-CSRF token. Fetched once from the same-origin server and held in
// a module variable ONLY (never localStorage/sessionStorage) so a future XSS
// can't read it back. Every mutation carries it as X-Fleet-Token — a header a
// cross-origin page cannot set, so CSRF can't forge the request.

let token = '';

export async function loadFleetToken(): Promise<string> {
  try {
    const res = await fetch('/api/fleet-token');
    if (res.ok) token = ((await res.json()) as { token?: string })?.token || '';
  } catch { /* server down — token stays empty, mutations will 403 */ }
  return token;
}

/** Headers for a mutating fetch: JSON + the token (both required server-side). */
export function fleetHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { 'content-type': 'application/json', 'x-fleet-token': token, ...extra };
}

/**
 * POST a JSON mutation with the fleet token. The token rotates on every server
 * restart while the SPA keeps running — so on a 403 refresh the token once and
 * retry, instead of failing every mutation until a full page reload.
 */
export async function fleetMutate(url: string, body?: unknown): Promise<Response> {
  const init = (): RequestInit => ({
    method: 'POST',
    headers: fleetHeaders(),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const res = await fetch(url, init());
  if (res.status !== 403) return res;
  await loadFleetToken();
  return fetch(url, init());
}

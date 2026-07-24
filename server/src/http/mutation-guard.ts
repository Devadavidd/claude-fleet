import { realpathSync } from 'node:fs';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';

// Security foundation for the launch/kill write surface. The dashboard is
// no-auth localhost, so once a POST can spawn a bypassPermissions process the
// only thing standing between a malicious web page and RCE is this guard.
// Everything here is pure (fs only via an injectable realpath) so it is unit-
// testable and cannot itself be the thing that breaks.

// Applied to EVERY response. `frame-ancestors 'none'` + X-Frame-Options defeat
// clickjacking (a framed real-SPA click would otherwise POST with a valid token).
// connect-src 'self' + no unsafe-inline keep a future XSS from exfiltrating the
// DOM token to an attacker origin.
export const SECURITY_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'X-Frame-Options': 'DENY',
  // The SPA boots from an inline <script type="module"> in index.html, so scripts
  // need 'unsafe-inline'. The protections the red-team actually required survive:
  // frame-ancestors 'none' (clickjacking) and connect-src 'self' (a future XSS
  // still can't exfiltrate the DOM token to an attacker origin). A nonce/external
  // bootstrap would let us drop 'unsafe-inline' later.
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self' 'unsafe-inline'; frame-ancestors 'none'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'",
});

/** Structural subset of `http.IncomingMessage` this guard reads — loose enough
 * that the characterization suite can pass a plain object double. */
export interface MutationRequestLike {
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
}

export interface MutationGuardOptions {
  host?: string;
  port?: number;
}

export interface MutationOk {
  ok: true;
}
export interface MutationDeny {
  ok: false;
  status: number;
  error: string;
}
export type MutationResult = MutationOk | MutationDeny;

// Gate for every mutating request. Rejects anything a cross-origin page could
// forge. Order matters: cheapest structural checks first, token last.
export function requireMutation(
  req: MutationRequestLike | null | undefined,
  token: string,
  { host = '127.0.0.1', port = 4600 }: MutationGuardOptions = {},
): MutationResult {
  if (!req || req.method !== 'POST') return deny(405, 'method not allowed');
  const headers = req.headers ?? {};
  // JSON-only ⇒ a cross-origin fetch triggers a CORS preflight the server
  // refuses; a <form>/sendBeacon (text/plain, form-encoded) is rejected here.
  if (!String(headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
    return deny(415, 'application/json required');
  }
  // Origin, when present, must be same-origin (blocks Origin: null too). Absent
  // Origin falls through — the header token is the real gate, not this.
  const origin = headers['origin'];
  if (origin && !isSameOrigin(String(origin), host, port)) return deny(403, 'forbidden origin');
  // The load-bearing control: a custom header a cross-origin page CANNOT set
  // (would need a CORS preflight the server denies). Read ONLY from the header —
  // never body/query, or CSRF re-opens.
  if (!token || !constantTimeEq(headers['x-fleet-token'], token)) return deny(403, 'bad or missing token');
  return { ok: true };
}

export interface CwdOk {
  ok: true;
  path: string;
}
export interface CwdDeny {
  ok: false;
  error: string;
}
export type CwdResult = CwdOk | CwdDeny;

// Canonicalize a requested cwd and confirm it is inside an allowed root.
// realpath resolves symlinks (beats symlink escape); the prefix test uses
// `root + sep` (beats the /proj vs /proj-evil sibling-dir bug). Empty allow-list
// ⇒ launching disabled (safe default). realpath is injectable for tests.
export function resolveAllowedCwd(
  requested: unknown,
  allowedRoots: readonly string[],
  realpath: (p: string) => string = realpathSync,
): CwdResult {
  if (typeof requested !== 'string' || !requested) return deny2('no cwd given');
  if (!Array.isArray(allowedRoots) || allowedRoots.length === 0) {
    return deny2('launching disabled (no allowed roots configured)');
  }
  let real: string;
  try {
    real = realpath(path.resolve(requested));
  } catch {
    return deny2('cwd not found');
  }
  for (const root of allowedRoots) {
    let realRoot: string;
    try {
      realRoot = realpath(path.resolve(root));
    } catch {
      continue;
    }
    if (real === realRoot || real.startsWith(realRoot + path.sep)) return { ok: true, path: real };
  }
  return deny2('cwd is outside every allowed root');
}

export function isAllowedModel(model: unknown, allowedModels: readonly string[]): boolean {
  // `model` is untrusted JSON input; `includes` only ever performs a value
  // comparison, so a non-string safely returns false — the cast merely
  // satisfies Array<string>.includes' parameter signature.
  return Array.isArray(allowedModels) && allowedModels.length > 0 && allowedModels.includes(model as string);
}

function isSameOrigin(origin: string, host: string, port: number): boolean {
  return origin === `http://${host}:${port}` || origin === `http://localhost:${port}`;
}

function constantTimeEq(presented: unknown, token: string): boolean {
  if (typeof presented !== 'string' || typeof token !== 'string') return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(token);
  if (a.length !== b.length) return false; // length is not secret; unequal ⇒ not equal
  return timingSafeEqual(a, b);
}

function deny(status: number, error: string): MutationDeny {
  return { ok: false, status, error };
}
function deny2(error: string): CwdDeny {
  return { ok: false, error };
}

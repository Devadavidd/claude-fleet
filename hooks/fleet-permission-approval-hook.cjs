#!/usr/bin/env node
// Claude Code PreToolUse hook: ask the fleet dashboard for an Allow/Deny
// decision before a risky tool call runs. Installed globally but STRICTLY
// OPT-IN PER SESSION: it does nothing unless the session's environment
// carries FLEET_REMOTE_APPROVE=on (supervised dashboard launches inject it;
// a terminal opts in with `FLEET_REMOTE_APPROVE=on claude`). Absence = inert —
// so desktop-app and everyday terminal sessions can never be surprised by a
// dashboard wait (the incident that motivated this: the desktop app's "auto"
// is acceptEdits, not bypassPermissions, and a mode blocklist froze it).
// Standalone: plain node, zero dependencies, no imports from the server.
//
// FAIL-OPEN IS SACRED. Any error, timeout, or unreachable server exits 0 with
// no decision, which lets Claude Code fall through to its normal permission
// flow. A dead dashboard must never freeze or break a session.
//
// Flow: read hook input from stdin → skip auto (bypassPermissions) sessions →
// POST the request to the fleet server → long-poll the decision endpoint
// (204 = still waiting, keep polling; the server holds each poll ~55s so the
// overall wait is unbounded) → emit permissionDecision JSON on stdout.

'use strict';
const http = require('node:http');

const BASE_URL = process.env.FLEET_URL || 'http://127.0.0.1:4600';
// First contact must be near-instant on localhost; a refused/absent server
// fails open in well under a second.
const REQUEST_TIMEOUT_MS = 1500;
// Long-poll requests outlive the server's ~55s hold with margin.
const POLL_TIMEOUT_MS = 65_000;

/** Minimal JSON-over-HTTP helper. Resolves {status, body}; rejects on network
 * error/timeout — callers translate rejection into fail-open. */
function jsonRequest(method, url, payload, timeoutMs) {
  return new Promise((resolve, reject) => {
    const body = payload === undefined ? null : JSON.stringify(payload);
    const req = http.request(url, {
      method,
      headers: body ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } : {},
    }, (res) => {
      let raw = '';
      res.on('data', (d) => { raw += d; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = raw ? JSON.parse(raw) : null; } catch { /* non-JSON body → null */ }
        resolve({ status: res.statusCode ?? 0, body: parsed });
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
    if (body) req.write(body);
    req.end();
  });
}

/** Parse hook stdin into the request we send the broker; null → fail-open. */
function buildPermissionRequest(rawStdin, env) {
  // OPT-IN gate: without the explicit marker this hook is inert. Not 'off'-
  // default — sessions that never heard of the fleet must never wait on it.
  if (env.FLEET_REMOTE_APPROVE !== 'on') return null;
  let input;
  try { input = JSON.parse(rawStdin); } catch { return null; }
  if (!input || typeof input !== 'object') return null;
  // Belt-and-braces: even an opted-in bypass session is auto by definition.
  if (input.permission_mode === 'bypassPermissions') return null;
  if (typeof input.session_id !== 'string' || !input.session_id) return null;
  return {
    sessionId: input.session_id,
    toolName: String(input.tool_name ?? ''),
    toolInput: input.tool_input ?? {},
    toolUseId: typeof input.tool_use_id === 'string' ? input.tool_use_id : '',
    permissionMode: String(input.permission_mode ?? ''),
    cwd: String(input.cwd ?? ''),
  };
}

/** Claude Code PreToolUse decision payload for stdout. */
function decisionOutput(decision) {
  const reason = decision === 'allow' ? 'approved via fleet dashboard' : 'denied via fleet dashboard';
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision,
      permissionDecisionReason: reason,
    },
  });
}

/** Register the request, then poll until a terminal decision. Returns
 * 'allow' | 'deny' | null (null → fail-open / passthrough). */
async function waitForDecision(request, transport) {
  const posted = await transport('POST', `${BASE_URL}/api/permissions/request`, request, REQUEST_TIMEOUT_MS);
  if (posted.status !== 200 && posted.status !== 201) return null;
  let requestId = posted.body?.requestId;
  if (typeof requestId !== 'string' || !requestId) return null;
  // Unbounded by design (user decision: wait indefinitely). Each iteration is
  // one bounded long-poll; a server restart surfaces as 404 → re-register.
  for (;;) {
    const poll = await transport('GET', `${BASE_URL}/api/permissions/${encodeURIComponent(requestId)}/decision`, undefined, POLL_TIMEOUT_MS);
    if (poll.status === 200) {
      const d = poll.body?.decision;
      if (d === 'allow' || d === 'deny') return d;
      return null; // 'passthrough' or malformed → normal permission flow
    }
    if (poll.status === 204) continue; // still pending — keep waiting
    if (poll.status === 404) {
      // Server restarted and lost the in-memory request — re-register.
      const again = await transport('POST', `${BASE_URL}/api/permissions/request`, request, REQUEST_TIMEOUT_MS);
      if (again.status !== 200 && again.status !== 201) return null;
      requestId = again.body?.requestId;
      if (typeof requestId !== 'string' || !requestId) return null;
      continue;
    }
    return null; // unexpected status → fail-open
  }
}

async function main() {
  const rawStdin = await new Promise((resolve) => {
    let raw = '';
    process.stdin.on('data', (d) => { raw += d; });
    process.stdin.on('end', () => resolve(raw));
  });
  const request = buildPermissionRequest(rawStdin, process.env);
  if (!request) return; // exit 0, no decision
  const decision = await waitForDecision(request, jsonRequest);
  if (decision) process.stdout.write(decisionOutput(decision));
}

if (require.main === module) {
  // Belt-and-braces fail-open: whatever goes wrong, exit 0 decision-less.
  process.on('uncaughtException', () => process.exit(0));
  process.on('unhandledRejection', () => process.exit(0));
  main().then(() => process.exit(0), () => process.exit(0));
}

module.exports = { buildPermissionRequest, decisionOutput, waitForDecision, BASE_URL };

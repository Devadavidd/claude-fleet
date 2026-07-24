// Resume freshness gate: a transcript that is still moving means some OTHER
// process (the user's terminal / desktop app) may own the session — two writers
// on one session id would corrupt it. But the dashboard's OWN launched child
// also moves the transcript right up until it exits, so "fresh activity" alone
// over-blocks: every finished/stopped in-app session would refuse a follow-up
// message for the full window. The child's exit timestamp disambiguates.

/** How long after the last transcript write we assume a foreign writer is live. */
export const FOREIGN_WRITER_WINDOW_MS = 120_000;

// Transcript timestamps come from the entries the child wrote before exiting,
// so they normally precede exitedAt. The slack absorbs clock skew and a final
// flush landing just after the process is reaped. Trade-off: a foreign process
// that takes the session over within this window is mis-attributed to our own
// child and resume is allowed — accepted, since it requires the user racing
// their own stop/finish by seconds.
const OWN_EXIT_SLACK_MS = 10_000;

/**
 * True when resuming must be refused: the transcript saw activity inside the
 * window AND that activity cannot be attributed to the dashboard's own
 * (already-exited) child — i.e. a foreign process may still be writing.
 */
export function isForeignWriterFresh(
  lastActivityAt: number | null,
  ownChildExitedAt: number | null | undefined,
  now: number,
): boolean {
  if (!lastActivityAt || now - lastActivityAt >= FOREIGN_WRITER_WINDOW_MS) return false;
  if (ownChildExitedAt && lastActivityAt <= ownChildExitedAt + OWN_EXIT_SLACK_MS) return false;
  return true;
}

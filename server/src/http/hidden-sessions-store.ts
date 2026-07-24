import fs from 'node:fs';
import path from 'node:path';

// Persistence for "hidden" sessions (display-only removal — transcripts stay
// untouched) and the guarded real-delete helper. Hidden ids live in an
// owner-only JSON file under ~/.claude-fleet, same posture as launch-settings.

/** Load the hidden-session id set; a missing/corrupt file is an empty set. */
export function loadHiddenSessions(file: string): Set<string> {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

/** Best-effort persist — hiding must never crash the server over disk trouble. */
export function persistHiddenSessions(file: string, hidden: ReadonlySet<string>): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify([...hidden]), { mode: 0o600 });
  } catch { /* display-only state — losing it just resurfaces cards */ }
}

export interface TranscriptDeleteTargets {
  /** The session's own .jsonl file. */
  transcriptFile: string;
  /** The session's sibling dir (subagents/workflows), if the layout matches. */
  sessionDir: string | null;
}

/**
 * The ONLY paths a transcript delete may touch, derived from the watcher's
 * registered file path (never client input) and confined to projectsRoot.
 * Returns null when the file lies outside the root — refuse to delete.
 */
export function resolveTranscriptDeleteTargets(
  transcriptFile: string,
  sessionId: string,
  projectsRoot: string,
): TranscriptDeleteTargets | null {
  const root = path.resolve(projectsRoot);
  const file = path.resolve(transcriptFile);
  if (!file.startsWith(root + path.sep)) return null;
  if (path.basename(file) !== `${sessionId}.jsonl`) return null; // layout sanity
  const sessionDir = path.join(path.dirname(file), sessionId);
  return {
    transcriptFile: file,
    // The sibling dir only qualifies while it stays under the root too.
    sessionDir: sessionDir.startsWith(root + path.sep) ? sessionDir : null,
  };
}

/** Delete the resolved targets (file first, then the sibling dir). */
export function deleteTranscriptTargets(targets: TranscriptDeleteTargets): void {
  fs.rmSync(targets.transcriptFile, { force: true });
  if (targets.sessionDir) fs.rmSync(targets.sessionDir, { recursive: true, force: true });
}

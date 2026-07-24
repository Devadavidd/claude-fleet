import fs from 'node:fs/promises';

const MAX_BYTES = 512 * 1024; // viewer cap — transcripts aside, no giant blobs

/** Narrow slice of session state this reader consults — the reducer's real
 * per-session state (session-state-reducer.ts) satisfies this structurally. */
export interface TouchedFileSessionState {
  readableFiles?: Set<string>;
  fileTouches?: Map<string, unknown>;
}

export interface TouchedFileOkBody {
  path: string;
  content?: string;
  binary?: boolean;
  size: number;
  truncated?: boolean;
  mtime?: number;
}

export interface TouchedFileErrorBody {
  error: string;
}

export interface TouchedFileResult {
  status: 200 | 403 | 404;
  body: TouchedFileOkBody | TouchedFileErrorBody;
}

// Serves file CONTENT for the web viewer. Security invariant: only paths the
// agents actually read or wrote (present in some session's readableFiles set)
// are readable — the client-supplied path is a lookup key into that set,
// never a free-form filesystem path. The viewer always serves LIVE disk content
// (it has a reload button), not a transcript snapshot; this is a localhost-only,
// same-user, read-only tool, so surfacing a path the session touched grants the
// viewer nothing the operator's own shell couldn't already read.
export async function readTouchedFile(
  requestedPath: string,
  sessionStates: Iterable<TouchedFileSessionState>,
): Promise<TouchedFileResult> {
  let known = false;
  for (const state of sessionStates) {
    if (state.readableFiles?.has(requestedPath) || state.fileTouches?.has(requestedPath)) {
      known = true;
      break;
    }
  }
  if (!known) return { status: 403, body: { error: 'not a tracked file' } };

  let stat;
  try {
    stat = await fs.stat(requestedPath);
  } catch {
    return { status: 404, body: { error: 'file gone' } };
  }
  if (!stat.isFile()) return { status: 404, body: { error: 'not a file' } };

  const handle = await fs.open(requestedPath, 'r'); // read-only, explicit
  try {
    const size = Math.min(stat.size, MAX_BYTES);
    const buffer = Buffer.alloc(size);
    await handle.read(buffer, 0, size, 0);
    if (buffer.includes(0)) {
      return { status: 200, body: { path: requestedPath, binary: true, size: stat.size } };
    }
    return {
      status: 200,
      body: {
        path: requestedPath,
        content: buffer.toString('utf8'),
        size: stat.size,
        truncated: stat.size > MAX_BYTES,
        mtime: stat.mtimeMs,
      },
    };
  } finally {
    await handle.close();
  }
}

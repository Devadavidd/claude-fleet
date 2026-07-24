import fs from 'node:fs/promises';
import path from 'node:path';
import type { ServerResponse } from 'node:http';
import { SECURITY_HEADERS } from './mutation-guard.js';

// Static SPA serving, extracted out of the dispatcher so server.ts stays
// focused on routing. `publicDir` is caller-resolved (path.resolve'd once in
// the SseServer constructor) so the traversal guard below compares real paths.

const MIME: Readonly<Record<string, string>> = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
});

// Serves one static file from `publicDir`. No index.html fallback — the SPA is
// a HASH router, so a miss must be a real 404 (a fallback would mask missing
// hashed assets as a false 200 and break module-MIME diagnostics).
export async function serveStatic(res: ServerResponse, pathname: string, publicDir: string): Promise<void> {
  const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
  const filePath = path.join(publicDir, path.normalize(rel));
  if (!filePath.startsWith(publicDir + path.sep)) {
    writeJson(res, 403, { error: 'forbidden' });
    return;
  }
  try {
    const body = await fs.readFile(filePath);
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'content-type': MIME[path.extname(filePath)] ?? 'application/octet-stream',
      // Dashboard iterates fast; a stale cached SPA hides new tabs/views.
      'cache-control': 'no-cache',
    });
    res.end(body);
  } catch {
    writeJson(res, 404, { error: 'not found' });
  }
}

function writeJson(res: ServerResponse, status: number, data: unknown): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  res.writeHead(status, { ...SECURITY_HEADERS, 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

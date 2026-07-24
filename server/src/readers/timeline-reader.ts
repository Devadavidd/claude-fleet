import { createReadStream } from 'node:fs';
import readline from 'node:readline';
import type { TimelineResponse } from '../../../shared/types/index.js';
import { parseLine } from './jsonl-defensive-parser.js';

export interface ReadTimelineOptions {
  limit?: number;
  since?: number | null;
}

// On-demand full-file parse for the drill-down view. Timelines are NOT kept
// in memory — a 100MB transcript is streamed line by line and only the
// requested window is retained.
//
// Returns { events, total, offset } where `offset` is the absolute index of
// events[0] in the file, so the client can live-append with ?since=<total>.
export async function readTimeline(
  filePath: string,
  { limit = 1000, since = null }: ReadTimelineOptions = {},
): Promise<TimelineResponse> {
  const events: TimelineResponse['events'] = [];
  let total = 0;

  const stream = createReadStream(filePath, { encoding: 'utf8' });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of lines) {
    const entry = parseLine(line);
    if (!entry) continue;
    total += 1;
    if (since !== null) {
      // Live-append mode: only entries after the client's known count — but
      // still ring-buffered, so ?since=0 on a huge file cannot blow memory.
      if (total > since) events.push(entry);
    } else {
      // Initial load: ring buffer of the last `limit` entries.
      events.push(entry);
    }
    if (events.length > limit) events.shift();
  }

  return { events, total, offset: total - events.length };
}

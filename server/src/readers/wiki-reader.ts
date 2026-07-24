import fs from 'node:fs/promises';
import path from 'node:path';
import type { FleetWiki, WikiCard } from '../../../shared/types/index.js';
import { parseFrontmatter as parseFm, firstHeading } from './plan-frontmatter.js';
import type { FrontmatterData, FrontmatterFieldKey } from './plan-frontmatter.js';

// Read-only reader for the "Shipped" tab. Given fleet project roots (from session cwds),
// it scans each root's plans/ (status/meta) and docs/wiki/ (plain-language prose written by
// the /ck:wiki skill) and joins them into cards. It NEVER writes and touches nothing outside
// each root's plans/ + docs/wiki/. Defensive throughout: a bad file degrades one card, never
// the whole feed; a root without plans/ contributes nothing (non-ClaudeKit projects hidden).

const COMPLETED = new Set(['completed', 'complete']);
// Scalar frontmatter fields the wiki cards need from plan.md + generated entries.
const WIKI_FIELDS: FrontmatterFieldKey[] = ['title', 'status', 'branch', 'created', 'plan_slug', 'source_hash', 'completed', 'project'];

interface ProjectWikiResult {
  project: string;
  root: string;
  cards: WikiCard[];
}

interface WikiEntryRecord {
  path: string;
  mtimeMs: number;
  data: FrontmatterData;
  body: string;
}

// Thin wrapper over the shared parser, pinned to the fields this reader consumes.
function parseFrontmatter(text: string) {
  return parseFm(text, WIKI_FIELDS);
}

async function readIfExists(p: string): Promise<string | null> {
  try {
    return await fs.readFile(p, 'utf8');
  } catch {
    return null;
  }
}

// Last-modified epoch-ms for a file, or 0 if it can't be stat'd. Used as the recency signal so
// just-completed / just-summarized work floats to the top of the Shipped feed.
async function statMs(p: string): Promise<number> {
  try {
    return (await fs.stat(p)).mtimeMs;
  } catch {
    return 0;
  }
}

// Local YYYY-MM-DD for an epoch-ms timestamp (local, to avoid a UTC off-by-one near midnight).
function ymdLocal(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function listDir(p: string) {
  try {
    return await fs.readdir(p, { withFileTypes: true });
  } catch {
    return [];
  }
}

// Confine a candidate path to a whitelisted sub-tree of root. Rejects traversal.
function within(root: string, sub: string, name: string): string | null {
  const base = path.join(root, sub);
  const resolved = path.resolve(base, name);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) return null;
  return resolved;
}

export async function readProjectWiki(root: string): Promise<ProjectWikiResult> {
  const project = path.basename(root);
  const plansDir = path.join(root, 'plans');
  const wikiDir = path.join(root, 'docs', 'wiki');

  const planDirs = (await listDir(plansDir)).filter((d) => d.isDirectory());
  if (planDirs.length === 0) return { project, root, cards: [] }; // not a ClaudeKit project

  // Index generated entries by slug.
  const entries = new Map<string, WikiEntryRecord>();
  for (const f of await listDir(wikiDir)) {
    if (!f.isFile() || !f.name.endsWith('.md')) continue;
    const full = within(root, path.join('docs', 'wiki'), f.name);
    if (!full) continue;
    const text = await readIfExists(full);
    if (text == null) continue;
    const parsed = parseFrontmatter(text);
    entries.set(f.name.replace(/\.md$/, ''), { path: full, mtimeMs: await statMs(full), ...parsed });
  }

  const cards: WikiCard[] = [];
  for (const d of planDirs) {
    const planPath = within(root, 'plans', path.join(d.name, 'plan.md'));
    if (!planPath) continue;
    const planText = await readIfExists(planPath);
    if (planText == null) continue;
    const planMs = await statMs(planPath);
    const { data: plan } = parseFrontmatter(planText);
    const status = (plan.status || '').toLowerCase();
    if (!status) continue;

    const entry = entries.get(d.name) || null;
    // Recency = the most recent write across the plan and its summary. This is what the feed
    // sorts on, so flipping a plan to completed (or running /ck:wiki) lifts it to the top.
    const updatedMs = Math.max(planMs, entry?.mtimeMs || 0);
    // Prefer the summary's explicit completed date; otherwise fall back to when plan.md was last
    // written (≈ when it was marked completed) — more truthful than the plan's created date.
    const completed = entry?.data.completed || (planMs ? ymdLocal(planMs) : plan.created?.slice(0, 10) || '');

    cards.push({
      slug: d.name,
      project,
      status,
      shipped: COMPLETED.has(status),
      summarized: Boolean(entry),
      plainTitle: entry ? (firstHeading(entry.body) || plan.title || d.name) : (plan.title || d.name),
      title: plan.title || d.name,
      body: entry ? entry.body.trim() : '',
      completed,
      updatedMs,
      branch: plan.branch || '',
      tags: plan.tags || [],
    });
  }
  return { project, root, cards };
}

// Aggregate across the fleet. Shipped first; then newest completed day; then, because day-granular
// dates tie constantly within a busy day, the most-recently-worked-on (by file mtime) so the thing
// you just finished leads its day. Pending sinks below shipped.
export async function readFleetWiki(roots: Array<string | null | undefined>): Promise<FleetWiki> {
  const unique = [...new Set(roots.filter((r): r is string => Boolean(r)))];
  const perRoot = await Promise.all(unique.map((r) => readProjectWiki(r).catch(() => null)));
  const cards = perRoot.filter((r): r is ProjectWikiResult => r !== null).flatMap((r) => r.cards);
  cards.sort((a, b) => {
    if (a.shipped !== b.shipped) return a.shipped ? -1 : 1;
    if (a.completed !== b.completed) return a.completed < b.completed ? 1 : -1; // newer completed day first
    if (b.updatedMs !== a.updatedMs) return b.updatedMs - a.updatedMs;          // same day: newest work first
    return a.slug < b.slug ? 1 : a.slug > b.slug ? -1 : 0;                      // final deterministic tie-break
  });
  const projects = [...new Set(cards.map((c) => c.project))].sort();
  return { projects, cards };
}

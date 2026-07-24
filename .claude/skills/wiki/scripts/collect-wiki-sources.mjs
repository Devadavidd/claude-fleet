#!/usr/bin/env node
// Mechanical half of /ck:wiki: scan a project's completed plans, match each to its
// journal, compute a content hash, and decide create/update/skip against any existing
// docs/wiki entry. Emits a JSON work order on stdout. The *prose* is written by the
// skill (Claude) — this script never calls an LLM and never writes files.
//
// Usage:
//   node collect-wiki-sources.mjs [--root <dir>] [--for <slug>] [--json]
//   --root  project root to scan (default: cwd)
//   --for   restrict to a single plan dir/slug
//
// Deterministic + dependency-free (node builtins only) so it is unit-testable (Phase 5)
// and portable to any project the skill runs in.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const COMPLETED = new Set(['completed', 'complete']);

function parseArgs(argv) {
  const args = { root: process.cwd(), for: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') args.root = path.resolve(argv[++i] ?? '.');
    else if (argv[i] === '--for') args.for = argv[++i] ?? null;
  }
  return args;
}

// Minimal, defensive frontmatter split. Returns { fm: rawText, body }.
function splitFrontmatter(text) {
  if (!text.startsWith('---')) return { fm: '', body: text };
  const end = text.indexOf('\n---', 3);
  if (end === -1) return { fm: '', body: text };
  const fm = text.slice(text.indexOf('\n') + 1, end);
  const nl = text.indexOf('\n', end + 1);
  const body = nl === -1 ? '' : text.slice(nl + 1);
  return { fm, body };
}

// Extract just the scalar keys we need. Not a full YAML parser by design (KISS).
function fmScalar(fm, key) {
  const m = fm.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  if (!m) return '';
  return m[1].trim().replace(/^['"]|['"]$/g, '').trim();
}

// tags: [a, b]  OR  block list under `tags:`
function fmTags(fm) {
  const inline = fm.match(/^tags:\s*\[(.*)\]\s*$/m);
  if (inline) {
    return inline[1].split(',').map((t) => t.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  }
  const block = fm.match(/^tags:\s*\n((?:\s+-\s*.+\n?)+)/m);
  if (block) {
    return block[1].split('\n').map((l) => l.replace(/^\s*-\s*/, '').trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  }
  return [];
}

const DATE_TOKEN = /^\d{6}/; // leading YYMMDD in a slug

function slugWordTokens(slug) {
  return slug.split('-').filter((t) => t && !/^\d+$/.test(t));
}

// Heuristic journal match: require >=3 shared meaningful word tokens. In a project whose
// vocabulary recurs ("image", "rag", "source", "vision"...), a 2-word overlap is often
// coincidental across unrelated work, while a real plan↔journal pair has a near-identical
// slug (3-6 shared words). Date alone is never a match — only a tiebreak among genuine
// word-overlap candidates. Under-matching (plan-only entry) is safer than mis-matching
// (injecting an unrelated journal's lessons).
const MIN_JOURNAL_TOKEN_OVERLAP = 3;

function matchJournal(slug, journalFiles) {
  const dateTok = (slug.match(DATE_TOKEN) || [])[0] || '';
  const slugTokens = new Set(slugWordTokens(slug));
  let best = null;
  let bestScore = 0;
  for (const jf of journalFiles) {
    const base = path.basename(jf, '.md');
    const overlap = slugWordTokens(base).filter((t) => slugTokens.has(t)).length;
    if (overlap < MIN_JOURNAL_TOKEN_OVERLAP) continue;
    const shareDate = dateTok && base.includes(dateTok);
    const score = overlap + (shareDate ? 1 : 0);
    if (score > bestScore) {
      best = jf;
      bestScore = score;
    }
  }
  return best ? { file: best, score: bestScore } : null;
}

function safeGitLog(root, branch) {
  if (!branch) return '';
  try {
    return execFileSync('git', ['-C', root, 'log', '--oneline', '--no-merges', branch, '-n', '30'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

function projectName(root) {
  return path.basename(root);
}

function readIfExists(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = args.root;
  const plansDir = path.join(root, 'plans');
  const journalsDir = path.join(root, 'docs', 'journals');
  const wikiDir = path.join(root, 'docs', 'wiki');

  const result = { root, project: projectName(root), items: [] };

  let planDirs = [];
  try {
    planDirs = fs.readdirSync(plansDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    // Non-ClaudeKit project (no plans/) → empty work order, graceful.
    process.stdout.write(JSON.stringify(result, null, 2));
    return;
  }

  const journalFiles = (() => {
    try {
      return fs.readdirSync(journalsDir).filter((f) => f.endsWith('.md')).map((f) => path.join(journalsDir, f));
    } catch {
      return [];
    }
  })();

  // Pass 1: gather completed plans + their best candidate journal (with match score).
  const items = [];
  for (const slug of planDirs) {
    if (args.for && slug !== args.for) continue;
    const planPath = path.join(plansDir, slug, 'plan.md');
    const planText = readIfExists(planPath);
    if (planText == null) continue;

    const { fm, body } = splitFrontmatter(planText);
    const status = fmScalar(fm, 'status').toLowerCase();
    if (!COMPLETED.has(status)) continue; // generation is completed-only

    const jmatch = matchJournal(slug, journalFiles);

    let completed = '';
    try {
      completed = fs.statSync(planPath).mtime.toISOString().slice(0, 10);
    } catch {
      completed = fmScalar(fm, 'created').slice(0, 10);
    }

    items.push({
      slug,
      status,
      title: fmScalar(fm, 'title') || slug,
      branch: fmScalar(fm, 'branch'),
      tags: fmTags(fm),
      completed,
      entryPath: path.join(wikiDir, `${slug}.md`),
      planPath,
      planText,
      planBody: body,
      _journalCandidate: jmatch, // { file, score } | null
    });
  }

  // Dedup: a journal belongs to exactly one plan — its highest-scoring match. Losers get no
  // journal (a plan-only entry) rather than borrowing another plan's journal. Ties broken
  // deterministically by slug so a journal binds to exactly one owner.
  const owner = new Map(); // journalFile -> { score, slug }
  for (const it of items) {
    const c = it._journalCandidate;
    if (!c) continue;
    const cur = owner.get(c.file);
    if (!cur || c.score > cur.score || (c.score === cur.score && it.slug < cur.slug)) {
      owner.set(c.file, { score: c.score, slug: it.slug });
    }
  }

  // Pass 2: finalize journal assignment, then hash + action against any existing entry.
  for (const it of items) {
    const c = it._journalCandidate;
    const journalPath = c && owner.get(c.file)?.slug === it.slug ? c.file : null;
    const journalText = journalPath ? readIfExists(journalPath) : null;

    // source_hash covers plan + journal only (not git log) so new commits alone don't force regen.
    const hash = 'sha256:' + crypto.createHash('sha256')
      .update(it.planText).update('\0').update(journalText || '')
      .digest('hex').slice(0, 16);

    const existing = readIfExists(it.entryPath);
    let action = 'create';
    if (existing != null) {
      const existingHash = fmScalar(splitFrontmatter(existing).fm, 'source_hash');
      action = existingHash === hash ? 'skip' : 'update';
    }

    result.items.push({
      slug: it.slug,
      status: it.status,
      action,
      title: it.title,
      branch: it.branch,
      tags: it.tags,
      completed: it.completed,
      sourceHash: hash,
      entryPath: it.entryPath,
      planPath: it.planPath,
      journalPath: journalPath || null,
      gitLog: safeGitLog(root, it.branch),
      planBody: it.planBody,
      journalText: journalText || null,
    });
  }

  // Newest first for convenience.
  result.items.sort((a, b) => (a.completed < b.completed ? 1 : -1));
  process.stdout.write(JSON.stringify(result, null, 2));
}

main();

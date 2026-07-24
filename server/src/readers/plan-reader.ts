import fs from 'node:fs/promises';
import path from 'node:path';
import type { Dirent } from 'node:fs';
import type { PlanPhase, PlanRecord } from '../../../shared/types/index.js';
import { parseFrontmatter } from './plan-frontmatter.js';
import type { FrontmatterFieldKey } from './plan-frontmatter.js';

// Read-only reader of durable plan progress for the Overview dashboard. Given fleet
// project roots (from session cwds), it scans each root's plans/<slug>/ — reading plan.md
// (Epic-level status/meta) and every phase-*.md (Story-level status + checkbox progress).
// NEVER writes; confined to <root>/plans/**. Defensive: a bad file degrades one plan/phase,
// never the whole scan.

const COMPLETED = new Set(['completed', 'complete']);
const PLAN_FIELDS: FrontmatterFieldKey[] = ['title', 'status', 'branch', 'created', 'completed'];
const PHASE_FIELDS: FrontmatterFieldKey[] = ['title', 'status', 'phase', 'priority'];

// Count markdown task-list checkboxes in a phase file body: `- [ ]` vs `- [x]`.
function countCheckboxes(text: string): { checked: number; total: number } {
  const src = typeof text === 'string' ? text : '';
  const checked = (src.match(/^\s*[-*]\s+\[[xX]\]/gm) || []).length;
  const unchecked = (src.match(/^\s*[-*]\s+\[ \]/gm) || []).length;
  return { checked, total: checked + unchecked };
}

function pct(checked: number, total: number): number {
  return total > 0 ? Math.round((checked / total) * 100) : 0;
}

// Phase ordinal from a `phase-0N-*.md` file name. Fallback when the frontmatter
// omits `phase:` — the number is authoritative in the name, so live tasks tagged
// "Phase N" still match the right phase node.
function numFromFileName(fileName: string): number | null {
  const m = /^phase-0*(\d+)/i.exec(fileName);
  return m ? Number(m[1]) : null;
}

async function readIfExists(p: string): Promise<string | null> {
  try { return await fs.readFile(p, 'utf8'); } catch { return null; }
}

async function listDir(p: string): Promise<Dirent[]> {
  try { return await fs.readdir(p, { withFileTypes: true }); } catch { return []; }
}

// Confine a candidate path to a whitelisted sub-tree of root. Rejects traversal.
function within(root: string, sub: string, name: string): string | null {
  const base = path.join(root, sub);
  const resolved = path.resolve(base, name);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) return null;
  return resolved;
}

// Read one phase-*.md into a compact phase record. A phase is "done" when its
// frontmatter says completed OR every checkbox is ticked (and there is at least one).
async function readPhase(planAbsDir: string, fileName: string): Promise<PlanPhase | null> {
  const full = path.join(planAbsDir, fileName);
  const text = await readIfExists(full);
  if (text == null) return null;
  const { data } = parseFrontmatter(text, PHASE_FIELDS);
  const status = (data.status || '').toLowerCase();
  const { checked, total } = countCheckboxes(text);
  const done = COMPLETED.has(status) || (total > 0 && checked === total);
  return {
    file: fileName,
    title: data.title || fileName,
    num: data.phase != null ? Number(data.phase) : numFromFileName(fileName),
    status: status || 'pending',
    checked,
    total,
    pct: total > 0 ? pct(checked, total) : (done ? 100 : 0),
    done,
  };
}

// Read a single plans/<slug>/ directory into a plan record with its phases and a
// rolled-up progress %. Returns null when plan.md is missing/unreadable.
export async function readPlanDir(root: string, slug: string): Promise<PlanRecord | null> {
  const planMdPath = within(root, 'plans', path.join(slug, 'plan.md'));
  if (!planMdPath) return null;
  const planText = await readIfExists(planMdPath);
  if (planText == null) return null;
  const { data: plan } = parseFrontmatter(planText, PLAN_FIELDS);
  const status = (plan.status || '').toLowerCase();
  if (!status) return null;

  const planAbsDir = path.dirname(planMdPath);
  const phaseFiles = (await listDir(planAbsDir))
    .filter((d) => d.isFile() && /^phase-.*\.md$/.test(d.name))
    .map((d) => d.name)
    .sort();
  const phases: PlanPhase[] = [];
  for (const f of phaseFiles) {
    const phase = await readPhase(planAbsDir, f);
    if (phase) phases.push(phase);
  }

  const checked = phases.reduce((n, p) => n + p.checked, 0);
  const total = phases.reduce((n, p) => n + p.total, 0);
  const phaseDone = phases.filter((p) => p.done).length;

  return {
    slug,
    project: path.basename(root),
    title: plan.title || slug,
    status,
    shipped: COMPLETED.has(status),
    branch: plan.branch || '',
    completed: (plan.completed || plan.created || '').slice(0, 10),
    tags: plan.tags || [],
    phases,
    phaseTotal: phases.length,
    phaseDone,
    progress: { checked, total, pct: total > 0 ? pct(checked, total) : (COMPLETED.has(status) ? 100 : 0) },
  };
}

// Scan one project root's plans/ directory into plan records (fail-open per plan).
export async function readProjectPlans(root: string): Promise<PlanRecord[]> {
  const planDirs = (await listDir(path.join(root, 'plans'))).filter((d) => d.isDirectory());
  const plans: PlanRecord[] = [];
  for (const d of planDirs) {
    const rec = await readPlanDir(root, d.name).catch(() => null);
    if (rec) plans.push(rec);
  }
  return plans;
}

// Aggregate plans across the fleet, newest-created-slug first (slug is date-prefixed).
export async function readFleetPlans(roots?: Array<string | null | undefined>): Promise<PlanRecord[]> {
  const unique = [...new Set((roots || []).filter((r): r is string => Boolean(r)))];
  const perRoot = await Promise.all(unique.map((r) => readProjectPlans(r).catch(() => [] as PlanRecord[])));
  const plans = perRoot.flat();
  plans.sort((a, b) => (a.slug < b.slug ? 1 : a.slug > b.slug ? -1 : 0));
  return plans;
}

import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  SkillAgent,
  SkillCatalog,
  SkillCatalogKit,
  SkillCategory,
  SkillEntry,
  SkillWorkflowStep,
} from '../../../shared/types/index.js';

// Read-only live scan of a ClaudeKit home (`~/.claude` by default) for
// GET /api/skills. Defensive like jsonl-defensive-parser.ts: a malformed or
// oversized entry is skipped, never thrown, and one bad skill/agent never
// fails the whole scan. NEVER writes/renames/locks anything under the scanned
// root — every filesystem call here is a read (stat/readdir/readFile/realpath).
// Every candidate path is confined to the configured root via fs.realpath, so
// a symlink (or an entry name smuggling `..`) can never resolve outside
// `<root>/skills` or `<root>/agents`. Takes no client-supplied input — the
// scan root comes solely from server config.

const MAX_SKILL_FILE_BYTES = 64 * 1024; // SKILL.md / agent .md are short docs; bigger reads are treated as oversized
const MAX_KIT_FILE_BYTES = 2 * 1024 * 1024; // .ck.json / metadata.json can legitimately run larger (per-file checksums)
const MAX_SKILLS = 300; // cap result size — a hostile/runaway skills dir can't blow up the response
const MAX_AGENTS = 200;
const MAX_ROLE_CHARS = 140;

// The core workflow strip (plan → cook → test → review → ship) is a fixed
// concept, not derived data — but a step only surfaces when a backing skill is
// actually present in this scan, so a partial/custom install never shows a
// dead link. Each step lists candidate skill names because the cf bundle
// strips the legacy `ck-` prefix (plan) while a legacy ~/.claude scan still
// carries it (ck-plan); the first candidate found wins.
const CORE_WORKFLOW: ReadonlyArray<{ key: string; label: string; candidates: readonly string[] }> = [
  { key: 'plan', label: 'Plan', candidates: ['plan', 'ck-plan'] },
  { key: 'cook', label: 'Cook', candidates: ['cook'] },
  { key: 'test', label: 'Test', candidates: ['test'] },
  { key: 'review', label: 'Review', candidates: ['code-review', 'ck-code-review'] },
  { key: 'ship', label: 'Ship', candidates: ['ship'] },
];

export async function scanSkillCatalog(root: string): Promise<SkillCatalog> {
  const realRoot = await safeRealpath(path.resolve(root));
  if (!realRoot) return emptyCatalog();

  const skills = await scanSkills(realRoot);
  const agents = await scanAgents(realRoot);
  await applyProvenance(realRoot, skills);
  const kit = await buildKit(realRoot, skills.length, agents.length);
  return {
    kit,
    categories: categoriesOf(skills),
    workflow: coreWorkflowSteps(skills),
    agents,
    skills,
  };
}

function coreWorkflowSteps(skills: readonly SkillEntry[]): SkillWorkflowStep[] {
  const present = new Set(skills.map((s) => s.name));
  const steps: SkillWorkflowStep[] = [];
  for (const step of CORE_WORKFLOW) {
    const found = step.candidates.find((name) => present.has(name));
    if (found) steps.push({ key: step.key, skill: found, label: step.label });
  }
  return steps;
}

function emptyCatalog(): SkillCatalog {
  return {
    kit: {
      name: '',
      version: '',
      installed: '',
      codingLevel: '',
      statusline: '',
      privacy: false,
      counts: { skills: 0, agents: 0, outputStyles: 0, hooks: 0, rules: 0 },
    },
    categories: [],
    workflow: [],
    agents: [],
    skills: [],
  };
}

// --- skills ---

async function scanSkills(realRoot: string): Promise<SkillEntry[]> {
  const realSkillsDir = await safeRealpath(path.join(realRoot, 'skills'));
  if (!realSkillsDir) return [];
  const out: SkillEntry[] = [];
  for (const entry of await listDir(realSkillsDir)) {
    if (out.length >= MAX_SKILLS) break;
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const realSkillDir = await safeRealpath(path.join(realSkillsDir, entry.name));
    if (!realSkillDir || !isWithin(realSkillsDir, realSkillDir)) continue; // symlink escape — never followed
    const skill = await readSkillEntry(entry.name, realSkillDir);
    if (skill) out.push(skill);
  }
  return out;
}

async function readSkillEntry(dirName: string, realSkillDir: string): Promise<SkillEntry | null> {
  const dirStat = await safeStat(realSkillDir);
  if (!dirStat?.isDirectory()) return null;
  const text = await readBounded(path.join(realSkillDir, 'SKILL.md'), MAX_SKILL_FILE_BYTES);
  if (text === null) return null; // missing, oversized, or unreadable — skip, never throw

  const block = extractFrontmatter(text);
  const desc = (block ? scalarField(block.fm, 'description') : '') || firstNonEmptyLine(block ? block.body : text);
  const scripts = await hasDir(path.join(realSkillDir, 'scripts'));
  const refs = (await hasDir(path.join(realSkillDir, 'references'))) || (await hasDir(path.join(realSkillDir, 'refs')));

  return {
    name: dirName, // name from the directory, per the read-only scan contract
    desc,
    cat: (block ? scalarField(block.fm, 'category') : '') || 'other',
    hint: block ? scalarField(block.fm, 'argument-hint') : '',
    keywords: block ? listField(block.fm, 'keywords') : [],
    scripts,
    refs,
    maturity: block ? scalarField(block.fm, 'maturity') : '',
  };
}

// --- agents ---

async function scanAgents(realRoot: string): Promise<SkillAgent[]> {
  const realAgentsDir = await safeRealpath(path.join(realRoot, 'agents'));
  if (!realAgentsDir) return [];
  const out: SkillAgent[] = [];
  for (const entry of await listDir(realAgentsDir)) {
    if (out.length >= MAX_AGENTS) break;
    if ((!entry.isFile() && !entry.isSymbolicLink()) || !entry.name.toLowerCase().endsWith('.md')) continue;
    const realFilePath = await safeRealpath(path.join(realAgentsDir, entry.name));
    if (!realFilePath || !isWithin(realAgentsDir, realFilePath)) continue; // symlink escape — never followed
    const agent = await readAgentEntry(entry.name, realFilePath);
    if (agent) out.push(agent);
  }
  return out;
}

async function readAgentEntry(fileName: string, realFilePath: string): Promise<SkillAgent | null> {
  const fileStat = await safeStat(realFilePath);
  if (!fileStat?.isFile()) return null;
  const text = await readBounded(realFilePath, MAX_SKILL_FILE_BYTES);
  if (text === null) return null;
  const block = extractFrontmatter(text);
  const rawDescription = block ? scalarField(block.fm, 'description') : '';
  const role = shortenRole(rawDescription) || firstNonEmptyLine(block ? block.body : text);
  return { name: fileName.replace(/\.md$/i, ''), role };
}

// First sentence of a (often long, example-laden) agent description, bounded —
// a short human-readable role rather than the full frontmatter prose.
function shortenRole(description: string): string {
  if (!description) return '';
  const firstSentence = description.split(/(?<=[.!?])\s/)[0] || description;
  const clipped = firstSentence.length > MAX_ROLE_CHARS ? `${firstSentence.slice(0, MAX_ROLE_CHARS)}…` : firstSentence;
  return clipped.trim();
}

// --- categories ---

function categoriesOf(skills: readonly SkillEntry[]): SkillCategory[] {
  const counts = new Map<string, number>();
  for (const s of skills) counts.set(s.cat, (counts.get(s.cat) ?? 0) + 1);
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || (a.key < b.key ? -1 : 1));
}

// --- kit metadata (best-effort; absent/corrupt files degrade to blank fields) ---

interface CkConfigShape {
  codingLevel?: unknown;
  statusline?: unknown;
  privacyBlock?: unknown;
  kits?: Record<string, unknown>;
}

interface KitMetadataEntry {
  version?: unknown;
  installedAt?: unknown;
}

interface MetadataShape {
  kits?: Record<string, KitMetadataEntry>;
}

// cf-plugin bundle metadata (present ⇒ the scanned root IS the cf bundle).
interface CfPluginJsonShape {
  name?: unknown;
  version?: unknown;
}

interface CfManifestShape {
  upstream?: { tag?: unknown; syncedAt?: unknown };
  entries?: { skills?: Array<{ name?: unknown; origin?: unknown }> };
}

// Tag each scanned skill with its cf-manifest origin (upstream/local/github)
// so the UI can show provenance badges. Best-effort: no manifest ⇒ no-op.
async function applyProvenance(realRoot: string, skills: SkillEntry[]): Promise<void> {
  const manifest = await readJsonBounded<CfManifestShape>(path.join(realRoot, 'cf-manifest.json'));
  const entries = manifest?.entries?.skills;
  if (!Array.isArray(entries)) return;
  const origins = new Map<string, string>();
  for (const e of entries) {
    if (typeof e?.name === 'string' && typeof e?.origin === 'string') origins.set(e.name, e.origin);
  }
  for (const skill of skills) {
    const origin = origins.get(skill.name);
    if (origin) skill.provenance = origin;
  }
}

async function buildKit(realRoot: string, skillCount: number, agentCount: number): Promise<SkillCatalogKit> {
  // cf mode first: a plugin.json under the root means we're scanning the
  // dashboard-owned bundle — brand from it, not from ClaudeKit's .ck.json.
  const plugin = await readJsonBounded<CfPluginJsonShape>(path.join(realRoot, '.claude-plugin', 'plugin.json'));
  if (plugin && typeof plugin.name === 'string' && plugin.name) {
    const manifest = await readJsonBounded<CfManifestShape>(path.join(realRoot, 'cf-manifest.json'));
    const syncedAt = manifest?.upstream?.syncedAt;
    return {
      name: `Claude Fleet /${plugin.name}`,
      version: typeof plugin.version === 'string' ? plugin.version : '',
      installed: typeof syncedAt === 'string' ? syncedAt.slice(0, 10) : '',
      codingLevel: '',
      statusline: '',
      privacy: false,
      counts: {
        skills: skillCount,
        agents: agentCount,
        outputStyles: await countDirEntries(path.join(realRoot, 'output-styles')),
        hooks: await countDirEntries(path.join(realRoot, 'hooks')),
        rules: await countDirEntries(path.join(realRoot, 'rules')),
      },
    };
  }

  const ck = await readJsonBounded<CkConfigShape>(path.join(realRoot, '.ck.json'));
  const metadata = await readJsonBounded<MetadataShape>(path.join(realRoot, 'metadata.json'));
  const kitKey = ck?.kits && typeof ck.kits === 'object' ? Object.keys(ck.kits)[0] : undefined;
  // metadata.json keys the kit by a short slug that need not match .ck.json's
  // display name (e.g. "engineer" vs "ClaudeKit Engineer") — fall back to
  // whatever entry IS present rather than require the slugs to line up.
  const metaEntry = (kitKey && metadata?.kits?.[kitKey]) || (metadata?.kits ? Object.values(metadata.kits)[0] : undefined);

  const codingLevelRaw = ck?.codingLevel;
  const codingLevel = codingLevelRaw === -1 ? 'auto' : codingLevelRaw != null ? String(codingLevelRaw) : '';

  return {
    name: kitKey || 'ClaudeKit',
    version: typeof metaEntry?.version === 'string' ? metaEntry.version : '',
    installed: typeof metaEntry?.installedAt === 'string' ? metaEntry.installedAt.slice(0, 10) : '',
    codingLevel,
    statusline: typeof ck?.statusline === 'string' ? ck.statusline : '',
    privacy: ck?.privacyBlock === true,
    counts: {
      skills: skillCount,
      agents: agentCount,
      outputStyles: await countDirEntries(path.join(realRoot, 'output-styles')),
      hooks: await countDirEntries(path.join(realRoot, 'hooks')),
      rules: await countDirEntries(path.join(realRoot, 'rules')),
    },
  };
}

async function countDirEntries(dir: string): Promise<number> {
  try {
    return (await fs.readdir(dir)).length;
  } catch {
    return 0;
  }
}

async function readJsonBounded<T>(filePath: string): Promise<T | null> {
  const text = await readBounded(filePath, MAX_KIT_FILE_BYTES);
  if (text === null) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

// --- fs helpers (all read-only) ---

async function listDir(dir: string) {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function safeStat(p: string) {
  try {
    return await fs.stat(p);
  } catch {
    return null;
  }
}

async function safeRealpath(p: string): Promise<string | null> {
  try {
    return await fs.realpath(p);
  } catch {
    return null;
  }
}

async function hasDir(p: string): Promise<boolean> {
  const stat = await safeStat(p);
  return Boolean(stat?.isDirectory());
}

function isWithin(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(root + path.sep);
}

// Bounded, defensive read: missing/oversized/unreadable ⇒ null, never throws.
async function readBounded(filePath: string, maxBytes: number): Promise<string | null> {
  const stat = await safeStat(filePath);
  if (!stat?.isFile() || stat.size > maxBytes) return null;
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

// --- minimal frontmatter parsing (self-contained: skill/agent keys differ from
// the whitelisted plan/wiki frontmatter fields in readers/plan-frontmatter.ts) ---

interface FrontmatterBlock {
  fm: string;
  body: string;
}

function extractFrontmatter(text: string): FrontmatterBlock | null {
  if (!text.startsWith('---')) return null;
  const end = text.indexOf('\n---', 3);
  if (end === -1) return null;
  const fm = text.slice(text.indexOf('\n') + 1, end);
  const nl = text.indexOf('\n', end + 1);
  const body = nl === -1 ? '' : text.slice(nl + 1);
  return { fm, body };
}

function scalarField(fm: string, key: string): string {
  const m = fm.match(new RegExp(`^${escapeRegExp(key)}:\\s*(.+)$`, 'm'));
  return m ? m[1].trim().replace(/^['"]|['"]$/g, '').trim() : '';
}

function listField(fm: string, key: string): string[] {
  const escaped = escapeRegExp(key);
  const inline = fm.match(new RegExp(`^${escaped}:\\s*\\[(.*)\\]\\s*$`, 'm'));
  if (inline) return inline[1].split(',').map((t) => t.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  const block = fm.match(new RegExp(`^${escaped}:\\s*\\n((?:\\s+-\\s*.+\\n?)+)`, 'm'));
  if (block) return block[1].split('\n').map((l) => l.replace(/^\s*-\s*/, '').trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  return [];
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function firstNonEmptyLine(text: string): string {
  for (const line of text.split('\n')) {
    const trimmed = line.replace(/^#+\s*/, '').trim();
    if (trimmed) return trimmed.length > 200 ? `${trimmed.slice(0, 200)}…` : trimmed;
  }
  return '';
}

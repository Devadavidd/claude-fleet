// Skills catalog contract — shape per the designer's data
// (docs/design/fleet-redesign/ck-catalog.js). Rendered from a bundled fixture
// until the read-only GET /api/skills live-scan endpoint lands.

export interface SkillCatalogKit {
  name: string;
  version: string;
  /** YYYY-MM-DD. */
  installed: string;
  codingLevel: string;
  statusline: string;
  privacy: boolean;
  counts: {
    skills: number;
    agents: number;
    outputStyles: number;
    hooks: number;
    rules: number;
  };
}

export interface SkillCategory {
  key: string;
  count: number;
}

/** One step of the core workflow strip (plan → cook → test → review → ship). */
export interface SkillWorkflowStep {
  key: string;
  skill: string;
  label: string;
}

export interface SkillAgent {
  name: string;
  role: string;
}

export interface SkillEntry {
  name: string;
  desc: string;
  cat: string;
  /** Argument placeholder shown in the launcher, e.g. "[url or task]". */
  hint: string;
  keywords: string[];
  /** Whether the skill ships bundled scripts. */
  scripts?: boolean;
  /** Whether the skill ships reference docs. */
  refs?: boolean;
  /** Maturity tag ('' = stable, 'beta', …). */
  maturity?: string;
  /** Where the skill came from in the cf bundle: upstream|local|github|… ('' = unknown). */
  provenance?: string;
}

export interface SkillCatalog {
  kit: SkillCatalogKit;
  categories: SkillCategory[];
  workflow: SkillWorkflowStep[];
  agents: SkillAgent[];
  skills: SkillEntry[];
}

// Durable plan + wiki contracts — mirror src/plan-reader.js and
// src/wiki-reader.js outputs (/api/overview plans feed + /api/wiki).

export interface PlanPhase {
  file: string;
  title: string;
  num: number | null;
  status: string;
  checked: number;
  total: number;
  pct: number;
  done: boolean;
}

export interface PlanProgress {
  checked: number;
  total: number;
  pct: number;
}

export interface PlanRecord {
  slug: string;
  project: string;
  title: string;
  status: string;
  shipped: boolean;
  branch: string;
  /** YYYY-MM-DD (completed, falling back to created). */
  completed: string;
  tags: string[];
  phases: PlanPhase[];
  phaseTotal: number;
  phaseDone: number;
  progress: PlanProgress;
}

/** One Shipped-tab card (plan joined with its docs/wiki entry). */
export interface WikiCard {
  slug: string;
  project: string;
  status: string;
  shipped: boolean;
  summarized: boolean;
  plainTitle: string;
  title: string;
  body: string;
  completed: string;
  updatedMs: number;
  branch: string;
  tags: string[];
}

/** /api/wiki response. */
export interface FleetWiki {
  projects: string[];
  cards: WikiCard[];
}

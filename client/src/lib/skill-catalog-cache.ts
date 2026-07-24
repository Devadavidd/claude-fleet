import type { SkillCatalog, SkillEntry } from '../../../shared/types/index.js';

// One shared, memoized /api/skills fetch for every slash-menu instance —
// the catalog is static per server run, so each composer must not refetch it.

let cached: Promise<SkillEntry[]> | null = null;

export function fetchSkillEntries(): Promise<SkillEntry[]> {
  cached ??= (async () => {
    try {
      const res = await fetch('/api/skills');
      if (!res.ok) return [];
      const data = (await res.json()) as SkillCatalog;
      return Array.isArray(data?.skills) ? data.skills : [];
    } catch {
      return [];
    }
  })();
  return cached;
}

/** Test hook: clear the memoized fetch. */
export function resetSkillEntriesCache(): void {
  cached = null;
}

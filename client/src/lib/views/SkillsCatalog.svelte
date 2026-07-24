<!-- Skills screen (#/skills): kit header + counts, category filter row, a
     searchable skills grid, the core workflow strip, and the agent roster —
     per Fleet.dc.html's `isSkills` section. Clicking a skill opens
     SkillDetailDrawer. Data currently comes from the bundled fixture; see the
     single seam marked below for the phase-03 flip to a live endpoint. -->
<script lang="ts">
  import SkillCard from '../components/SkillCard.svelte';
  import SkillWorkflowStrip from '../components/SkillWorkflowStrip.svelte';
  import SkillAgentRoster from '../components/SkillAgentRoster.svelte';
  import SkillDetailDrawer from '../components/SkillDetailDrawer.svelte';
  import SkillInstallModal from '../components/SkillInstallModal.svelte';
  import { skillCatalogFixture } from '../skill-catalog-fixture.js';
  import { fleetHeaders } from '../auth.js';
  import type { SkillCatalog, SkillEntry } from '../../../../shared/types/index.js';

  // Single data-source seam: live-scan the cf bundle (or legacy ~/.claude)
  // via the read-only GET /api/skills endpoint, falling back to the bundled
  // fixture if the server is unreachable or returns nothing (offline demo).
  let catalog = $state<SkillCatalog>(skillCatalogFixture);
  let live = $state(false); // true once /api/skills answered — gates the manage controls

  async function refetchCatalog(): Promise<void> {
    try {
      const r = await fetch('/api/skills');
      const data = r.ok ? ((await r.json()) as SkillCatalog) : null;
      if (data && Array.isArray(data.skills) && data.skills.length) {
        catalog = data;
        live = true;
      }
    } catch { /* keep the fixture */ }
  }

  $effect(() => {
    void refetchCatalog();
    void checkUpstream();
  });

  // --- upstream sync (managed cf bundle) ---
  interface UpstreamCheck {
    current: string;
    latest: string;
    prerelease: boolean;
    upToDate: boolean;
  }

  let upstream = $state<UpstreamCheck | null>(null);
  let syncBusy = $state(false);
  let syncMessage = $state('');
  let installOpen = $state(false);

  async function checkUpstream(): Promise<void> {
    try {
      const r = await fetch('/api/skills/upstream-check');
      if (r.ok) upstream = (await r.json()) as UpstreamCheck;
    } catch { /* gh unavailable — banner simply stays hidden */ }
  }

  async function syncNow(): Promise<void> {
    if (syncBusy) return;
    syncBusy = true;
    syncMessage = '';
    try {
      const r = await fetch('/api/skills/sync-upstream', { method: 'POST', headers: fleetHeaders(), body: '{}' });
      const data = (await r.json()) as { tag?: string; skills?: number; error?: string };
      if (!r.ok) throw new Error(data.error || `sync failed (${r.status})`);
      syncMessage = `Synced ${data.tag} — ${data.skills} skills`;
      await refetchCatalog();
      await checkUpstream();
    } catch (err) {
      syncMessage = err instanceof Error ? err.message : String(err);
    } finally {
      syncBusy = false;
    }
  }

  async function removeSkill(name: string): Promise<void> {
    try {
      const r = await fetch('/api/skills/remove', { method: 'POST', headers: fleetHeaders(), body: JSON.stringify({ name }) });
      if (r.ok) {
        selectedSkill = null;
        await refetchCatalog();
      }
    } catch { /* leave the drawer open — nothing changed */ }
  }

  // Manage controls only make sense against the live managed bundle, never the fixture.
  const managed = $derived(live && catalog.kit.name.startsWith('Claude Fleet'));

  let search = $state('');
  let activeCategory = $state<string | null>(null); // null = "All"
  let selectedSkill = $state<SkillEntry | null>(null);

  function matchesSearch(skill: SkillEntry, query: string): boolean {
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      skill.name.toLowerCase().includes(q) ||
      skill.desc.toLowerCase().includes(q) ||
      skill.keywords.some((k) => k.toLowerCase().includes(q))
    );
  }

  const filteredSkills = $derived(
    catalog.skills.filter(
      (s) => (activeCategory === null || s.cat === activeCategory) && matchesSearch(s, search),
    ),
  );

  function categoryLabel(key: string): string {
    return key.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
  }

  function selectCategory(key: string): void {
    activeCategory = activeCategory === key ? null : key; // click active chip again to clear
  }
</script>

<div class="p-6 max-w-[1300px] mx-auto flex flex-col gap-4" data-testid="skills-catalog">
  <div class="border border-fleet-border-strong rounded-2xl bg-fleet-panel p-5">
    <div class="flex items-center gap-3 flex-wrap">
      <div class="w-[42px] h-[42px] rounded-xl bg-gradient-to-br from-fleet-accent to-fleet-accent-deep flex items-center justify-center flex-none">
        <svg width="22" height="22" viewBox="0 0 16 16" fill="none"><path d="M8 1.6l1.6 4.4 4.4 1.6-4.4 1.6L8 13.6 6.4 9.2 2 7.6l4.4-1.6z" stroke="#fff" stroke-width="1.15" stroke-linejoin="round"/></svg>
      </div>
      <div class="min-w-0">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="text-lg font-bold tracking-tight">{catalog.kit.name}</span>
          <span class="text-[11px] font-mono text-fleet-accent border border-[#33346a] rounded-full px-2 py-0.5">{catalog.kit.version}</span>
        </div>
        <div class="text-[12.5px] text-fleet-muted mt-1">Powers every session in this workspace — skills, agents, workflow &amp; guardrails.</div>
      </div>
      {#if managed}
        <div class="flex items-center gap-2 flex-wrap" data-testid="skills-manage-controls">
          {#if upstream && !upstream.upToDate}
            <span class="text-[11px] font-mono text-fleet-warn" data-testid="skills-upstream-banner">
              Update {upstream.current || 'none'} → {upstream.latest}{upstream.prerelease ? ' (pre-release)' : ''}
            </span>
          {/if}
          <button
            type="button"
            data-testid="skills-sync-button"
            onclick={syncNow}
            disabled={syncBusy}
            class="text-xs px-2.5 py-1.5 rounded-lg border border-fleet-accent text-fleet-accent cursor-pointer disabled:opacity-50"
          >
            {syncBusy ? 'Syncing…' : 'Sync upstream'}
          </button>
          <button
            type="button"
            data-testid="skills-install-button"
            onclick={() => (installOpen = true)}
            class="text-xs px-2.5 py-1.5 rounded-lg border border-fleet-border-strong text-fleet-muted cursor-pointer"
          >
            Install…
          </button>
          {#if syncMessage}<span class="text-[11px] text-fleet-dim">{syncMessage}</span>{/if}
        </div>
      {/if}
      <div class="ml-auto flex gap-5 flex-wrap" data-testid="skills-kit-stats">
        {#each Object.entries(catalog.kit.counts) as [key, value] (key)}
          <div class="text-right">
            <div class="text-lg font-bold font-mono text-fleet-text">{value}</div>
            <div class="text-[9.5px] text-fleet-dim uppercase tracking-wide">{key}</div>
          </div>
        {/each}
      </div>
    </div>
    <div class="mt-4 pt-3.5 border-t border-fleet-border">
      <SkillWorkflowStrip workflow={catalog.workflow} />
    </div>
  </div>

  <div class="flex items-center gap-3 flex-wrap">
    <div class="flex items-center gap-2 bg-fleet-panel border border-fleet-border-strong rounded-lg px-3 py-2 flex-1 min-w-[200px] max-w-[340px]">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" class="text-fleet-dim flex-none"><circle cx="7" cy="7" r="4.6" stroke="currentColor" stroke-width="1.4"/><path d="m11 11 3 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
      <input
        bind:value={search}
        placeholder="Search skills"
        class="bg-transparent border-0 outline-none text-fleet-text text-[13px] w-full"
        data-testid="skills-search"
      />
    </div>
    <span class="text-xs text-fleet-dim font-mono">{filteredSkills.length} shown</span>
  </div>

  <div class="flex gap-1.5 flex-wrap" data-testid="skills-category-filter">
    <button
      type="button"
      onclick={() => (activeCategory = null)}
      class={`text-xs px-2.5 py-1.5 rounded-lg border cursor-pointer ${activeCategory === null ? 'border-fleet-accent text-fleet-accent bg-fleet-accent/10' : 'border-fleet-border-strong text-fleet-muted'}`}
    >
      All <span class="text-fleet-dim font-mono">{catalog.skills.length}</span>
    </button>
    {#each catalog.categories as cat (cat.key)}
      <button
        type="button"
        onclick={() => selectCategory(cat.key)}
        data-testid={`skills-category-${cat.key}`}
        class={`text-xs px-2.5 py-1.5 rounded-lg border cursor-pointer ${activeCategory === cat.key ? 'border-fleet-accent text-fleet-accent bg-fleet-accent/10' : 'border-fleet-border-strong text-fleet-muted'}`}
      >
        {categoryLabel(cat.key)} <span class="text-fleet-dim font-mono">{cat.count}</span>
      </button>
    {/each}
  </div>

  <div class="grid gap-3" style="grid-template-columns: repeat(auto-fill, minmax(280px, 1fr))" data-testid="skills-grid">
    {#each filteredSkills as skill (skill.name)}
      <SkillCard {skill} onSelect={() => (selectedSkill = skill)} />
    {/each}
    {#if filteredSkills.length === 0}
      <div class="text-fleet-faint text-xs col-span-full text-center py-8">No skills match.</div>
    {/if}
  </div>

  <SkillAgentRoster agents={catalog.agents} count={catalog.kit.counts.agents} />
</div>

<SkillDetailDrawer
  skill={selectedSkill}
  onClose={() => (selectedSkill = null)}
  onRemove={managed ? (name) => void removeSkill(name) : undefined}
/>
<SkillInstallModal open={installOpen} onClose={() => (installOpen = false)} onInstalled={() => void refetchCatalog()} />

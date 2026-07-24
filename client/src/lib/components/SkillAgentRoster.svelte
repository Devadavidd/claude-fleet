<!-- Agent roster footer of the Skills catalog: one tile per specialist agent
     (name + role), sourced from `SkillCatalog.agents`. -->
<script lang="ts">
  import type { SkillAgent } from '../../../../shared/types/index.js';

  interface Props {
    agents: SkillAgent[];
    count: number;
  }

  const { agents, count }: Props = $props();
</script>

<div data-testid="skills-agent-roster">
  <div class="text-[11px] font-semibold text-fleet-faint uppercase tracking-wide mb-2.5">Agent roster · {count} specialists</div>
  <div class="grid gap-2.5" style="grid-template-columns: repeat(auto-fill, minmax(220px, 1fr))">
    {#each agents as agent (agent.name)}
      <div class="flex gap-2.5 bg-fleet-bg border border-fleet-border rounded-lg px-3 py-2.5">
        <span class="w-2 h-2 rounded-full bg-[#c084fc] flex-none mt-1"></span>
        <div class="min-w-0">
          <div class="text-[12.5px] font-semibold text-fleet-text font-mono">{agent.name}</div>
          <div class="text-[11.5px] text-fleet-faint leading-snug mt-0.5">{agent.role}</div>
        </div>
      </div>
    {/each}
  </div>
</div>

<!-- One skill tile in the SkillsCatalog grid: name, maturity tag, description,
     category chip, scripts/refs indicators. Clicking opens SkillDetailDrawer
     via the parent-owned `onSelect` callback (this component never mutates). -->
<script lang="ts">
  import type { SkillEntry } from '../../../../shared/types/index.js';

  interface Props {
    skill: SkillEntry;
    onSelect: () => void;
  }

  const { skill, onSelect }: Props = $props();
</script>

<button
  type="button"
  onclick={onSelect}
  class="text-left bg-fleet-panel border border-fleet-border rounded-xl px-3.5 py-3 flex flex-col gap-2 cursor-pointer hover:border-fleet-border-strong"
  data-testid="skill-card"
  data-skill-name={skill.name}
>
  <div class="flex items-center gap-2">
    <span class="text-[13px] font-semibold text-fleet-text font-mono truncate flex-1 min-w-0">{skill.name}</span>
    {#if skill.maturity}
      <span class="text-[9px] font-mono text-fleet-warn border border-fleet-warn-border rounded px-1.5 flex-none">{skill.maturity}</span>
    {/if}
  </div>
  <div class="text-xs text-fleet-muted leading-snug line-clamp-3">{skill.desc}</div>
  <div class="flex flex-wrap items-center gap-2 mt-auto pt-1">
    <span class="text-[10px] text-fleet-dim border border-fleet-border rounded-full px-2 py-0.5">{skill.cat}</span>
    {#if skill.provenance && skill.provenance !== 'upstream'}
      <!-- Upstream is the default source — only externally installed skills get a badge. -->
      <span class="text-[9px] font-mono text-fleet-accent border border-fleet-accent-border rounded px-1.5" data-testid="skill-provenance">{skill.provenance}</span>
    {/if}
    {#if skill.scripts}<span class="text-[10px] text-fleet-faint font-mono">◆ scripts</span>{/if}
    {#if skill.refs}<span class="text-[10px] text-fleet-faint font-mono">▤ refs</span>{/if}
  </div>
</button>

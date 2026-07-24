<!-- Core workflow strip inside the Skills kit header: plan → cook → test →
     review → ship, each step naming the skill it maps to. Pure presentation
     over `SkillCatalog.workflow`. -->
<script lang="ts">
  import type { SkillWorkflowStep } from '../../../../shared/types/index.js';

  interface Props {
    workflow: SkillWorkflowStep[];
  }

  const { workflow }: Props = $props();
</script>

<div class="flex items-center gap-1.5 flex-wrap" data-testid="skills-workflow-strip">
  <span class="text-[10px] text-fleet-dim uppercase tracking-wide mr-1">Default workflow</span>
  {#each workflow as step, i (step.key)}
    <span class="text-[11px] font-mono text-fleet-muted bg-fleet-bg border border-fleet-border-strong rounded px-2 py-1 whitespace-nowrap">/cf:{step.skill}</span>
    {#if i < workflow.length - 1}<span class="text-fleet-dim text-xs">→</span>{/if}
  {/each}
</div>

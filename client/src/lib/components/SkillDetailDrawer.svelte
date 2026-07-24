<!-- Slide-in skill detail drawer (right side, over a backdrop) — same layout
     pattern as TaskDetailDrawer: name/category/maturity header, description,
     invoke hint, keywords, scripts/refs flags. Fully prop-driven (skill +
     onClose + optional onRemove) so SkillsCatalog is the only thing that
     opens it and owns the actual remove POST/refetch. -->
<script lang="ts">
  import type { SkillEntry } from '../../../../shared/types/index.js';

  interface Props {
    skill: SkillEntry | null;
    onClose: () => void;
    /** Present only when the catalog is the managed cf bundle. */
    onRemove?: (name: string) => void;
  }

  const { skill, onClose, onRemove }: Props = $props();

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') onClose();
  }

  // Only listen while a skill is actually shown — reruns whenever `skill` changes.
  $effect(() => {
    if (!skill) return;
    document.addEventListener('keydown', onKeydown);
    return () => document.removeEventListener('keydown', onKeydown);
  });
</script>

{#if skill}
  <div class="fixed inset-0 z-40" data-testid="skill-drawer-backdrop">
    <button
      type="button"
      class="absolute inset-0 w-full h-full bg-black/50 cursor-default"
      aria-label="Close skill detail"
      onclick={onClose}
    ></button>
    <div
      class="fixed right-0 top-0 h-screen w-[420px] max-w-full bg-fleet-surface border-l border-fleet-border-strong p-5 overflow-y-auto flex flex-col gap-4"
      role="dialog"
      aria-modal="true"
      aria-label="Skill detail"
      data-testid="skill-drawer"
    >
      <div class="flex items-start gap-2.5">
        <div class="min-w-0 flex-1">
          <div class="text-[15px] font-bold font-mono text-fleet-text break-words">{skill.name}</div>
          <div class="flex items-center gap-1.5 mt-2 flex-wrap">
            <span class="text-[10.5px] text-fleet-muted border border-fleet-border rounded-full px-2 py-0.5">{skill.cat}</span>
            {#if skill.maturity}
              <span class="text-[10px] font-mono text-fleet-warn border border-fleet-warn-border rounded-full px-2 py-0.5">{skill.maturity}</span>
            {/if}
          </div>
        </div>
        <button type="button" onclick={onClose} aria-label="Close" class="text-fleet-dim cursor-pointer hover:text-fleet-text flex-none">✕</button>
      </div>

      <div>
        <div class="text-[11px] font-semibold text-fleet-faint uppercase tracking-wide mb-1.5">What it does</div>
        <div class="text-[13px] text-fleet-muted leading-snug">{skill.desc}</div>
      </div>

      {#if skill.hint}
        <div>
          <div class="text-[11px] font-semibold text-fleet-faint uppercase tracking-wide mb-1.5">Invoke</div>
          <div class="text-[12px] font-mono text-fleet-success bg-fleet-bg border border-fleet-border rounded-lg px-3 py-2 break-words">{skill.name} {skill.hint}</div>
        </div>
      {/if}

      {#if skill.keywords.length}
        <div>
          <div class="text-[11px] font-semibold text-fleet-faint uppercase tracking-wide mb-1.5">Keywords</div>
          <div class="flex flex-wrap gap-1.5">
            {#each skill.keywords as kw (kw)}
              <span class="text-[11px] font-mono text-fleet-muted bg-fleet-panel border border-fleet-border rounded px-2 py-0.5">{kw}</span>
            {/each}
          </div>
        </div>
      {/if}

      <div class="flex gap-3.5 text-[11.5px] text-fleet-faint font-mono">
        {#if skill.scripts}<span>◆ bundled scripts</span>{/if}
        {#if skill.refs}<span>▤ reference docs</span>{/if}
      </div>

      {#if skill.provenance}
        <div class="text-[11px] text-fleet-dim font-mono">source: {skill.provenance}</div>
      {/if}

      {#if onRemove}
        <button
          type="button"
          data-testid="skill-remove"
          onclick={() => onRemove(skill.name)}
          class="mt-auto text-[12px] text-fleet-warn border border-fleet-warn-border rounded-lg px-3 py-2 cursor-pointer hover:bg-fleet-bg self-start"
        >
          Remove from bundle
        </button>
      {/if}
    </div>
  </div>
{/if}

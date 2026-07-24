<!-- Desktop-app-style message box: a plain textarea that opens a slash-command
     suggestion menu when the message STARTS with '/' (catalog skills as
     /cf:<name>). ↑/↓ move, Tab/Enter accept, Esc closes; Enter with the menu
     closed submits via onSubmit (shift+Enter always newlines). Shared by the
     Launch modal and the in-session composer so both inputs behave the same. -->
<script lang="ts">
  import { fetchSkillEntries } from '../skill-catalog-cache.js';
  import { activeSlashToken, suggestSlashCommands } from '../slash-command-suggest.js';
  import type { SlashSuggestion } from '../slash-command-suggest.js';
  import type { SkillEntry } from '../../../../shared/types/index.js';

  interface Props {
    value: string;
    placeholder?: string;
    rows?: number;
    testid?: string;
    /** Called on Enter when the suggestion menu is NOT open. */
    onSubmit?: () => void;
    /**
     * Where the menu opens. 'above' suits a bottom-of-screen composer;
     * 'below' suits the launch modal, whose scrolling dialog would CLIP an
     * upward menu to a couple of rows.
     */
    menuPlacement?: 'above' | 'below';
  }

  let {
    value = $bindable(), placeholder = '', rows = 2, testid = 'slash-textarea', onSubmit,
    menuPlacement = 'above',
  }: Props = $props();

  let skills = $state<SkillEntry[]>([]);
  let textareaEl = $state<HTMLTextAreaElement | null>(null);
  let selectedIndex = $state(0);
  // Re-evaluated on every input/caret move; menu shows only while the first
  // word is a slash token and something matches.
  let suggestions = $state<SlashSuggestion[]>([]);

  $effect(() => { void fetchSkillEntries().then((s) => { skills = s; }); });

  function refreshSuggestions(): void {
    const el = textareaEl;
    const caret = el ? el.selectionStart ?? value.length : value.length;
    const token = activeSlashToken(value.slice(0, caret));
    // No cap — the FULL catalog must be reachable ("/cf:" lists everything);
    // the menu itself scrolls inside its max height.
    const next = token === null ? [] : suggestSlashCommands(skills, token, Number.MAX_SAFE_INTEGER);
    suggestions = next;
    if (selectedIndex >= next.length) selectedIndex = 0;
  }

  function accept(s: SlashSuggestion): void {
    // Replace the slash token (the whole first word) with the full command.
    const rest = value.replace(/^\S*/, '');
    value = `${s.command} ${rest.trimStart()}`;
    suggestions = [];
    textareaEl?.focus();
  }

  function onKeydown(e: KeyboardEvent): void {
    if (suggestions.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); selectedIndex = (selectedIndex + 1) % suggestions.length; return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); selectedIndex = (selectedIndex - 1 + suggestions.length) % suggestions.length; return; }
      if (e.key === 'Tab' || e.key === 'Enter') { e.preventDefault(); accept(suggestions[selectedIndex]); return; }
      if (e.key === 'Escape') { e.preventDefault(); suggestions = []; return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSubmit?.();
    }
  }
</script>

<div class="relative">
  {#if suggestions.length}
    <!-- Desktop-style command menu; placement per surface (see Props). -->
    <div
      class={`absolute left-0 w-full max-w-[440px] max-h-[300px] overflow-y-auto rounded-xl border border-fleet-border-strong bg-fleet-surface shadow-[0_10px_30px_rgba(0,0,0,0.5)] py-1 z-30 ${menuPlacement === 'above' ? 'bottom-full mb-2' : 'top-full mt-2'}`}
      data-testid="slash-menu"
      role="listbox"
    >
      {#each suggestions as s, i (s.command)}
        <button
          type="button"
          role="option"
          aria-selected={i === selectedIndex}
          class={`w-full text-left px-3 py-1.5 flex items-baseline gap-2 cursor-pointer ${i === selectedIndex ? 'bg-fleet-accent/15' : ''}`}
          onmouseenter={() => (selectedIndex = i)}
          onmousedown={(e) => { e.preventDefault(); accept(s); }}
          data-testid={`slash-option-${s.name}`}
        >
          <span class="font-mono text-[12.5px] text-fleet-accent flex-none">{s.command}</span>
          <span class="text-[11.5px] text-fleet-faint truncate">{s.desc}</span>
        </button>
      {/each}
    </div>
  {/if}
  <textarea
    bind:this={textareaEl}
    bind:value
    {rows}
    {placeholder}
    onkeydown={onKeydown}
    oninput={refreshSuggestions}
    onclick={refreshSuggestions}
    class="w-full bg-transparent border-0 outline-none resize-none text-[13px] text-fleet-text placeholder:text-fleet-faint leading-relaxed"
    data-testid={testid}
  ></textarea>
</div>

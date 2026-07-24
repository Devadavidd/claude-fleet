<!-- Contextual header: Back button (shown when the router says so), title,
     ⌘K search stub, 🔔 alert toggle (localStorage + Notification permission,
     behavior preserved from the legacy top-nav bell), gradient Launch button.
     Layout/colors translated from Fleet.dc.html ~L93-118 into Tailwind. -->
<script lang="ts">
  import { router, navigate } from '../router.svelte.js';
  import { unlockAudio } from '../audio.js';
  import { readThemePref, resolveTheme, setThemePref } from '../theme.svelte.js';

  interface Props {
    title: string;
    launch: () => void;
  }

  const { title, launch }: Props = $props();

  // Concrete theme currently shown ('dark' | 'light'). Seeded from the stored
  // pref resolved against the OS setting; the toggle flips to the opposite.
  let theme = $state(resolveTheme(readThemePref()));
  const isLight = $derived(theme === 'light');

  function toggleTheme(): void {
    const next = theme === 'light' ? 'dark' : 'light';
    theme = next;
    setThemePref(next); // writes localStorage + <html data-theme>
  }

  function readAlertPref(): boolean {
    return typeof localStorage !== 'undefined' && localStorage.getItem('fleet-alerts') === 'on';
  }

  let alertsOn = $state(readAlertPref());

  async function toggleBell(): Promise<void> {
    if (alertsOn) {
      alertsOn = false;
      localStorage.setItem('fleet-alerts', 'off');
      return;
    }
    unlockAudio();
    try {
      const perm = typeof Notification !== 'undefined' ? await Notification.requestPermission() : 'denied';
      alertsOn = perm !== 'denied'; // sound-only alerts still work without desktop permission
    } catch {
      alertsOn = true; // Notification unsupported (e.g. iOS Safari) — degrade to sound-only
    }
    localStorage.setItem('fleet-alerts', alertsOn ? 'on' : 'off');
  }
</script>

<header class="flex items-center gap-4 px-6.5 py-3.5 border-b border-fleet-border bg-fleet-bg/85 backdrop-blur-sm flex-none z-10">
  {#if router.route.showBack}
    <button
      type="button"
      onclick={() => navigate('#/')}
      class="flex items-center gap-1.5 bg-fleet-panel border border-fleet-border-strong text-fleet-muted rounded-lg px-2.5 py-1.5 text-[12.5px] cursor-pointer flex-none"
    >
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M10 3 5 8l5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
      Back
    </button>
  {/if}

  <div class="min-w-0 flex-1">
    <h1 class="m-0 text-[16.5px] font-semibold tracking-tight truncate">{title}</h1>
  </div>

  <div class="ml-auto flex items-center gap-2.5 flex-none">
    <div class="flex items-center gap-2 bg-fleet-panel border border-fleet-border-strong rounded-lg px-3 py-1.5 w-[230px] text-fleet-dim">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="4.6" stroke="currentColor" stroke-width="1.4"/><path d="m11 11 3 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
      <span class="text-[12.5px] whitespace-nowrap overflow-hidden text-ellipsis">Search sessions</span>
      <span class="ml-auto text-[10.5px] font-mono bg-fleet-panel-deep border border-fleet-border-strong rounded px-1">⌘K</span>
    </div>
    <button
      type="button"
      onclick={toggleTheme}
      title={isLight ? 'Switch to dark theme' : 'Switch to light theme'}
      aria-label={isLight ? 'Switch to dark theme' : 'Switch to light theme'}
      aria-pressed={isLight}
      class="w-9 h-9 rounded-lg border border-fleet-border-strong text-fleet-dim bg-fleet-panel flex items-center justify-center flex-none cursor-pointer hover:text-fleet-text"
    >
      {#if isLight}
        <!-- Sun: currently light, click to go dark -->
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="3.1" stroke="currentColor" stroke-width="1.3"/><path d="M8 1.4v1.7M8 12.9v1.7M14.6 8h-1.7M3.1 8H1.4M12.7 3.3l-1.2 1.2M4.5 11.5l-1.2 1.2M12.7 12.7l-1.2-1.2M4.5 4.5 3.3 3.3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
      {:else}
        <!-- Moon: currently dark, click to go light -->
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M13.2 9.6A5.4 5.4 0 0 1 6.4 2.8a5.4 5.4 0 1 0 6.8 6.8Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>
      {/if}
    </button>
    <button
      type="button"
      onclick={toggleBell}
      title="Alert when a session needs you"
      aria-pressed={alertsOn}
      class={`w-9 h-9 rounded-lg border flex items-center justify-center flex-none cursor-pointer ${alertsOn ? 'border-fleet-accent text-fleet-accent bg-fleet-accent/10' : 'border-fleet-border-strong text-fleet-dim bg-fleet-panel'}`}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 6.4a4 4 0 0 1 8 0c0 3 1.2 4 1.2 4H2.8S4 9.4 4 6.4Z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M6.4 12.8a1.7 1.7 0 0 0 3.2 0" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
    </button>
    <button
      type="button"
      onclick={launch}
      class="flex items-center gap-1.5 bg-gradient-to-br from-fleet-accent to-fleet-accent-deep text-white border-0 rounded-lg px-3.5 py-2 text-[13px] font-semibold cursor-pointer shadow-[0_3px_12px_rgba(125,123,255,0.4)] flex-none"
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
      Launch
    </button>
  </div>
</header>

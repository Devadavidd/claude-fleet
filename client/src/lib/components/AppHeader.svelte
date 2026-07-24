<!-- Contextual header: Back button (shown when the router says so), title,
     ⌘K search stub, 🔔 alert toggle (localStorage + Notification permission,
     behavior preserved from the legacy top-nav bell), gradient Launch button.
     Layout/colors translated from Fleet.dc.html ~L93-118 into Tailwind. -->
<script lang="ts">
  import { router, navigate } from '../router.svelte.js';
  import { unlockAudio } from '../audio.js';

  interface Props {
    title: string;
    launch: () => void;
  }

  const { title, launch }: Props = $props();

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
      <span class="ml-auto text-[10.5px] font-mono bg-[#1b212c] border border-[#2a3140] rounded px-1">⌘K</span>
    </div>
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

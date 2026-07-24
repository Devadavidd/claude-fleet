<!-- #/always-on: manage 24/7 loop jobs — a task relaunched on a cadence until it
     hits its goal or you Stop it. Loop cycles are excluded from the main board
     server-side, so this page is their home. Live via fleetStore.loopJobs (the
     'loop-job' SSE). Split from the legacy public/always-on-view.js. -->
<script lang="ts">
  import { fleetStore } from '../fleet-store.svelte.js';
  import { fleetHeaders } from '../auth.js';
  import QaWebsiteTemplate from '../components/QaWebsiteTemplate.svelte';
  import type { LoopJob, LoopJobMode } from '../../../../shared/types/index.js';

  const jobs = $derived([...fleetStore.loopJobs.values()].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)));

  // Loop jobs aren't in the SSE snapshot — hydrate the list on mount so
  // restart-interrupted / paused / completed jobs are visible (and resumable),
  // not just ones that happen to emit a delta while this page is open.
  $effect(() => {
    let alive = true;
    fetch('/api/loop-jobs')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: LoopJob[] | null) => { if (alive && data) fleetStore.hydrateLoopJobs(data); })
      .catch(() => { /* offline — SSE deltas still populate live */ });
    return () => { alive = false; };
  });

  let task = $state('');
  let cwd = $state('');
  let model = $state('');
  let mode = $state<LoopJobMode>('job');
  let intervalSec = $state(300);
  let baseUrl = $state('');
  let creating = $state(false);
  let formError = $state<string | null>(null);
  let busyIds = $state(new Set<string>());

  async function createJob(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    const text = task.trim();
    if (!text) { formError = 'Task is required.'; return; }
    if (!cwd.trim()) { formError = 'Working directory is required.'; return; }
    creating = true;
    formError = null;
    try {
      const body: Record<string, unknown> = { task: text, cwd: cwd.trim(), mode, intervalSec };
      if (model.trim()) body.model = model.trim();
      if (baseUrl.trim()) body.baseUrl = baseUrl.trim();
      const res = await fetch('/api/loop-jobs', { method: 'POST', headers: fleetHeaders(), body: JSON.stringify(body) });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.status !== 202) { formError = `Failed (${res.status}): ${data.error ?? ''}`; return; }
      task = ''; cwd = ''; baseUrl = '';
    } catch {
      formError = 'Network error — is the server running?';
    } finally {
      creating = false;
    }
  }

  async function stopOrResume(id: string, verb: 'stop' | 'resume'): Promise<void> {
    busyIds = new Set(busyIds).add(id);
    try {
      await fetch(`/api/loop-jobs/${encodeURIComponent(id)}/${verb}`, { method: 'POST', headers: fleetHeaders() });
    } catch {
      // Fail-soft: the next SSE 'loop-job' delta re-syncs real state either way.
    } finally {
      const next = new Set(busyIds); next.delete(id); busyIds = next;
    }
  }

  function statusLabel(job: LoopJob): string {
    if (job.status === 'running') return job.mode === 'job' ? '● live' : '● running';
    if (job.status === 'interrupted') return '⏸ stopped by restart';
    if (job.status === 'paused') return '⏸ paused';
    if (job.status === 'completed') return '✓ completed';
    return '■ stopped';
  }
</script>

<div class="p-6 flex flex-col gap-4" data-testid="always-on">
  <h2 class="text-[15px] font-semibold text-fleet-text">Always-on agents</h2>

  <form onsubmit={createJob} class="bg-fleet-panel border border-fleet-border rounded-xl p-4 flex flex-col gap-2.5" data-testid="loop-job-form">
    <textarea
      bind:value={task}
      placeholder="Describe the task the agent should do each cycle…"
      rows="3"
      class="bg-fleet-bg border border-fleet-border rounded-md px-2.5 py-2 text-[13px] text-fleet-text"
      data-testid="loop-job-task"
    ></textarea>
    <QaWebsiteTemplate onApply={(p) => { task = p.task; baseUrl = p.baseUrl; }} />
    <div class="flex gap-2.5 flex-wrap">
      <input bind:value={cwd} placeholder="Working directory" class="flex-1 min-w-[200px] bg-fleet-bg border border-fleet-border rounded-md px-2.5 py-1.5 text-[12.5px] font-mono text-fleet-text" data-testid="loop-job-cwd" />
      <input bind:value={model} placeholder="Model (optional)" class="flex-1 min-w-[160px] bg-fleet-bg border border-fleet-border rounded-md px-2.5 py-1.5 text-[12.5px] font-mono text-fleet-text" data-testid="loop-job-model" />
      <input type="number" bind:value={intervalSec} min="60" class="w-[130px] bg-fleet-bg border border-fleet-border rounded-md px-2.5 py-1.5 text-[12.5px] font-mono text-fleet-text" data-testid="loop-job-interval" />
    </div>
    <div class="flex items-center gap-4 text-xs text-fleet-muted">
      <label class="flex items-center gap-1.5"><input type="radio" bind:group={mode} value="job" /> Job — never stops</label>
      <label class="flex items-center gap-1.5"><input type="radio" bind:group={mode} value="goal" /> Goal — stops when done</label>
    </div>
    {#if formError}<div class="text-[12px] text-fleet-warn" data-testid="loop-job-form-error">{formError}</div>{/if}
    <button type="submit" disabled={creating} class="self-start bg-fleet-accent text-white rounded-md px-4 py-1.5 text-[12.5px] font-semibold cursor-pointer disabled:opacity-60" data-testid="loop-job-submit">
      {creating ? 'Starting…' : 'Start loop'}
    </button>
  </form>

  <div class="flex flex-col gap-3" data-testid="loop-job-list">
    {#if !jobs.length}
      <div class="text-fleet-faint text-sm text-center py-10">No always-on agents yet. Create one to run a task on a loop.</div>
    {:else}
      {#each jobs as job (job.id)}
        <div class="bg-fleet-panel border border-fleet-border rounded-xl p-3.5 flex flex-col gap-1.5" data-testid="loop-job-card" data-job-id={job.id}>
          <div class="flex items-center gap-2">
            <span class="text-xs font-medium text-fleet-text" data-testid="loop-job-status">{statusLabel(job)}</span>
            <span class="text-[10.5px] text-fleet-dim font-mono">{job.mode === 'goal' ? 'goal' : 'job · 24/7'}</span>
          </div>
          <div class="text-[12.5px] text-fleet-text">{job.task}</div>
          <div class="text-[11px] text-fleet-dim font-mono truncate">{job.cwd}</div>
          <div class="flex items-center gap-3 text-[11px] text-fleet-muted font-mono">
            <span data-testid="loop-job-cycles">{job.cyclesDone ?? 0} cycle{job.cyclesDone === 1 ? '' : 's'}</span>
            {#if job.consecutiveFailures > 0}<span class="text-fleet-warn">⚠ {job.consecutiveFailures} failing</span>{/if}
          </div>
          <div class="flex gap-2 mt-1">
            {#if job.status === 'running'}
              <button type="button" onclick={() => stopOrResume(job.id, 'stop')} disabled={busyIds.has(job.id)} class="text-[11.5px] text-fleet-warn border border-fleet-danger-border rounded-full px-2.5 py-0.5 cursor-pointer disabled:opacity-50" data-testid="loop-job-stop">Stop</button>
            {/if}
            {#if job.status === 'paused' || job.status === 'interrupted'}
              <button type="button" onclick={() => stopOrResume(job.id, 'resume')} disabled={busyIds.has(job.id)} class="text-[11.5px] text-fleet-success border border-fleet-success-border rounded-full px-2.5 py-0.5 cursor-pointer disabled:opacity-50" data-testid="loop-job-resume">Resume</button>
            {/if}
          </div>
        </div>
      {/each}
    {/if}
  </div>
</div>

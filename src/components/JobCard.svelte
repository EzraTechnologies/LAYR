<script lang="ts">
  import type { CommandGateway } from '../lib/actions/commands';
  import { displayFilename, formatClock, formatDuration, formatFilament } from '../lib/format';
  import type { PrinterState } from '../lib/printer/model';
  import { headline } from '../lib/statusMeta';
  import Icon from './Icon.svelte';
  import ProgressRing from './ProgressRing.svelte';

  interface Props {
    printerState: PrinterState;
    commands: CommandGateway;
    timeZone?: string;
  }

  let { printerState, commands, timeZone }: Props = $props();

  const job = $derived(printerState.job);
  const title = $derived(headline(printerState));
  const active = $derived(printerState.status === 'printing' || printerState.status === 'paused');
  const ringTone = $derived(
    printerState.status === 'paused' ? 'warn' : job?.state === 'complete' ? 'ok' : active ? 'cyan' : 'dim',
  );
  const eta = $derived(job?.remaining != null ? printerState.now + job.remaining * 1000 : null);
  const layerText = $derived(
    job?.currentLayer != null && job.totalLayers != null && job.totalLayers > 0
      ? `${job.currentLayer} / ${job.totalLayers}`
      : job?.currentLayer != null
        ? String(job.currentLayer)
        : '—',
  );
  const pauseBlock = $derived(commands.availability({ kind: printerState.status === 'paused' ? 'resume' : 'pause' }));
  const blockedMessage = $derived(pauseBlock.allowed ? '' : pauseBlock.message);
</script>

<section class="card job" aria-labelledby="job-title">
  {#if job}
    <header class="head">
      <div class="title-block">
        <span class="eyebrow">Current job</span>
        <h2 id="job-title" class="filename" title={job.filename}>{displayFilename(job.filename)}</h2>
      </div>
      <span class="state tone-{ringTone}">{title}</span>
    </header>

    <div class="body">
      <ProgressRing progress={job.progress} tone={ringTone} label={`Print progress for ${displayFilename(job.filename)}`} />

      <dl class="stats">
        <div>
          <dt><Icon name="clock" size={16} />Elapsed</dt>
          <dd class="num">{formatDuration(job.totalDuration)}</dd>
        </div>
        <div>
          <dt><Icon name="hourglass" size={16} />Remaining</dt>
          <dd class="num">
            {active ? formatDuration(job.remaining) : '—'}
            {#if active && job.remainingSource === 'slicer'}<small title="Based on slicer estimate">est.</small>{/if}
          </dd>
        </div>
        <div>
          <dt><Icon name="flag" size={16} />ETA</dt>
          <dd class="num">{active && eta !== null ? formatClock(eta, timeZone) : '—'}</dd>
        </div>
        <div>
          <dt><Icon name="layers" size={16} />Layer</dt>
          <dd class="num">{layerText}</dd>
        </div>
        <div class="wide">
          <dt><Icon name="ruler" size={16} />Filament</dt>
          <dd class="num">{formatFilament(job.filamentUsed)}</dd>
        </div>
      </dl>
    </div>

    {#if job.message}
      <p class="message" title={job.message}>{job.message}</p>
    {/if}

    {#if active}
      <footer class="controls">
        <button type="button" class="ctl" disabled aria-describedby="ctl-note">
          <Icon name={printerState.status === 'paused' ? 'play' : 'pause'} size={20} />
          {printerState.status === 'paused' ? 'Resume' : 'Pause'}
        </button>
        <button type="button" class="ctl danger" disabled aria-describedby="ctl-note">
          <Icon name="stop" size={20} />
          Cancel
        </button>
        <p id="ctl-note" class="note"><Icon name="lock" size={15} />{blockedMessage}</p>
      </footer>
    {/if}
  {:else}
    <div class="idle">
      <div class="idle-icon" aria-hidden="true"><Icon name="check" size={34} strokeWidth={2} /></div>
      <h2 id="job-title">Ready to print</h2>
      <p>No job is loaded. File browsing and print start will arrive in a later release.</p>
    </div>
  {/if}
</section>

<style>
  .job {
    display: flex;
    flex-direction: column;
    gap: var(--gap);
    padding: var(--pad) calc(var(--pad) + 4px);
    overflow: hidden;
  }

  .head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--gap);
    min-width: 0;
  }

  .title-block {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .filename {
    margin: 0;
    font-size: var(--fs-xl);
    font-weight: 650;
    letter-spacing: -0.015em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .state {
    flex: none;
    padding: 5px 11px;
    border-radius: 999px;
    font-size: var(--fs-sm);
    font-weight: 650;
    color: var(--cyan);
    background: var(--cyan-soft);
    white-space: nowrap;
  }
  .state.tone-warn {
    color: var(--warn);
    background: var(--warn-soft);
  }
  .state.tone-ok {
    color: var(--ok);
    background: var(--ok-soft);
  }
  .state.tone-dim {
    color: var(--text-2);
    background: var(--surface-3);
  }

  .body {
    flex: 1;
    display: flex;
    align-items: center;
    gap: calc(var(--gap) * 2);
    min-height: 0;
  }

  .stats {
    flex: 1;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--gap) calc(var(--gap) * 1.5);
    margin: 0;
    min-width: 0;
  }

  .stats .wide {
    grid-column: 1 / -1;
  }

  .stats div {
    min-width: 0;
  }

  dt {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: var(--fs-xs);
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-dim);
  }

  dd {
    margin: 3px 0 0;
    font-size: var(--fs-xl);
    font-weight: 600;
    letter-spacing: -0.01em;
    white-space: nowrap;
  }

  dd small {
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--text-dim);
    margin-left: 4px;
  }

  .message {
    margin: 0;
    padding: 8px 12px;
    border-radius: var(--radius-sm);
    background: var(--warn-soft);
    color: var(--warn);
    font-size: var(--fs-sm);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .controls {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .ctl {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-height: var(--touch);
    min-width: 116px;
    padding: 0 16px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-strong);
    background: var(--surface-3);
    font-weight: 600;
  }

  .ctl:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }

  .note {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    font-size: var(--fs-xs);
    color: var(--text-dim);
    min-width: 0;
  }

  .idle {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    gap: 8px;
  }

  .idle-icon {
    display: grid;
    place-items: center;
    width: 72px;
    height: 72px;
    border-radius: 50%;
    color: var(--ok);
    background: var(--ok-soft);
  }

  .idle h2 {
    margin: 4px 0 0;
    font-size: var(--fs-xl);
  }

  .idle p {
    margin: 0;
    max-width: 34ch;
    color: var(--text-dim);
    font-size: var(--fs-sm);
  }

  @media (max-width: 900px), (max-height: 540px) {
    .ctl {
      min-width: 0;
      padding: 0 12px;
    }
    .body {
      gap: var(--gap);
    }
  }
</style>

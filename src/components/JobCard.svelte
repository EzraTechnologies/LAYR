<script lang="ts">
  import { app } from '../lib/context';
  import { displayFilename, formatClock, formatDuration, formatFilament, formatFlow, formatSpeed } from '../lib/format';
  import { navigate } from '../lib/routes';
  import { jobSpoolSuffix } from '../lib/spoolman/present';
  import { printerImages } from '../lib/printerImage/store.svelte';
  import { isJobActive } from '../lib/printer/model';
  import { headline } from '../lib/statusMeta';
  import Icon from './Icon.svelte';
  import PrinterPhoto from './PrinterPhoto.svelte';
  import ProgressRing from './ProgressRing.svelte';
  import Thumb from './Thumb.svelte';

  const { store, ui, spoolman } = app();
  const printerState = store.state;
  const timeZone: string | undefined = undefined;

  const job = $derived(printerState.job);
  const title = $derived(headline(printerState));
  const active = $derived(isJobActive(printerState.status));
  const printerPhoto = $derived(printerImages.url);
  let failedIdlePhoto = $state<string | null>(null);
  const showIdlePhoto = $derived(!!printerPhoto && failedIdlePhoto !== printerPhoto);
  const ringTone = $derived(
    printerState.status === 'paused' ? 'warn' : job?.state === 'complete' ? 'ok' : active ? 'cyan' : 'dim',
  );
  // A wall-clock ETA is meaningless while paused; only the remaining duration is shown then.
  const eta = $derived(
    printerState.status === 'printing' && job?.remaining != null ? printerState.now + job.remaining * 1000 : null,
  );
  const layerText = $derived(
    job?.currentLayer != null && job.totalLayers != null && job.totalLayers > 0
      ? `${job.currentLayer} / ${job.totalLayers}`
      : job?.currentLayer != null
        ? String(job.currentLayer)
        : '—',
  );
  const spoolSuffix = $derived(active ? jobSpoolSuffix(spoolman.snapshot, spoolman.activeSpool()) : null);
  const filamentTitle = $derived(spoolSuffix ? `Filament used for this job. ${spoolSuffix}` : 'Filament used for this job');
  const paused = $derived(printerState.status === 'paused');
  const toggleCommand = $derived(paused ? ({ kind: 'resume' } as const) : ({ kind: 'pause' } as const));
  const toggleBusy = $derived(ui.isBusy(toggleCommand));
  const printBusy = $derived(ui.busyGroups.includes('print'));
  const feedBusy = $derived(ui.busyGroups.includes('feedrate'));

  const motion = $derived(printerState.motion);
  const speedText = $derived(formatSpeed(motion.speedMmS));
  const flowText = $derived(formatFlow(motion.flowMm3S));
  const speedTitle = $derived(
    motion.speedMmS === null
      ? 'Klipper did not report motion_report.live_velocity.'
      : 'Klipper motion_report.live_velocity, in mm/s. Not the M220 speed override.',
  );
  const flowTitle = $derived(
    motion.flowGap === 'diameter'
      ? 'Klipper reported extruder velocity, but filament_diameter is missing, so volumetric flow cannot be calculated.'
      : motion.flowGap === 'velocity'
        ? 'Klipper did not report motion_report.live_extruder_velocity.'
        : motion.flowMm3S !== null && motion.flowMm3S < 0
          ? 'Filament is retracting. Negative mm³/s is live_extruder_velocity × filament area, not the M221 override.'
          : 'Volumetric flow from Klipper live_extruder_velocity × filament cross-section. Not the M221 flow override.',
  );

  let rates = $state<null | 'speed' | 'flow'>(null);

  function percentOf(factor: number | null | undefined): number {
    if (factor === null || factor === undefined || !Number.isFinite(factor)) return 100;
    return Math.round(factor * 100);
  }

  function openRates(which: 'speed' | 'flow') {
    rates = rates === which ? null : which;
  }

  function nudge(which: 'speed' | 'flow', delta: number) {
    if (which === 'speed') {
      void ui.run({ kind: 'set_speed_factor', percent: percentOf(printerState.toolhead?.speedFactor) + delta });
    } else {
      void ui.run({ kind: 'set_extrude_factor', percent: percentOf(printerState.toolhead?.extrudeFactor) + delta });
    }
  }
</script>

<section class="card job" aria-labelledby="job-title">
  {#if job}
    <header class="head">
      {#if active}
        <Thumb
          path={job.thumbnailPath}
          cacheKey={null}
          size={56}
          alt={displayFilename(job.filename)}
          fallbackSrc={printerPhoto}
          fallbackAlt="Printer photo"
        />
      {:else}
        <PrinterPhoto src={printerPhoto} size={72} />
      {/if}
      <div class="title-block">
        <span class="eyebrow">Current job</span>
        <h2 id="job-title" class="filename" title={job.filename}>{displayFilename(job.filename)}</h2>
      </div>
      <span class="state tone-{ringTone}">{title}</span>
    </header>

    <div class="body">
      <ProgressRing progress={job.progress} tone={ringTone} label={`Print progress for ${displayFilename(job.filename)}`} />

      <div class="stats-wrap">
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
        </dl>

        <div class="motion" role="region" aria-label="Live motion reported by Klipper">
          {#if active}
            <button type="button" class="hit" title={speedTitle} aria-label={`Live speed ${speedText} millimetres per second. Adjust speed override.`} onclick={() => openRates('speed')}>
              <span class="k"><Icon name="bolt" size={16} />Speed</span>
              <span class="v num">{speedText}<small>mm/s</small></span>
            </button>
            <button type="button" class="hit" title={flowTitle} aria-label={`Live flow ${flowText} cubic millimetres per second. Adjust flow override.`} onclick={() => openRates('flow')}>
              <span class="k"><Icon name="filament" size={16} />Flow</span>
              <span class="v num">
                {flowText}<small>mm³/s</small>
                {#if motion.flowMm3S !== null && motion.flowMm3S < 0}<em>retract</em>{/if}
              </span>
            </button>
          {:else}
            <div class="hit static" title={speedTitle}>
              <span class="k"><Icon name="bolt" size={16} />Speed</span>
              <span class="v num">{speedText}<small>mm/s</small></span>
            </div>
            <div class="hit static" title={flowTitle}>
              <span class="k"><Icon name="filament" size={16} />Flow</span>
              <span class="v num">{flowText}<small>mm³/s</small></span>
            </div>
          {/if}
        </div>
        <p class="filament" title={filamentTitle}>Filament {formatFilament(job.filamentUsed)}{spoolSuffix ? ` · ${spoolSuffix}` : ''}</p>
      </div>
    </div>

    {#if job.message}
      <p class="message" title={job.message}>{job.message}</p>
    {/if}

    {#if active}
      <footer class="controls">
        <button
          type="button"
          class="btn {paused ? 'cyan' : ''} ctl"
          aria-busy={toggleBusy}
          disabled={printBusy && !toggleBusy}
          onclick={() => ui.run(toggleCommand)}
        >
          <Icon name={paused ? 'play' : 'pause'} size={20} />
          {paused ? 'Resume' : 'Pause'}
        </button>
        <button
          type="button"
          class="btn danger ctl"
          disabled={printBusy}
          onclick={() => ui.run({ kind: 'cancel' })}
        >
          <Icon name="stop" size={20} />
          Cancel
        </button>
        {#if printerState.toolhead?.zOffset != null}
          <button type="button" class="btn ghost ctl zoff" onclick={() => navigate('move')} title="Adjust Z offset">
            <span class="num">Z {printerState.toolhead.zOffset >= 0 ? '+' : ''}{printerState.toolhead.zOffset.toFixed(3)}</span>
          </button>
        {/if}
      </footer>
    {:else if job.state === 'complete' || job.state === 'cancelled' || job.state === 'error'}
      <footer class="controls">
        <button type="button" class="btn ghost ctl" onclick={() => navigate('files')}>
          <Icon name="files" size={20} />Files
        </button>
      </footer>
    {/if}
  {:else}
    <div class="idle" class:with-photo={showIdlePhoto}>
      {#if showIdlePhoto}
        <div class="hero">
          <PrinterPhoto src={printerPhoto} onError={() => (failedIdlePhoto = printerPhoto)} />
        </div>
      {/if}
      <div class="idle-copy">
        <div class="idle-icon" aria-hidden="true"><Icon name="check" size={showIdlePhoto ? 22 : 34} strokeWidth={2} /></div>
        <div class="idle-text">
          <h2 id="job-title" title="Ready to print">Ready to print</h2>
          <p title="No job is loaded. Choose a file to start a print.">No job is loaded. Choose a file to start a print.</p>
        </div>
        <button type="button" class="btn primary" onclick={() => navigate('files')}>
          <Icon name="files" size={20} />Browse files
        </button>
      </div>
    </div>
  {/if}
</section>

{#if rates && job && active}
  {@const which = rates}
  {@const current = which === 'speed' ? percentOf(printerState.toolhead?.speedFactor) : percentOf(printerState.toolhead?.extrudeFactor)}
  <div class="popover" role="dialog" aria-label={which === 'speed' ? 'Speed override' : 'Flow override'}>
    <div class="pop-copy">
      <strong>{which === 'speed' ? 'Speed override' : 'Flow override'}</strong>
      <span class="num">{current}%</span>
      <p>{which === 'speed' ? 'M220 multiplier. The number on the dashboard is live mm/s.' : 'M221 multiplier. The number on the dashboard is live mm³/s.'}</p>
    </div>
    <div class="pop-actions">
      <button type="button" class="btn" disabled={feedBusy} onclick={() => nudge(which, -10)} aria-label={which === 'speed' ? 'Decrease speed override' : 'Decrease flow override'}>−10%</button>
      <button type="button" class="btn" disabled={feedBusy} onclick={() => nudge(which, 10)} aria-label={which === 'speed' ? 'Increase speed override' : 'Increase flow override'}>+10%</button>
      <button type="button" class="btn ghost" onclick={() => (rates = null)} aria-label={which === 'speed' ? 'Close speed override' : 'Close flow override'}>Done</button>
    </div>
  </div>
{/if}

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
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    min-width: 0;
  }

  .title-block {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1;
  }

  .filename {
    margin: 0;
    font-size: var(--fs-lg);
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
    gap: calc(var(--gap) * 1.5);
    min-height: 0;
  }

  .stats-wrap {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .stats {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px calc(var(--gap) * 1.25);
    margin: 0;
    min-width: 0;
  }

  .stats div {
    min-width: 0;
  }

  dt,
  .k {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: var(--fs-xs);
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-dim);
  }

  dd,
  .v {
    margin: 2px 0 0;
    font-size: var(--fs-lg);
    font-weight: 600;
    letter-spacing: -0.01em;
    white-space: nowrap;
  }

  dd small,
  .v small,
  .v em {
    font-size: var(--fs-xs);
    font-weight: 600;
    font-style: normal;
    color: var(--text-dim);
    margin-left: 4px;
  }

  .v em {
    color: var(--warn);
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .motion {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }

  .hit {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: center;
    min-width: 0;
    min-height: 44px;
    padding: 4px 8px;
    border-radius: var(--radius-sm);
    border: 1px solid transparent;
    background: transparent;
    color: inherit;
    text-align: left;
  }

  button.hit {
    border-color: var(--border);
    background: color-mix(in srgb, var(--bg) 55%, transparent);
  }

  button.hit:active {
    background: var(--surface-3);
  }

  .filament {
    margin: 0;
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--text-dim);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
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
    min-width: 108px;
    min-height: 48px;
  }

  .zoff {
    margin-left: auto;
    min-width: 0;
    font-size: var(--fs-sm);
  }

  .popover {
    position: fixed;
    z-index: 30;
    left: calc(var(--rail-w) + var(--pad));
    right: var(--pad);
    bottom: var(--pad);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 14px;
    border-radius: var(--radius);
    border: 1px solid var(--border-strong);
    background: var(--surface-2);
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
  }

  .pop-copy {
    min-width: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 8px;
  }

  .pop-copy strong {
    font-size: var(--fs-sm);
  }

  .pop-copy .num {
    font-size: var(--fs-lg);
    font-weight: 650;
  }

  .pop-copy p {
    flex-basis: 100%;
    margin: 0;
    color: var(--text-dim);
    font-size: var(--fs-xs);
  }

  .pop-actions {
    display: flex;
    gap: 8px;
    flex: none;
  }

  .idle {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    gap: 8px;
  }

  .idle.with-photo {
    align-items: stretch;
    justify-content: flex-start;
    text-align: left;
  }

  .hero {
    flex: 1;
    min-height: 0;
    display: grid;
  }

  .idle-copy {
    display: contents;
  }

  .with-photo .idle-copy {
    flex: none;
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .idle-copy .btn {
    flex: none;
  }

  .idle-icon {
    display: grid;
    place-items: center;
    flex: none;
    width: 72px;
    height: 72px;
    border-radius: 50%;
    color: var(--ok);
    background: var(--ok-soft);
  }

  .with-photo .idle-icon {
    width: 40px;
    height: 40px;
  }

  .idle-text {
    display: contents;
  }

  .with-photo .idle-text {
    display: block;
    flex: 1;
    min-width: 0;
  }

  .idle h2 {
    margin: 4px 0 0;
    font-size: var(--fs-xl);
  }

  .with-photo h2 {
    margin: 0;
    font-size: var(--fs-lg);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .idle p {
    margin: 0;
    max-width: 34ch;
    color: var(--text-dim);
    font-size: var(--fs-sm);
  }

  .with-photo p {
    max-width: none;
    font-size: var(--fs-xs);
  }

  @media (max-width: 900px), (max-height: 540px) {
    .ctl {
      min-width: 0;
      min-height: var(--touch);
      padding: 0 12px;
    }
    .body {
      gap: var(--gap);
    }
    .popover {
      flex-direction: column;
      align-items: stretch;
    }
    .pop-actions .btn {
      flex: 1;
    }
  }
</style>

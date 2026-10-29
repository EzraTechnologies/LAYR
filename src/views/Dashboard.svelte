<script lang="ts">
  import ConnectionCard from '../components/ConnectionCard.svelte';
  import FanSummary from '../components/FanSummary.svelte';
  import Icon from '../components/Icon.svelte';
  import { mmuSummary } from '../lib/mmu/happyhare';
  import JobCard from '../components/JobCard.svelte';
  import TemperatureCard from '../components/TemperatureCard.svelte';
  import { app } from '../lib/context';
  import { formatClock } from '../lib/format';
  import { headlineFor } from '../lib/spoolman/present';

  const { store, console: log, spoolman } = app();
  const printerState = store.state;
  const spoolLine = $derived(headlineFor(spoolman.snapshot, spoolman.activeSpool()));
  const showSpoolStrip = $derived(!!spoolLine && printerState.status !== 'printing' && printerState.status !== 'paused');

  const online = $derived(printerState.status === 'ready' || printerState.status === 'printing' || printerState.status === 'paused');
  const mmuLine = $derived(printerState.mmu ? mmuSummary(printerState.mmu) : '');
  const showJob = $derived(online || (printerState.status === 'error' && printerState.klippy === 'ready'));
  const unavailable = $derived(online ? 'Not configured' : 'No data');
  const alerts = $derived(log.alerts(printerState.now));
</script>

<div class="dashboard page">
  <div class="primary">
    {#if showSpoolStrip && spoolLine}
      <a class="spool-strip" href="#/extrude" title={spoolLine.titleAttr}>
        <span class="swatch" class:empty={!spoolLine.color} style:background={spoolLine.color ?? 'transparent'} aria-hidden="true"></span>
        <span class="copy">
          <strong title={spoolLine.title}>{spoolLine.title}</strong>
          <span title={spoolLine.detail}>{spoolLine.detail}</span>
        </span>
      </a>
    {/if}
    {#if alerts.length > 0}
      <ul class="alerts" aria-label="Printer alerts">
        {#each alerts as alert (alert.id)}
          <li class="alert">
            <Icon name="alert" size={18} strokeWidth={2} />
            <span class="msg" title={alert.text}>{alert.text.replace(/^!!\s*/, '')}</span>
            <span class="time num">{formatClock(alert.time)}</span>
            <button type="button" class="btn ghost dismiss" aria-label="Dismiss alert" onclick={() => log.dismiss(alert.id)}>
              <Icon name="close" size={18} />
            </button>
          </li>
        {/each}
      </ul>
    {/if}
    {#if printerState.mmu}
      <a class="mmu-link card" href="#/mmu" title={mmuLine}>
        <span class="mmu-kicker">Happy Hare</span>
        <span class="mmu-summary" title={mmuLine}>{mmuLine}</span>
      </a>
    {/if}
    {#if showJob}
      <JobCard />
    {:else}
      <ConnectionCard />
    {/if}
  </div>

  <div class="side" aria-label="Temperatures and fans" role="group">
    <a class="temp-link" href="#/heat" aria-label="Nozzle temperature controls">
      <TemperatureCard label="Nozzle" icon="nozzle" reading={printerState.extruder} unavailableText={unavailable} />
    </a>
    <a class="temp-link" href="#/heat" aria-label="Bed temperature controls">
      <TemperatureCard label="Bed" icon="bed" reading={printerState.bed} unavailableText={unavailable} />
    </a>
    <TemperatureCard
      label="Chamber"
      icon="chamber"
      reading={printerState.chamber}
      unavailableText={online ? 'No chamber sensor' : unavailable}
    />
    <FanSummary />
  </div>
</div>

<style>
  .dashboard {
    display: grid;
    grid-template-columns: minmax(0, 1.55fr) minmax(0, 1fr);
    gap: var(--gap);
  }

  .primary {
    display: flex;
    flex-direction: column;
    gap: var(--gap);
    min-height: 0;
    min-width: 0;
  }

  .primary > :global(:last-child) {
    flex: 1;
  }

  .side {
    display: grid;
    grid-template-rows: repeat(3, minmax(0, 1.15fr)) minmax(0, 1fr);
    gap: var(--gap);
    min-height: 0;
    min-width: 0;
  }

  .temp-link {
    display: grid;
    min-height: 0;
    color: inherit;
    text-decoration: none;
    border-radius: var(--radius);
  }

  .mmu-link {
    flex: none;
    min-height: 44px;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 12px;
    color: inherit;
    text-decoration: none;
  }

  .mmu-kicker {
    flex: none;
    font-size: var(--fs-xs);
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--cyan);
  }

  .mmu-summary {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--fs-sm);
    font-weight: 600;
  }

  .alerts {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 6px;
    flex: none;
  }

  .alert {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    padding: 2px 4px 2px 12px;
    border-radius: var(--radius-sm);
    border: 1px solid color-mix(in srgb, var(--danger) 40%, transparent);
    background: var(--danger-soft);
    color: var(--danger);
  }

  .msg {
    flex: 1;
    min-width: 0;
    font-size: var(--fs-sm);
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .time {
    font-size: var(--fs-xs);
    color: var(--text-dim);
  }

  .dismiss {
    border: 0;
    padding: 0;
    color: var(--text-2);
  }

  .spool-strip {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: none;
    min-height: 44px;
    padding: 4px 12px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: var(--surface);
    color: inherit;
    text-decoration: none;
  }

  .swatch {
    flex: none;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    border: 1px solid var(--border-strong);
  }

  .swatch.empty {
    background: transparent !important;
    border-style: dashed;
  }

  .copy {
    flex: 1;
    min-width: 0;
    display: flex;
    gap: 8px;
    align-items: baseline;
  }

  .copy strong,
  .copy span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .copy span {
    color: var(--text-dim);
    font-size: var(--fs-sm);
  }
</style>

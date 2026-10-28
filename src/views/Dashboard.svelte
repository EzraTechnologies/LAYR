<script lang="ts">
  import ConnectionCard from '../components/ConnectionCard.svelte';
  import FanSummary from '../components/FanSummary.svelte';
  import Icon from '../components/Icon.svelte';
  import JobCard from '../components/JobCard.svelte';
  import TemperatureCard from '../components/TemperatureCard.svelte';
  import { app } from '../lib/context';
  import { formatClock } from '../lib/format';
  import { spoolQuantityLine } from '../lib/spoolman/api';
  import { activeSummary } from '../lib/spoolman/store.svelte';

  const { store, console: log, spoolman } = app();
  const printerState = store.state;
  const activeSpool = $derived(activeSummary(spoolman.spools, spoolman.facts));

  const online = $derived(printerState.status === 'ready' || printerState.status === 'printing' || printerState.status === 'paused');
  const showJob = $derived(online || (printerState.status === 'error' && printerState.klippy === 'ready'));
  const unavailable = $derived(online ? 'Not configured' : 'No data');
  const alerts = $derived(log.alerts(printerState.now));
</script>

<div class="dashboard page">
  <div class="primary">
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
    {#if activeSpool}
      {@const spoolLine = [activeSpool.name, activeSpool.material, spoolQuantityLine(activeSpool)].filter(Boolean).join(' · ')}
      <a class="spool card" href="#/filament">
        <span class="swatch" style:background={activeSpool.colors[0] ?? 'transparent'} class:none={activeSpool.colors.length === 0} aria-hidden="true"></span>
        <span class="spool-copy">
          <span class="eyebrow">Active spool</span>
          <span class="spool-name" title={spoolLine}>{spoolLine}</span>
        </span>
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

  .alerts {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 6px;
    flex: none;
  }

  .spool {
    flex: none;
    min-height: 48px;
    display: grid;
    grid-template-columns: 22px minmax(0, 1fr);
    gap: 10px;
    align-items: center;
    padding: 6px 12px;
    color: inherit;
    text-decoration: none;
  }

  .swatch {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.25);
  }

  .swatch.none {
    background: repeating-linear-gradient(135deg, var(--surface-3), var(--surface-3) 3px, var(--surface) 3px, var(--surface) 6px) !important;
  }

  .spool-copy {
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .spool-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .spool-name {
    font-weight: 650;
    font-size: var(--fs-sm);
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
</style>

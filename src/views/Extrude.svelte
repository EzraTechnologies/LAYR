<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import SpoolBrowser from '../components/SpoolBrowser.svelte';
  import { MAX_EXTRUDE_MM, type PrinterCommand } from '../lib/actions/commands';
  import { app } from '../lib/context';
  import { findMacro, LOAD_MACROS, UNLOAD_MACROS } from '../lib/filament';
  import { formatClock, formatTemp } from '../lib/format';
  import type { MacroInfo } from '../lib/printer/model';
  import { navigate } from '../lib/routes';
  import { unloadOutcomeFrom } from '../lib/spoolman/api';
  import { headlineFor } from '../lib/spoolman/present';

  const { store, ui, consoleDraft, spoolman } = app();
  const printerState = store.state;

  const LENGTHS = [1, 5, 10, 25, 50] as const;
  const SPEEDS = [1, 2, 5, 10] as const;

  let length = $state<number>(10);
  let speed = $state<number>(5);

  type MacroResult = { macro: string; status: 'ok' | 'failed' | 'unconfirmed'; message: string; time: number };
  let lastFilamentAction = $state<MacroResult | null>(null);
  let browseSpools = $state(false);
  const spoolLine = $derived(headlineFor(spoolman.snapshot, spoolman.activeSpool()));

  const extruder = $derived(printerState.extruder);
  const minTemp = $derived(printerState.limits.extruder.minExtrudeTemp);
  const maxLength = $derived(Math.min(printerState.limits.extruder.maxExtrudeOnlyDistance, MAX_EXTRUDE_MM));
  const lengths = $derived(LENGTHS.filter((l) => l <= maxLength));
  const loadMacro = $derived(findMacro(printerState.macros, LOAD_MACROS));
  const unloadMacro = $derived(findMacro(printerState.macros, UNLOAD_MACROS));
  const hot = $derived(extruder?.temperature != null && extruder.temperature >= minTemp && printerState.canExtrude !== false);

  const extrudeCmd = $derived<PrinterCommand>({ kind: 'extrude', length, speed });
  const retractCmd = $derived<PrinterCommand>({ kind: 'extrude', length: -length, speed });
  const extrudeCheck = $derived(ui.gateway.availability(extrudeCmd));
  const busy = $derived(ui.busyGroups.includes('extrude'));

  function openSpools() {
    if (spoolman.snapshot.phase === 'loading') return;
    if (spoolman.snapshot.phase === 'ready') browseSpools = true;
    else void spoolman.refresh();
  }

  async function runFilamentMacro(macro: MacroInfo) {
    if (macro.requiredParams.length > 0) {
      consoleDraft.value = `${macro.name} ${macro.requiredParams.map((p) => `${p}=`).join(' ')}`;
      navigate('console');
      return;
    }
    const clearing =
      macro.name === unloadMacro?.name &&
      spoolman.willClearOnUnload &&
      printerState.status !== 'printing' &&
      printerState.status !== 'paused';
    const outcome = await ui.run({
      kind: 'macro',
      name: macro.name,
      ...(clearing
        ? { note: 'If Klipper accepts this unload, the active spool is cleared. A failed or unknown result keeps the spool.' }
        : {}),
    });
    // Only Klipper's "ok" reply counts as done; anything else is reported as failed or unknown.
    if (outcome.status === 'ok') {
      lastFilamentAction = { macro: macro.name, status: 'ok', message: 'Klipper reported the macro finished', time: Date.now() };
    } else if (outcome.status === 'failed' || outcome.status === 'unconfirmed') {
      lastFilamentAction = { macro: macro.name, status: outcome.status, message: outcome.message, time: Date.now() };
    }
    if (!clearing) return;
    const result = await spoolman.clearAfterUnload(unloadOutcomeFrom(outcome));
    if (result === 'cleared') ui.toast('ok', 'Active spool cleared');
    else if (result === 'kept' && (outcome.status === 'ok' || outcome.status === 'unconfirmed')) {
      ui.toast('warn', 'Active spool kept', spoolman.snapshot.message);
    }
  }
</script>

<div class="extrude page">
  <section class="card panel" aria-labelledby="extrude-title">
    <h2 id="extrude-title" class="panel-title eyebrow">
      Extruder
      <span class="temp num" class:cold={!hot}>
        <Icon name="nozzle" size={16} />
        {formatTemp(extruder?.temperature)}°C{extruder?.target ? ` → ${formatTemp(extruder.target)}°` : ''}
      </span>
    </h2>

    <h3 class="eyebrow sub">Length (mm)</h3>
    <div class="seg" role="radiogroup" aria-label="Extrusion length">
      {#each lengths as l (l)}
        <button type="button" role="radio" aria-checked={length === l} onclick={() => (length = l)}>{l}</button>
      {/each}
    </div>
    <h3 class="eyebrow sub">Speed (mm/s)</h3>
    <div class="seg" role="radiogroup" aria-label="Extrusion speed">
      {#each SPEEDS as s (s)}
        <button type="button" role="radio" aria-checked={speed === s} onclick={() => (speed = s)}>{s}</button>
      {/each}
    </div>

    <div class="actions">
      <button
        type="button"
        class="btn"
        disabled={!extrudeCheck.allowed || busy}
        aria-busy={busy}
        onclick={() => ui.run(retractCmd)}
      >
        <Icon name="up" size={20} />Retract
      </button>
      <button
        type="button"
        class="btn primary"
        disabled={!extrudeCheck.allowed || busy}
        onclick={() => ui.run(extrudeCmd)}
      >
        <Icon name="down" size={20} />Extrude
      </button>
    </div>
    {#if !extrudeCheck.allowed}
      <p class="hint warn"><Icon name="lock" size={14} />{extrudeCheck.message}</p>
    {:else}
      <p class="hint">Cold extrusion is blocked below {Math.round(minTemp)} °C. Max {Math.round(maxLength)} mm per move.</p>
    {/if}
  </section>

  <div class="side">
    <section class="card panel" aria-labelledby="filament-title">
      <h2 id="filament-title" class="eyebrow">Filament change</h2>
      {#if loadMacro || unloadMacro}
        <div class="actions">
          {#if unloadMacro}
            {@const command = { kind: 'macro', name: unloadMacro.name } as const}
            <button type="button" class="btn" aria-busy={ui.isBusy(command)} disabled={!ui.gateway.availability(command).allowed && unloadMacro.requiredParams.length === 0} onclick={() => runFilamentMacro(unloadMacro)}>
              <Icon name="unload" size={20} />Unload
            </button>
          {/if}
          {#if loadMacro}
            {@const command = { kind: 'macro', name: loadMacro.name } as const}
            <button type="button" class="btn cyan" aria-busy={ui.isBusy(command)} disabled={!ui.gateway.availability(command).allowed && loadMacro.requiredParams.length === 0} onclick={() => runFilamentMacro(loadMacro)}>
              <Icon name="load" size={20} />Load
            </button>
          {/if}
        </div>
        <p class="hint">
          Runs {[unloadMacro?.name, loadMacro?.name].filter(Boolean).join(' / ')} from your config. The macro must heat the nozzle
          if it needs to.
        </p>
        {#if lastFilamentAction}
          <p class="result tone-{lastFilamentAction.status}" role="status">
            <Icon name={lastFilamentAction.status === 'ok' ? 'check' : 'alert'} size={16} />
            <span>
              <strong>{lastFilamentAction.macro}</strong>
              {lastFilamentAction.status === 'ok' ? 'completed' : lastFilamentAction.status === 'failed' ? 'failed' : 'result unknown'}
              at {formatClock(lastFilamentAction.time)}.
              {lastFilamentAction.status === 'ok' ? '' : lastFilamentAction.message}
            </span>
          </p>
        {/if}
      {:else}
        <p class="hint">
          <Icon name="info" size={14} />
          No LOAD_FILAMENT or UNLOAD_FILAMENT macro was found in the printer config. Use Extrude and Retract, or add the macros to
          Klipper.
        </p>
      {/if}
    </section>

    <section class="card panel" aria-labelledby="sensor-title">
      <h2 id="sensor-title" class="eyebrow">Runout sensors</h2>
      {#if printerState.filamentSensors.length === 0}
        <p class="hint">No filament sensor configured.</p>
      {:else}
        <ul class="sensors">
          {#each printerState.filamentSensors as sensor (sensor.object)}
            <li>
              <span title={sensor.object}>{sensor.label}</span>
              <span class="badge" class:ok={sensor.detected === true} class:off={sensor.enabled === false}>
                {sensor.enabled === false ? 'Disabled' : sensor.detected === null ? '—' : sensor.detected ? 'Filament' : 'Empty'}
              </span>
            </li>
          {/each}
        </ul>
      {/if}
      {#if spoolLine}
        <button type="button" class="spool-row" title={spoolLine.titleAttr} disabled={spoolman.snapshot.phase === 'loading'} onclick={openSpools}>
          <span class="swatch" class:empty={!spoolLine.color} style:background={spoolLine.color ?? 'transparent'} aria-hidden="true"></span>
          <span class="copy">
            <strong title={spoolLine.title}>{spoolLine.title}</strong>
            <span title={spoolLine.detail}>{spoolLine.detail}</span>
          </span>
        </button>
        {#if spoolman.snapshot.message && spoolman.snapshot.message !== 'No active spool.'}
          <p class="hint">{spoolman.snapshot.message}</p>
        {/if}
      {:else}
        <p class="hint">Spool tracking with Spoolman is planned for a later release.</p>
      {/if}
    </section>
  </div>
</div>

<SpoolBrowser open={browseSpools} onClose={() => (browseSpools = false)} />

<style>
  .extrude {
    display: grid;
    grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
    gap: var(--gap);
  }

  .extrude > .panel,
  .side > .panel {
    min-height: 0;
    overflow: hidden;
  }

  .side {
    display: flex;
    flex-direction: column;
    gap: var(--gap);
    min-height: 0;
    min-width: 0;
  }

  .temp {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: var(--fs-sm);
    text-transform: none;
    letter-spacing: 0;
    color: var(--cyan);
  }

  .temp.cold {
    color: var(--text-dim);
  }

  .sub {
    margin: 2px 0 0;
  }

  .actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }

  .actions .btn {
    min-height: 58px;
  }

  .result {
    display: flex;
    gap: 8px;
    margin: 0;
    padding: 8px 10px;
    border-radius: var(--radius-sm);
    font-size: var(--fs-sm);
    color: var(--warn);
    background: var(--warn-soft);
  }

  .result.tone-ok {
    color: var(--ok);
    background: var(--ok-soft);
  }

  .result.tone-failed {
    color: var(--danger);
    background: var(--danger-soft);
  }

  .result span {
    color: var(--text-2);
  }

  .sensors {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 4px;
  }

  .sensors li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    font-size: var(--fs-sm);
  }

  .badge {
    padding: 2px 8px;
    border-radius: 999px;
    font-size: var(--fs-xs);
    font-weight: 650;
    color: var(--warn);
    background: var(--warn-soft);
  }

  .badge.ok {
    color: var(--ok);
    background: var(--ok-soft);
  }

  .badge.off {
    color: var(--text-dim);
    background: var(--surface-3);
  }

  .spool-row {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    min-height: 44px;
    padding: 6px 8px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-strong);
    background: var(--surface-3);
    color: inherit;
    text-align: left;
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
    min-width: 0;
    display: flex;
    flex-direction: column;
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
    font-size: var(--fs-xs);
  }

  @media (max-width: 900px), (max-height: 540px) {
    .actions .btn {
      min-height: var(--touch);
    }
  }
</style>

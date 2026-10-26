<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import { heaterLimitsFor, heaterReadings } from '../lib/actions/commands';
  import { app } from '../lib/context';
  import { formatTemp } from '../lib/format';
  import type { IconName } from '../lib/icons';
  import type { HeaterReading } from '../lib/printer/model';

  const { store, ui } = app();
  const printerState = store.state;

  /** Common starting points; adjust per filament. Values above a heater's configured max_temp are rejected. */
  const PRESETS = [
    { name: 'PLA', extruder: 210, bed: 60 },
    { name: 'PETG', extruder: 240, bed: 80 },
    { name: 'ABS / ASA', extruder: 255, bed: 105 },
  ] as const;

  const heaters = $derived(heaterReadings(printerState));
  const ready = $derived(printerState.transport === 'connected' && printerState.klippy === 'ready');

  function iconFor(object: string): IconName {
    return object === 'extruder' ? 'nozzle' : object === 'heater_bed' ? 'bed' : 'heat';
  }

  async function setTarget(heater: HeaterReading, target: number) {
    await ui.run({ kind: 'set_temperature', heater: heater.object, target });
  }

  async function enter(heater: HeaterReading) {
    const limits = heaterLimitsFor(printerState, heater.object);
    const presets =
      heater.object === 'extruder' ? [0, 200, 210, 220, 240, 250] : heater.object === 'heater_bed' ? [0, 55, 60, 80, 100, 105] : [0, 40, 50, 60];
    const value = await ui.prompt({
      title: `${heater.label} target`,
      value: String(Math.round(heater.target ?? 0)),
      mode: 'number',
      unit: '°C',
      min: 0,
      max: limits.maxTemp,
      presets: presets.filter((p) => p <= limits.maxTemp),
      hint: `0 turns the heater off. Allowed: ${Math.round(limits.minTemp)}–${Math.round(limits.maxTemp)} °C${printerState.limits.fromConfig ? ' (from printer config)' : ' (fallback limits)'}.`,
      submitLabel: 'Set',
    });
    if (value !== null) await setTarget(heater, Number(value));
  }

  async function applyPreset(preset: (typeof PRESETS)[number]) {
    if (printerState.extruder) {
      const outcome = await ui.run({ kind: 'set_temperature', heater: 'extruder', target: preset.extruder });
      if (outcome.status !== 'ok') return;
    }
    if (printerState.bed) await ui.run({ kind: 'set_temperature', heater: 'heater_bed', target: preset.bed });
  }

  async function coolDown() {
    for (const heater of heaters) {
      if ((heater.target ?? 0) > 0) await ui.run({ kind: 'set_temperature', heater: heater.object, target: 0 });
    }
  }

  const anyHeating = $derived(heaters.some((h) => (h.target ?? 0) > 0));
</script>

<div class="heat page">
  <section class="card panel heaters" aria-labelledby="heaters-title">
    <h2 id="heaters-title" class="panel-title eyebrow">Heaters</h2>
    {#if heaters.length === 0}
      <div class="empty">
        <Icon name="heat" size={30} />
        <strong>{ready ? 'No heaters reported' : 'Printer is offline'}</strong>
      </div>
    {:else}
      <ul class="list">
        {#each heaters as heater (heater.object)}
          {@const busy = ui.isBusy({ kind: 'set_temperature', heater: heater.object, target: 0 })}
          {@const heating = (heater.target ?? 0) > 0}
          <li class="heater" class:heating>
            <span class="label"><Icon name={iconFor(heater.object)} size={20} />{heater.label}</span>
            <span class="reading num">
              <span class="current">{formatTemp(heater.temperature)}°</span>
              <span class="target">→ {heating ? `${formatTemp(heater.target)}°` : 'off'}</span>
            </span>
            <div class="controls">
              <button
                type="button"
                class="btn ghost"
                aria-label={`${heater.label} −5 °C`}
                disabled={!ready || busy || !heating}
                onclick={() => setTarget(heater, Math.max(0, Math.round(heater.target ?? 0) - 5))}
              >
                <Icon name="minus" size={18} />
              </button>
              <button
                type="button"
                class="btn ghost"
                aria-label={`${heater.label} +5 °C`}
                disabled={!ready || busy}
                onclick={() => setTarget(heater, Math.round(heater.target ?? 0) + 5)}
              >
                <Icon name="plus" size={18} />
              </button>
              <button
                type="button"
                class="btn set"
                aria-label={`Set ${heater.label} target`}
                aria-busy={busy}
                disabled={!ready}
                onclick={() => enter(heater)}
              >
                Set…
              </button>
              <button
                type="button"
                class="btn ghost"
                aria-label={`Turn off ${heater.label}`}
                disabled={!ready || busy || !heating}
                onclick={() => setTarget(heater, 0)}
              >
                Off
              </button>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section class="card panel presets" aria-labelledby="presets-title">
    <h2 id="presets-title" class="eyebrow">Presets</h2>
    <div class="preset-grid">
      {#each PRESETS as preset (preset.name)}
        <button type="button" class="btn preset" disabled={!ready || !printerState.extruder} onclick={() => applyPreset(preset)}>
          <span class="preset-name">{preset.name}</span>
          <span class="preset-values num">{preset.extruder}° / {preset.bed}°</span>
        </button>
      {/each}
      <button type="button" class="btn cyan preset" disabled={!ready || !anyHeating} onclick={coolDown}>
        <Icon name="snowflake" size={20} />
        <span class="preset-name">Cool down</span>
      </button>
    </div>
    <p class="hint">
      <Icon name="info" size={14} />
      {printerState.limits.fromConfig
        ? `Limits come from the printer config. Nozzle max ${Math.round(printerState.limits.extruder.maxTemp)} °C${printerState.limits.bed ? `, bed max ${Math.round(printerState.limits.bed.maxTemp)} °C` : ''}.`
        : 'Printer config limits are not available, so conservative fallback limits apply.'}
    </p>
  </section>
</div>

<style>
  .heat {
    display: grid;
    grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr);
    gap: var(--gap);
  }

  .heaters {
    min-height: 0;
    overflow: hidden;
  }

  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 8px;
    overflow-y: auto;
    min-height: 0;
  }

  .heater {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas:
      'label reading'
      'controls controls';
    gap: 8px 12px;
    padding: 10px 12px;
    border-radius: var(--radius-sm);
    background: var(--bg);
    border: 1px solid var(--border);
  }

  .heating {
    border-color: color-mix(in srgb, var(--heat) 35%, transparent);
  }

  .label {
    grid-area: label;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-weight: 650;
    min-width: 0;
    white-space: nowrap;
  }

  .reading {
    grid-area: reading;
    display: flex;
    align-items: baseline;
    gap: 8px;
  }

  .current {
    font-size: var(--fs-xl);
    font-weight: 650;
  }

  .target {
    color: var(--text-dim);
    font-weight: 600;
  }

  .heating .target {
    color: var(--heat);
  }

  .controls {
    grid-area: controls;
    display: grid;
    grid-template-columns: 1fr 1fr 1.6fr 1fr;
    gap: 6px;
  }

  .controls .btn {
    min-width: 0;
    padding: 0 6px;
  }

  .presets {
    min-height: 0;
    overflow: hidden;
  }

  .preset-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 8px;
  }

  .preset {
    justify-content: space-between;
    min-height: 54px;
  }

  .preset-values {
    color: var(--text-dim);
    font-weight: 600;
  }

  @media (max-width: 900px), (max-height: 540px) {
    .heater {
      padding: 6px 10px;
      gap: 6px 10px;
    }
    .preset {
      min-height: var(--touch);
    }
    .current {
      font-size: var(--fs-lg);
    }
  }
</style>

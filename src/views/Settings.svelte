<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import { isValidMoonrakerUrl, type AppConfig, type PrinterProfile } from '../lib/config';
  import { DEMO_SCENARIOS, DEMO_SCENARIO_LABELS, type DemoScenarioId } from '../lib/demo/scenarios';
  import { formatTemp } from '../lib/format';
  import type { PrinterState } from '../lib/printer/model';

  interface Props {
    printerState: PrinterState;
    config: AppConfig;
    printer: PrinterProfile;
    demoScenario: DemoScenarioId | null;
    onScenario: (id: DemoScenarioId) => void;
    onSaveUrl: (url: string | null) => void;
    onDemoMode: (enabled: boolean) => void;
  }

  let { printerState, config, printer, demoScenario, onScenario, onSaveUrl, onDemoMode }: Props = $props();

  // svelte-ignore state_referenced_locally
  let urlDraft = $state(printer.moonrakerUrl);
  const urlValid = $derived(isValidMoonrakerUrl(urlDraft));

  const SOURCE_LABEL: Record<AppConfig['urlSource'], string> = {
    query: 'URL parameter',
    storage: 'Saved on this device',
    env: 'Build configuration',
    default: 'Default (this host, port 7125)',
  };

  function save(event: SubmitEvent) {
    event.preventDefault();
    if (urlValid) onSaveUrl(urlDraft.trim());
  }

  const allSensors = $derived(
    [printerState.extruder, printerState.bed, printerState.chamber, ...printerState.sensors].filter((s) => s !== null),
  );
</script>

<div class="settings">
  <section class="card panel" aria-labelledby="set-conn">
    <h2 id="set-conn" class="eyebrow">Connection</h2>
    <dl>
      <div><dt>Moonraker</dt><dd title={printer.moonrakerUrl}>{printer.moonrakerUrl}</dd></div>
      <div><dt>Source</dt><dd>{demoScenario ? 'Demo (not connected)' : SOURCE_LABEL[config.urlSource]}</dd></div>
      <div><dt>Transport</dt><dd>{printerState.transport}</dd></div>
      <div><dt>Klipper</dt><dd>{printerState.klippy}</dd></div>
      <div><dt>Host</dt><dd>{printerState.hostname ?? '—'}</dd></div>
      <div><dt>API key</dt><dd>{printer.apiKey ? 'Configured' : 'Not set (trusted client)'}</dd></div>
      {#if printerState.missingObjects.length > 0}
        <div><dt>Missing</dt><dd title={printerState.missingObjects.join(', ')}>{printerState.missingObjects.join(', ')}</dd></div>
      {/if}
    </dl>

    <form class="url-form" onsubmit={save}>
      <label for="moonraker-url">Moonraker URL</label>
      <div class="row">
        <input
          id="moonraker-url"
          type="url"
          inputmode="url"
          autocomplete="off"
          spellcheck="false"
          bind:value={urlDraft}
          aria-invalid={!urlValid}
        />
        <button type="submit" class="btn primary" disabled={!urlValid}>Save</button>
        {#if config.urlSource === 'storage'}
          <button type="button" class="btn" onclick={() => onSaveUrl(null)}>Reset</button>
        {/if}
      </div>
    </form>
  </section>

  <div class="col">
    <section class="card panel" aria-labelledby="set-demo">
      <h2 id="set-demo" class="eyebrow">Demo mode</h2>
      {#if demoScenario}
        <p class="note">Showing sample data. No connection is made and printer actions are disabled.</p>
        <div class="scenarios" role="radiogroup" aria-label="Demo scenario">
          {#each DEMO_SCENARIOS as id (id)}
            <button
              type="button"
              role="radio"
              class="chip"
              aria-checked={demoScenario === id}
              onclick={() => onScenario(id)}
            >
              {DEMO_SCENARIO_LABELS[id]}
            </button>
          {/each}
        </div>
        <button type="button" class="btn" onclick={() => onDemoMode(false)}>
          <Icon name="refresh" size={18} />Exit demo
        </button>
      {:else}
        <p class="note">Preview LAYR with sample print data. No commands are sent in demo mode.</p>
        <button type="button" class="btn" onclick={() => onDemoMode(true)}>
          <Icon name="play" size={18} />Open demo
        </button>
      {/if}
    </section>

    <section class="card panel" aria-labelledby="set-sensors">
      <h2 id="set-sensors" class="eyebrow">Temperature sources</h2>
      {#if allSensors.length === 0}
        <p class="note">No temperature data.</p>
      {:else}
        <ul class="sensors">
          {#each allSensors as sensor (sensor.object)}
            <li>
              <span title={sensor.object}>{sensor.label}</span>
              <span class="num">{formatTemp(sensor.temperature)}°C</span>
            </li>
          {/each}
        </ul>
      {/if}
      <p class="about">LAYR v{__LAYR_VERSION__} · read-only preview</p>
    </section>
  </div>
</div>

<style>
  .settings {
    height: 100%;
    display: grid;
    grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
    gap: var(--gap);
    overflow: auto;
    align-items: start;
  }

  .col {
    display: grid;
    gap: var(--gap);
    min-width: 0;
  }

  .panel {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: var(--pad) calc(var(--pad) + 2px);
  }

  h2 {
    margin: 0;
  }

  dl {
    display: grid;
    gap: 2px;
    margin: 0;
  }

  dl div {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 5px 0;
    border-bottom: 1px solid var(--border);
    font-size: var(--fs-sm);
    min-width: 0;
  }

  dt {
    color: var(--text-dim);
    flex: none;
  }

  dd {
    margin: 0;
    color: var(--text-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }

  .url-form {
    display: grid;
    gap: 6px;
  }

  label {
    font-size: var(--fs-sm);
    color: var(--text-2);
    font-weight: 600;
  }

  .row {
    display: flex;
    gap: 8px;
  }

  input {
    flex: 1;
    min-width: 0;
    min-height: var(--touch);
    padding: 0 12px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-strong);
    background: var(--bg);
    user-select: text;
    -webkit-user-select: text;
  }

  input[aria-invalid='true'] {
    border-color: var(--danger);
  }

  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-height: var(--touch);
    padding: 0 16px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-strong);
    background: var(--surface-3);
    font-weight: 600;
    white-space: nowrap;
  }

  .btn.primary {
    border-color: transparent;
    background: var(--accent-gradient);
    color: #06080c;
  }

  .btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .col .btn {
    align-self: flex-start;
  }

  .note {
    margin: 0;
    color: var(--text-dim);
    font-size: var(--fs-sm);
  }

  .scenarios {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 6px;
  }

  .chip {
    min-height: var(--touch);
    padding: 0 6px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: rgba(255, 255, 255, 0.03);
    color: var(--text-2);
    font-size: var(--fs-sm);
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .chip[aria-checked='true'] {
    color: var(--text);
    border-color: color-mix(in srgb, var(--purple) 60%, transparent);
    background: var(--purple-soft);
  }

  .sensors {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 2px;
  }

  .sensors li {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    padding: 5px 0;
    border-bottom: 1px solid var(--border);
    font-size: var(--fs-sm);
    color: var(--text-2);
  }

  .about {
    margin: 0;
    font-size: var(--fs-xs);
    color: var(--text-dim);
  }
</style>

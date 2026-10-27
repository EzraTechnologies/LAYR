<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import { isValidMoonrakerUrl, type AppConfig } from '../lib/config';
  import { app } from '../lib/context';
  import { formatTemp } from '../lib/format';
  import { DIM_OPTIONS } from '../lib/settings.svelte';

  interface Props {
    onSaveUrl: (url: string | null) => void;
  }

  let { onSaveUrl }: Props = $props();
  const { store, ui, config, printer, settings } = app();
  const printerState = store.state;

  // svelte-ignore state_referenced_locally
  let urlDraft = $state(printer.moonrakerUrl ?? '');
  const urlValid = $derived(isValidMoonrakerUrl(urlDraft));
  const changed = $derived(urlDraft.trim() !== (printer.moonrakerUrl ?? ''));

  const SOURCE_LABEL: Record<AppConfig['urlSource'], string> = {
    query: 'URL parameter',
    storage: 'Saved on this device',
    env: 'Build configuration',
    none: 'Not set up',
  };

  async function editUrl() {
    const value = await ui.prompt({
      title: 'Moonraker URL',
      value: urlDraft || config.suggestedUrl,
      mode: 'url',
      placeholder: 'http://printer.local:7125',
      hint: 'Usually http://localhost:7125 on the printer’s own screen.',
      submitLabel: 'Done',
      validate: (v) => (isValidMoonrakerUrl(v) ? null : 'Enter an http:// or https:// address'),
    });
    if (value !== null) urlDraft = value.trim();
  }

  const effectiveName = $derived(settings.value.displayName.trim() || printerState.hostname || printerState.printerName);

  async function editName() {
    const value = await ui.prompt({
      title: 'Printer Name',
      value: settings.value.displayName,
      mode: 'text',
      placeholder: printerState.hostname || 'Voron Trident',
      hint: 'Shown in the top bar. This does not change the Linux hostname.',
      submitLabel: 'Save',
      validate: (v) => {
        const name = v.trim();
        if (name.length > 32) return 'Use 32 characters or fewer';
        if (/[\u0000-\u001f]/.test(name)) return 'Remove line breaks';
        return null;
      },
    });
    if (value === null) return;
    settings.update({ displayName: value.trim() });
  }

  const allSensors = $derived(
    [printerState.extruder, printerState.bed, printerState.chamber, ...printerState.sensors].filter((s) => s !== null),
  );
  const klippyReachable = $derived(
    printerState.transport === 'connected' && printerState.klippy !== 'disconnected' && printerState.klippy !== 'unknown',
  );
</script>

<div class="settings page scroll">
  <section class="card panel" aria-labelledby="set-conn">
    <h2 id="set-conn" class="eyebrow">Connection</h2>
    <dl>
      <div><dt>Moonraker</dt><dd title={printer.moonrakerUrl ?? ''}>{printer.moonrakerUrl ?? 'Not set up'}</dd></div>
      <div><dt>Source</dt><dd>{SOURCE_LABEL[config.urlSource]}</dd></div>
      <div><dt>Transport</dt><dd>{printerState.transport}</dd></div>
      <div><dt>Klipper</dt><dd>{printerState.klippy}</dd></div>
      <div><dt>Host</dt><dd>{printerState.hostname ?? '—'}</dd></div>
      <div><dt>Auth</dt><dd>{printer.apiKey ? 'API key (build setting)' : 'Trusted client'}</dd></div>
      {#if printerState.missingObjects.length > 0}
        <div><dt>Missing</dt><dd title={printerState.missingObjects.join(', ')}>{printerState.missingObjects.join(', ')}</dd></div>
      {/if}
    </dl>

    <div class="url">
      <span class="label" id="url-label">Moonraker URL</span>
      <button type="button" class="btn ghost url-field" aria-labelledby="url-label" onclick={editUrl}>
        <span class="url-text" class:placeholder={!urlDraft} title={urlDraft}>{urlDraft || 'Tap to enter an address'}</span>
      </button>
      <div class="row">
        <button type="button" class="btn primary" disabled={!urlValid || !changed} onclick={() => onSaveUrl(urlDraft.trim())}>
          Save &amp; connect
        </button>
        {#if urlDraft !== config.suggestedUrl}
          <button type="button" class="btn" onclick={() => (urlDraft = config.suggestedUrl)} title={config.suggestedUrl}>
            Use this device
          </button>
        {/if}
        {#if config.urlSource === 'storage'}
          <button type="button" class="btn ghost" onclick={() => onSaveUrl(null)}>Forget</button>
        {/if}
      </div>
      {#if store.configured}
        <button type="button" class="btn ghost" onclick={() => store.source.connection?.reconnect()}>
          <Icon name="refresh" size={18} />Reconnect now
        </button>
      {/if}
    </div>
  </section>

  <div class="col">
    <section class="card panel" aria-labelledby="set-display">
      <h2 id="set-display" class="eyebrow">Display</h2>
      <span class="label">Dim screen after</span>
      <div class="seg" role="radiogroup" aria-label="Dim screen after">
        {#each DIM_OPTIONS as minutes (minutes)}
          <button
            type="button"
            role="radio"
            aria-checked={settings.value.dimAfterMinutes === minutes}
            onclick={() => settings.update({ dimAfterMinutes: minutes })}
          >
            {minutes === 0 ? 'Never' : `${minutes} min`}
          </button>
        {/each}
      </div>
      <span class="label">Theme</span>
      <div class="seg" role="radiogroup" aria-label="Theme">
        <button type="button" role="radio" aria-checked={settings.value.theme === 'midnight'} onclick={() => settings.update({ theme: 'midnight' })}
          >Midnight</button
        >
        <button type="button" role="radio" aria-checked={settings.value.theme === 'black'} onclick={() => settings.update({ theme: 'black' })}
          >True black</button
        >
      </div>
      <span class="label" id="name-label">Printer Name</span>
      <button type="button" class="btn ghost url-field" aria-labelledby="name-label" onclick={editName}>
        <span class="url-text" class:placeholder={!settings.value.displayName} title={effectiveName}>
          {settings.value.displayName || effectiveName}
        </span>
      </button>
      <p class="hint">Shown in the top bar. Empty uses the Klipper host name. This does not rename the Linux host.</p>
      {#if settings.value.displayName}
        <button type="button" class="btn ghost" onclick={() => settings.update({ displayName: '' })}>Use host name</button>
      {/if}
      <div class="toggles">
        <button
          type="button"
          class="btn ghost toggle"
          role="switch"
          aria-checked={settings.value.onScreenKeyboard}
          onclick={() => settings.update({ onScreenKeyboard: !settings.value.onScreenKeyboard })}
        >
          <span class="switch" aria-hidden="true"></span>Touch keyboard
        </button>
        <button
          type="button"
          class="btn ghost toggle"
          role="switch"
          aria-checked={settings.value.hideCursor}
          onclick={() => settings.update({ hideCursor: !settings.value.hideCursor })}
        >
          <span class="switch" aria-hidden="true"></span>Hide pointer
        </button>
      </div>
      <p class="hint">Dimming darkens the screen; it does not switch the backlight off. The first tap only wakes it.</p>
      <p class="hint">Hide pointer clears the arrow in this browser immediately. On the Cage kiosk it also applies the next time the display starts, without restarting Klipper. A mouse still clicks.</p>
    </section>

    <section class="card panel" aria-labelledby="set-printer">
      <h2 id="set-printer" class="eyebrow">Klipper</h2>
      <div class="row">
        <button
          type="button"
          class="btn warn"
          disabled={!klippyReachable}
          aria-busy={ui.isBusy({ kind: 'restart' })}
          onclick={() => ui.run({ kind: 'restart' })}
        >
          <Icon name="power" size={18} />Restart
        </button>
        <button
          type="button"
          class="btn warn"
          disabled={!klippyReachable}
          aria-busy={ui.isBusy({ kind: 'firmware_restart' })}
          onclick={() => ui.run({ kind: 'firmware_restart' })}
        >
          <Icon name="refresh" size={18} />Firmware restart
        </button>
      </div>
      {#if allSensors.length > 0}
        <ul class="sensors">
          {#each allSensors as sensor (sensor.object)}
            <li>
              <span title={sensor.object}>{sensor.label}</span>
              <span class="num">{formatTemp(sensor.temperature)}°C</span>
            </li>
          {/each}
        </ul>
      {/if}
      <p class="about">LAYR v{__LAYR_VERSION__}</p>
    </section>
  </div>
</div>

<style>
  .settings {
    display: grid;
    grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
    gap: var(--gap);
    align-items: start;
  }

  .col {
    display: grid;
    gap: var(--gap);
    min-width: 0;
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
    padding: 4px 0;
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

  .url {
    display: grid;
    gap: 8px;
  }

  .label {
    font-size: var(--fs-sm);
    color: var(--text-2);
    font-weight: 600;
  }

  .url-field {
    justify-content: flex-start;
    min-width: 0;
    background: var(--bg);
  }

  .url-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 500;
  }

  .url-text.placeholder {
    color: var(--text-dim);
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .toggles {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
    gap: 8px;
  }

  .toggle {
    justify-content: flex-start;
    min-width: 0;
    padding: 0 10px;
  }

  .switch {
    position: relative;
    flex: none;
    width: 36px;
    height: 22px;
    border-radius: 11px;
    background: var(--surface-3);
    border: 1px solid var(--border-strong);
  }

  .switch::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--text-dim);
    transition: transform 120ms ease;
  }

  .toggle[aria-checked='true'] .switch {
    background: var(--cyan-soft);
    border-color: color-mix(in srgb, var(--cyan) 50%, transparent);
  }

  .toggle[aria-checked='true'] .switch::after {
    transform: translateX(14px);
    background: var(--cyan);
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
    padding: 4px 0;
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

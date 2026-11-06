<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import PrinterImageChooser from '../components/PrinterImageChooser.svelte';
  import SponsorDialog from '../components/SponsorDialog.svelte';
  import { isValidMoonrakerUrl, type AppConfig } from '../lib/config';
  import { app } from '../lib/context';
  import { discoverIntegrations } from '../lib/integrations/discover';
  import {
    changerExclusivityNote,
    integrationPresence,
    integrationStatusText,
    type IntegrationDiscovery,
    type IntegrationId,
  } from '../lib/integrations/preferences';
  import { integrations } from '../lib/integrations/store.svelte';
  import { formatTemp } from '../lib/format';
  import { HOST_UNAUTHORIZED_MESSAGE, HOST_UNSUPPORTED_MESSAGE, type HostRefusal } from '../lib/moonraker/host';
  import { DIM_OPTIONS, FILES_VIEW_OPTIONS } from '../lib/settings.svelte';

  interface Props {
    onSaveUrl: (url: string | null) => void;
  }

  let { onSaveUrl }: Props = $props();
  let showSponsors = $state(false);
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

  const INTEGRATIONS: Array<{ id: IntegrationId; label: string }> = [
    { id: 'spoolman', label: 'Spoolman' },
    { id: 'happyHare', label: 'Happy Hare' },
    { id: 'afc', label: 'AFC' },
  ];

  let discovery = $state<IntegrationDiscovery | null>(null);
  let discoveryPending = $state(false);
  const anyIntegration = $derived(integrations.value.spoolman || integrations.value.happyHare || integrations.value.afc);
  const printerReady = $derived(printerState.transport === 'connected' && printerState.klippy === 'ready');
  const jobBusy = $derived(printerState.status === 'printing' || printerState.status === 'paused');

  function integrationStatus(id: IntegrationId): string {
    const failed = id === 'spoolman' && (discovery?.failedComponents?.includes('spoolman') ?? false);
    return integrationStatusText({
      enabled: integrations.value[id],
      connected: printerReady,
      presence: integrationPresence(id, discovery),
      pending: discoveryPending && discovery === null,
      failed,
    });
  }

  $effect(() => {
    if (!anyIntegration || !printerReady) {
      discovery = null;
      discoveryPending = false;
      return;
    }
    const connection = store.source.connection;
    if (!connection) return;
    discoveryPending = true;
    let cancelled = false;
    void discoverIntegrations((method, params) => connection.call(method, params)).then((found) => {
      if (cancelled) return;
      discovery = found;
      discoveryPending = false;
    });
    return () => {
      cancelled = true;
    };
  });

  const allSensors = $derived(
    [printerState.extruder, printerState.bed, printerState.chamber, ...printerState.sensors].filter((s) => s !== null),
  );
  const klippyReachable = $derived(
    printerState.transport === 'connected' && printerState.klippy !== 'disconnected' && printerState.klippy !== 'unknown',
  );

  const rebootCommand = { kind: 'host_reboot' } as const;
  const shutdownCommand = { kind: 'host_shutdown' } as const;
  const rebootCheck = $derived(ui.gateway.availability(rebootCommand));
  const shutdownCheck = $derived(ui.gateway.availability(shutdownCommand));
  let hostRefusal = $state<{ key: string; reason: HostRefusal } | null>(null);
  const refusalKey = $derived(`${printerState.printerId}:${printerState.transport}`);
  const activeRefusal = $derived(hostRefusal && hostRefusal.key === refusalKey ? hostRefusal.reason : null);
  const hostBlock = $derived(
    activeRefusal === 'unauthorized'
      ? HOST_UNAUTHORIZED_MESSAGE
      : activeRefusal === 'unsupported'
        ? HOST_UNSUPPORTED_MESSAGE
        : !rebootCheck.allowed
          ? rebootCheck.message
          : null,
  );
  const hostBusy = $derived(ui.isBusy(rebootCommand) || ui.isBusy(shutdownCommand));

  async function runHost(command: typeof rebootCommand | typeof shutdownCommand) {
    const outcome = await ui.run(command);
    if (outcome.status === 'failed' && outcome.reason) hostRefusal = { key: refusalKey, reason: outcome.reason };
  }
</script>

<div class="settings page scroll">
  <div class="col">
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

    <section class="card panel" aria-labelledby="set-printer">
      <h2 id="set-printer" class="eyebrow">Klipper</h2>
      <p class="hint">Klipper only. This does not reboot the Raspberry Pi or cut printer power.</p>
      <div class="row">
        <button
          type="button"
          class="btn warn"
          disabled={!klippyReachable}
          aria-busy={ui.isBusy({ kind: 'restart' })}
          onclick={() => ui.run({ kind: 'restart' })}
        >
          <Icon name="power" size={18} />Restart Klipper
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
    </section>

    <section class="card panel" aria-labelledby="set-about">
      <h2 id="set-about" class="eyebrow">About LAYR</h2>
      <p class="hint">LAYR v{__LAYR_VERSION__} · GNU GPLv3 · Developed by Ezra Technologies.</p>
      <p class="hint">Free and open-source, supported by the community. Sponsorship is entirely voluntary.</p>
      <button type="button" class="btn ghost" onclick={() => (showSponsors = true)}>
        Support LAYR Development
      </button>
    </section>

    <section class="card panel" aria-labelledby="set-pi">
      <h2 id="set-pi" class="eyebrow">Raspberry Pi</h2>
      <p class="hint">
        Host {printerState.hostname ?? 'not reported'}. Reboot and shut down the Raspberry Pi running Moonraker. This is not a Klipper
        firmware restart and it does not switch off the printer power supply.
      </p>
      {#if hostBlock}
        <p class="hint warn" id="pi-block" role="status">{hostBlock}</p>
      {/if}
      {#if hostBusy}
        <p class="hint" role="status">Waiting for Moonraker. This is not yet a confirmed reboot or shutdown.</p>
      {/if}
      <div class="host-actions">
        <button
          type="button"
          class="btn warn host-btn"
          disabled={!rebootCheck.allowed || activeRefusal !== null}
          aria-busy={ui.isBusy(rebootCommand)}
          aria-describedby={hostBlock ? 'pi-block' : undefined}
          onclick={() => runHost(rebootCommand)}
        >
          <Icon name="refresh" size={22} />Reboot Raspberry Pi
        </button>
        <button
          type="button"
          class="btn danger host-btn"
          disabled={!shutdownCheck.allowed || activeRefusal !== null}
          aria-busy={ui.isBusy(shutdownCommand)}
          aria-describedby={hostBlock ? 'pi-block' : undefined}
          onclick={() => runHost(shutdownCommand)}
        >
          <Icon name="power" size={22} />Shut down Raspberry Pi
        </button>
      </div>
    </section>
  </div>

  <div class="col">
    <section class="card panel" aria-labelledby="set-integrations">
      <h2 id="set-integrations" class="eyebrow">Integrations</h2>
      <p class="hint">
        Off until you turn one on. Saved for this printer only. Spoolman can stay on with either changer, or with both off.
      </p>
      <div class="integrations" role="group" aria-labelledby="set-integrations">
        {#each INTEGRATIONS as item (item.id)}
          {@const status = integrationStatus(item.id)}
          <div class="integration">
            <button
              type="button"
              class="btn ghost toggle"
              role="switch"
              data-integration={item.id}
              aria-checked={integrations.value[item.id]}
              aria-label={`${item.label}. ${status}`}
              onclick={() => integrations.set(item.id, !integrations.value[item.id])}
            >
              <span class="switch" aria-hidden="true"></span>
              <span class="toggle-name">{item.label}</span>
            </button>
            <p class="hint integration-status">{status}</p>
          </div>
        {/each}
      </div>
      <p class="hint">{changerExclusivityNote(integrations.value)}</p>
      <p class="hint">Turning a switch does not move the printer or edit Klipper. A feature appears only after it is on and this printer reports it.</p>
      {#if jobBusy}
        <p class="hint">A print is active. These switches only change what LAYR shows. They do not pause or move the printer.</p>
      {/if}
    </section>

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
      <span class="label">Files</span>
      <div class="seg" role="radiogroup" aria-label="File browsing">
        {#each FILES_VIEW_OPTIONS as mode (mode.id)}
          <button
            type="button"
            role="radio"
            aria-checked={settings.value.filesViewMode === mode.id}
            onclick={() => settings.update({ filesViewMode: mode.id })}
          >
            {mode.label}
          </button>
        {/each}
      </div>
      <p class="hint">Saved on this device. Thumbnails shows the current directory as cards.</p>
      <PrinterImageChooser />
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
  </div>
</div>

{#if showSponsors}
  <SponsorDialog onClose={() => (showSponsors = false)} />
{/if}

<style>
  /* Independent stacks. One shared grid row would grow to the taller side and leave a hole under Connection. */
  .settings {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: var(--gap);
    align-items: start;
    align-content: start;
  }

  .col {
    display: flex;
    flex-direction: column;
    gap: var(--gap);
    min-width: 0;
  }

  .col > .panel {
    flex: none;
  }

  /* Full-width in the column so reboot and shutdown stay easy to hit and distinct from the Klipper pair. */
  .host-actions {
    display: grid;
    grid-template-columns: 1fr;
    gap: 10px;
  }

  .host-btn {
    width: 100%;
    min-height: 64px;
    white-space: normal;
    line-height: 1.25;
    padding: 8px 14px;
    font-size: var(--fs-md);
  }

  @media (max-width: 640px) {
    .settings {
      grid-template-columns: minmax(0, 1fr);
    }
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

  .integrations {
    display: grid;
    gap: 8px;
  }

  .integration {
    display: grid;
    gap: 2px;
    min-width: 0;
  }

  .integrations .toggle {
    width: 100%;
  }

  .toggle-name {
    min-width: 0;
  }

  .integration-status {
    padding-left: 2px;
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

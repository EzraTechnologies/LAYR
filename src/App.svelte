<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import NavRail from './components/NavRail.svelte';
  import TopBar from './components/TopBar.svelte';
  import { activePrinter, STORAGE_URL_KEY, type AppConfig } from './lib/config';
  import { DemoSource } from './lib/demo/demoSource';
  import type { DemoScenarioId } from './lib/demo/scenarios';
  import { createSourceBundle } from './lib/printer/createSource';
  import { PrinterStore } from './lib/printer/store.svelte';
  import { parseRoute, type RouteId } from './lib/routes';
  import Dashboard from './views/Dashboard.svelte';
  import Placeholder from './views/Placeholder.svelte';
  import Settings from './views/Settings.svelte';

  interface Props {
    config: AppConfig;
  }

  let { config }: Props = $props();

  // svelte-ignore state_referenced_locally
  const printer = activePrinter(config);
  // svelte-ignore state_referenced_locally
  const bundle = createSourceBundle(config);
  const store = new PrinterStore(bundle.source, bundle.commands, printer.name);
  const printerState = store.state;
  const demo = store.isDemo;
  // Demo renders in UTC so screenshots are identical on every machine.
  const timeZone = demo ? 'UTC' : undefined;

  // svelte-ignore state_referenced_locally
  let demoScenario = $state<DemoScenarioId | null>(config.demo);
  let route = $state<RouteId>(parseRoute(location.hash));

  function onHashChange() {
    route = parseRoute(location.hash);
  }

  onMount(() => {
    window.addEventListener('hashchange', onHashChange);
    store.start();
  });

  onDestroy(() => {
    window.removeEventListener('hashchange', onHashChange);
    store.stop();
  });

  function setScenario(id: DemoScenarioId) {
    if (!(bundle.source instanceof DemoSource)) return;
    bundle.source.setScenario(id);
    demoScenario = id;
    const url = new URL(location.href);
    url.searchParams.set('demo', id);
    history.replaceState(null, '', url);
  }

  function saveUrl(url: string | null) {
    try {
      if (url) localStorage.setItem(STORAGE_URL_KEY, url);
      else localStorage.removeItem(STORAGE_URL_KEY);
    } catch {
      // Storage can be unavailable in locked-down kiosk profiles; the URL parameter still works.
    }
    const next = new URL(location.href);
    next.searchParams.delete('moonraker');
    location.assign(next);
  }

  function setDemoMode(enabled: boolean) {
    const next = new URL(location.href);
    next.searchParams.set('demo', enabled ? 'printing' : 'off');
    next.hash = '#/home';
    location.assign(next);
  }
</script>

<div class="app" class:is-demo={demo}>
  <NavRail current={route} />
  <TopBar {printerState} {demo} {timeZone} />

  <main class="content" id="main">
    {#if route === 'home'}
      <Dashboard {printerState} commands={store.commands} moonrakerUrl={printer.moonrakerUrl} {demo} {timeZone} />
    {:else if route === 'files'}
      <Placeholder
        title="Files"
        icon="files"
        summary="Browse G-code stored on the printer."
        planned={[
          'File list with thumbnails, slicer estimates and filament use',
          'Sort by name, date or print time',
          'Start a print only after an explicit confirmation step',
        ]}
        safety="Starting prints is disabled in v0.1."
      />
    {:else if route === 'controls'}
      <Placeholder
        title="Controls"
        icon="controls"
        summary="Motion, temperature and fan controls."
        planned={[
          'Home and jog axes with selectable step sizes',
          'Temperature presets for nozzle and bed',
          'Pause, resume and cancel with confirmation',
        ]}
        safety={demo ? 'Demo mode: printer actions are disabled.' : 'No G-code is sent by LAYR v0.1.'}
      />
    {:else if route === 'filament'}
      <Placeholder
        title="Filament"
        icon="filament"
        summary="Load, unload and track spools."
        planned={[
          'Guided load and unload routines',
          'Spoolman: browse available spools and select the active spool',
          'Clear the active spool only after a confirmed successful unload',
        ]}
        safety="Spoolman integration is not enabled in v0.1."
      />
    {:else if route === 'settings'}
      <Settings
        {printerState}
        {config}
        {printer}
        {demoScenario}
        onScenario={setScenario}
        onSaveUrl={saveUrl}
        onDemoMode={setDemoMode}
      />
    {/if}
  </main>
</div>

<style>
  .app {
    height: 100%;
    display: grid;
    grid-template-columns: var(--rail-w) minmax(0, 1fr);
    grid-template-rows: var(--bar-h) minmax(0, 1fr);
    min-height: 0;
  }

  .content {
    padding: var(--pad);
    min-height: 0;
    min-width: 0;
    overflow: hidden;
  }

  /* A purple accent along the top edge makes demo mode recognisable even in cropped screenshots. */
  .is-demo {
    box-shadow: inset 0 3px 0 0 var(--purple);
  }
</style>

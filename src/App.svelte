<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import ConfirmDialog from './components/ConfirmDialog.svelte';
  import DimOverlay from './components/DimOverlay.svelte';
  import NavRail from './components/NavRail.svelte';
  import PromptSheet from './components/PromptSheet.svelte';
  import Toasts from './components/Toasts.svelte';
  import TopBar from './components/TopBar.svelte';
  import { activePrinter, STORAGE_URL_KEY, type AppConfig } from './lib/config';
  import { ConsoleLog } from './lib/console/console.svelte';
  import { setApp } from './lib/context';
  import { FileBrowser } from './lib/files/browser.svelte';
  import { integrations } from './lib/integrations/store.svelte';
  import { createSource } from './lib/printer/createSource';
  import { PrinterStore } from './lib/printer/store.svelte';
  import { navigate, parseRoute, type RouteId } from './lib/routes';
  import { SettingsStore } from './lib/settings.svelte';
  import { SpoolmanLive } from './lib/spoolman/live.svelte';
  import { Ui } from './lib/ui.svelte';
  import Console from './views/Console.svelte';
  import Dashboard from './views/Dashboard.svelte';
  import Extrude from './views/Extrude.svelte';
  import Fans from './views/Fans.svelte';
  import Files from './views/Files.svelte';
  import Heat from './views/Heat.svelte';
  import Macros from './views/Macros.svelte';
  import Mmu from './views/Mmu.svelte';
  import Move from './views/Move.svelte';
  import Settings from './views/Settings.svelte';
  import { integrationRouteHidden } from './lib/integrations/preferences';

  interface Props {
    config: AppConfig;
  }

  let { config }: Props = $props();

  // svelte-ignore state_referenced_locally
  const printer = activePrinter(config);
  // svelte-ignore state_referenced_locally
  const store = new PrinterStore(createSource(config), printer.name);
  const connection = store.source.connection;
  const consoleLog = new ConsoleLog(connection);
  const files = new FileBrowser(connection);
  const ui = new Ui(store.commands, consoleLog);
  const settings = new SettingsStore();
  const spoolman = new SpoolmanLive(printer, connection, store.commands, (confirm) => ui.confirm(confirm));

  // svelte-ignore state_referenced_locally
  setApp({ config, printer, store, ui, files, console: consoleLog, settings, spoolman, consoleDraft: { value: '' } });

  let route = $state<RouteId>(parseRoute(location.hash));

  function onHashChange() {
    route = parseRoute(location.hash);
  }

  $effect(() => {
    const root = document.documentElement;
    root.classList.toggle('theme-black', settings.value.theme === 'black');
    root.classList.toggle('hide-cursor', settings.value.hideCursor);
  });

  $effect(() => {
    if (integrationRouteHidden(route, integrations.value)) navigate('home');
  });

  onMount(() => {
    window.addEventListener('hashchange', onHashChange);
    store.start();
  });

  $effect(() => {
    if (integrations.value.spoolman) spoolman.start(connection);
    else spoolman.stop();
    return () => spoolman.stop();
  });

  onDestroy(() => {
    window.removeEventListener('hashchange', onHashChange);
    spoolman.stop();
    store.stop();
    files.dispose();
    consoleLog.dispose();
  });

  function saveUrl(url: string | null) {
    try {
      if (url) localStorage.setItem(STORAGE_URL_KEY, url);
      else localStorage.removeItem(STORAGE_URL_KEY);
    } catch {
      // Storage can be unavailable in locked-down kiosk profiles; the URL parameter still works.
    }
    const next = new URL(location.href);
    next.searchParams.delete('moonraker');
    next.hash = '#/home';
    // A hash-only change would not reload; the new endpoint needs a fresh source and connection.
    history.replaceState(null, '', next);
    location.reload();
  }
</script>

<div class="app">
  <NavRail current={route} />
  <TopBar />

  <main class="content" id="main">
    {#if route === 'home'}
      <Dashboard />
    {:else if route === 'files'}
      <Files />
    {:else if route === 'move'}
      <Move />
    {:else if route === 'heat'}
      <Heat />
    {:else if route === 'extrude'}
      <Extrude />
    {:else if route === 'fans'}
      <Fans />
    {:else if route === 'macros'}
      <Macros />
    {:else if route === 'mmu'}
      <Mmu />
    {:else if route === 'console'}
      <Console />
    {:else if route === 'settings'}
      <Settings onSaveUrl={saveUrl} />
    {/if}
  </main>
</div>

<Toasts />
<PromptSheet />
<ConfirmDialog />
<DimOverlay />

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
</style>

<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import { app } from '../lib/context';
  import type { MacroInfo } from '../lib/printer/model';
  import { navigate } from '../lib/routes';

  const { store, ui, settings, consoleDraft } = app();
  const printerState = store.state;
  const ready = $derived(printerState.transport === 'connected' && printerState.klippy === 'ready');

  let query = $state('');

  const visible = $derived.by(() => {
    const q = query.trim().toUpperCase();
    return printerState.macros.filter(
      (m) => (settings.value.showHiddenMacros || !m.hidden) && (!q || m.name.includes(q) || m.description?.toUpperCase().includes(q)),
    );
  });
  const hiddenCount = $derived(printerState.macros.filter((m) => m.hidden).length);

  async function search() {
    const value = await ui.prompt({ title: 'Search macros', value: query, mode: 'gcode', placeholder: 'e.g. LIGHT', submitLabel: 'Search' });
    if (value !== null) query = value;
  }

  function run(macro: MacroInfo) {
    if (macro.requiredParams.length > 0) {
      // Never send a macro without its required values; let the user complete them in the console.
      consoleDraft.value = `${macro.name} ${macro.requiredParams.map((p) => `${p}=`).join(' ')}`;
      navigate('console');
      return;
    }
    void ui.run({ kind: 'macro', name: macro.name });
  }
</script>

<div class="macros page">
  <header class="toolbar">
    <button type="button" class="btn ghost search" onclick={search} aria-label="Search macros">
      <Icon name="search" size={18} />
      <span class="query" class:placeholder={!query} title={query}>{query || 'Search macros'}</span>
    </button>
    {#if query}
      <button type="button" class="btn ghost icon" aria-label="Clear search" onclick={() => (query = '')}>
        <Icon name="close" size={18} />
      </button>
    {/if}
    {#if hiddenCount > 0}
      <button
        type="button"
        class="btn ghost"
        aria-pressed={settings.value.showHiddenMacros}
        onclick={() => settings.update({ showHiddenMacros: !settings.value.showHiddenMacros })}
      >
        <Icon name="eye" size={18} />{settings.value.showHiddenMacros ? 'Hide' : 'Show'} internal ({hiddenCount})
      </button>
    {/if}
  </header>

  <div class="card list-wrap">
    {#if !ready}
      <div class="empty fill"><Icon name="plug" size={30} /><strong>Printer is offline</strong></div>
    {:else if printerState.macros.length === 0}
      <div class="empty fill"><Icon name="bolt" size={30} /><strong>No macros configured</strong><span>Add [gcode_macro] sections to your Klipper config.</span></div>
    {:else if visible.length === 0}
      <div class="empty fill"><Icon name="search" size={30} /><strong>No macros match “{query}”</strong></div>
    {:else}
      <ul class="grid scroll" aria-label="Macros">
        {#each visible as macro (macro.name)}
          <li>
            <button
              type="button"
              class="macro"
              class:hidden-macro={macro.hidden}
              aria-busy={ui.isBusy({ kind: 'macro', name: macro.name })}
              onclick={() => run(macro)}
            >
              <span class="name" title={macro.name}>{macro.name}</span>
              <span class="desc" title={macro.description ?? ''}>
                {#if macro.requiredParams.length > 0}
                  <Icon name="terminal" size={13} />Needs {macro.requiredParams.join(', ')}
                {:else}
                  {macro.description ?? (macro.params.length ? `Optional: ${macro.params.join(', ')}` : 'Tap to run')}
                {/if}
              </span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
  <p class="hint">Every macro asks for confirmation. Macros that need parameters open in the console so you can enter values first.</p>
</div>

<style>
  .macros {
    display: flex;
    flex-direction: column;
    gap: var(--gap);
  }

  .toolbar {
    display: flex;
    gap: 8px;
    min-width: 0;
  }

  .search {
    flex: 1;
    justify-content: flex-start;
    min-width: 0;
  }

  .query {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .placeholder {
    color: var(--text-dim);
    font-weight: 500;
  }

  .icon {
    padding: 0;
    width: var(--touch);
  }

  .list-wrap {
    flex: 1;
    min-height: 0;
    display: flex;
    overflow: hidden;
  }

  .fill {
    flex: 1;
  }

  .grid {
    list-style: none;
    margin: 0;
    padding: 8px;
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
    grid-auto-rows: min-content;
    gap: 8px;
  }

  .macro {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 3px;
    width: 100%;
    min-height: 64px;
    padding: 10px 12px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-strong);
    background: linear-gradient(180deg, var(--surface-3), var(--surface-2));
    text-align: left;
  }

  .macro:active {
    border-color: color-mix(in srgb, var(--cyan) 50%, transparent);
  }

  .macro[aria-busy='true'] {
    border-color: var(--cyan);
  }

  .hidden-macro {
    border-style: dashed;
  }

  .name {
    max-width: 100%;
    font-weight: 700;
    font-size: var(--fs-sm);
    letter-spacing: 0.02em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .desc {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    max-width: 100%;
    font-size: var(--fs-xs);
    color: var(--text-dim);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  @media (max-width: 900px), (max-height: 540px) {
    .grid {
      grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    }
    .macro {
      min-height: 56px;
      padding: 8px 10px;
    }
  }
</style>

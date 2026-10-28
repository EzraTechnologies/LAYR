<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import { app } from '../lib/context';
  import { UNLOAD_MACROS } from '../lib/filament';
  import { spoolMatches, spoolQuantityLine } from '../lib/spoolman/api';
  import { unloadMacro } from '../lib/spoolman/plan';
  import { absentHelp, activeSummary, spoolInCatalogue } from '../lib/spoolman/store.svelte';
  import type { SpoolSummary } from '../lib/spoolman/types';

  const { store, ui, spoolman } = app();
  const printerState = store.state;

  let search = $state('');
  let showArchived = $state(false);

  const facts = $derived(spoolman.facts);
  const active = $derived(activeSummary(spoolman.spools, facts));
  const activeInList = $derived(active !== null && spoolInCatalogue(spoolman.spools, active.id));
  const unload = $derived(unloadMacro(printerState.macros, UNLOAD_MACROS));
  const rows = $derived(
    spoolman.spools.filter((spool) => (showArchived || !spool.archived || spool.id === facts.activeId) && spoolMatches(spool, search)),
  );
  const setCommand = (spool: SpoolSummary) => ({ kind: 'set_active_spool' as const, spoolId: spool.id });
  const clearCommand = { kind: 'clear_active_spool' as const };
  const clearCheck = $derived(ui.gateway.availability(clearCommand));
  const unloadCommand = $derived(unload ? ({ kind: 'unload_for_spool_clear' as const, macro: unload.name }) : null);
  const unloadCheck = $derived(unloadCommand ? ui.gateway.availability(unloadCommand) : null);

  async function searchSpools() {
    const value = await ui.prompt({
      title: 'Search spools',
      value: search,
      mode: 'text',
      placeholder: 'Name, material, vendor, lot',
      submitLabel: 'Search',
    });
    if (value !== null) search = value.trim();
  }
</script>

<div class="spools page">
  <section class="card active" aria-labelledby="spool-active-title">
    <h2 id="spool-active-title" class="eyebrow">Active spool</h2>
    {#if facts.phase === 'loading' || (spoolman.refreshing && facts.phase !== 'ready')}
      <p class="hint">Reading Spoolman…</p>
    {:else if facts.phase === 'offline' || facts.phase === 'error' || facts.phase === 'stale'}
      <p class="hint warn"><Icon name="alert" size={16} />{facts.message}</p>
    {:else if facts.phase === 'absent' || facts.phase === 'unknown'}
      <p class="hint"><Icon name="info" size={16} />{absentHelp()}</p>
    {:else if active}
      <div class="active-row">
        <span class="swatch" style:background={active.colors[0] ?? 'transparent'} class:none={active.colors.length === 0} aria-hidden="true"></span>
        <div class="copy">
          <p class="name" title={active.name}>{active.name}</p>
          <p class="meta" title={[active.material, active.vendor].filter(Boolean).join(' · ')}>
            {[active.material, active.vendor].filter(Boolean).join(' · ') || 'Material not reported'}
          </p>
          <p class="meta" title={`${spoolQuantityLine(active)}${activeInList ? '' : ' · Not in the loaded list'}`}>
            {spoolQuantityLine(active)}{activeInList ? '' : ' · Not in the loaded list'}
          </p>
        </div>
      </div>
    {:else}
      <p class="hint">No active spool.</p>
    {/if}

    {#if facts.phase === 'ready'}
      <div class="actions">
        {#if unload && unloadCheck}
          <button
            type="button"
            class="btn warn"
            disabled={!unloadCheck.allowed}
            aria-busy={ui.isBusy(unloadCommand!)}
            onclick={() => spoolman.unloadAndClear(printerState.printerId, unload.name)}
          >
            <Icon name="unload" size={18} />Unload
          </button>
        {/if}
        <button
          type="button"
          class="btn"
          disabled={!clearCheck.allowed}
          aria-busy={ui.isBusy(clearCommand)}
          onclick={() => spoolman.clearActiveSpool(printerState.printerId).catch(() => {})}
        >
          Clear
        </button>
        <button type="button" class="btn ghost" aria-busy={spoolman.refreshing} onclick={() => spoolman.refresh()}>
          <Icon name="refresh" size={18} />Refresh
        </button>
      </div>
      {#if !clearCheck.allowed}
        <p class="hint warn">{clearCheck.message}</p>
      {:else if unload && unloadCheck && !unloadCheck.allowed}
        <p class="hint warn">{unloadCheck.message}</p>
      {:else}
        <p class="hint">
          {#if unload}
            Clear does not move filament. Unload runs {unload.name} and clears the spool only if Klipper accepts it.
          {:else}
            Clear does not move filament. No parameter-free unload macro was found, so an unload from here is not offered.
          {/if}
        </p>
      {/if}
    {:else}
      <button type="button" class="btn ghost" aria-busy={spoolman.refreshing} onclick={() => spoolman.refresh()}>
        <Icon name="refresh" size={18} />Refresh
      </button>
    {/if}
  </section>

  <section class="card list" aria-labelledby="spool-list-title">
    <div class="toolbar">
      <h2 id="spool-list-title" class="eyebrow">Inventory</h2>
      <button type="button" class="btn ghost" onclick={searchSpools}>
        <Icon name="search" size={18} />{search ? 'Edit search' : 'Search'}
      </button>
      <button type="button" class="btn ghost" aria-pressed={showArchived} onclick={() => (showArchived = !showArchived)}>
        Archive
      </button>
    </div>
    {#if search}
      <p class="hint">Search: {search} <button type="button" class="texty" onclick={() => (search = '')}>Clear</button></p>
    {/if}
    {#if facts.phase !== 'ready'}
      <p class="empty-note">No spool list while Spoolman is {facts.phase === 'absent' ? 'not configured' : facts.phase === 'offline' ? 'offline' : facts.phase === 'loading' ? 'loading' : 'unavailable'}.</p>
    {:else if rows.length === 0}
      <p class="empty-note">{spoolman.spools.length === 0 ? 'Spoolman returned no spools.' : 'No spools match.'}</p>
    {:else}
      <ul class="rows scroll">
        {#each rows as spool (spool.id)}
          {@const command = setCommand(spool)}
          {@const check = ui.gateway.availability(command)}
          <li class:current={spool.id === facts.activeId}>
            <span class="swatch" style:background={spool.colors[0] ?? 'transparent'} class:none={spool.colors.length === 0} aria-hidden="true"></span>
            <div class="copy">
              <p class="name" title={spool.name}>
                {spool.name}
                {#if spool.id === facts.activeId}<span class="badge">Active</span>{/if}
                {#if spool.archived}<span class="badge dim">Archived</span>{/if}
              </p>
              <p class="meta" title={[spool.material, spool.vendor, spool.location].filter(Boolean).join(' · ')}>
                {[spool.material, spool.vendor].filter(Boolean).join(' · ') || 'Material not reported'}
              </p>
              <p class="meta" title={spoolQuantityLine(spool)}>{spoolQuantityLine(spool)}</p>
            </div>
            <button
              type="button"
              class="btn cyan use"
              disabled={!check.allowed}
              aria-busy={ui.isBusy(command)}
              onclick={() => spoolman.setActiveSpool(printerState.printerId, spool.id).catch(() => {})}
            >
              Use
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</div>

<style>
  .spools {
    height: 100%;
    display: grid;
    grid-template-columns: minmax(240px, 0.85fr) minmax(0, 1.4fr);
    gap: var(--gap);
    min-height: 0;
  }

  .active,
  .list {
    min-height: 0;
    min-width: 0;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    overflow: hidden;
  }

  .active-row,
  .rows li {
    display: grid;
    grid-template-columns: 28px minmax(0, 1fr) auto;
    gap: 10px;
    align-items: center;
    min-width: 0;
  }

  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-height: 0;
  }

  .rows li {
    min-height: 58px;
    padding: 6px 8px;
    border-radius: var(--radius-sm);
    border: 1px solid transparent;
  }

  .rows li.current {
    border-color: color-mix(in srgb, var(--cyan) 55%, transparent);
    background: var(--cyan-soft);
  }

  .swatch {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.2);
  }

  .swatch.none {
    background: repeating-linear-gradient(135deg, var(--surface-3), var(--surface-3) 3px, var(--surface) 3px, var(--surface) 6px) !important;
  }

  .copy {
    min-width: 0;
  }

  .name,
  .meta {
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .name {
    font-weight: 650;
    font-size: var(--fs-sm);
  }

  .meta {
    color: var(--text-dim);
    font-size: var(--fs-xs);
  }

  .badge {
    margin-left: 6px;
    padding: 1px 6px;
    border-radius: 999px;
    font-size: 10px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--cyan);
    background: var(--cyan-soft);
  }

  .badge.dim {
    color: var(--text-dim);
    background: var(--surface-3);
  }

  .toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .toolbar .eyebrow {
    flex: 1;
    margin: 0;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .use {
    min-width: 64px;
  }

  .empty-note {
    margin: 0;
    color: var(--text-dim);
    font-size: var(--fs-sm);
  }

  .texty {
    min-height: 44px;
    min-width: 44px;
    padding: 0 8px;
    border: 0;
    background: transparent;
    color: var(--cyan);
    font-weight: 650;
  }

  @media (max-width: 900px), (max-height: 540px) {
    .spools {
      grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.2fr);
    }

    .active,
    .list {
      padding: 8px;
      gap: 6px;
    }

    .rows li {
      min-height: 52px;
      padding: 4px 6px;
    }
  }
</style>

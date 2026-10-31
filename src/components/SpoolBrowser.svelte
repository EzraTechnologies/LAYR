<script lang="ts">
  import { onDestroy } from 'svelte';
  import { app } from '../lib/context';
  import { cssColor, matchesSpool, materialText, quantityText, sortSpools } from '../lib/spoolman/api';
  import { SpoolmanCancelled } from '../lib/spoolman/session';
  import type { SpoolSummary } from '../lib/spoolman/types';
  import Icon from './Icon.svelte';

  interface Props {
    open: boolean;
    onClose: () => void;
    onSelected?: () => void;
  }

  let { open, onClose, onSelected }: Props = $props();

  const { ui, spoolman, store } = app();
  const printerState = store.state;

  let query = $state('');
  let choosing = $state(false);
  let disposed = false;
  onDestroy(() => { disposed = true; });
  let material = $state('');

  const locked = $derived(printerState.status === 'printing' || printerState.status === 'paused');
  const ready = $derived(spoolman.snapshot.phase === 'ready');
  const materials = $derived(
    [...new Set(spoolman.snapshot.spools.map((spool) => spool.material).filter((value): value is string => !!value))].sort().slice(0, 6),
  );
  const rows = $derived(
    sortSpools(
      spoolman.snapshot.spools.filter((spool) => matchesSpool(spool, query, material)),
      spoolman.snapshot.activeId,
    ),
  );

  function onKey(event: KeyboardEvent) {
    if (!open || event.key !== 'Escape') return;
    if (ui.confirmRequest || ui.promptRequest) return;
    onClose();
  }

  async function search() {
    const value = await ui.prompt({
      title: 'Find a spool',
      value: query,
      mode: 'text',
      placeholder: 'Name, material, or vendor',
      submitLabel: 'Search',
    });
    if (value === null) return;
    query = value.trim();
  }

  async function choose(spool: SpoolSummary) {
    if (choosing || locked || spool.archived || spool.id === spoolman.snapshot.activeId) return;
    choosing = true;
    try {
      await spoolman.select(spool, () => !disposed && open);
      if (disposed || !open) return;
      ui.toast('ok', `Active spool set to ${spool.name}`);
      if (spoolman.snapshot.phase === 'ready' && spoolman.snapshot.activeKnown && spoolman.snapshot.activeId === spool.id) onSelected?.();
      else if (onSelected) ui.toast('warn', 'Spool selection could not be verified', 'Refresh the catalogue before continuing.');
    } catch (error) {
      if (error instanceof SpoolmanCancelled) return;
      const message = error instanceof Error ? error.message : 'Spoolman did not accept the spool';
      ui.toast('error', 'Could not set the active spool', message);
    } finally {
      choosing = false;
    }
  }
</script>

<svelte:window onkeydown={onKey} />

{#if open}
  <div class="backdrop" role="presentation" onpointerdown={(event) => event.target === event.currentTarget && onClose()}>
    <div class="dialog card" role="dialog" aria-modal="true" aria-labelledby="spool-browse-title">
      <header>
        <h2 id="spool-browse-title">Spools</h2>
        <button type="button" class="btn ghost icon" aria-label="Close spools" onclick={onClose}>
          <Icon name="close" size={20} />
        </button>
      </header>

      <div class="tools">
        <button type="button" class="btn" onclick={search}>Search</button>
        <button type="button" class="btn" disabled={spoolman.snapshot.phase === 'loading'} onclick={() => spoolman.refresh()}>Refresh</button>
        {#if query}
          <button type="button" class="btn ghost" onclick={() => (query = '')}>Clear search</button>
        {/if}
      </div>

      {#if materials.length > 0}
        <div class="filters" role="radiogroup" aria-label="Material">
          <button type="button" role="radio" aria-checked={material === ''} onclick={() => (material = '')}>All</button>
          {#each materials as item (item)}
            <button type="button" role="radio" aria-checked={material === item} onclick={() => (material = item)}>{item}</button>
          {/each}
        </div>
      {/if}

      {#if locked}
        <p class="hint warn">Spool changes are locked while a print is running.</p>
      {:else if !ready}
        <p class="hint">{spoolman.snapshot.message || 'Spoolman has no catalogue to show.'}</p>
      {/if}

      {#if ready && rows.length === 0}
        <p class="hint">No spools match.</p>
      {/if}

      <ul aria-label="Spools">
        {#each rows as spool (spool.id)}
          {@const active = spool.id === spoolman.snapshot.activeId}
          {@const color = cssColor(spool.colorHex)}
          <li>
            <button
              type="button"
              class="row"
              class:active
              aria-current={active ? 'true' : undefined}
              disabled={choosing || !ready || locked || spool.archived || active}
              onclick={() => choose(spool)}
            >
              <span class="swatch" class:empty={!color} style:background={color ?? 'transparent'} aria-hidden="true"></span>
              <span class="copy">
                <strong title={spool.name}>{spool.name}</strong>
                <span title={`${materialText(spool)}. ${quantityText(spool)}`}>{materialText(spool)} · {quantityText(spool)}</span>
              </span>
              <em>{active ? 'Active' : spool.archived ? 'Archived' : 'Use'}</em>
            </button>
          </li>
        {/each}
      </ul>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 36;
    display: grid;
    place-items: center;
    padding: var(--pad);
    background: rgba(3, 4, 7, 0.72);
  }

  .dialog {
    width: min(640px, 100%);
    max-height: 100%;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: var(--pad);
    overflow: hidden;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-width: 0;
  }

  h2 {
    margin: 0;
    font-size: var(--fs-lg);
  }

  .icon {
    width: 44px;
    padding: 0;
  }

  .tools,
  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .filters button {
    min-height: 44px;
    min-width: 44px;
    padding: 0 12px;
    border-radius: 999px;
    border: 1px solid var(--border-strong);
    background: transparent;
    color: var(--text-2);
    font-weight: 650;
  }

  .filters button[aria-checked='true'] {
    color: var(--text);
    background: var(--cyan-soft);
    border-color: color-mix(in srgb, var(--cyan) 45%, transparent);
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-height: 0;
    overflow: auto;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    min-height: 52px;
    padding: 6px 10px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: var(--surface-2);
    color: inherit;
    text-align: left;
  }

  .row.active {
    border-color: color-mix(in srgb, var(--cyan) 55%, transparent);
  }

  .row:disabled {
    opacity: 0.72;
  }

  .swatch {
    flex: none;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    border: 1px solid var(--border-strong);
  }

  .swatch.empty {
    background: transparent !important;
    border-style: dashed;
  }

  .copy {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .copy strong,
  .copy span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .copy span,
  em {
    font-size: var(--fs-xs);
    font-style: normal;
    font-weight: 650;
    color: var(--text-dim);
  }

  em {
    flex: none;
  }
</style>

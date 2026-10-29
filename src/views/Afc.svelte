<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import { afcMotionLocked } from '../lib/afc/plan';
  import type { AfcLane } from '../lib/afc/types';
  import type { PrinterCommand } from '../lib/actions/commands';
  import { app } from '../lib/context';

  const { store, ui, gcodeHelp } = app();
  const printerState = store.state;

  const afc = $derived(printerState.afc);
  const help = $derived(gcodeHelp.names);
  const known = (name: string) => help?.includes(name) === true;
  const offline = $derived(printerState.transport !== 'connected' || printerState.klippy !== 'ready');
  const lock = $derived(afc ? afcMotionLocked(printerState) : null);

  const groups = $derived.by(() => {
    const map = new Map<string, AfcLane[]>();
    for (const lane of afc?.lanes ?? []) {
      const key = lane.unit ?? '';
      const list = map.get(key) ?? [];
      list.push(lane);
      map.set(key, list);
    }
    return [...map.entries()];
  });

  function laneMeta(lane: AfcLane): string {
    const parts = [lane.map, lane.material, lane.colorName, lane.filamentStatus].filter((part): part is string => !!part);
    return parts.length > 0 ? parts.join(' · ') : 'Details not reported';
  }

  function laneWeight(lane: AfcLane): string | null {
    if (lane.weightG === null) return null;
    const rounded = Math.round(lane.weightG * 10) / 10;
    return `${rounded} g`;
  }

  function laneCommand(lane: AfcLane): { command: PrinterCommand; label: string } | null {
    if (help === null) return null;
    if (known('CHANGE_TOOL')) return { command: { kind: 'afc_change_tool', lane: lane.name }, label: 'Change' };
    if (known('TOOL_LOAD')) return { command: { kind: 'afc_load', lane: lane.name }, label: 'Load' };
    return null;
  }

  const unloadLane = $derived(afc?.currentLoad && afc.lanes.some((lane) => lane.name === afc.currentLoad) ? afc.currentLoad : null);
  const unloadCommand = $derived<PrinterCommand>({ kind: 'afc_unload', lane: unloadLane });
  const clearCommand: PrinterCommand = { kind: 'afc_clear_message' };
</script>

<div class="afc page">
  <section class="card status scroll" aria-labelledby="afc-status-title">
    <h2 id="afc-status-title" class="eyebrow">AFC</h2>
    {#if !afc}
      <p class="hint">
        <Icon name="info" size={16} />
        {#if offline}
          AFC status is unavailable while the printer is offline.
        {:else}
          AFC is not installed on this printer.
        {/if}
      </p>
    {:else}
      <p class="line" title={afc.currentState ?? 'Not reported'}>State: {afc.currentState ?? 'Not reported'}</p>
      <p class="line" title={afc.currentLoad ?? 'Not reported'}>Loaded: {afc.currentLoad ?? 'Not reported'}</p>
      {#if afc.bypass !== null}
        <p class="line">Bypass: {afc.bypass ? 'On' : 'Off'}</p>
      {/if}
      {#if afc.units.length > 0}
        <p class="line" title={afc.units.join(', ')}>Units: {afc.units.join(', ')}</p>
      {/if}
      {#if afc.hubs.length > 0}
        <p class="line" title={afc.hubs.join(', ')}>Hubs: {afc.hubs.join(', ')}</p>
      {/if}
      {#if afc.error}
        <p class="hint warn"><Icon name="alert" size={16} />AFC is reporting an error.</p>
      {/if}
      {#if afc.message}
        <p class="hint warn" title={afc.message}><Icon name="alert" size={16} />{afc.message}</p>
      {/if}

      {#if help === null}
        <p class="hint">AFC commands have not been read yet.</p>
      {:else}
        <div class="actions">
          {#if known('TOOL_UNLOAD')}
            {@const check = ui.gateway.availability(unloadCommand)}
            <button
              type="button"
              class="btn warn"
              disabled={!check.allowed}
              aria-busy={ui.isBusy(unloadCommand)}
              onclick={() => ui.run(unloadCommand)}
            >
              Unload
            </button>
          {/if}
          {#if afc.message && known('AFC_CLEAR_MESSAGE')}
            {@const check = ui.gateway.availability(clearCommand)}
            <button
              type="button"
              class="btn"
              disabled={!check.allowed}
              aria-busy={ui.isBusy(clearCommand)}
              onclick={() => ui.run(clearCommand)}
            >
              Clear message
            </button>
          {/if}
        </div>
        {#if lock}
          <p class="hint warn">{lock}</p>
        {:else if !known('CHANGE_TOOL') && !known('TOOL_LOAD') && !known('TOOL_UNLOAD')}
          <p class="hint">This printer does not register AFC lane commands, so filament moves are not offered.</p>
        {:else}
          <p class="hint">Lane changes ask first and only run the AFC command this printer registers.</p>
        {/if}
      {/if}
    {/if}
  </section>

  <section class="card lanes" aria-labelledby="afc-lanes-title">
    <h2 id="afc-lanes-title" class="eyebrow">Lanes</h2>
    {#if !afc}
      <p class="empty-note">No lanes while AFC is {offline ? 'offline' : 'not installed'}.</p>
    {:else if afc.lanes.length === 0}
      <p class="empty-note">AFC did not report any lanes.</p>
    {:else}
      <div class="scroll">
        {#each groups as [unit, lanes] (unit)}
          {#if unit}
            <h3 class="unit" title={unit}>{unit}</h3>
          {/if}
          <ul class="rows">
            {#each lanes as lane (lane.name)}
              {@const action = laneCommand(lane)}
              {@const weight = laneWeight(lane)}
              {@const meta = laneMeta(lane)}
              <li class:current={afc.currentLoad === lane.name}>
                <span class="swatch" style:background={lane.color ?? 'transparent'} class:none={!lane.color} aria-hidden="true"></span>
                <div class="copy">
                  <p class="name" title={lane.name}>
                    {lane.name}
                    {#if afc.currentLoad === lane.name}<span class="badge">Loaded</span>{/if}
                  </p>
                  <p class="meta" title={meta}>{meta}</p>
                  {#if weight}
                    <p class="meta" title={weight}>{weight}</p>
                  {/if}
                </div>
                {#if action}
                  {@const check = ui.gateway.availability(action.command)}
                  <button
                    type="button"
                    class="btn cyan use"
                    disabled={!check.allowed}
                    aria-busy={ui.isBusy(action.command)}
                    onclick={() => ui.run(action.command)}
                  >
                    {action.label}
                  </button>
                {/if}
              </li>
            {/each}
          </ul>
        {/each}
      </div>
    {/if}
  </section>
</div>

<style>
  .afc {
    height: 100%;
    display: grid;
    grid-template-columns: minmax(220px, 0.8fr) minmax(0, 1.35fr);
    gap: var(--gap);
    min-height: 0;
  }

  .status,
  .lanes {
    min-height: 0;
    min-width: 0;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    overflow: hidden;
  }

  .status {
    overflow: auto;
  }

  .line,
  .unit,
  .name,
  .meta {
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .line,
  .unit {
    font-size: var(--fs-sm);
  }

  .unit {
    color: var(--text-dim);
    font-weight: 650;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    font-size: var(--fs-xs);
  }

  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .rows li {
    display: grid;
    grid-template-columns: 28px minmax(0, 1fr) auto;
    gap: 10px;
    align-items: center;
    min-width: 0;
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

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .use {
    min-width: 72px;
  }

  .lanes .scroll {
    flex: 1;
    min-height: 0;
  }

  .empty-note {
    margin: 0;
    color: var(--text-dim);
    font-size: var(--fs-sm);
  }

  @media (max-width: 900px), (max-height: 540px) {
    .afc {
      grid-template-columns: minmax(0, 0.85fr) minmax(0, 1.2fr);
    }

    .status,
    .lanes {
      padding: 8px;
      gap: 6px;
    }

    .rows li {
      min-height: 52px;
      padding: 4px 6px;
    }
  }
</style>

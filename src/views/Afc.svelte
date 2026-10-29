<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import { afcLaneButtons, afcMotionBlock, afcUnloadButton, type AfcButton } from '../lib/actions/commands';
  import { groupAfcLanes } from '../lib/afc/map';
  import type { AfcLane } from '../lib/afc/types';
  import { app } from '../lib/context';

  const { store, ui } = app();
  const printerState = store.state;

  const ready = $derived(printerState.transport === 'connected' && printerState.klippy === 'ready');
  const afc = $derived(printerState.afc);
  const block = $derived(afc ? afcMotionBlock(printerState) : null);
  const groups = $derived(afc ? groupAfcLanes(afc) : []);
  const unload = $derived(afcUnloadButton(printerState));
  const busy = $derived(ui.busyGroups.includes('afc'));

  function laneButtons(lane: AfcLane): AfcButton[] {
    return afcLaneButtons(printerState, lane.name);
  }

  function weightText(grams: number): string {
    const digits = grams >= 100 || Number.isInteger(grams) ? 0 : 1;
    return `${grams.toFixed(digits)} g`;
  }

  function laneSummary(lane: AfcLane): string | null {
    if (!lane.detailReported) return null;
    const parts = [lane.material, lane.filamentName].filter((part): part is string => !!part);
    if (lane.weight !== null) parts.push(weightText(lane.weight));
    if (lane.spoolId !== null) parts.push(`Spool ${lane.spoolId}`);
    return parts.length > 0 ? parts.join(' · ') : null;
  }

  function laneState(lane: AfcLane): string {
    if (!lane.detailReported) return 'No status';
    if (lane.filamentStatus && lane.status && lane.filamentStatus !== lane.status) return `${lane.filamentStatus} · ${lane.status}`;
    return lane.filamentStatus ?? lane.status ?? 'No status';
  }

  const loadedText = $derived.by(() => {
    if (!afc?.reported) return 'Waiting for AFC status';
    if (!afc.currentLoadKnown) return 'Loaded lane was not reported';
    return afc.currentLoad ? `Loaded ${afc.currentLoad}` : 'Nothing loaded';
  });

  const stateText = $derived.by(() => {
    if (!afc?.reported) return 'Waiting';
    const state = afc.state ?? 'State not reported';
    if (afc.state && afc.state !== 'Idle' && afc.currentLane) return `${state} · ${afc.currentLane}`;
    return state;
  });
</script>

<div class="afc page">
  {#if !ready}
    <section class="card panel">
      <div class="empty">
        <Icon name="filament" size={30} />
        <h2>{printerState.transport === 'connected' ? 'Klipper is not ready' : 'Printer is offline'}</h2>
        <p>AFC status is shown only while Klipper is ready.</p>
      </div>
    </section>
  {:else if !afc}
    <section class="card panel">
      <div class="empty">
        <Icon name="filament" size={30} />
        <h2>AFC is not installed</h2>
        <p>
          This printer did not report an AFC object. Printing does not need AFC. LAYR does not install it and does not change Klipper
          or Moonraker configuration.
        </p>
      </div>
    </section>
  {:else}
    <section class="card panel summary" aria-labelledby="afc-title">
      <h2 id="afc-title" class="panel-title eyebrow">
        AFC
        <span class="state" class:bad={afc.error === true} class:moving={afc.state !== null && afc.state !== 'Idle'} role="status">
          {stateText}
        </span>
      </h2>
      <div class="summary-row">
        <p class="loaded" title={loadedText}>{loadedText}</p>
        {#if unload && afc.currentLoad}
          {@const lane = afc.currentLoad}
          <button
            type="button"
            class="btn danger"
            aria-label={unload.name}
            disabled={busy}
            aria-busy={busy}
            onclick={() => ui.run({ kind: 'afc', action: 'tool_unload', lane })}
          >
            <Icon name="unload" size={18} />{unload.label}
          </button>
        {/if}
      </div>
      {#if afc.toolchange}
        <p class="hint">Tool change {afc.toolchange.current} / {afc.toolchange.total}</p>
      {/if}
      {#if afc.positionSaved}
        <p class="hint">Position saved</p>
      {/if}
      {#if afc.message}
        <p class="message tone-{afc.message.type === 'error' ? 'error' : afc.message.type === 'warning' ? 'warn' : 'info'}">
          <Icon name={afc.message.type === 'error' ? 'alert' : 'info'} size={14} />
          <span title={afc.message.text}>{afc.message.text}</span>
        </p>
      {/if}
      {#if block}
        <p class="hint warn"><Icon name="lock" size={14} />{block}</p>
      {/if}
    </section>

    <section class="card panel lanes" aria-labelledby="lanes-title">
      <h2 id="lanes-title" class="eyebrow">Units and lanes</h2>
      <div class="scroll list">
        {#if afc.truncated}
          <p class="hint">Some AFC lane or unit objects were not subscribed. The screen is showing the first ones Klipper listed.</p>
        {/if}
        {#if groups.length === 0}
          <div class="empty">
            <strong>{afc.reported ? 'AFC did not report any lanes' : 'Waiting for AFC status'}</strong>
          </div>
        {/if}
        {#each groups as group (group.id)}
          <section class="unit" aria-label={group.title}>
            <h3>{group.title}</h3>
            {#if group.lanes.length === 0}
              <p class="hint">This unit did not report any lanes.</p>
            {:else}
              <div class="grid">
                {#each group.lanes as lane (lane.name)}
                  {@const buttons = laneButtons(lane)}
                  {@const summary = laneSummary(lane)}
                  <article class="lane" aria-label={lane.name} class:loaded={afc.currentLoad === lane.name}>
                    <div class="lane-top">
                      <span
                        class="swatch"
                        style:background={lane.color ?? 'transparent'}
                        style:border-color={lane.color ?? 'var(--border-strong)'}
                        aria-hidden="true"
                      ></span>
                      <strong class="name" title={lane.name}>{lane.name}</strong>
                      {#if lane.map}<span class="map">{lane.map}</span>{/if}
                      {#if afc.currentLoad === lane.name}<span class="tag loaded-tag">In tool</span>{/if}
                    </div>
                    <p class="status" title={laneState(lane)}>{laneState(lane)}</p>
                    {#if summary}
                      <p class="meta" title={summary}>{summary}</p>
                    {:else if !lane.detailReported}
                      <p class="meta">Status not reported</p>
                    {/if}
                    {#if lane.bufferStatus || lane.runoutLane}
                      <p class="meta dim">
                        {lane.bufferStatus ? `Buffer ${lane.bufferStatus}` : ''}
                        {lane.bufferStatus && lane.runoutLane ? ' · ' : ''}
                        {lane.runoutLane ? `Runout ${lane.runoutLane}` : ''}
                      </p>
                    {/if}
                    {#if buttons.length > 0}
                      <div class="actions">
                        {#each buttons as button (button.action)}
                          <button
                            type="button"
                            class="btn {button.action === 'lane_unload' ? 'danger' : 'warn'}"
                            aria-label={button.name}
                            disabled={busy}
                            aria-busy={busy}
                            onclick={() => ui.run({ kind: 'afc', action: button.action, lane: lane.name })}
                          >
                            {button.label}
                          </button>
                        {/each}
                      </div>
                    {/if}
                  </article>
                {/each}
              </div>
            {/if}
          </section>
        {/each}
      </div>
    </section>
  {/if}
</div>

<style>
  .afc {
    height: 100%;
    min-height: 0;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    gap: var(--gap);
  }

  .afc > .panel:only-child {
    grid-row: 1 / -1;
  }

  .panel {
    min-height: 0;
    overflow: hidden;
  }

  .summary {
    gap: 8px;
  }

  .state {
    text-transform: none;
    letter-spacing: 0;
    font-size: var(--fs-sm);
    font-weight: 700;
    color: var(--ok);
  }

  .state.moving {
    color: var(--cyan);
  }

  .state.bad {
    color: var(--danger);
  }

  .summary-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-width: 0;
  }

  .loaded {
    margin: 0;
    min-width: 0;
    font-size: var(--fs-md);
    font-weight: 650;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .message {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    margin: 0;
    font-size: var(--fs-sm);
    color: var(--text-2);
  }

  .message span {
    min-width: 0;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .message.tone-error {
    color: var(--danger);
  }

  .message.tone-warn {
    color: var(--warn);
  }

  .lanes {
    display: flex;
    flex-direction: column;
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-height: 0;
    flex: 1;
  }

  .unit h3 {
    margin: 0 0 6px;
    font-size: var(--fs-sm);
    font-weight: 650;
    color: var(--text-2);
  }

  .grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 8px;
  }

  .lane {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px 10px;
    border-radius: var(--radius-sm);
    background: var(--bg);
    border: 1px solid var(--border);
    min-width: 0;
  }

  .lane.loaded {
    border-color: color-mix(in srgb, var(--cyan) 55%, transparent);
  }

  .lane-top {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .swatch {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 1px solid var(--border-strong);
    flex: none;
  }

  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .map,
  .tag {
    flex: none;
    padding: 1px 7px;
    border-radius: 999px;
    font-size: var(--fs-xs);
    font-weight: 700;
    color: var(--text-dim);
    background: var(--surface-3);
  }

  .loaded-tag {
    margin-left: auto;
    color: var(--cyan);
    background: var(--cyan-soft);
  }

  .status,
  .meta {
    margin: 0;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--fs-sm);
    color: var(--text-2);
  }

  .meta {
    color: var(--text-dim);
    font-size: var(--fs-xs);
  }

  .actions {
    display: flex;
    gap: 8px;
  }

  .actions .btn {
    flex: 1;
    min-height: 44px;
  }

  .empty h2 {
    margin: 0;
    font-size: var(--fs-md);
    color: var(--text-2);
  }

  .empty p {
    margin: 0;
    max-width: 46ch;
  }

  @media (min-width: 900px) and (min-height: 560px) {
    .grid {
      grid-template-columns: 1fr 1fr;
    }
  }
</style>

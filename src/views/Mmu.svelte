<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import type { PrinterCommand } from '../lib/actions/commands';
  import { app } from '../lib/context';
  import { gateStatusLabel } from '../lib/mmu/map';
  import { mmuMotionLocked } from '../lib/mmu/plan';
  import type { MmuGate } from '../lib/mmu/types';

  const { store, ui, gcodeHelp } = app();
  const printerState = store.state;

  const mmu = $derived(printerState.mmu);
  const help = $derived(gcodeHelp.names);
  const known = (name: string) => help?.includes(name) === true;
  const offline = $derived(printerState.transport !== 'connected' || printerState.klippy !== 'ready');
  const lock = $derived(mmu ? mmuMotionLocked(printerState) : null);
  const paused = $derived(mmu?.printState === 'pause_locked' || mmu?.printState === 'paused' || mmu?.printState === 'error');

  const groups = $derived.by(() => {
    const map = new Map<string, MmuGate[]>();
    for (const gate of mmu?.gates ?? []) {
      const key = gate.unit ?? '';
      const list = map.get(key) ?? [];
      list.push(gate);
      map.set(key, list);
    }
    return [...map.entries()];
  });

  function toolLabel(tool: number | null): string {
    if (tool === null) return 'Not reported';
    if (tool === -1) return 'Unknown';
    if (tool === -2) return 'Bypass';
    return `T${tool}`;
  }

  function gateMeta(gate: MmuGate): string {
    const status = gateStatusLabel(gate.status);
    const parts = [gate.tool === null ? null : `T${gate.tool}`, gate.material, gate.colorName, status].filter((part): part is string => !!part);
    return parts.length > 0 ? parts.join(' · ') : 'Details not reported';
  }

  function rowAction(gate: MmuGate): { command: PrinterCommand; label: string } | null {
    if (help === null) return null;
    if (known('MMU_CHANGE_TOOL')) return { command: { kind: 'mmu_change_tool', gate: gate.index }, label: 'Change' };
    if (known('MMU_SELECT') || known('MMU_SELECT_TOOL')) return { command: { kind: 'mmu_select', gate: gate.index }, label: 'Select' };
    return null;
  }

  const actions = $derived.by(() => {
    if (help === null || !mmu) return [];
    const items: Array<{ command: PrinterCommand; label: string; tone: 'warn' | 'primary' }> = [];
    if (known('MMU_HOME')) items.push({ command: { kind: 'mmu_home' }, label: 'Home', tone: 'warn' });
    if (known('MMU_LOAD') || known('MMU_LOAD_TOOL')) items.push({ command: { kind: 'mmu_load' }, label: 'Load', tone: 'warn' });
    if (known('MMU_UNLOAD') || known('MMU_UNLOAD_TOOL')) items.push({ command: { kind: 'mmu_unload' }, label: 'Unload', tone: 'warn' });
    if (known('MMU_EJECT') || known('MMU_EJECT_TOOL')) items.push({ command: { kind: 'mmu_eject' }, label: 'Eject', tone: 'warn' });
    if (known('MMU_PRELOAD')) items.push({ command: { kind: 'mmu_preload' }, label: 'Preload', tone: 'warn' });
    if (known('MMU_CHECK_GATE')) items.push({ command: { kind: 'mmu_check_gate' }, label: 'Check', tone: 'warn' });
    if (mmu.hasBypass === true && (known('MMU_SELECT') || known('MMU_SELECT_BYPASS'))) {
      items.push({ command: { kind: 'mmu_bypass' }, label: 'Bypass', tone: 'warn' });
    }
    if (known('MMU_RECOVER')) items.push({ command: { kind: 'mmu_recover' }, label: 'Recover', tone: 'warn' });
    if (paused && known('MMU_UNLOCK')) items.push({ command: { kind: 'mmu_unlock' }, label: 'Unlock', tone: 'primary' });
    return items;
  });
</script>

<div class="mmu page">
  <section class="card status scroll" aria-labelledby="mmu-status-title">
    <h2 id="mmu-status-title" class="eyebrow">Happy Hare{mmu?.version ? ` ${mmu.version}` : ''}</h2>
    {#if !mmu}
      <p class="hint">
        <Icon name="info" size={16} />
        {#if offline}
          MMU status is unavailable while the printer is offline.
        {:else}
          Happy Hare is not installed on this printer.
        {/if}
      </p>
    {:else}
      <p class="line" title={mmu.printState ?? 'Not reported'}>State: {mmu.printState ?? 'Not reported'}</p>
      <p class="line" title={mmu.action ?? 'Not reported'}>Action: {mmu.action ?? 'Not reported'}</p>
      <p class="line" title={toolLabel(mmu.tool)}>Tool: {toolLabel(mmu.tool)}</p>
      <p class="line" title={mmu.gate === null ? 'Not reported' : `Gate ${mmu.gate}`}>Gate: {mmu.gate === null ? 'Not reported' : mmu.gate}</p>
      <p class="line" title={mmu.filament ?? 'Not reported'}>Filament: {mmu.filament ?? 'Not reported'}</p>
      {#if mmu.homed !== null}
        <p class="line">Selector: {mmu.homed ? 'Homed' : 'Not homed'}</p>
      {/if}
      {#if mmu.activeName}
        <p class="line" title={[mmu.activeName, mmu.activeMaterial].filter(Boolean).join(' · ')}>
          Active: {mmu.activeName}{mmu.activeMaterial ? ` · ${mmu.activeMaterial}` : ''}
        </p>
      {/if}
      {#if mmu.enabled === false}
        <p class="hint warn"><Icon name="alert" size={16} />Happy Hare is disabled.</p>
      {/if}
      {#if mmu.reasonForPause}
        <p class="hint warn" title={mmu.reasonForPause}><Icon name="alert" size={16} />{mmu.reasonForPause}</p>
      {/if}

      {#if help === null}
        <p class="hint">MMU commands have not been read yet.</p>
      {:else if actions.length === 0}
        <p class="hint">This printer does not register Happy Hare filament commands, so those moves are not offered.</p>
      {:else}
        <div class="actions">
          {#each actions as action (action.command.kind)}
            {@const check = ui.gateway.availability(action.command)}
            <button
              type="button"
              class="btn {action.tone === 'warn' ? 'warn' : ''}"
              disabled={!check.allowed}
              aria-busy={ui.isBusy(action.command)}
              onclick={() => ui.run(action.command)}
            >
              {action.label}
            </button>
          {/each}
        </div>
        {#if lock}
          <p class="hint warn">{lock}</p>
        {:else}
          <p class="hint">Filament moves ask first and only run a Happy Hare command this printer registers.</p>
        {/if}
      {/if}
    {/if}
  </section>

  <section class="card gates" aria-labelledby="mmu-gates-title">
    <h2 id="mmu-gates-title" class="eyebrow">Gates</h2>
    {#if !mmu}
      <p class="empty-note">No gates while Happy Hare is {offline ? 'offline' : 'not installed'}.</p>
    {:else if mmu.gates.length === 0}
      <p class="empty-note">Happy Hare did not report any gates.</p>
    {:else}
      <div class="scroll">
        {#each groups as [unit, gates] (unit)}
          {#if unit}
            <h3 class="unit" title={unit}>{unit}</h3>
          {/if}
          <ul class="rows">
            {#each gates as gate (gate.index)}
              {@const action = rowAction(gate)}
              {@const meta = gateMeta(gate)}
              <li class:current={mmu.gate === gate.index}>
                <span class="swatch" style:background={gate.color ?? 'transparent'} class:none={!gate.color} aria-hidden="true"></span>
                <div class="copy">
                  <p class="name" title={`Gate ${gate.index}`}>
                    Gate {gate.index}
                    {#if mmu.tool !== null && mmu.tool >= 0 && gate.tool === mmu.tool}<span class="badge">Tool</span>{/if}
                  </p>
                  <p class="meta" title={meta}>{meta}</p>
                  {#if gate.filamentName}
                    <p class="meta" title={gate.filamentName}>{gate.filamentName}</p>
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
  .mmu {
    height: 100%;
    display: grid;
    grid-template-columns: minmax(220px, 0.85fr) minmax(0, 1.3fr);
    gap: var(--gap);
    min-height: 0;
  }

  .status,
  .gates {
    min-height: 0;
    min-width: 0;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
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

  .line {
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
    min-height: 52px;
    padding: 4px 8px;
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

  .gates .scroll {
    flex: 1;
    min-height: 0;
  }

  .empty-note {
    margin: 0;
    color: var(--text-dim);
    font-size: var(--fs-sm);
  }

  @media (max-width: 900px), (max-height: 540px) {
    .mmu {
      grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.15fr);
    }

    .status,
    .gates {
      padding: 8px;
      gap: 4px;
    }

    .rows li {
      min-height: 48px;
      padding: 4px 6px;
    }
  }
</style>

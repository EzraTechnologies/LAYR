<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import type { PrinterCommand } from '../lib/actions/commands';
  import { app } from '../lib/context';
  import {
    filamentHeadline,
    gateStatusLabel,
    MMU_CHANGE_TOOL,
    MMU_LOAD,
    MMU_RECOVER,
    MMU_UNLOAD,
    mmuNeedsRecover,
    mmuNotices,
    slotLabel,
  } from '../lib/mmu/happyhare';
  import type { MmuGate, MmuState } from '../lib/printer/model';

  const { store, ui } = app();
  const printerState = store.state;

  let picked = $state<number | null>(null);

  const mmu = $derived(printerState.mmu);
  const notices = $derived(mmu ? mmuNotices(mmu) : []);
  const headline = $derived(mmu ? filamentHeadline(mmu) : '');

  $effect(() => {
    const gate = mmu?.gate;
    if (picked === null && gate !== null && gate !== undefined && gate >= 0) picked = gate;
  });

  const pickedGate = $derived(mmu?.gates.find((gate) => gate.index === picked) ?? mmu?.gates[0] ?? null);

  const changeTools = $derived.by(() => {
    if (!mmu || !mmu.commands?.includes(MMU_CHANGE_TOOL)) return [];
    if (mmu.ttgReported) return pickedGate?.tools ?? [];
    if (mmu.numGates === null) return [];
    return Array.from({ length: Math.min(mmu.numGates, 16) }, (_, tool) => tool);
  });

  const loadCommand = { kind: 'mmu', action: 'load' } as const;
  const unloadCommand = { kind: 'mmu', action: 'unload' } as const;
  const recoverCommand = { kind: 'mmu', action: 'recover' } as const;

  const showLoad = $derived(mmu?.commands?.includes(MMU_LOAD) ?? false);
  const showUnload = $derived(mmu?.commands?.includes(MMU_UNLOAD) ?? false);
  const showRecover = $derived(!!mmu && (mmu.commands?.includes(MMU_RECOVER) ?? false) && mmuNeedsRecover(mmu));

  const loadCheck = $derived(ui.gateway.availability(loadCommand));
  const unloadCheck = $derived(ui.gateway.availability(unloadCommand));
  const recoverCheck = $derived(ui.gateway.availability(recoverCommand));

  function changeCommand(tool: number): PrinterCommand {
    return { kind: 'mmu', action: 'change_tool', tool };
  }

  const blockMessage = $derived.by(() => {
    const messages = [
      showUnload && !unloadCheck.allowed ? unloadCheck.message : null,
      showLoad && !loadCheck.allowed ? loadCheck.message : null,
      showRecover && !recoverCheck.allowed ? recoverCheck.message : null,
    ].filter((message): message is string => !!message);
    return (
      messages.find(
        (message) =>
          message === 'Not available while printing' ||
          message.startsWith('Happy Hare is busy') ||
          message.startsWith('Happy Hare reports') ||
          message.startsWith('Waiting for'),
      ) ?? null
    );
  });

  function absentCopy(): { title: string; body: string } {
    if (printerState.status === 'unconfigured') {
      return { title: 'No Happy Hare MMU', body: 'Set up the printer connection in Settings. MMU state is not shown until then.' };
    }
    if (printerState.transport !== 'connected') {
      return { title: 'No Happy Hare MMU', body: 'Printer is offline. MMU state is not shown, and nothing is sent.' };
    }
    if (printerState.klippy !== 'ready') {
      return { title: 'No Happy Hare MMU', body: 'Klipper is not ready, so MMU state is not shown. Nothing is sent.' };
    }
    return {
      title: 'No Happy Hare MMU',
      body: 'This printer did not list an mmu object. Happy Hare controls stay off, and the rest of LAYR is unchanged.',
    };
  }

  function gateName(gate: MmuGate): string {
    return [gate.material, gate.filamentName].filter(Boolean).join(' · ');
  }

  function filamentTone(state: MmuState): string {
    if (state.filament === 'Unknown' || state.filamentPos === -1) return 'bad';
    if (state.filament === 'Loaded' || state.filamentPos === 10) return 'ok';
    return '';
  }
</script>

{#if mmu}
  <div class="mmu page">
    <section class="card panel" aria-labelledby="mmu-title">
      <h2 id="mmu-title" class="panel-title eyebrow">
        Happy Hare
        <span class="filament num" class:ok={filamentTone(mmu) === 'ok'} class:bad={filamentTone(mmu) === 'bad'}>{headline}</span>
      </h2>

      <dl class="facts">
        <div>
          <dt>Tool</dt>
          <dd class="num" title={slotLabel('Tool', mmu.tool)}>{slotLabel('Tool', mmu.tool).replace(/^Tool /, '')}</dd>
        </div>
        <div>
          <dt>Gate</dt>
          <dd class="num" title={slotLabel('Gate', mmu.gate)}>{slotLabel('Gate', mmu.gate).replace(/^Gate /, '')}</dd>
        </div>
        <div>
          <dt>Homed</dt>
          <dd>{mmu.homed === null ? 'Not reported' : mmu.homed ? 'Yes' : 'No'}</dd>
        </div>
        <div>
          <dt>Action</dt>
          <dd title={mmu.action ?? 'Not reported'}>{mmu.action ?? 'Not reported'}</dd>
        </div>
      </dl>

      {#if (mmu.printState && !['ready', 'standby', 'initialized', 'idle'].includes(mmu.printState)) || (mmu.nextTool !== null && mmu.nextTool >= 0)}
        <p class="meta">
          {#if mmu.printState}<span>Print state {mmu.printState}</span>{/if}
          {#if mmu.nextTool !== null && mmu.nextTool >= 0}<span class="num">Next tool {mmu.nextTool}</span>{/if}
          {#if mmu.lastTool !== null && mmu.lastTool >= 0 && mmu.lastTool !== mmu.tool}<span class="num">Last tool {mmu.lastTool}</span>{/if}
        </p>
      {/if}

      {#if notices.length > 0}
        <ul class="notices" aria-label="MMU notices">
          {#each notices as notice, i (i)}
            <li class={notice.tone} title={notice.text}>{notice.text}</li>
          {/each}
        </ul>
      {/if}

      <div class="actions">
        {#if showUnload}
          <button
            type="button"
            class="btn"
            disabled={!unloadCheck.allowed || ui.isBusy(unloadCommand)}
            aria-busy={ui.isBusy(unloadCommand)}
            onclick={() => ui.run(unloadCommand)}
          >
            <Icon name="unload" size={20} />Unload
          </button>
        {/if}
        {#if showLoad}
          <button
            type="button"
            class="btn cyan"
            disabled={!loadCheck.allowed || ui.isBusy(loadCommand)}
            aria-busy={ui.isBusy(loadCommand)}
            onclick={() => ui.run(loadCommand)}
          >
            <Icon name="load" size={20} />Load
          </button>
        {/if}
        {#if showRecover}
          <button
            type="button"
            class="btn warn"
            disabled={!recoverCheck.allowed || ui.isBusy(recoverCommand)}
            aria-busy={ui.isBusy(recoverCommand)}
            onclick={() => ui.run(recoverCommand)}
          >
            <Icon name="refresh" size={20} />Recover
          </button>
        {/if}
      </div>

      {#if blockMessage}
        <p class="hint warn"><Icon name="lock" size={14} />{blockMessage}</p>
      {/if}
      <p class="hint">Load and unload use the gate Happy Hare already has selected. Each move asks before it is sent.</p>
    </section>

    <section class="card panel gates" aria-labelledby="gates-title">
      <h2 id="gates-title" class="eyebrow">Gates</h2>
      {#if mmu.gates.length === 0}
        <p class="hint">No per-gate list was reported.</p>
      {:else}
        <div class="grid" role="radiogroup" aria-label="Gate details">
          {#each mmu.gates as gate (gate.index)}
            {@const label = gateName(gate)}
            <button
              type="button"
              class="gate"
              class:live={mmu.gate === gate.index}
              role="radio"
              aria-checked={pickedGate?.index === gate.index}
              aria-label={`Gate ${gate.index}, ${gateStatusLabel(gate)}${mmu.gate === gate.index ? ', selected' : ''}`}
              title={`Gate ${gate.index}, ${label || gateStatusLabel(gate)}`}
              onclick={() => (picked = gate.index)}
            >
              <span class="gate-top">
                <span class="num">{gate.index}</span>
                {#if gate.color}
                  <span class="swatch" style:background={gate.color} title={gate.colorName ?? gate.color}></span>
                {/if}
                {#if mmu.gate === gate.index}<span class="live-tag" title="Selected">Selected</span>{/if}
              </span>
              <span class="gate-name" title={label || gateStatusLabel(gate)}>{label || gateStatusLabel(gate)}</span>
              <span class="gate-status">{gateStatusLabel(gate)}</span>
            </button>
          {/each}
        </div>

        {#if pickedGate}
          <div class="detail" aria-label={`Gate ${pickedGate.index} details`}>
            <h3 class="eyebrow sub">Gate {pickedGate.index}</h3>
            <p class="detail-line">
              {gateName(pickedGate) || 'Filament name not reported'}
              {#if pickedGate.temperature !== null}<span class="num"> · {pickedGate.temperature}°</span>{/if}
              {#if pickedGate.spoolId !== null}<span class="num"> · Spool id {pickedGate.spoolId}</span>{/if}
            </p>
            {#if mmu.ttgReported}
              <p class="detail-line">
                {pickedGate.tools.length > 0 ? `Tools ${pickedGate.tools.join(', ')}` : 'No tool maps to this gate'}
              </p>
            {/if}
            {#if changeTools.length > 0}
              <div class="changes">
                {#each changeTools as tool (tool)}
                  {@const command = changeCommand(tool)}
                  {@const check = ui.gateway.availability(command)}
                  <button
                    type="button"
                    class="btn"
                    disabled={!check.allowed || ui.isBusy(command)}
                    aria-busy={ui.isBusy(command)}
                    title={check.allowed ? `Change to tool ${tool}` : check.message}
                    onclick={() => ui.run(command)}
                  >
                    Change to tool {tool}
                  </button>
                {/each}
              </div>
            {:else if mmu.ttgReported && mmu.commands?.includes(MMU_CHANGE_TOOL)}
              <p class="hint">No tool maps to this gate, so there is no tool change for it.</p>
            {/if}
          </div>
        {/if}
      {/if}
    </section>
  </div>
{:else}
  {@const empty = absentCopy()}
  <div class="mmu page">
    <section class="card panel absent" aria-labelledby="mmu-absent-title">
      <h2 id="mmu-absent-title">{empty.title}</h2>
      <p>{empty.body}</p>
    </section>
  </div>
{/if}

<style>
  .mmu {
    height: 100%;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(240px, 0.86fr) minmax(0, 1.14fr);
    gap: var(--gap);
  }

  .mmu > .panel {
    min-height: 0;
    overflow: auto;
  }

  .filament {
    font-size: var(--fs-sm);
    letter-spacing: 0;
    text-transform: none;
    color: var(--text-2);
    font-weight: 650;
  }

  .filament.ok {
    color: var(--ok);
  }

  .filament.bad {
    color: var(--warn);
  }

  .facts {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 8px;
    margin: 0;
  }

  .facts div {
    min-width: 0;
  }

  dt {
    margin: 0;
    font-size: var(--fs-xs);
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  dd {
    margin: 2px 0 0;
    font-size: var(--fs-lg);
    font-weight: 650;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 12px;
    margin: 0;
    color: var(--text-2);
    font-size: var(--fs-sm);
  }

  .notices {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 6px;
  }

  .notices li {
    margin: 0;
    padding: 8px 10px;
    border-radius: var(--radius-sm);
    font-size: var(--fs-sm);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .notices .danger {
    color: var(--danger);
    background: var(--danger-soft);
  }

  .notices .warn {
    color: var(--warn);
    background: var(--warn-soft);
  }

  .notices .info {
    color: var(--text-2);
    background: var(--surface-3);
  }

  .actions,
  .changes {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .gates {
    min-height: 0;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 8px;
  }

  .gate {
    min-height: var(--touch);
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    padding: 8px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-strong);
    background: var(--surface-3);
    color: var(--text);
    text-align: left;
    overflow: hidden;
  }

  .gate[aria-checked='true'] {
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--purple) 70%, transparent);
  }

  .gate.live {
    box-shadow: inset 0 0 0 2px var(--cyan);
  }

  .gate-top {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    min-width: 0;
  }

  .swatch {
    width: 12px;
    height: 12px;
    border-radius: 99px;
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.25);
  }

  .live-tag {
    margin-left: auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--cyan);
  }

  .gate-name,
  .gate-status {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--fs-xs);
  }

  .gate-name {
    font-weight: 650;
  }

  .gate-status {
    color: var(--text-dim);
  }

  .detail {
    display: grid;
    gap: 6px;
  }

  .sub {
    margin: 0;
  }

  .detail-line {
    margin: 0;
    font-size: var(--fs-sm);
    color: var(--text-2);
  }

  .absent {
    align-self: start;
    max-width: 560px;
  }

  .absent h2 {
    margin: 0;
    font-size: var(--fs-xl);
  }

  .absent p {
    margin: 0;
    color: var(--text-2);
  }

  @media (max-width: 900px), (max-height: 540px) {
    .mmu {
      display: block;
      height: 100%;
      overflow: auto;
    }

    .mmu > .panel {
      min-height: auto;
      overflow: visible;
      margin-bottom: var(--gap);
    }

    .facts {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }
</style>

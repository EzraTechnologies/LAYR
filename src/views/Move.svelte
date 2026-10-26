<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import { DEFAULT_MAX_Z_SPEED, type PrinterCommand } from '../lib/actions/commands';
  import { app } from '../lib/context';
  import { AXES, isHomed, type Axis } from '../lib/printer/model';

  const { store, ui } = app();
  const printerState = store.state;

  const STEPS = [0.1, 1, 10, 25, 50] as const;
  const SPEEDS = [25, 50, 100, 150] as const;
  const Z_STEPS = [0.01, 0.05] as const;

  let step = $state<number>(10);
  let speed = $state<number>(50);

  const jobActive = $derived(printerState.status === 'printing' || printerState.status === 'paused');
  const maxXY = $derived(printerState.toolhead?.maxVelocity ?? printerState.limits.maxVelocity ?? 150);
  const speeds = $derived(SPEEDS.filter((s) => s <= maxXY));
  const zSpeed = $derived(Math.min(printerState.limits.maxZVelocity ?? DEFAULT_MAX_Z_SPEED, DEFAULT_MAX_Z_SPEED));
  const homedAll = $derived(AXES.every((a) => isHomed(printerState, a)));

  function jog(axis: Axis, direction: 1 | -1): PrinterCommand {
    return { kind: 'jog', axis, distance: direction * step, speed: axis === 'z' ? zSpeed : speed };
  }

  function check(command: PrinterCommand) {
    return ui.gateway.availability(command);
  }

  const jogHint = $derived.by(() => {
    if (jobActive) return null;
    const blocked = check(jog('x', 1));
    if (!blocked.allowed && !homedAll) return 'Home the printer to enable jogging. Moves are checked against the axis limits.';
    if (!blocked.allowed && blocked.message.includes('offline')) return blocked.message;
    return null;
  });

  const motionBusy = $derived(ui.busyGroups.includes('motion'));

  function position(axis: Axis): string {
    const p = printerState.toolhead?.position;
    if (!p) return '—';
    return p[AXES.indexOf(axis)]!.toFixed(axis === 'z' ? 2 : 1);
  }

  const zOffset = $derived(printerState.toolhead?.zOffset ?? null);
</script>

{#snippet jogButton(axis: Axis, direction: 1 | -1, icon: 'up' | 'down' | 'left' | 'right', area: string)}
  {@const command = jog(axis, direction)}
  {@const availability = check(command)}
  <button
    type="button"
    class="btn jog"
    style:grid-area={area}
    aria-label={`${axis.toUpperCase()}${direction > 0 ? '+' : '−'} ${step} mm`}
    title={availability.allowed ? '' : availability.message}
    disabled={!availability.allowed || motionBusy}
    onclick={() => ui.run(command, { quietSuccess: true })}
  >
    <Icon name={icon} size={26} strokeWidth={2} />
    <span class="jog-label">{axis.toUpperCase()}{direction > 0 ? '+' : '−'}</span>
  </button>
{/snippet}

<div class="move page">
  <section class="card panel pad-card" aria-labelledby="jog-title">
    <h2 id="jog-title" class="panel-title eyebrow">
      {jobActive ? 'Z offset (babystep)' : 'Jog'}
      {#if !jobActive}<span class="speed-note">Z at {zSpeed} mm/s</span>{/if}
    </h2>

    {#if jobActive}
      <div class="babystep">
        <p class="hint"><Icon name="lock" size={14} />Jogging and homing are locked while a print is {printerState.status}.</p>
        <div class="z-value num" aria-live="polite">{zOffset === null ? '—' : `${zOffset >= 0 ? '+' : ''}${zOffset.toFixed(3)}`}<small>mm</small></div>
        <div class="z-buttons">
          {#each Z_STEPS as z (z)}
            {@const command = { kind: 'z_offset', delta: -z } as const}
            <button
              type="button"
              class="btn"
              disabled={!check(command).allowed}
              aria-busy={ui.isBusy(command)}
              onclick={() => ui.run(command, { quietSuccess: true })}>−{z}</button
            >
          {/each}
          {#each Z_STEPS as z (z)}
            {@const command = { kind: 'z_offset', delta: z } as const}
            <button
              type="button"
              class="btn"
              disabled={!check(command).allowed}
              aria-busy={ui.isBusy(command)}
              onclick={() => ui.run(command, { quietSuccess: true })}>+{z}</button
            >
          {/each}
        </div>
        <p class="hint">Negative moves the nozzle closer to the bed. The offset is not saved to the config.</p>
      </div>
    {:else}
      <div class="pad">
        <div class="xy">
          {@render jogButton('y', 1, 'up', 'up')}
          {@render jogButton('x', -1, 'left', 'left')}
          <div class="center" style:grid-area="mid" aria-hidden="true">XY</div>
          {@render jogButton('x', 1, 'right', 'right')}
          {@render jogButton('y', -1, 'down', 'down')}
        </div>
        <div class="z">
          {@render jogButton('z', 1, 'up', 'auto')}
          <div class="center z-mid" aria-hidden="true">Z</div>
          {@render jogButton('z', -1, 'down', 'auto')}
        </div>
      </div>
      {#if jogHint}
        <p class="hint warn"><Icon name="lock" size={14} />{jogHint}</p>
      {:else}
        <p class="hint">Z+ raises the nozzle. Z never jogs below 0 mm.</p>
      {/if}
    {/if}
  </section>

  <div class="side">
    <section class="card panel" aria-labelledby="pos-title">
      <h2 id="pos-title" class="eyebrow">Position</h2>
      <div class="positions">
        {#each AXES as axis (axis)}
          <div class="pos" class:homed={isHomed(printerState, axis)}>
            <span class="axis">{axis.toUpperCase()}</span>
            <span class="value num">{position(axis)}</span>
            <span class="state">{isHomed(printerState, axis) ? 'Homed' : 'Not homed'}</span>
          </div>
        {/each}
      </div>
      <div class="home-row">
        <button
          type="button"
          class="btn cyan home-all"
          disabled={!check({ kind: 'home', axes: [] }).allowed || motionBusy}
          aria-busy={motionBusy && ui.isBusy({ kind: 'home', axes: [] })}
          onclick={() => ui.run({ kind: 'home', axes: [] })}
        >
          <Icon name="home" size={18} />Home all
        </button>
        {#each AXES as axis (axis)}
          {@const command = { kind: 'home', axes: [axis] } as PrinterCommand}
          {@const availability = check(command)}
          <button
            type="button"
            class="btn"
            aria-label={`Home ${axis.toUpperCase()}`}
            title={availability.allowed ? '' : availability.message}
            disabled={!availability.allowed || motionBusy}
            onclick={() => ui.run(command)}>{axis.toUpperCase()}</button
          >
        {/each}
        <button
          type="button"
          class="btn ghost"
          aria-label="Disable motors"
          title="Disable motors (M84)"
          disabled={!check({ kind: 'motors_off' }).allowed || motionBusy}
          onclick={() => ui.run({ kind: 'motors_off' })}
        >
          <Icon name="motorOff" size={20} />
        </button>
      </div>
    </section>

    <section class="card panel" aria-labelledby="step-title">
      <h2 id="step-title" class="eyebrow">Step (mm)</h2>
      <div class="seg" role="radiogroup" aria-label="Step size">
        {#each STEPS as s (s)}
          <button type="button" role="radio" aria-checked={step === s} onclick={() => (step = s)}>{s}</button>
        {/each}
      </div>
      <h2 class="eyebrow">XY speed (mm/s)</h2>
      <div class="seg" role="radiogroup" aria-label="XY speed">
        {#each speeds as s (s)}
          <button type="button" role="radio" aria-checked={speed === s} onclick={() => (speed = s)}>{s}</button>
        {/each}
      </div>
    </section>
  </div>
</div>

<style>
  .move {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: var(--gap);
  }

  .pad-card {
    min-height: 0;
    overflow: hidden;
  }

  .speed-note {
    text-transform: none;
    letter-spacing: 0;
    font-weight: 500;
  }

  .pad {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(0, 3fr) minmax(0, 1fr);
    gap: var(--gap);
  }

  .xy {
    display: grid;
    grid-template-areas:
      '. up .'
      'left mid right'
      '. down .';
    grid-template-columns: repeat(3, minmax(0, 1fr));
    grid-template-rows: repeat(3, minmax(0, 1fr));
    gap: 8px;
    min-height: 0;
  }

  .z {
    display: grid;
    grid-template-rows: repeat(3, minmax(0, 1fr));
    gap: 8px;
    min-height: 0;
  }

  .jog {
    flex-direction: column;
    gap: 2px;
    min-height: 0;
    height: 100%;
    padding: 0;
    border-radius: var(--radius);
    background: linear-gradient(180deg, var(--surface-3), var(--surface-2));
  }

  .jog-label {
    font-size: var(--fs-xs);
    color: var(--text-dim);
  }

  .center {
    display: grid;
    place-items: center;
    border-radius: 50%;
    color: var(--text-dim);
    font-weight: 700;
    font-size: var(--fs-sm);
    letter-spacing: 0.1em;
    border: 1px dashed var(--border-strong);
    width: min(56px, 70%);
    aspect-ratio: 1;
    place-self: center;
  }

  .side {
    display: flex;
    flex-direction: column;
    gap: var(--gap);
    min-height: 0;
    min-width: 0;
  }

  .positions {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
  }

  .pos {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 8px 10px;
    border-radius: var(--radius-sm);
    background: var(--bg);
    border: 1px solid var(--border);
    min-width: 0;
  }

  .axis {
    font-size: var(--fs-xs);
    font-weight: 700;
    color: var(--text-dim);
  }

  .value {
    font-size: var(--fs-xl);
    font-weight: 650;
    white-space: nowrap;
  }

  .state {
    font-size: var(--fs-xs);
    color: var(--warn);
  }

  .homed .state {
    color: var(--ok);
  }

  .home-row {
    display: grid;
    grid-template-columns: minmax(0, 2fr) repeat(4, minmax(0, 1fr));
    gap: 6px;
  }

  .home-row .btn {
    min-width: 0;
    padding: 0 6px;
  }

  .babystep {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 12px;
  }

  .z-value {
    text-align: center;
    font-size: var(--fs-hero);
    font-weight: 650;
    letter-spacing: -0.02em;
  }

  .z-value small {
    font-size: 0.4em;
    color: var(--text-dim);
    margin-left: 4px;
  }

  .z-buttons {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 8px;
  }

  .z-buttons .btn {
    min-height: 56px;
    min-width: 0;
    padding: 0;
  }

  @media (max-width: 900px), (max-height: 540px) {
    .pos {
      padding: 5px 8px;
    }
    .value {
      font-size: var(--fs-lg);
    }
    .seg button {
      padding: 0 4px;
    }
  }
</style>

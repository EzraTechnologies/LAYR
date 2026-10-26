<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import LevelControl from '../components/LevelControl.svelte';
  import { app } from '../lib/context';

  const { store, ui } = app();
  const printerState = store.state;
  const ready = $derived(printerState.transport === 'connected' && printerState.klippy === 'ready');
  const controllable = $derived(printerState.fans.filter((f) => f.controllable));
  const automatic = $derived(printerState.fans.filter((f) => !f.controllable));
</script>

<div class="fans page">
  <section class="card panel" aria-labelledby="fans-title">
    <h2 id="fans-title" class="eyebrow">Fans</h2>
    <div class="scroll list">
      {#if printerState.fans.length === 0}
        <div class="empty">
          <Icon name="fan" size={30} />
          <strong>{ready ? 'No fans reported' : 'Printer is offline'}</strong>
        </div>
      {/if}
      {#each controllable as fan (fan.object)}
        {@const busy = ui.isBusy({ kind: 'set_fan', fan: fan.object, speed: 0 })}
        <div class="item">
          <div class="item-head">
            <span class="name"><Icon name="fan" size={18} />{fan.label}</span>
            {#if fan.rpm !== null}<span class="rpm num">{Math.round(fan.rpm)} rpm</span>{/if}
          </div>
          <LevelControl
            label={fan.label}
            value={fan.speed}
            continuous={true}
            disabled={!ready}
            {busy}
            onSet={(v) => ui.run({ kind: 'set_fan', fan: fan.object, speed: v }, { quietSuccess: true })}
          />
        </div>
      {/each}
      {#if automatic.length > 0}
        <ul class="auto" aria-label="Automatic fans">
          {#each automatic as fan (fan.object)}
            <li>
              <span class="name" title={fan.object}>{fan.label}</span>
              <span class="num value">{fan.speed === null ? '—' : `${Math.round(fan.speed * 100)}%`}{fan.rpm !== null ? ` · ${Math.round(fan.rpm)} rpm` : ''}</span>
              <span class="tag">Auto</span>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </section>

  <section class="card panel" aria-labelledby="lights-title">
    <h2 id="lights-title" class="eyebrow">Lights</h2>
    <div class="scroll list">
      {#if printerState.lights.length === 0}
        <p class="hint">
          <Icon name="info" size={14} />No LED, neopixel or light-named output_pin was found. Light macros, if you have them, are under Macros.
        </p>
      {/if}
      {#each printerState.lights as light (light.object)}
        {@const busy = ui.isBusy({ kind: 'set_light', light: light.object, value: 0 })}
        <div class="item">
          <div class="item-head">
            <span class="name"><Icon name="bulb" size={18} />{light.label}</span>
            <span class="tag">{light.kind === 'led' ? 'LED' : 'Pin'}</span>
          </div>
          <LevelControl
            label={light.label}
            value={light.value}
            continuous={light.dimmable}
            disabled={!ready}
            {busy}
            onSet={(v) => ui.run({ kind: 'set_light', light: light.object, value: v }, { quietSuccess: true })}
          />
        </div>
      {/each}
    </div>
  </section>
</div>

<style>
  .fans {
    display: grid;
    grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
    gap: var(--gap);
  }

  .panel {
    min-height: 0;
    overflow: hidden;
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-height: 0;
    flex: 1;
  }

  .item {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px 12px;
    border-radius: var(--radius-sm);
    background: var(--bg);
    border: 1px solid var(--border);
  }

  .item-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .name {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-weight: 650;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .rpm,
  .value {
    color: var(--text-dim);
    font-size: var(--fs-sm);
    white-space: nowrap;
  }

  .tag {
    padding: 2px 8px;
    border-radius: 999px;
    font-size: var(--fs-xs);
    font-weight: 650;
    color: var(--text-dim);
    background: var(--surface-3);
  }

  .auto {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 4px;
  }

  .auto li {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    align-items: center;
    gap: 10px;
    padding: 6px 4px;
    border-bottom: 1px solid var(--border);
  }

  .auto .name {
    font-weight: 500;
    color: var(--text-2);
  }

  @media (max-width: 900px), (max-height: 540px) {
    .item {
      padding: 6px 10px;
    }
  }
</style>

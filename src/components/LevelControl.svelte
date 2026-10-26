<script lang="ts">
  interface Props {
    label: string;
    /** Reported value 0..1, or null when unknown. */
    value: number | null;
    disabled: boolean;
    busy: boolean;
    /** Dimmable controls get a slider; on/off controls only get the two buttons. */
    continuous: boolean;
    onSet: (value: number) => void;
  }

  let { label, value, disabled, busy, continuous, onSet }: Props = $props();

  let dragging = $state(false);
  let draft = $state(0);
  const shown = $derived(dragging ? draft : Math.round((value ?? 0) * 100));
  const on = $derived((value ?? 0) > 0);

  function commit(event: Event) {
    const pct = Number((event.currentTarget as HTMLInputElement).value);
    dragging = false;
    if (pct !== Math.round((value ?? 0) * 100)) onSet(pct / 100);
  }
</script>

<div class="level" class:continuous>
  <span class="pct num" class:on>{value === null ? '—' : continuous ? `${shown}%` : on ? 'On' : 'Off'}</span>
  {#if continuous}
    <input
      type="range"
      min="0"
      max="100"
      step="5"
      value={shown}
      aria-label={`${label} level`}
      style:--fill={`${shown}%`}
      {disabled}
      oninput={(e) => {
        dragging = true;
        draft = Number(e.currentTarget.value);
      }}
      onchange={commit}
    />
  {/if}
  <div class="quick">
    <button type="button" class="btn ghost" aria-label={`${label} off`} disabled={disabled || busy || !on} onclick={() => onSet(0)}>Off</button>
    {#if continuous}
      <button type="button" class="btn ghost" aria-label={`${label} 50%`} disabled={disabled || busy} onclick={() => onSet(0.5)}>50%</button>
    {/if}
    <button type="button" class="btn ghost" aria-label={`${label} ${continuous ? '100%' : 'on'}`} aria-busy={busy} disabled={disabled} onclick={() => onSet(1)}>
      {continuous ? '100%' : 'On'}
    </button>
  </div>
</div>

<style>
  .level {
    display: grid;
    grid-template-columns: 64px minmax(0, 1fr);
    align-items: center;
    gap: 6px 12px;
  }

  .level.continuous .quick {
    grid-column: 1 / -1;
  }

  .pct {
    font-size: var(--fs-xl);
    font-weight: 650;
    color: var(--text-dim);
  }

  .pct.on {
    color: var(--cyan);
  }

  input[type='range'] {
    -webkit-appearance: none;
    appearance: none;
    width: 100%;
    min-height: 44px;
    background: transparent;
    touch-action: none;
  }

  input[type='range']::-webkit-slider-runnable-track {
    height: 10px;
    border-radius: 5px;
    background: linear-gradient(90deg, var(--cyan) var(--fill), var(--surface-3) var(--fill));
  }

  input[type='range']::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 30px;
    height: 30px;
    margin-top: -10px;
    border-radius: 50%;
    background: var(--text);
    border: 3px solid var(--cyan);
  }

  input[type='range']::-moz-range-track {
    height: 10px;
    border-radius: 5px;
    background: var(--surface-3);
  }

  input[type='range']::-moz-range-progress {
    height: 10px;
    border-radius: 5px;
    background: var(--cyan);
  }

  input[type='range']::-moz-range-thumb {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    background: var(--text);
    border: 3px solid var(--cyan);
  }

  input[type='range']:disabled {
    opacity: 0.4;
  }

  .quick {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(0, 1fr);
    gap: 6px;
  }

  .quick .btn {
    min-width: 0;
    padding: 0 6px;
  }
</style>

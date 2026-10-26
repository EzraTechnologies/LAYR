<script lang="ts">
  import { formatTemp } from '../lib/format';
  import type { IconName } from '../lib/icons';
  import type { HeaterReading } from '../lib/printer/model';
  import Icon from './Icon.svelte';

  interface Props {
    label: string;
    icon: IconName;
    reading: HeaterReading | null;
    /** Text shown when the printer does not expose this heater/sensor. */
    unavailableText?: string;
  }

  let { label, icon, reading, unavailableText = 'Not available' }: Props = $props();

  /** Within this many °C of target counts as "at temperature". */
  const AT_TARGET_BAND = 2;

  const target = $derived(reading?.target ?? null);
  const temp = $derived(reading?.temperature ?? null);
  const heating = $derived(target !== null && target > 0);
  const phase = $derived.by(() => {
    if (!reading || temp === null) return 'none';
    if (target === null) return 'sensor';
    if (target <= 0) return 'off';
    if (Math.abs(temp - target) <= AT_TARGET_BAND) return 'at-target';
    return temp < target ? 'heating' : 'cooling';
  });
  const phaseLabel = $derived(
    {
      none: '',
      sensor: 'Sensor',
      off: 'Off',
      'at-target': 'At target',
      heating: 'Heating',
      cooling: 'Cooling',
    }[phase],
  );
  const powerPct = $derived(reading?.power == null ? null : Math.round(reading.power * 100));
  const fill = $derived(heating && temp !== null && target ? Math.min(1, Math.max(0, temp / target)) : 0);
  const ariaText = $derived(
    !reading || temp === null
      ? `${label}: ${unavailableText}`
      : `${label}: ${formatTemp(temp)} degrees${heating ? `, target ${formatTemp(target)} degrees` : ''}${phaseLabel ? `, ${phaseLabel}` : ''}`,
  );
</script>

<section class="card temp phase-{phase}" aria-label={ariaText}>
  <header>
    <span class="label">
      <Icon name={icon} size={18} />
      {label}
    </span>
    {#if phaseLabel}
      <span class="phase">{phaseLabel}</span>
    {/if}
  </header>

  <div class="readout">
    {#if !reading || temp === null}
      <div class="values muted" aria-hidden="true">
        <span class="current num">—<span class="unit">°C</span></span>
      </div>
      <p class="foot">{unavailableText}</p>
    {:else}
      <div class="values" aria-hidden="true">
        <span class="current num">{formatTemp(temp)}<span class="unit">°C</span></span>
        {#if target !== null}
          <span class="target num">/ {heating ? `${formatTemp(target)}°` : 'off'}</span>
        {/if}
        {#if powerPct !== null && heating}
          <span class="power num">{powerPct}%</span>
        {/if}
      </div>
      {#if target !== null}
        <div class="meter" aria-hidden="true">
          <div class="meter-fill" style:transform={`scaleX(${fill})`}></div>
        </div>
      {:else}
        <p class="foot">Read-only sensor</p>
      {/if}
    {/if}
  </div>
</section>

<style>
  .temp {
    --tone: var(--text-dim);
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 4px;
    padding: calc(var(--pad) - 2px) var(--pad);
    overflow: hidden;
  }

  .phase-heating {
    --tone: var(--heat);
  }
  .phase-at-target {
    --tone: var(--cyan);
  }
  .phase-cooling {
    --tone: var(--purple);
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .label {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-2);
    white-space: nowrap;
  }

  .phase {
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--tone);
    white-space: nowrap;
  }

  .readout {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .values {
    display: flex;
    align-items: baseline;
    gap: 8px;
    white-space: nowrap;
  }

  .values.muted .current {
    color: var(--text-dim);
  }

  .power {
    margin-left: auto;
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--text-dim);
    padding: 2px 7px;
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.04);
  }

  .current {
    font-size: var(--fs-temp);
    font-weight: 650;
    letter-spacing: -0.03em;
    line-height: 1;
  }

  .unit {
    font-size: 0.42em;
    font-weight: 600;
    color: var(--text-dim);
    margin-left: 2px;
    letter-spacing: 0;
  }

  .target {
    font-size: var(--fs-md);
    color: var(--text-dim);
    font-weight: 500;
  }

  .meter {
    height: 5px;
    border-radius: 3px;
    background: var(--surface-3);
    overflow: hidden;
  }

  .meter-fill {
    height: 100%;
    width: 100%;
    transform-origin: left center;
    background: var(--tone);
    border-radius: inherit;
    transition: transform 400ms ease-out;
  }

  .foot {
    margin: 0;
    color: var(--text-dim);
    font-size: var(--fs-xs);
    line-height: 1.1;
    white-space: nowrap;
  }
</style>

<script lang="ts">
  interface Props {
    /** 0..1, or null when unknown. */
    progress: number | null;
    tone?: 'cyan' | 'warn' | 'ok' | 'dim';
    label: string;
  }

  let { progress, tone = 'cyan', label }: Props = $props();

  const R = 52;
  const C = 2 * Math.PI * R;
  const pct = $derived(progress === null ? null : Math.floor(Math.min(1, Math.max(0, progress)) * 100));
  const offset = $derived(C * (1 - (pct ?? 0) / 100));
</script>

<div
  class="ring tone-{tone}"
  role="progressbar"
  aria-label={label}
  aria-valuemin={0}
  aria-valuemax={100}
  aria-valuenow={pct ?? undefined}
>
  <svg viewBox="0 0 120 120" aria-hidden="true">
    <defs>
      <linearGradient id="ring-gradient" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="var(--cyan)" />
        <stop offset="1" stop-color="var(--purple)" />
      </linearGradient>
    </defs>
    <circle class="track" cx="60" cy="60" r={R} />
    <circle class="value" cx="60" cy="60" r={R} stroke-dasharray={C} stroke-dashoffset={offset} />
  </svg>
  <div class="center">
    <span class="pct num">{pct ?? '—'}<small>{pct === null ? '' : '%'}</small></span>
  </div>
</div>

<style>
  .ring {
    position: relative;
    width: var(--ring-size);
    height: var(--ring-size);
    flex: none;
  }

  svg {
    width: 100%;
    height: 100%;
    transform: rotate(-90deg);
  }

  circle {
    fill: none;
    stroke-width: 9;
  }

  .track {
    stroke: var(--surface-3);
  }

  .value {
    stroke: url(#ring-gradient);
    stroke-linecap: round;
    transition: stroke-dashoffset 500ms ease-out;
  }

  .tone-warn .value {
    stroke: var(--warn);
  }
  .tone-ok .value {
    stroke: var(--ok);
  }
  .tone-dim .value {
    stroke: var(--text-dim);
  }

  .center {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
  }

  .pct {
    font-size: var(--fs-hero);
    font-weight: 700;
    letter-spacing: -0.03em;
  }

  .pct small {
    font-size: 0.5em;
    font-weight: 600;
    color: var(--text-dim);
    margin-left: 2px;
  }
</style>

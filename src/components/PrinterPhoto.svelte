<script lang="ts">
  interface Props {
    /** Blob URL created for this printer, or null for the generic placeholder. */
    src: string | null;
    onError?: () => void;
    /** Square edge in px. Omit to fill the parent. */
    size?: number;
    /** Leave generous space around the idle Home photo without shrinking its preview frame. */
    inset?: boolean;
  }

  let { src, size, onError, inset = false }: Props = $props();

  const safeSrc = $derived(src?.startsWith('blob:') ? src : null);
  let brokenSrc = $state<string | null>(null);
  const showPhoto = $derived(!!safeSrc && brokenSrc !== safeSrc);
  const label = $derived(showPhoto ? 'Printer photo' : 'Generic printer placeholder');
</script>

<div
  class="frame"
  class:fill={size === undefined}
  class:inset
  style:width={size !== undefined ? `${size}px` : undefined}
  style:height={size !== undefined ? `${size}px` : undefined}
>
  {#if showPhoto && safeSrc}
    <img
      src={safeSrc}
      alt={label}
      draggable="false"
      decoding="async"
      onerror={() => {
        brokenSrc = safeSrc;
        onError?.();
      }}
    />
  {:else}
    <div class="generic" role="img" aria-label={label}>
      <svg viewBox="0 0 160 120" aria-hidden="true">
        <rect class="shell" x="28" y="22" width="104" height="72" rx="10" />
        <path class="gantry" d="M40 42h80" />
        <rect class="head" x="72" y="36" width="18" height="14" rx="2" />
        <rect class="bed" x="44" y="70" width="72" height="8" rx="2" />
        <path class="feet" d="M44 94v8M116 94v8" />
      </svg>
    </div>
  {/if}
</div>

<style>
  .frame {
    flex: none;
    display: grid;
    min-width: 0;
    min-height: 0;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background:
      radial-gradient(circle at 50% 32%, rgba(62, 224, 240, 0.14), transparent 68%),
      var(--bg);
    overflow: hidden;
  }

  .frame.fill {
    width: 100%;
    height: 100%;
  }

  img {
    min-width: 0;
    min-height: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  .frame.inset {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr);
    place-items: center;
  }

  .inset img {
    width: 58%;
    height: 58%;
  }

  .generic {
    display: grid;
    place-items: center;
    width: 100%;
    height: 100%;
    color: var(--text-dim);
  }

  svg {
    width: 72%;
    height: 72%;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .gantry,
  .head {
    stroke: var(--cyan);
  }

  .head {
    fill: var(--cyan);
    stroke: none;
  }

  .bed {
    fill: var(--purple);
    stroke: none;
  }
</style>

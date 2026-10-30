<script lang="ts">
  import { app } from '../lib/context';
  import Icon from './Icon.svelte';

  interface Props {
    /** Thumbnail path relative to the gcodes root, or null when the file has none. */
    path: string | null;
    cacheKey: number | null;
    size: number;
    alt: string;
    /** Blob URL used when the G-code thumbnail is missing or fails to load. */
    fallbackSrc?: string | null;
    fallbackAlt?: string;
  }

  let { path, cacheKey, size, alt, fallbackSrc = null, fallbackAlt = 'Printer photo' }: Props = $props();
  const { files } = app();

  let src = $state<string | null>(null);
  let failed = $state(false);
  let fallbackBroken = $state<string | null>(null);
  const safeFallback = $derived(fallbackSrc?.startsWith('blob:') ? fallbackSrc : null);
  const showJob = $derived(!!src && !failed);
  const showFallback = $derived(!showJob && (!path || failed) && !!safeFallback && fallbackBroken !== safeFallback);

  $effect(() => {
    src = null;
    failed = false;
    if (!path) return;
    let cancelled = false;
    files
      .thumbnailUrl(path, cacheKey)
      .then((url) => {
        if (!cancelled) src = url;
      })
      .catch(() => {
        if (!cancelled) failed = true;
      });
    return () => {
      cancelled = true;
    };
  });
</script>

<div class="thumb" style:width={`${size}px`} style:height={`${size}px`}>
  {#if showJob}
    <img {src} {alt} loading="lazy" decoding="async" draggable="false" onerror={() => (failed = true)} />
  {:else if showFallback && safeFallback}
    <img src={safeFallback} alt={fallbackAlt} decoding="async" draggable="false" onerror={() => (fallbackBroken = safeFallback)} />
  {:else}
    <span class="fallback" role="img" aria-label={path && !failed ? `${alt} (loading)` : `${alt} (no preview)`}>
      <Icon name="cube" size={Math.round(size * 0.42)} strokeWidth={1.5} />
    </span>
  {/if}
</div>

<style>
  .thumb {
    flex: none;
    display: grid;
    place-items: center;
    border-radius: var(--radius-sm);
    background:
      radial-gradient(circle at 50% 35%, rgba(139, 108, 255, 0.12), transparent 70%),
      var(--bg);
    border: 1px solid var(--border);
    overflow: hidden;
  }

  img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  .fallback {
    display: grid;
    place-items: center;
    color: var(--text-dim);
    opacity: 0.6;
  }
</style>

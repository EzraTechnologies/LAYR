<script lang="ts">
  import { app } from '../lib/context';
  import { formatClock } from '../lib/format';
  import EStopButton from './EStopButton.svelte';
  import StatusPill from './StatusPill.svelte';

  const { store } = app();
  const printerState = store.state;
  const clock = $derived(formatClock(printerState.now));
</script>

<header class="bar">
  <div class="identity">
    <h1 class="name" title={printerState.printerName}>{printerState.printerName}</h1>
    {#if printerState.hostname && printerState.hostname !== printerState.printerName}
      <span class="host" title={printerState.hostname}>{printerState.hostname}</span>
    {/if}
  </div>

  <div class="right">
    <StatusPill status={printerState.status} />
    <time class="clock num" aria-label={`Time ${clock}`}>{clock}</time>
    {#if store.configured}
      <EStopButton />
    {/if}
  </div>
</header>

<style>
  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--gap);
    height: var(--bar-h);
    padding: 0 var(--pad);
    border-bottom: 1px solid var(--border);
    min-width: 0;
  }

  .identity {
    display: flex;
    align-items: baseline;
    gap: 10px;
    min-width: 0;
  }

  .name {
    margin: 0;
    font-size: var(--fs-lg);
    font-weight: 650;
    letter-spacing: -0.01em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .host {
    color: var(--text-dim);
    font-size: var(--fs-sm);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .right {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: none;
  }

  .clock {
    font-size: var(--fs-lg);
    font-weight: 600;
    color: var(--text-2);
    min-width: 3.2em;
    text-align: right;
  }

  @media (max-width: 900px) {
    .host {
      display: none;
    }
  }
</style>

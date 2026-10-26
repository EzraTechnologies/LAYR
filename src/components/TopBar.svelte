<script lang="ts">
  import { formatClock } from '../lib/format';
  import type { PrinterState } from '../lib/printer/model';
  import StatusPill from './StatusPill.svelte';

  interface Props {
    printerState: PrinterState;
    demo: boolean;
    timeZone?: string;
  }

  let { printerState, demo, timeZone }: Props = $props();
  const clock = $derived(formatClock(printerState.now, timeZone));
</script>

<header class="bar">
  <div class="identity">
    <h1 class="name" title={printerState.printerName}>{printerState.printerName}</h1>
    {#if printerState.hostname && printerState.hostname !== printerState.printerName}
      <span class="host">{printerState.hostname}</span>
    {/if}
  </div>

  <div class="right">
    {#if demo}
      <span class="demo" title="Sample data. No printer is connected and no actions can run.">Demo</span>
    {/if}
    <StatusPill status={printerState.status} />
    <time class="clock num" aria-label={`Time ${clock}`}>{clock}</time>
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

  .demo {
    display: inline-flex;
    align-items: center;
    height: 30px;
    padding: 0 12px;
    border-radius: 999px;
    font-size: var(--fs-xs);
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--purple);
    background: var(--purple-soft);
    border: 1px dashed color-mix(in srgb, var(--purple) 60%, transparent);
  }

  .clock {
    font-size: var(--fs-lg);
    font-weight: 600;
    color: var(--text-2);
    min-width: 3.2em;
    text-align: right;
  }
</style>

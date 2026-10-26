<script lang="ts">
  import ConnectionCard from '../components/ConnectionCard.svelte';
  import JobCard from '../components/JobCard.svelte';
  import TemperatureCard from '../components/TemperatureCard.svelte';
  import type { CommandGateway } from '../lib/actions/commands';
  import type { PrinterState } from '../lib/printer/model';

  interface Props {
    printerState: PrinterState;
    commands: CommandGateway;
    moonrakerUrl: string;
    demo: boolean;
    timeZone?: string;
  }

  let { printerState, commands, moonrakerUrl, demo, timeZone }: Props = $props();

  const online = $derived(printerState.status === 'ready' || printerState.status === 'printing' || printerState.status === 'paused');
  const unavailable = $derived(online ? 'Not configured' : 'No data');
</script>

<div class="dashboard">
  <div class="primary">
    {#if online}
      <JobCard {printerState} {commands} {timeZone} />
    {:else}
      <ConnectionCard {printerState} {moonrakerUrl} {demo} />
    {/if}
  </div>

  <div class="temps" aria-label="Temperatures" role="group">
    <TemperatureCard label="Nozzle" icon="nozzle" reading={printerState.extruder} unavailableText={unavailable} />
    <TemperatureCard label="Bed" icon="bed" reading={printerState.bed} unavailableText={unavailable} />
    <TemperatureCard
      label="Chamber"
      icon="chamber"
      reading={printerState.chamber}
      unavailableText={online ? 'No chamber sensor' : unavailable}
    />
  </div>
</div>

<style>
  .dashboard {
    height: 100%;
    display: grid;
    grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr);
    gap: var(--gap);
    min-height: 0;
  }

  .primary {
    display: grid;
    min-height: 0;
    min-width: 0;
  }

  .temps {
    display: grid;
    grid-template-rows: repeat(3, minmax(0, 1fr));
    gap: var(--gap);
    min-height: 0;
    min-width: 0;
  }
</style>

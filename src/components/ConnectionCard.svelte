<script lang="ts">
  import type { PrinterState } from '../lib/printer/model';
  import { STATUS_META } from '../lib/statusMeta';
  import Icon from './Icon.svelte';

  interface Props {
    printerState: PrinterState;
    moonrakerUrl: string;
    demo: boolean;
  }

  let { printerState, moonrakerUrl, demo }: Props = $props();

  // Live countdown only while waiting to retry; demo uses its frozen clock.
  let tick = $state(Date.now());
  $effect(() => {
    if (demo || printerState.nextRetryAt === null) return;
    tick = Date.now();
    const id = setInterval(() => (tick = Date.now()), 1000);
    return () => clearInterval(id);
  });

  const isError = $derived(printerState.status === 'error');
  const retryIn = $derived(
    printerState.nextRetryAt === null ? null : Math.max(0, Math.ceil((printerState.nextRetryAt - (demo ? printerState.now : tick)) / 1000)),
  );
  const title = $derived(
    isError
      ? 'Printer reports an error'
      : printerState.status === 'connecting'
        ? 'Connecting to printer'
        : printerState.klippy === 'disconnected'
          ? 'Klipper is not running'
          : 'Printer is offline',
  );
</script>

<section class="card conn" class:error={isError} aria-labelledby="conn-title" aria-live="polite">
  <div class="icon" aria-hidden="true">
    <Icon name={isError ? 'alert' : 'plug'} size={30} strokeWidth={2} />
  </div>
  <h2 id="conn-title">{title}</h2>
  {#if printerState.statusDetail}
    <p class="detail">{printerState.statusDetail}</p>
  {/if}

  <dl class="facts">
    <div>
      <dt>Moonraker</dt>
      <dd title={moonrakerUrl}>{moonrakerUrl}</dd>
    </div>
    <div>
      <dt>State</dt>
      <dd>{STATUS_META[printerState.status].label}{printerState.klippy !== 'unknown' ? ` · Klipper ${printerState.klippy}` : ''}</dd>
    </div>
    {#if printerState.transport === 'waiting'}
      <div>
        <dt>Retry</dt>
        <dd class="num">Attempt {printerState.reconnectAttempt}{retryIn !== null ? ` · next in ${retryIn}s` : ''}</dd>
      </div>
    {/if}
  </dl>

  {#if isError}
    <p class="hint">LAYR v0.1 is read-only. Resolve the error from Mainsail, Fluidd or a console; this screen updates automatically.</p>
  {/if}
</section>

<style>
  .conn {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    gap: 8px;
    padding: var(--pad) calc(var(--pad) * 2);
    overflow: hidden;
  }

  .icon {
    display: grid;
    place-items: center;
    width: 64px;
    height: 64px;
    border-radius: 50%;
    color: var(--purple);
    background: var(--purple-soft);
  }

  .error .icon {
    color: var(--danger);
    background: var(--danger-soft);
  }

  h2 {
    margin: 4px 0 0;
    font-size: var(--fs-xl);
    font-weight: 650;
  }

  .detail {
    margin: 0;
    max-width: 46ch;
    color: var(--text-2);
    font-size: var(--fs-sm);
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .error .detail {
    color: var(--danger);
  }

  .facts {
    display: grid;
    gap: 4px;
    margin: 6px 0 0;
    width: 100%;
    max-width: 420px;
  }

  .facts div {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 6px 12px;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.03);
    font-size: var(--fs-sm);
    min-width: 0;
  }

  dt {
    color: var(--text-dim);
    flex: none;
  }

  dd {
    margin: 0;
    color: var(--text-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }

  .hint {
    margin: 4px 0 0;
    max-width: 46ch;
    font-size: var(--fs-xs);
    color: var(--text-dim);
  }
</style>

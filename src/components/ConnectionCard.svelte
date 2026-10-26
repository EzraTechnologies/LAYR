<script lang="ts">
  import { app } from '../lib/context';
  import { navigate } from '../lib/routes';
  import { STATUS_META } from '../lib/statusMeta';
  import Icon from './Icon.svelte';

  const { store, ui, printer } = app();
  const printerState = store.state;
  const moonrakerUrl = printer.moonrakerUrl;

  // Live countdown only while waiting to retry.
  let tick = $state(Date.now());
  $effect(() => {
    if (printerState.nextRetryAt === null) return;
    tick = Date.now();
    const id = setInterval(() => (tick = Date.now()), 1000);
    return () => clearInterval(id);
  });

  const unconfigured = $derived(printerState.status === 'unconfigured');
  const isError = $derived(printerState.status === 'error');
  const klippyDown = $derived(
    printerState.transport === 'connected' && (printerState.klippy === 'shutdown' || printerState.klippy === 'error'),
  );
  const retryIn = $derived(
    printerState.nextRetryAt === null ? null : Math.max(0, Math.ceil((printerState.nextRetryAt - tick) / 1000)),
  );
  const title = $derived(
    unconfigured
      ? 'Connect LAYR to your printer'
      : isError
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

  {#if unconfigured}
    <p class="detail">
      No Moonraker address is set up yet. LAYR does not connect anywhere or show printer data until you choose one.
    </p>
    <button type="button" class="btn primary" onclick={() => navigate('settings')}>
      <Icon name="settings" size={18} />Set up connection
    </button>
  {:else}
    {#if printerState.statusDetail}
      <p class="detail">{printerState.statusDetail}</p>
    {/if}

    <dl class="facts">
      <div>
        <dt>Moonraker</dt>
        <dd title={moonrakerUrl ?? ''}>{moonrakerUrl}</dd>
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

    <div class="actions">
      {#if klippyDown}
        <button
          type="button"
          class="btn warn"
          aria-busy={ui.isBusy({ kind: 'firmware_restart' })}
          onclick={() => ui.run({ kind: 'firmware_restart' })}
        >
          <Icon name="refresh" size={18} />Firmware restart
        </button>
        <button type="button" class="btn" aria-busy={ui.isBusy({ kind: 'restart' })} onclick={() => ui.run({ kind: 'restart' })}>
          <Icon name="power" size={18} />Restart Klipper
        </button>
      {:else if printerState.transport === 'waiting'}
        <button type="button" class="btn" onclick={() => store.source.connection?.reconnect()}>
          <Icon name="refresh" size={18} />Retry now
        </button>
        <button type="button" class="btn ghost" onclick={() => navigate('settings')}>Connection settings</button>
      {/if}
    </div>
    {#if klippyDown}
      <p class="hint">Fix the cause shown above first. Both restarts turn heaters off and require homing again.</p>
    {/if}
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
    width: 60px;
    height: 60px;
    flex: none;
    border-radius: 50%;
    color: var(--purple);
    background: var(--purple-soft);
  }

  .error .icon {
    color: var(--danger);
    background: var(--danger-soft);
  }

  h2 {
    margin: 2px 0 0;
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
    margin: 4px 0 0;
    width: 100%;
    max-width: 420px;
  }

  .facts div {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 5px 12px;
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

  .actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 8px;
  }

  .hint {
    max-width: 46ch;
    justify-content: center;
  }

  @media (max-height: 540px) {
    .icon {
      display: none;
    }
  }
</style>

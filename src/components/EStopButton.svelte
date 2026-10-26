<script lang="ts">
  import { app } from '../lib/context';
  import Icon from './Icon.svelte';

  /** Press-and-hold duration. Long enough to rule out brushes and accidental taps, short enough for an emergency. */
  const HOLD_MS = 800;

  const { store, ui } = app();
  const availability = $derived.by(() => {
    // Re-evaluate when connection state changes.
    void store.state.transport;
    void store.state.klippy;
    return ui.gateway.availability({ kind: 'emergency_stop' });
  });

  let holding = $state(false);
  let timer: ReturnType<typeof setTimeout> | null = null;

  function start(event: PointerEvent | KeyboardEvent) {
    if (!availability.allowed || holding) return;
    if (event instanceof KeyboardEvent && event.key !== ' ' && event.key !== 'Enter') return;
    event.preventDefault();
    holding = true;
    timer = setTimeout(fire, HOLD_MS);
  }

  function cancel() {
    holding = false;
    if (timer) clearTimeout(timer);
    timer = null;
  }

  function fire() {
    timer = null;
    holding = false;
    void ui.run({ kind: 'emergency_stop' });
  }
</script>

<button
  type="button"
  class="estop"
  class:holding
  style:--hold-ms={`${HOLD_MS}ms`}
  disabled={!availability.allowed}
  aria-label="Emergency stop. Press and hold"
  title={availability.allowed ? 'Press and hold for emergency stop' : availability.message}
  onpointerdown={start}
  onpointerup={cancel}
  onpointerleave={cancel}
  onpointercancel={cancel}
  onkeydown={start}
  onkeyup={cancel}
  onblur={cancel}
  oncontextmenu={(e) => e.preventDefault()}
>
  <span class="fill" aria-hidden="true"></span>
  <Icon name="octagon" size={20} strokeWidth={2.2} />
  <span class="label">{holding ? 'Hold…' : 'STOP'}</span>
</button>

<style>
  .estop {
    position: relative;
    overflow: hidden;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    min-height: 44px;
    min-width: 104px;
    padding: 0 14px;
    border-radius: 999px;
    border: 1.5px solid color-mix(in srgb, var(--danger) 75%, transparent);
    background: var(--danger-soft);
    color: var(--danger);
    font-weight: 800;
    letter-spacing: 0.08em;
    font-size: var(--fs-sm);
    touch-action: none;
  }

  .fill {
    position: absolute;
    inset: 0;
    background: var(--danger);
    transform: scaleX(0);
    transform-origin: left center;
  }

  .holding .fill {
    transform: scaleX(1);
    transition: transform var(--hold-ms) linear;
  }

  .holding {
    color: #1a0408;
  }

  .estop > :global(.icon),
  .label {
    position: relative;
  }

  .estop:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  @media (max-width: 900px), (max-height: 540px) {
    .estop {
      min-width: 92px;
      padding: 0 10px;
    }
  }
</style>

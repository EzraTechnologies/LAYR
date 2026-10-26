<script lang="ts">
  import { app } from '../lib/context';

  const { settings } = app();
  const minutes = $derived(settings.value.dimAfterMinutes);

  let dimmed = $state(false);
  let timer: ReturnType<typeof setTimeout> | null = null;

  function arm() {
    if (timer) clearTimeout(timer);
    timer = minutes > 0 ? setTimeout(() => (dimmed = true), minutes * 60_000) : null;
  }

  $effect(() => {
    void minutes;
    dimmed = false;
    arm();
    const activity = () => {
      if (!dimmed) arm();
    };
    window.addEventListener('pointerdown', activity, { capture: true, passive: true });
    window.addEventListener('keydown', activity, { capture: true });
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener('pointerdown', activity, { capture: true });
      window.removeEventListener('keydown', activity, { capture: true });
    };
  });

  /** The waking touch is swallowed so it cannot press whatever is underneath. */
  function wake(event: Event) {
    event.preventDefault();
    event.stopPropagation();
    dimmed = false;
    arm();
  }
</script>

{#if dimmed}
  <div
    class="dim"
    style:opacity={settings.value.dimLevel}
    role="button"
    tabindex="0"
    aria-label="Screen dimmed. Tap to wake"
    onpointerdown={(e) => e.preventDefault()}
    onclick={wake}
    onkeydown={wake}
  ></div>
{/if}

<style>
  .dim {
    position: fixed;
    inset: 0;
    z-index: 100;
    background: #000;
  }
</style>

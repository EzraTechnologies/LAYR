<script lang="ts">
  interface Props {
    /** `gcode` starts in upper case; `url` starts in lower case. */
    mode: 'text' | 'url' | 'gcode';
    onKey: (text: string) => void;
    onBackspace: () => void;
  }

  let { mode, onKey, onBackspace }: Props = $props();

  // svelte-ignore state_referenced_locally
  let shift = $state(mode === 'gcode');
  let symbols = $state(false);

  const LETTERS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
  const SYMBOLS = ['!@#$%^&*()', '[]{}<>|\\~`', '\'",;?+'];
  const DIGITS = '1234567890';
  const EXTRA: Record<Props['mode'], string[]> = {
    gcode: ['-', '_', '=', '.', '/'],
    url: [':', '/', '.', '-', '_'],
    text: ['-', '_', '.', '/', '='],
  };

  const rows = $derived(symbols ? SYMBOLS : LETTERS);
  const label = (ch: string) => (symbols ? ch : shift ? ch.toUpperCase() : ch);
</script>

<div class="kb" role="group" aria-label="On-screen keyboard">
  <div class="row">
    {#each DIGITS as ch (ch)}
      <button type="button" class="key" onpointerdown={(e) => e.preventDefault()} onclick={() => onKey(ch)}>{ch}</button>
    {/each}
  </div>
  {#each rows as row, i (row)}
    <div class="row">
      {#if i === 2}
        <button
          type="button"
          class="key wide mod"
          aria-pressed={shift}
          aria-label="Shift"
          onpointerdown={(e) => e.preventDefault()}
          onclick={() => (shift = !shift)}
          disabled={symbols}>⇧</button
        >
      {/if}
      {#each row as ch (ch)}
        <button type="button" class="key" onpointerdown={(e) => e.preventDefault()} onclick={() => onKey(label(ch))}>{label(ch)}</button>
      {/each}
      {#if i === 2}
        <button type="button" class="key wide mod" aria-label="Backspace" onpointerdown={(e) => e.preventDefault()} onclick={onBackspace}
          >⌫</button
        >
      {/if}
    </div>
  {/each}
  <div class="row">
    <button
      type="button"
      class="key wide mod"
      aria-pressed={symbols}
      onpointerdown={(e) => e.preventDefault()}
      onclick={() => (symbols = !symbols)}>{symbols ? 'ABC' : '#+='}</button
    >
    {#each EXTRA[mode].slice(0, 2) as ch (ch)}
      <button type="button" class="key" onpointerdown={(e) => e.preventDefault()} onclick={() => onKey(ch)}>{ch}</button>
    {/each}
    <button type="button" class="key space" aria-label="Space" onpointerdown={(e) => e.preventDefault()} onclick={() => onKey(' ')}>space</button>
    {#each EXTRA[mode].slice(2) as ch (ch)}
      <button type="button" class="key" onpointerdown={(e) => e.preventDefault()} onclick={() => onKey(ch)}>{ch}</button>
    {/each}
  </div>
</div>

<style>
  .kb {
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-height: 0;
  }

  .row {
    display: flex;
    justify-content: center;
    gap: 5px;
  }

  .key {
    flex: 1 1 0;
    max-width: 84px;
    min-width: 44px;
    min-height: 44px;
    height: clamp(44px, 8.4vh, 52px);
    border-radius: 9px;
    border: 1px solid var(--border);
    background: var(--surface-3);
    color: var(--text);
    font-size: var(--fs-lg);
    font-weight: 550;
  }

  .key:active {
    background: color-mix(in srgb, var(--surface-3) 60%, var(--cyan) 25%);
  }

  .key.mod {
    background: var(--surface-2);
    color: var(--text-2);
    font-size: var(--fs-md);
  }

  .key.wide {
    flex-grow: 1.5;
    max-width: 120px;
  }

  .key.space {
    flex-grow: 4;
    max-width: 320px;
    font-size: var(--fs-sm);
    color: var(--text-dim);
  }

  .key[aria-pressed='true'] {
    color: var(--cyan);
    border-color: color-mix(in srgb, var(--cyan) 50%, transparent);
  }

  .key:disabled {
    opacity: 0.35;
  }
</style>

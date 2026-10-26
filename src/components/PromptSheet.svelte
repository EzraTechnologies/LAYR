<script lang="ts">
  import { app } from '../lib/context';
  import Icon from './Icon.svelte';
  import Keyboard from './Keyboard.svelte';

  const { ui, settings } = app();
  const request = $derived(ui.promptRequest);

  let value = $state('');
  let input = $state<HTMLInputElement | null>(null);
  let lastRequest: unknown = null;

  $effect(() => {
    if (request && request !== lastRequest) {
      lastRequest = request;
      value = request.value;
      queueMicrotask(() => {
        input?.focus();
        input?.setSelectionRange(value.length, value.length);
      });
    } else if (!request) {
      lastRequest = null;
    }
  });

  const numeric = $derived(request?.mode === 'number');
  const error = $derived.by(() => {
    if (!request) return null;
    if (numeric) {
      if (value.trim() === '') return 'Enter a value';
      const n = Number(value);
      if (!Number.isFinite(n)) return 'Enter a number';
      if (request.min !== undefined && n < request.min) return `Minimum ${request.min}`;
      if (request.max !== undefined && n > request.max) return `Maximum ${request.max}`;
    }
    return request.validate?.(value) ?? null;
  });

  function insert(text: string) {
    const el = input;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    value = value.slice(0, start) + text + value.slice(end);
    queueMicrotask(() => el?.setSelectionRange(start + text.length, start + text.length));
  }

  function backspace() {
    const el = input;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    if (start !== end) value = value.slice(0, start) + value.slice(end);
    else if (start > 0) value = value.slice(0, start - 1) + value.slice(start);
    const pos = start !== end ? start : Math.max(0, start - 1);
    queueMicrotask(() => el?.setSelectionRange(pos, pos));
  }

  function submit(event?: SubmitEvent) {
    event?.preventDefault();
    if (request && !error) request.resolve(value);
  }

  function onKey(event: KeyboardEvent) {
    if (request && event.key === 'Escape') request.resolve(null);
  }
</script>

<svelte:window onkeydown={onKey} />

{#if request}
  <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="prompt-title">
    <form class="top" onsubmit={submit}>
      <button type="button" class="btn ghost icon-btn" aria-label="Close" onclick={() => request.resolve(null)}>
        <Icon name="close" size={20} />
      </button>
      <div class="field">
        <label id="prompt-title" for="prompt-input">{request.title}</label>
        <div class="input-row">
          <input
            id="prompt-input"
            bind:this={input}
            bind:value
            class:num={numeric}
            type="text"
            inputmode={numeric ? 'decimal' : settings.value.onScreenKeyboard ? 'none' : request.mode === 'url' ? 'url' : 'text'}
            autocomplete="off"
            autocapitalize={request.mode === 'gcode' ? 'characters' : 'off'}
            spellcheck="false"
            placeholder={request.placeholder ?? ''}
            aria-invalid={!!error}
            aria-describedby="prompt-hint"
          />
          {#if request.unit}<span class="unit">{request.unit}</span>{/if}
        </div>
      </div>
      <button type="submit" class="btn primary submit" disabled={!!error}>{request.submitLabel ?? 'Done'}</button>
    </form>
    <p id="prompt-hint" class="hint" class:warn={!!error && value !== ''}>
      {error && value !== '' ? error : (request.hint ?? '')}
    </p>

    {#if numeric}
      <div class="numeric">
        <div class="pad" role="group" aria-label="Keypad">
          {#each ['7', '8', '9', '4', '5', '6', '1', '2', '3'] as d (d)}
            <button type="button" class="key" onclick={() => insert(d)}>{d}</button>
          {/each}
          <button type="button" class="key mod" onclick={() => (value = '')}>Clear</button>
          <button type="button" class="key" onclick={() => insert('0')}>0</button>
          <button type="button" class="key mod" aria-label="Backspace" onclick={backspace}>⌫</button>
        </div>
        {#if request.presets?.length}
          <div class="presets" role="group" aria-label="Presets">
            {#each request.presets as preset (preset)}
              <button type="button" class="btn ghost" onclick={() => (value = String(preset))}>
                {preset === 0 ? 'Off' : preset}{request.unit && preset !== 0 ? ` ${request.unit}` : ''}
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {:else if settings.value.onScreenKeyboard}
      <Keyboard mode={request.mode === 'number' ? 'text' : request.mode} onKey={insert} onBackspace={backspace} />
    {/if}
  </div>
{/if}

<style>
  .sheet {
    position: fixed;
    inset: 0;
    z-index: 45;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: var(--pad);
    background: var(--bg);
  }

  .top {
    display: flex;
    align-items: flex-end;
    gap: 10px;
  }

  .icon-btn {
    padding: 0;
    width: var(--touch);
  }

  .field {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  label {
    font-size: var(--fs-sm);
    font-weight: 650;
    color: var(--text-2);
  }

  .input-row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    padding: 0 12px;
    min-height: 52px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-strong);
    background: var(--surface);
  }

  .input-row:focus-within {
    border-color: color-mix(in srgb, var(--cyan) 60%, transparent);
  }

  input {
    flex: 1;
    min-width: 0;
    min-height: 48px;
    border: 0;
    background: transparent;
    font-size: var(--fs-lg);
    user-select: text;
    -webkit-user-select: text;
  }

  input[aria-invalid='true'] {
    color: var(--text);
  }

  .unit {
    color: var(--text-dim);
    font-weight: 600;
  }

  .submit {
    min-height: 52px;
    min-width: 96px;
  }

  .hint {
    min-height: 1.35em;
  }

  .numeric {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
    gap: var(--gap);
  }

  .pad {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    grid-auto-rows: minmax(44px, 1fr);
    gap: 6px;
    min-height: 0;
  }

  .key {
    min-height: 44px;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: var(--surface-3);
    font-size: var(--fs-xl);
    font-weight: 600;
  }

  .key.mod {
    font-size: var(--fs-md);
    color: var(--text-2);
    background: var(--surface-2);
  }

  .key:active {
    background: color-mix(in srgb, var(--surface-3) 60%, var(--cyan) 25%);
  }

  .presets {
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-auto-rows: minmax(44px, 1fr);
    gap: 6px;
    align-content: start;
    min-height: 0;
  }

  .presets .btn {
    min-width: 0;
    padding: 0 6px;
  }
</style>

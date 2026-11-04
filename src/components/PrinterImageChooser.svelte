<script lang="ts">
  import { printerImages } from '../lib/printerImage/store.svelte';
  import { formatStoredSize, printerImageStorageNote } from '../lib/printerImage/policy';
  import { PRINTER_ILLUSTRATIONS, printerIllustrationFile } from '../lib/printerImage/illustrations';
  import PrinterPhoto from './PrinterPhoto.svelte';

  const photo = $derived(printerImages.url);
  const saving = $derived(printerImages.phase === 'saving');
  const stored = $derived(photo && printerImages.bytes !== null ? formatStoredSize(printerImages.bytes) : '');

  let picker = $state<HTMLInputElement | null>(null);
  let chooseButton = $state<HTMLButtonElement | null>(null);
  let choosing = $state(false);
  let selected = $state<string | null>(null);

  function cancelSelection() {
    choosing = false;
    selected = null;
    chooseButton?.focus();
  }

  function useIllustration() {
    if (!selected || saving) return;
    const file = printerIllustrationFile(selected);
    cancelSelection();
    void printerImages.importFile(file);
  }

  function onPick(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) {
      cancelSelection();
      void printerImages.importFile(file);
    }
  }
</script>

<svelte:window onkeydown={(event) => choosing && event.key === 'Escape' && cancelSelection()} />

<div class="block">
  <span class="label" id="printer-image-label">Printer image</span>
  <div class="chooser">
    <div class="preview" aria-busy={saving}>
      <PrinterPhoto src={photo} />
    </div>
    <div class="actions">
      <button type="button" class="btn primary" bind:this={chooseButton} disabled={saving} aria-expanded={choosing} aria-controls="printer-image-options" onclick={() => { selected = null; choosing = true; }}>Choose photo</button>
      {#if photo}
        <button type="button" class="btn ghost" disabled={saving} onclick={() => printerImages.remove()}>Remove photo</button>
      {/if}
    </div>
  </div>
  {#if choosing}
    <section class="options" id="printer-image-options" aria-labelledby="printer-image-options-title">
      <div class="options-heading">
        <h3 id="printer-image-options-title">Choose a printer image</h3>
        <button type="button" class="btn ghost" onclick={cancelSelection}>Cancel</button>
      </div>
      <p class="hint">Choose an illustration using touch. No file dialog or internet connection is needed.</p>
      <div class="illustrations" role="group" aria-label="Printer illustrations">
        {#each PRINTER_ILLUSTRATIONS as illustration (illustration.id)}
          <button
            type="button"
            class="illustration"
            aria-label={`${illustration.label} printer illustration`}
            aria-pressed={selected === illustration.id}
            onclick={() => { selected = illustration.id; }}
          >
            <img src={illustration.src} alt="" draggable="false" />
            <span>{illustration.label}</span>
          </button>
        {/each}
      </div>
      <button type="button" class="btn primary" disabled={!selected || saving} onclick={useIllustration}>Use illustration</button>
      <details>
        <summary>Upload a local photo</summary>
        <p class="hint">The system file picker may not respond to touch on some tablets. Use an illustration above, or connect a keyboard or mouse before opening it. Esc on a keyboard cancels the system dialog.</p>
        <button type="button" class="btn ghost" disabled={saving} onclick={() => picker?.click()}>Open system file picker</button>
      </details>
    </section>
  {/if}
  <input
    bind:this={picker}
    id="printer-image-file"
    class="file"
    type="file"
    name="printer-image"
    accept="image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif"
    aria-label="Choose printer photo"
    onchange={onPick}
  />
  {#if stored}
    <p class="hint">Saved copy · {stored}</p>
  {/if}
  <p class="hint">
    Home shows this photo while the printer is idle, finished, or standing by. Printing and paused keep the file thumbnail, and use this photo only when that file has none.
  </p>
  <p class="hint">{printerImageStorageNote()}</p>
  {#if printerImages.error}
    <p class="hint warn" role="alert">{printerImages.error}</p>
  {/if}
</div>

<style>
  .block {
    display: grid;
    gap: 8px;
  }

  .chooser {
    display: grid;
    grid-template-columns: 96px minmax(0, 1fr);
    gap: 10px;
    align-items: center;
  }

  .preview {
    height: 96px;
    min-width: 0;
    display: grid;
  }

  .actions {
    display: grid;
    gap: 8px;
    min-width: 0;
  }

  .actions .btn {
    width: 100%;
  }

  .file {
    display: none;
  }

  .options {
    display: grid;
    gap: 10px;
    padding: 10px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
  }

  .options-heading {
    display: flex;
    align-items: center;
    gap: 8px;
    justify-content: space-between;
  }

  h3 {
    margin: 0;
    font-size: var(--fs-md);
  }

  .illustrations {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 6px;
  }

  .illustration {
    display: grid;
    gap: 6px;
    min-width: 0;
    min-height: 106px;
    padding: 6px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    color: var(--text);
    background: var(--bg);
    font: inherit;
    font-size: var(--fs-sm);
    cursor: pointer;
  }

  .illustration[aria-pressed='true'] {
    border-color: var(--cyan);
    background: var(--cyan-soft);
  }

  .illustration img {
    width: 100%;
    height: 64px;
    object-fit: contain;
  }

  details {
    display: grid;
    min-width: 0;
  }

  summary {
    min-height: 44px;
    align-content: center;
    cursor: pointer;
    color: var(--text-2);
  }

  details .btn {
    width: 100%;
    margin-top: 8px;
  }
</style>

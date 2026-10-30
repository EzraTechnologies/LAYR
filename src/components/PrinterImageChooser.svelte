<script lang="ts">
  import { printerImages } from '../lib/printerImage/store.svelte';
  import { formatStoredSize, printerImageStorageNote } from '../lib/printerImage/policy';
  import PrinterPhoto from './PrinterPhoto.svelte';

  const photo = $derived(printerImages.url);
  const saving = $derived(printerImages.phase === 'saving');
  const stored = $derived(photo && printerImages.bytes !== null ? formatStoredSize(printerImages.bytes) : '');

  let picker = $state<HTMLInputElement | null>(null);

  function onPick(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) void printerImages.importFile(file);
  }
</script>

<div class="block">
  <span class="label" id="printer-image-label">Printer image</span>
  <div class="chooser">
    <div class="preview" aria-busy={saving}>
      <PrinterPhoto src={photo} />
    </div>
    <div class="actions">
      <button type="button" class="btn primary" disabled={saving} onclick={() => picker?.click()}>Choose photo</button>
      {#if photo}
        <button type="button" class="btn ghost" disabled={saving} onclick={() => printerImages.remove()}>Remove photo</button>
      {/if}
    </div>
  </div>
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
</style>

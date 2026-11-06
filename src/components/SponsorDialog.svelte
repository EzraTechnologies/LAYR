<script lang="ts">
  import { onMount } from 'svelte';

  interface Props {
    onClose: () => void;
  }

  let { onClose }: Props = $props();
  let closeButton: HTMLButtonElement;

  onMount(() => closeButton?.focus());

  function onKey(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="backdrop" role="presentation" onpointerdown={(event) => event.target === event.currentTarget && onClose()}>
  <section class="dialog card" role="dialog" aria-modal="true" aria-labelledby="support-title" aria-describedby="support-desc">
    <h2 id="support-title">Support LAYR Development</h2>
    <p id="support-desc">LAYR is free and open-source. If it helps your printing, please consider supporting ongoing development.</p>
    <div class="qr-frame"><img src="/sponsors-qr.svg" alt="Scan to open EzraTechnologies on GitHub Sponsors" width="220" height="220" /></div>
    <p class="scan">Scan with your phone to visit GitHub Sponsors</p>
    <p class="url">github.com/sponsors/EzraTechnologies</p>
    <p class="note">Completely optional. All LAYR features remain free.</p>
    <button type="button" class="btn primary close" bind:this={closeButton} onclick={onClose}>Close</button>
  </section>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 45;
    display: grid;
    place-items: center;
    padding: var(--pad);
    background: rgba(3, 4, 7, .78);
  }
  .dialog {
    width: min(540px, 100%);
    max-height: 100%;
    overflow: auto;
    padding: 18px 22px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    text-align: center;
  }
  h2 { margin: 0; font-size: var(--fs-lg); }
  p { margin: 0; color: var(--text-2); font-size: var(--fs-sm); }
  .qr-frame {
    background: #fff;
    padding: 8px;
    border-radius: 12px;
    flex: none;
  }
  img { display: block; width: clamp(140px, 30vh, 220px); height: auto; aspect-ratio: 1; }
  .scan { color: var(--text); font-weight: 600; }
  .url { font-size: var(--fs-xs); overflow-wrap: anywhere; }
  .note { font-size: var(--fs-xs); }
  .close { min-width: 150px; min-height: 48px; }
  @media (max-height: 490px) {
    .dialog { padding: 8px 16px; gap: 5px; }
    img { width: min(140px, 25vh); }
  }
</style>

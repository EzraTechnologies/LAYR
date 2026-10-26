<script lang="ts">
  import { app } from '../lib/context';
  import Icon from './Icon.svelte';

  const { ui } = app();
  const request = $derived(ui.confirmRequest);
  let cancelButton = $state<HTMLButtonElement | null>(null);

  $effect(() => {
    // Default focus on Cancel: an accidental Enter must not confirm a hazardous action.
    if (request) cancelButton?.focus();
  });

  function onKey(event: KeyboardEvent) {
    if (request && event.key === 'Escape') request.resolve(false);
  }
</script>

<svelte:window onkeydown={onKey} />

{#if request}
  <div class="backdrop" role="presentation" onpointerdown={(e) => e.target === e.currentTarget && request.resolve(false)}>
    <div
      class="dialog card tone-{request.confirm.tone}"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      aria-describedby="confirm-body"
    >
      <div class="icon" aria-hidden="true">
        <Icon name={request.confirm.tone === 'primary' ? 'info' : 'alert'} size={26} strokeWidth={2} />
      </div>
      <h2 id="confirm-title">{request.confirm.title}</h2>
      <p id="confirm-body">{request.confirm.body}</p>
      <div class="actions">
        <button type="button" class="btn ghost" bind:this={cancelButton} onclick={() => request.resolve(false)}
          >{request.confirm.cancelLabel ?? 'Go back'}</button
        >
        <button
          type="button"
          class="btn {request.confirm.tone === 'danger' ? 'danger' : request.confirm.tone === 'warn' ? 'warn' : 'primary'}"
          onclick={() => request.resolve(true)}
        >
          {request.confirm.confirmLabel}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: grid;
    place-items: center;
    padding: var(--pad);
    background: rgba(3, 4, 7, 0.72);
  }

  .dialog {
    --tone: var(--cyan);
    --tone-soft: var(--cyan-soft);
    width: min(500px, 100%);
    max-height: 100%;
    overflow: auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 10px;
    padding: calc(var(--pad) * 1.6) calc(var(--pad) * 1.6) var(--pad);
    border-color: color-mix(in srgb, var(--tone) 35%, transparent);
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.55);
  }

  .tone-warn {
    --tone: var(--warn);
    --tone-soft: var(--warn-soft);
  }

  .tone-danger {
    --tone: var(--danger);
    --tone-soft: var(--danger-soft);
  }

  .icon {
    display: grid;
    place-items: center;
    width: 52px;
    height: 52px;
    border-radius: 50%;
    color: var(--tone);
    background: var(--tone-soft);
  }

  h2 {
    margin: 0;
    font-size: var(--fs-xl);
    font-weight: 650;
    overflow-wrap: anywhere;
  }

  p {
    margin: 0;
    color: var(--text-2);
    font-size: var(--fs-md);
    overflow-wrap: anywhere;
  }

  .actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    width: 100%;
    margin-top: 8px;
  }

  .actions .btn {
    min-height: 54px;
  }
</style>

<script lang="ts">
  import { app } from '../lib/context';
  import Icon from './Icon.svelte';

  const { ui } = app();
  const ICON = { ok: 'check', error: 'alert', warn: 'alert', info: 'info' } as const;
</script>

<div class="toasts" role="status" aria-live="polite">
  {#each ui.toasts as toast (toast.id)}
    <button type="button" class="toast tone-{toast.tone}" onclick={() => ui.dismissToast(toast.id)} title="Dismiss">
      <Icon name={ICON[toast.tone]} size={18} strokeWidth={2} />
      <span class="text">
        <strong>{toast.title}</strong>
        {#if toast.detail}<span class="detail">{toast.detail}</span>{/if}
      </span>
    </button>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    right: var(--pad);
    bottom: var(--pad);
    z-index: 40;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 8px;
    width: min(420px, calc(100vw - var(--rail-w) - var(--pad) * 2));
    pointer-events: none;
  }

  .toast {
    --tone: var(--cyan);
    pointer-events: auto;
    display: flex;
    align-items: flex-start;
    gap: 10px;
    width: 100%;
    min-height: var(--touch);
    padding: 10px 14px;
    border-radius: var(--radius-sm);
    border: 1px solid color-mix(in srgb, var(--tone) 40%, transparent);
    background: color-mix(in srgb, var(--surface-2) 92%, var(--tone) 8%);
    box-shadow: 0 12px 30px rgba(0, 0, 0, 0.45);
    color: var(--tone);
    text-align: left;
  }

  .tone-ok {
    --tone: var(--ok);
  }
  .tone-warn {
    --tone: var(--warn);
  }
  .tone-error {
    --tone: var(--danger);
  }

  .text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  strong {
    color: var(--text);
    font-size: var(--fs-sm);
    font-weight: 650;
    overflow-wrap: anywhere;
  }

  .detail {
    color: var(--text-2);
    font-size: var(--fs-xs);
    overflow-wrap: anywhere;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
</style>

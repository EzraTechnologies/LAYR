<script lang="ts">
  import type { PrinterStatus } from '../lib/printer/model';
  import { STATUS_META } from '../lib/statusMeta';

  interface Props {
    status: PrinterStatus;
    label?: string;
  }

  let { status, label }: Props = $props();
  const meta = $derived(STATUS_META[status]);
</script>

<span class="pill tone-{meta.tone}" role="status" aria-label={`Printer status: ${label ?? meta.label}`}>
  <span class="dot" aria-hidden="true"></span>
  {label ?? meta.label}
</span>

<style>
  .pill {
    --tone: var(--text-dim);
    --tone-soft: rgba(255, 255, 255, 0.06);
    display: inline-flex;
    align-items: center;
    gap: 7px;
    height: 30px;
    padding: 0 12px 0 10px;
    border-radius: 999px;
    background: var(--tone-soft);
    border: 1px solid color-mix(in srgb, var(--tone) 30%, transparent);
    color: var(--tone);
    font-size: var(--fs-sm);
    font-weight: 600;
    white-space: nowrap;
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--tone);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--tone) 22%, transparent);
  }

  .tone-cyan {
    --tone: var(--cyan);
    --tone-soft: var(--cyan-soft);
  }
  .tone-purple {
    --tone: var(--purple);
    --tone-soft: var(--purple-soft);
  }
  .tone-ok {
    --tone: var(--ok);
    --tone-soft: var(--ok-soft);
  }
  .tone-warn {
    --tone: var(--warn);
    --tone-soft: var(--warn-soft);
  }
  .tone-danger {
    --tone: var(--danger);
    --tone-soft: var(--danger-soft);
  }
</style>

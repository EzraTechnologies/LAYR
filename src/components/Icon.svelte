<script lang="ts">
  import { ICONS, type IconName } from '../lib/icons';

  interface Props {
    name: IconName;
    size?: number;
    strokeWidth?: number;
    label?: string;
  }

  let { name, size = 24, strokeWidth = 1.8, label }: Props = $props();
</script>

<svg
  class="icon"
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width={strokeWidth}
  stroke-linecap="round"
  stroke-linejoin="round"
  role={label ? 'img' : undefined}
  aria-label={label}
  aria-hidden={label ? undefined : 'true'}
  focusable="false"
>
  {#each ICONS[name] as d (d)}
    <path {d} />
  {/each}
</svg>

<style>
  .icon {
    flex: none;
    display: block;
  }
</style>

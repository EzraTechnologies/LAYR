<script lang="ts">
  import Icon from './Icon.svelte';
  import { ROUTES, type RouteId } from '../lib/routes';

  interface Props {
    current: RouteId;
  }

  let { current }: Props = $props();
</script>

<nav class="rail" aria-label="Main">
  <div class="brand" aria-label="LAYR">
    <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <!-- userSpaceOnUse: bounding-box gradients do not render on zero-height horizontal strokes. -->
        <linearGradient id="layr-mark" gradientUnits="userSpaceOnUse" x1="6" y1="9" x2="26" y2="23">
          <stop offset="0" style:stop-color="var(--cyan)" />
          <stop offset="1" style:stop-color="var(--purple)" />
        </linearGradient>
      </defs>
      <g fill="none" stroke="url(#layr-mark)" stroke-width="3" stroke-linecap="round">
        <path d="M6 9h20" />
        <path d="M6 16h15" />
        <path d="M6 23h10" />
      </g>
    </svg>
    <span class="wordmark">LAYR</span>
  </div>

  <ul>
    {#each ROUTES as route (route.id)}
      <li>
        <a
          href={`#/${route.id}`}
          class:active={current === route.id}
          aria-current={current === route.id ? 'page' : undefined}
        >
          <Icon name={route.icon} size={22} />
          <span>{route.label}</span>
        </a>
      </li>
    {/each}
  </ul>
</nav>

<style>
  .rail {
    grid-row: 1 / -1;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: var(--gap);
    padding: var(--pad) 8px;
    border-right: 1px solid var(--border);
    background: rgba(10, 12, 17, 0.6);
    min-height: 0;
  }

  .brand {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding-bottom: 4px;
  }

  .wordmark {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.24em;
    margin-right: -0.24em;
    color: var(--text-2);
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-auto-rows: minmax(var(--touch), 1fr);
    gap: 3px;
    flex: 1;
    min-height: 0;
  }

  li {
    display: grid;
    min-height: 0;
  }

  a {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    min-height: var(--touch);
    padding: 4px 2px;
    border-radius: var(--radius-sm);
    color: var(--text-dim);
    text-decoration: none;
    font-size: var(--fs-xs);
    font-weight: 600;
    transition:
      background-color 150ms ease,
      color 150ms ease;
  }

  a:active {
    background: var(--surface-3);
  }

  a.active {
    color: var(--text);
    background: linear-gradient(135deg, var(--cyan-soft), var(--purple-soft));
  }

  a.active::before {
    content: '';
    position: absolute;
    left: -8px;
    top: 22%;
    bottom: 22%;
    width: 3px;
    border-radius: 0 3px 3px 0;
    background: var(--accent-gradient);
  }

  a.active :global(.icon) {
    color: var(--cyan);
  }

  @media (max-height: 640px) {
    .wordmark {
      display: none;
    }
  }

  @media (max-height: 540px) {
    .brand {
      display: none;
    }
    .rail {
      padding: 8px 6px;
      gap: 0;
    }
    a {
      gap: 0;
      padding: 2px;
    }
  }
</style>

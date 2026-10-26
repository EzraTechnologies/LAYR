<script lang="ts">
  import { app } from '../lib/context';
  import Icon from './Icon.svelte';

  const { store } = app();
  const fans = $derived(store.state.fans.slice(0, 3));
</script>

<a class="card fans" href="#/fans" aria-label="Fans">
  <span class="label"><Icon name="fan" size={18} />Fans</span>
  {#if fans.length === 0}
    <span class="none">No fan data</span>
  {:else}
    <ul>
      {#each fans as fan (fan.object)}
        <li>
          <span class="name" title={fan.label}>{fan.label}</span>
          <span class="num value" class:on={(fan.speed ?? 0) > 0}>{fan.speed === null ? '—' : `${Math.round(fan.speed * 100)}%`}</span>
        </li>
      {/each}
    </ul>
  {/if}
</a>

<style>
  .fans {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: calc(var(--pad) - 2px) var(--pad);
    color: inherit;
    text-decoration: none;
    overflow: hidden;
  }

  .label {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-2);
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
  }

  li {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .name {
    font-size: var(--fs-xs);
    color: var(--text-dim);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .value {
    font-size: var(--fs-lg);
    font-weight: 650;
    color: var(--text-2);
  }

  .value.on {
    color: var(--cyan);
  }

  .none {
    font-size: var(--fs-sm);
    color: var(--text-dim);
  }
</style>

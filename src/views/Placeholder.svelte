<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import type { IconName } from '../lib/icons';

  interface Props {
    title: string;
    icon: IconName;
    summary: string;
    planned: string[];
    safety?: string;
  }

  let { title, icon, summary, planned, safety }: Props = $props();
</script>

<section class="card placeholder" aria-labelledby="ph-title">
  <header>
    <div class="badge" aria-hidden="true"><Icon name={icon} size={28} /></div>
    <div class="titles">
      <h2 id="ph-title">{title}</h2>
      <p>{summary}</p>
    </div>
    <span class="soon">Coming later</span>
  </header>

  <ul>
    {#each planned as item (item)}
      <li><Icon name="sparkle" size={16} />{item}</li>
    {/each}
  </ul>

  {#if safety}
    <p class="safety"><Icon name="lock" size={16} />{safety}</p>
  {/if}
</section>

<style>
  .placeholder {
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: calc(var(--gap) * 1.25);
    padding: calc(var(--pad) + 4px) calc(var(--pad) + 8px);
    overflow: auto;
  }

  header {
    display: flex;
    align-items: center;
    gap: 14px;
  }

  .badge {
    display: grid;
    place-items: center;
    width: 56px;
    height: 56px;
    flex: none;
    border-radius: var(--radius-sm);
    color: var(--cyan);
    background: linear-gradient(135deg, var(--cyan-soft), var(--purple-soft));
  }

  .titles {
    flex: 1;
    min-width: 0;
  }

  h2 {
    margin: 0;
    font-size: var(--fs-xl);
  }

  .titles p {
    margin: 2px 0 0;
    color: var(--text-dim);
    font-size: var(--fs-sm);
  }

  .soon {
    flex: none;
    padding: 5px 11px;
    border-radius: 999px;
    font-size: var(--fs-xs);
    font-weight: 650;
    color: var(--purple);
    background: var(--purple-soft);
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 8px;
  }

  li {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    border-radius: var(--radius-sm);
    background: rgba(255, 255, 255, 0.025);
    border: 1px solid var(--border);
    color: var(--text-2);
    font-size: var(--fs-md);
  }

  li :global(.icon) {
    color: var(--purple);
  }

  .safety {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: auto 0 0;
    font-size: var(--fs-sm);
    color: var(--text-dim);
  }
</style>

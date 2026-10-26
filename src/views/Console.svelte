<script lang="ts">
  import { tick } from 'svelte';
  import Icon from '../components/Icon.svelte';
  import { normaliseConsoleInput } from '../lib/actions/commands';
  import { app } from '../lib/context';
  import { formatClock } from '../lib/format';

  const { store, ui, console: log, consoleDraft } = app();
  const printerState = store.state;
  const connected = $derived(printerState.transport === 'connected');

  // svelte-ignore state_referenced_locally
  let draft = $state(consoleDraft.value);
  consoleDraft.value = '';
  let list = $state<HTMLElement | null>(null);
  let pinned = true;

  $effect(() => {
    void log.lines.length;
    if (pinned) void tick().then(() => list?.scrollTo({ top: list.scrollHeight }));
  });

  function onScroll() {
    if (!list) return;
    pinned = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
  }

  async function edit() {
    const value = await ui.prompt({
      title: 'G-code command',
      value: draft,
      mode: 'gcode',
      placeholder: 'e.g. QUERY_ENDSTOPS',
      hint: 'One command per line. You will confirm before it is sent.',
      submitLabel: 'Done',
      validate: (v) => (v.trim() === '' ? null : (() => {
        const n = normaliseConsoleInput(v);
        return n.ok ? null : n.message;
      })()),
    });
    if (value !== null) draft = value;
  }

  async function send() {
    const outcome = await ui.run({ kind: 'gcode', script: draft });
    if (outcome.status === 'ok' || outcome.status === 'failed' || outcome.status === 'unconfirmed') draft = '';
  }

  const sendCheck = $derived(ui.gateway.availability({ kind: 'gcode', script: draft || 'STATUS' }));
  const busy = $derived(ui.busyGroups.includes('console'));
</script>

<div class="console page">
  <section class="card log-card" aria-labelledby="console-title">
    <h2 id="console-title" class="sr-only">Console</h2>
    <ol class="log scroll" bind:this={list} onscroll={onScroll} aria-live="polite" aria-label="G-code responses">
      {#if log.lines.length === 0}
        <li class="placeholder">{connected ? 'No messages yet.' : 'Printer is offline.'}</li>
      {/if}
      {#each log.lines as line (line.id)}
        <li class="line kind-{line.kind}">
          <time class="num">{formatClock(line.time)}</time>
          <span class="text">{line.kind === 'command' ? `> ${line.text}` : line.text}</span>
        </li>
      {/each}
    </ol>
  </section>

  <div class="input-row">
    <button type="button" class="btn ghost field" onclick={edit} aria-label="Edit command">
      <Icon name="keyboard" size={18} />
      <span class="draft num" class:placeholder={!draft} title={draft}>{draft || 'Tap to type a command'}</span>
    </button>
    {#if draft}
      <button type="button" class="btn ghost clear" aria-label="Clear command" onclick={() => (draft = '')}>
        <Icon name="close" size={18} />
      </button>
    {/if}
    <button
      type="button"
      class="btn primary send"
      disabled={!draft.trim() || !sendCheck.allowed}
      aria-busy={busy}
      onclick={send}
    >
      <Icon name="send" size={18} />Send
    </button>
  </div>
  {#if !sendCheck.allowed}
    <p class="hint warn"><Icon name="lock" size={14} />{sendCheck.message}</p>
  {/if}
</div>

<style>
  .console {
    display: flex;
    flex-direction: column;
    gap: var(--gap);
  }

  .log-card {
    flex: 1;
    min-height: 0;
    display: flex;
    overflow: hidden;
  }

  .log {
    flex: 1;
    min-height: 0;
    list-style: none;
    margin: 0;
    padding: 10px 12px;
    font-family: ui-monospace, 'DejaVu Sans Mono', Menlo, Consolas, monospace;
    font-size: var(--fs-sm);
    user-select: text;
    -webkit-user-select: text;
  }

  .line {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 10px;
    padding: 2px 0;
  }

  time {
    color: var(--text-dim);
  }

  .text {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    color: var(--text-2);
  }

  .kind-command .text {
    color: var(--cyan);
  }

  .kind-error .text {
    color: var(--danger);
  }

  .kind-warning .text {
    color: var(--warn);
  }

  .placeholder {
    color: var(--text-dim);
  }

  .input-row {
    display: flex;
    gap: 8px;
    min-width: 0;
  }

  .field {
    flex: 1;
    justify-content: flex-start;
    min-width: 0;
    min-height: 52px;
  }

  .draft {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: ui-monospace, 'DejaVu Sans Mono', Menlo, Consolas, monospace;
    color: var(--text);
  }

  .draft.placeholder {
    color: var(--text-dim);
    font-family: var(--font);
    font-weight: 500;
  }

  .clear {
    padding: 0;
    width: 52px;
    min-height: 52px;
  }

  .send {
    min-height: 52px;
    min-width: 110px;
  }
</style>

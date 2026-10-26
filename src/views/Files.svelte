<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import Thumb from '../components/Thumb.svelte';
  import { app } from '../lib/context';
  import { formatBytes, parentDir, pickThumbnail, type FileEntry, type SortKey } from '../lib/files/files';
  import { displayFilename, formatDate, formatDuration, formatFilament } from '../lib/format';
  import { navigate } from '../lib/routes';

  const { store, ui, files } = app();
  const printerState = store.state;
  const connected = $derived(printerState.transport === 'connected');

  const SORTS: Array<{ id: SortKey; label: string }> = [
    { id: 'modified', label: 'Newest' },
    { id: 'name', label: 'Name' },
    { id: 'time', label: 'Print time' },
    { id: 'size', label: 'Size' },
  ];

  let selected = $state<FileEntry | null>(null);

  $effect(() => {
    if (connected && !files.loaded && !files.loading) void files.load();
  });

  // Keep the detail sheet in sync after a reload (metadata may arrive later).
  const detail = $derived(selected ? (files.files.find((f) => f.path === selected!.path) ?? selected) : null);

  async function startPrint(file: FileEntry) {
    const outcome = await ui.run({ kind: 'start_print', filename: file.path });
    if (outcome.status === 'ok') {
      selected = null;
      navigate('home');
    }
  }

  async function remove(file: FileEntry) {
    const outcome = await ui.run({ kind: 'delete_file', path: file.path });
    if (outcome.status === 'ok') {
      selected = null;
      void files.load();
    }
  }

  function metaLine(file: FileEntry): string {
    const parts: string[] = [];
    if (file.meta?.estimatedTime) parts.push(formatDuration(file.meta.estimatedTime));
    if (file.meta?.filamentTotal) parts.push(formatFilament(file.meta.filamentTotal));
    if (file.meta?.filamentType) parts.push(file.meta.filamentType);
    if (parts.length === 0) parts.push(formatBytes(file.size));
    return parts.join(' · ');
  }

  const startCheck = $derived(detail ? ui.gateway.availability({ kind: 'start_print', filename: detail.path }) : null);
  const deleteCheck = $derived(detail ? ui.gateway.availability({ kind: 'delete_file', path: detail.path }) : null);
</script>

<div class="files page">
  <header class="toolbar">
    <div class="crumbs">
      {#if files.dir}
        <button type="button" class="btn ghost back" aria-label="Up one folder" onclick={() => files.open(parentDir(files.dir))}>
          <Icon name="back" size={20} />
        </button>
      {/if}
      <h2 class="path" title={`gcodes/${files.dir}`}>{files.dir ? files.dir.split('/').pop() : 'G-code files'}</h2>
    </div>
    <div class="seg sort" role="radiogroup" aria-label="Sort files">
      {#each SORTS as sort (sort.id)}
        <button type="button" role="radio" aria-checked={files.sort === sort.id} onclick={() => (files.sort = sort.id)}>
          {sort.label}
        </button>
      {/each}
    </div>
    <button
      type="button"
      class="btn ghost refresh"
      aria-label="Refresh file list"
      aria-busy={files.loading}
      disabled={!connected}
      onclick={() => files.load()}
    >
      <Icon name="refresh" size={20} />
    </button>
  </header>

  <div class="list-wrap card">
    {#if !connected}
      <div class="empty fill">
        <Icon name="plug" size={32} />
        <strong>Printer is offline</strong>
        <span>Files appear when LAYR is connected to Moonraker.</span>
      </div>
    {:else if files.error && !files.loaded}
      <div class="empty fill">
        <Icon name="alert" size={32} />
        <strong>Could not load files</strong>
        <span>{files.error}</span>
        <button type="button" class="btn" onclick={() => files.load()}>Try again</button>
      </div>
    {:else if files.loaded && files.dirs.length === 0 && files.files.length === 0}
      <div class="empty fill">
        <Icon name="folder" size={32} />
        <strong>No G-code files here</strong>
        <span>Upload files from your slicer, Mainsail or Fluidd.</span>
      </div>
    {:else}
      <ul class="list scroll" aria-label="Files" aria-busy={files.loading}>
        {#each files.dirs as dir (dir.path)}
          <li>
            <button type="button" class="row" onclick={() => files.open(dir.path)}>
              <span class="folder-icon"><Icon name="folder" size={28} /></span>
              <span class="text">
                <span class="name" title={dir.name}>{dir.name}</span>
                <span class="meta">Folder</span>
              </span>
              <Icon name="chevron" size={20} />
            </button>
          </li>
        {/each}
        {#each files.sorted as file (file.path)}
          <li>
            <button type="button" class="row" onclick={() => (selected = file)}>
              <Thumb
                path={pickThumbnail(file.meta?.thumbnails ?? [], 64)?.path ?? null}
                cacheKey={file.modified}
                size={56}
                alt={displayFilename(file.name)}
              />
              <span class="text">
                <span class="name" title={file.name}>{displayFilename(file.name)}</span>
                <span class="meta">{metaLine(file)}</span>
              </span>
              <span class="date">{formatDate(file.modified)}</span>
              <Icon name="chevron" size={20} />
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>

{#if detail}
  <div class="sheet-backdrop" role="presentation" onpointerdown={(e) => e.target === e.currentTarget && (selected = null)}>
    <div class="sheet card" role="dialog" aria-modal="true" aria-labelledby="file-title">
      <div class="preview">
        <Thumb
          path={pickThumbnail(detail.meta?.thumbnails ?? [], 300)?.path ?? null}
          cacheKey={detail.modified}
          size={220}
          alt={displayFilename(detail.name)}
        />
      </div>
      <div class="info">
        <div class="info-head">
          <h2 id="file-title" class="title" title={detail.path}>{displayFilename(detail.name)}</h2>
          <button type="button" class="btn ghost close" aria-label="Close" onclick={() => (selected = null)}>
            <Icon name="close" size={20} />
          </button>
        </div>
        <dl class="facts">
          <div><dt>Print time</dt><dd class="num">{formatDuration(detail.meta?.estimatedTime)}</dd></div>
          <div><dt>Filament</dt><dd class="num">{formatFilament(detail.meta?.filamentTotal)}{detail.meta?.filamentWeight ? ` · ${detail.meta.filamentWeight.toFixed(1)} g` : ''}</dd></div>
          <div><dt>Material</dt><dd title={detail.meta?.filamentName ?? ''}>{detail.meta?.filamentType ?? '—'}</dd></div>
          <div><dt>Layer</dt><dd class="num">{detail.meta?.layerHeight ? `${detail.meta.layerHeight} mm` : '—'}</dd></div>
          <div><dt>Temps</dt><dd class="num">{detail.meta?.firstLayerExtruderTemp ? `${detail.meta.firstLayerExtruderTemp}° / ${detail.meta.firstLayerBedTemp ?? '—'}°` : '—'}</dd></div>
          <div><dt>Size</dt><dd class="num">{formatBytes(detail.size)}</dd></div>
          <div class="wide"><dt>Slicer</dt><dd title={detail.meta?.slicer ?? ''}>{detail.meta?.slicer ?? '—'}</dd></div>
          <div class="wide"><dt>Modified</dt><dd class="num">{formatDate(detail.modified)}</dd></div>
        </dl>
        {#if startCheck && !startCheck.allowed}
          <p class="hint warn"><Icon name="lock" size={14} />{startCheck.message}</p>
        {/if}
        <div class="actions">
          <button
            type="button"
            class="btn danger"
            disabled={!deleteCheck?.allowed}
            aria-busy={ui.isBusy({ kind: 'delete_file', path: detail.path })}
            onclick={() => remove(detail)}
          >
            <Icon name="trash" size={18} />Delete
          </button>
          <button
            type="button"
            class="btn primary start"
            disabled={!startCheck?.allowed}
            aria-busy={ui.isBusy({ kind: 'start_print', filename: detail.path })}
            onclick={() => startPrint(detail)}
          >
            <Icon name="play" size={18} />Print
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .files {
    display: flex;
    flex-direction: column;
    gap: var(--gap);
  }

  .toolbar {
    display: flex;
    align-items: center;
    gap: var(--gap);
    min-width: 0;
  }

  .crumbs {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .back,
  .refresh,
  .close {
    padding: 0;
    width: var(--touch);
    flex: none;
  }

  .path {
    margin: 0;
    font-size: var(--fs-lg);
    font-weight: 650;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .sort {
    flex: none;
  }

  .list-wrap {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .fill {
    flex: 1;
  }

  .list {
    list-style: none;
    margin: 0;
    padding: 6px;
    flex: 1;
    min-height: 0;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    min-height: 68px;
    padding: 6px 10px 6px 6px;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-dim);
    text-align: left;
  }

  .row:active {
    background: var(--surface-3);
  }

  li + li .row {
    border-top: 1px solid var(--border);
    border-radius: 0;
  }

  .folder-icon {
    display: grid;
    place-items: center;
    width: 56px;
    height: 56px;
    flex: none;
    border-radius: var(--radius-sm);
    color: var(--purple);
    background: var(--purple-soft);
  }

  .text {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .name {
    color: var(--text);
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .meta,
  .date {
    font-size: var(--fs-sm);
    color: var(--text-dim);
    white-space: nowrap;
  }

  .sheet-backdrop {
    position: fixed;
    inset: 0;
    z-index: 30;
    display: grid;
    place-items: center;
    padding: var(--pad);
    background: rgba(3, 4, 7, 0.7);
  }

  .sheet {
    width: min(820px, 100%);
    max-height: 100%;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: calc(var(--gap) * 1.5);
    padding: calc(var(--pad) + 4px);
    overflow: auto;
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.55);
  }

  .info {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-width: 0;
  }

  .info-head {
    display: flex;
    align-items: flex-start;
    gap: 8px;
  }

  .title {
    flex: 1;
    margin: 0;
    font-size: var(--fs-xl);
    font-weight: 650;
    overflow-wrap: anywhere;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .facts {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px 14px;
    margin: 0;
  }

  .facts div {
    min-width: 0;
  }

  .facts .wide {
    grid-column: 1 / -1;
  }

  dt {
    font-size: var(--fs-xs);
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 600;
  }

  dd {
    margin: 1px 0 0;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .actions {
    display: grid;
    grid-template-columns: 1fr 1.6fr;
    gap: 10px;
    margin-top: auto;
  }

  .actions .btn {
    min-height: 54px;
  }

  @media (max-width: 900px), (max-height: 540px) {
    .date {
      display: none;
    }
    .sort button {
      padding: 0 6px;
      font-size: var(--fs-xs);
    }
    .sheet :global(.thumb) {
      width: 150px !important;
      height: 150px !important;
    }
    .row {
      min-height: 60px;
    }
  }
</style>

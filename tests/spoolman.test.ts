import { describe, expect, it, vi } from 'vitest';
import { CommandGateway } from '../src/lib/actions/gateway';
import { prepareCommand } from '../src/lib/actions/commands';
import { MoonrakerClient, RpcError } from '../src/lib/moonraker/client';
import { ConsoleLog } from '../src/lib/console/console.svelte';
import { Ui } from '../src/lib/ui.svelte';
import type { PrinterConnection } from '../src/lib/printer/source';
import {
  formatLength,
  isSpoolmanAbsentError,
  parseActiveSpool,
  parseSpoolmanProxy,
  parseSpoolmanStatus,
  spoolmanDetailParams,
  spoolmanListParams,
  spoolmanProxyAllowed,
  spoolmanWriteAllowed,
  spoolQuantityLine,
} from '../src/lib/spoolman/api';
import { SpoolmanStore } from '../src/lib/spoolman/store.svelte';
import { emptySpoolmanFacts, shouldClearAfterUnload, type SpoolmanFacts, type SpoolSummary } from '../src/lib/spoolman/types';
import { FakeMoonraker } from './fakeMoonraker';
import { readyState, withJob } from './stateFixture';

const spool = (patch: Partial<SpoolSummary> = {}): SpoolSummary => ({
  id: 4,
  name: 'Galaxy',
  material: 'ASA',
  vendor: 'Polymaker',
  colorHex: 'ff6a00',
  colors: ['#ff6a00'],
  remainingWeightG: 420,
  remainingLengthMm: 1400,
  usedWeightG: 80,
  spoolWeightG: 500,
  archived: false,
  location: 'dry box',
  lot: 'L1',
  ...patch,
});

function facts(patch: Partial<SpoolmanFacts> = {}): SpoolmanFacts {
  return {
    ...emptySpoolmanFacts('p1', 'ready'),
    activeKnown: true,
    activeId: 4,
    ids: [4, 5],
    names: { 4: 'Galaxy', 5: 'Empty' },
    archived: [5],
    ...patch,
  };
}

describe('Spoolman parsing', () => {
  it('reads status, an empty active spool, and a v2 catalogue', () => {
    expect(parseSpoolmanStatus({ spoolman_connected: true, spool_id: 4 })).toEqual({ ok: true, connected: true, activeKnown: true, spoolId: 4 });
    expect(parseSpoolmanStatus({ spoolman_connected: false, spool_id: null })).toMatchObject({ connected: false, activeKnown: true, spoolId: null });
    expect(parseSpoolmanStatus({ spoolman_connected: true })).toMatchObject({ activeKnown: false });
    expect(parseActiveSpool({ spool_id: null })).toEqual({ ok: true, spoolId: null });
    const parsed = parseSpoolmanProxy({
      response: [
        {
          id: 4,
          remaining_weight: 420.4,
          remaining_length: 1412,
          used_weight: 10,
          archived: false,
          filament: { name: 'Galaxy', material: 'ASA', color_hex: 'FF6A00', weight: 500, vendor: { name: 'Polymaker' }, multi_color_hexes: 'ff6a00,ffffff' },
        },
        { id: 'nope' },
        { id: 5, archived: true, filament: { name: '  Old   PETG ', material: 'PETG' } },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.received).toBe(3);
    expect(parsed.spools.map((item) => item.id)).toEqual([4, 5]);
    expect(parsed.spools[0]).toMatchObject({ colors: ['#ff6a00', '#ffffff'], remainingWeightG: 420.4, remainingLengthMm: 1412, vendor: 'Polymaker' });
    expect(parsed.spools[1]?.name).toBe('Old PETG');
    expect(spoolQuantityLine(parsed.spools[0]!)).toContain('420 g left');
    expect(formatLength(1412)).toBe('1.41 m');
    expect(spoolQuantityLine(spool({ remainingWeightG: null, remainingLengthMm: null, usedWeightG: null, spoolWeightG: null }))).toBe('Weight not reported');
  });

  it('treats a down Spoolman, a bad body, and a missing method as distinct', () => {
    expect(parseSpoolmanProxy({ error: { status_code: 503, message: 'Spoolman server not available' } })).toMatchObject({ ok: false, offline: true });
    expect(parseSpoolmanProxy({ error: { message: 'boom' } })).toMatchObject({ ok: false, offline: false, error: 'boom' });
    expect(parseSpoolmanStatus(null)).toMatchObject({ ok: false });
    expect(isSpoolmanAbsentError(new RpcError('Method not found', -32601))).toBe(true);
    expect(isSpoolmanAbsentError(new RpcError('Spoolman database is locked', 400))).toBe(false);
    expect(isSpoolmanAbsentError(new Error('socket'))).toBe(false);
  });

  it('allow-lists proxy reads and spool id writes', () => {
    expect(spoolmanProxyAllowed(spoolmanListParams(0))).toBe(true);
    expect(spoolmanProxyAllowed(spoolmanListParams(100))).toBe(true);
    expect(spoolmanProxyAllowed(spoolmanDetailParams(4))).toBe(true);
    expect(spoolmanProxyAllowed({ ...spoolmanListParams(0), request_method: 'POST' })).toBe(false);
    expect(spoolmanProxyAllowed({ ...spoolmanListParams(0), path: '/v1/spool/../secret' })).toBe(false);
    expect(spoolmanProxyAllowed({ ...spoolmanListParams(0), query: 'allow_archived=true&limit=100&offset=0&extra=1' })).toBe(false);
    expect(spoolmanProxyAllowed({ ...spoolmanDetailParams(4), query: 'x=1' })).toBe(false);
    expect(spoolmanProxyAllowed({ use_v2_response: true, request_method: 'GET', path: 'http://evil/v1/spool', query: spoolmanListParams(0).query })).toBe(false);
    expect(spoolmanWriteAllowed({ spool_id: 4 })).toBe(true);
    expect(spoolmanWriteAllowed({ spool_id: null })).toBe(true);
    expect(spoolmanWriteAllowed({ spool_id: 0 })).toBe(false);
    expect(spoolmanWriteAllowed({ spool_id: 4, extra: true })).toBe(false);
    expect(spoolmanWriteAllowed({ spool_id: true })).toBe(false);
  });

  it('ignores embedded URLs instead of treating them as colour', () => {
    const parsed = parseSpoolmanProxy({
      response: { id: 8, filament: { name: 'URL', color_hex: 'http://filament.example/red.png', extra: { image: 'https://cdn.example/a.png' } } },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.spools[0]?.colors).toEqual([]);
  });
});

describe('Spoolman commands', () => {
  const state = readyState({ macros: [{ name: 'UNLOAD_FILAMENT', description: null, params: [], requiredParams: [], hidden: false }] });

  it('confirms a set, refuses the current spool, and warns for archived spools', () => {
    const set = prepareCommand({ kind: 'set_active_spool', spoolId: 5 }, state, { spoolman: facts(), gcodeCommands: null });
    expect(set.ok && set.plan.confirm).toMatchObject({ tone: 'warn', confirmLabel: 'Set active spool' });
    expect(set.ok && set.plan).toMatchObject({ method: 'server.spoolman.post_spool_id', params: { spool_id: 5 } });
    expect(prepareCommand({ kind: 'set_active_spool', spoolId: 4 }, state, { spoolman: facts(), gcodeCommands: null }).ok).toBe(false);
    expect(prepareCommand({ kind: 'set_active_spool', spoolId: 9 }, state, { spoolman: facts(), gcodeCommands: null }).ok).toBe(false);
  });

  it('locks spool changes while printing or when the catalogue belongs to another printer', () => {
    const printing = prepareCommand({ kind: 'set_active_spool', spoolId: 5 }, withJob(state, 'printing'), { spoolman: facts(), gcodeCommands: null });
    expect(printing.ok).toBe(false);
    if (!printing.ok) expect(printing.message).toMatch(/print is active/);
    const other = prepareCommand({ kind: 'clear_active_spool' }, state, { spoolman: facts({ printerId: 'other' }), gcodeCommands: null });
    expect(other.ok).toBe(false);
  });

  it('clears only after a confirmed unload and keeps the spool otherwise', () => {
    expect(shouldClearAfterUnload({ kind: 'confirmed-success' })).toBe(true);
    expect(shouldClearAfterUnload({ kind: 'failed', reason: 'no' })).toBe(false);
    expect(shouldClearAfterUnload({ kind: 'cancelled' })).toBe(false);
    expect(shouldClearAfterUnload({ kind: 'unconfirmed', reason: 'timeout' })).toBe(false);
    const unload = prepareCommand({ kind: 'unload_for_spool_clear', macro: 'UNLOAD_FILAMENT' }, state, { spoolman: facts(), gcodeCommands: null });
    expect(unload.ok && unload.plan.confirm?.body).toMatch(/only if Klipper accepts/);
    const clear = prepareCommand({ kind: 'clear_active_spool', authorized: true }, state, { spoolman: facts(), gcodeCommands: null });
    expect(clear.ok && clear.plan.params).toEqual({ spool_id: null });
    const unknown = prepareCommand({ kind: 'clear_active_spool', authorized: true }, state, { spoolman: facts({ activeKnown: false, activeId: null }), gcodeCommands: null });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.message).toMatch(/kept/);
    const needs = prepareCommand({ kind: 'unload_for_spool_clear', macro: 'HEATSOAK' }, readyState(), { spoolman: facts(), gcodeCommands: null });
    expect(needs.ok).toBe(false);
  });

  it('hides weights when Spoolman is offline by refusing writes', () => {
    const offline = prepareCommand({ kind: 'set_active_spool', spoolId: 5 }, state, { spoolman: facts({ phase: 'offline', message: 'down', ids: [] }), gcodeCommands: null });
    expect(offline.ok).toBe(false);
  });
});

describe('SpoolmanStore', () => {
  function harness(handler: (method: string, params?: Record<string, unknown>) => Promise<unknown>) {
    const calls: string[] = [];
    let onSpool: ((notice: { kind: 'link'; connected: boolean | null } | { kind: 'active'; spoolId: number | null }) => void) | null = null;
    const connection = {
      hasApiKey: false,
      connected: true,
      call: (method: string, params?: Record<string, unknown>) => {
        calls.push(method);
        return handler(method, params);
      },
      httpUrl: (path: string) => path,
      fetchHttp: () => Promise.reject(new Error('unused')),
      reconnect: () => {},
      onReady: () => () => {},
      onGcodeResponse: () => () => {},
      onFilelistChanged: () => () => {},
      onSpoolman: (listener: typeof onSpool) => {
        onSpool = listener;
        return () => {
          onSpool = null;
        };
      },
    } as PrinterConnection;
    const state = readyState();
    let current = facts();
    const gateway = new CommandGateway(connection, () => state, { context: () => ({ spoolman: current, gcodeCommands: null }) });
    const ui = new Ui(gateway, new ConsoleLog(null));
    const store = new SpoolmanStore('p1', connection, gateway, ui, (next) => {
      current = next;
    });
    return { store, calls, notify: (notice: Parameters<NonNullable<typeof onSpool>>[0]) => onSpool?.(notice), connection };
  }

  const body = {
    response: [
      { id: 4, remaining_weight: 10, filament: { name: 'Galaxy', material: 'ASA', color_hex: 'ff6a00', vendor: { name: 'Polymaker' } } },
    ],
  };

  it('loads a catalogue and ignores a stale page after disconnect', async () => {
    const gate: { release: (() => void) | null } = { release: null };
    const { store, calls } = harness(async (method) => {
      if (method === 'server.info') return { components: ['spoolman'] };
      if (method === 'server.spoolman.status') return { spoolman_connected: true, spool_id: 4 };
      if (method === 'server.spoolman.get_spool_id') return { spool_id: 4 };
      if (method === 'server.spoolman.proxy') {
        await new Promise<void>((resolve) => {
          gate.release = resolve;
        });
        return body;
      }
      throw new RpcError('Method not found', -32601);
    });
    const pending = store.refresh();
    await vi.waitFor(() => expect(gate.release).not.toBeNull());
    store.observe('waiting', 'unknown', 'p1', 1);
    gate.release?.();
    await pending;
    expect(store.facts.phase).toBe('stale');
    expect(store.spools).toEqual([]);
    expect(calls).toContain('server.spoolman.proxy');
  });

  it('stays absent when Moonraker has no Spoolman component and does not invent spools', async () => {
    const { store, calls } = harness(async (method) => {
      if (method === 'server.info') return { components: ['file_manager'] };
      throw new Error(`unexpected ${method}`);
    });
    await store.refresh();
    expect(store.facts.phase).toBe('absent');
    expect(store.navVisible).toBe(false);
    expect(calls).toEqual(['server.info']);
    await expect(store.listSpools('other')).rejects.toThrow(/different printer/);
    expect(await store.listSpools('p1')).toEqual([]);
    expect(await store.getActiveSpool('p1')).toBeNull();
  });

  it('reports offline without listing, and keeps the spool when an unload is not accepted', async () => {
    const { store } = harness(async (method) => {
      if (method === 'server.info') return { components: ['spoolman'] };
      if (method === 'server.spoolman.status') return { spoolman_connected: false, spool_id: 4 };
      throw new Error(method);
    });
    await store.refresh();
    expect(store.facts.phase).toBe('offline');
    expect(store.spools).toEqual([]);
    expect(store.navVisible).toBe(true);
    await store.clearActiveSpoolAfterUnload('p1', { kind: 'failed', reason: 'no' });
    await store.clearActiveSpoolAfterUnload('p1', { kind: 'cancelled' });
    expect(store.facts.activeId).toBeNull();
  });

  it('drops the link when Spoolman goes offline and updates the active id from a notification', async () => {
    const { store, notify } = harness(async (method) => {
      if (method === 'server.info') return { components: ['spoolman'] };
      if (method === 'server.spoolman.status') return { spoolman_connected: true, spool_id: 4 };
      if (method === 'server.spoolman.get_spool_id') return { spool_id: 4 };
      if (method === 'server.spoolman.proxy') return body;
      if (method === 'server.spoolman.post_spool_id') return { spool_id: null };
      throw new RpcError('Method not found', -32601);
    });
    store.observe('connected', 'ready', 'p1', 0);
    await vi.waitFor(() => expect(store.facts.phase).toBe('ready'));
    expect(store.spools).toHaveLength(1);
    expect(await store.getActiveSpool('p1')).toMatchObject({ id: 4, material: 'ASA' });
    notify({ kind: 'active', spoolId: 9 });
    expect(store.facts.activeId).toBe(9);
    expect((await store.getActiveSpool('p1'))?.name).toBe('Spool 9');
    notify({ kind: 'link', connected: false });
    expect(store.facts.phase).toBe('offline');
    expect(store.spools).toEqual([]);
  });
});

describe('Moonraker client spoolman guard', () => {
  it('does not send a proxy call outside the allow-list', async () => {
    vi.useFakeTimers();
    const server = new FakeMoonraker();
    const client = new MoonrakerClient({
      baseUrl: 'http://printer.local:7125',
      onEvent: () => {},
      createSocket: server.createSocket,
      requestTimeoutMs: 1000,
      now: () => Date.now(),
    });
    client.start();
    await vi.advanceTimersByTimeAsync(0);
    const before = server.calls.length;
    await expect(client.call('server.spoolman.proxy', { request_method: 'POST', path: '/v1/spool', use_v2_response: true })).rejects.toThrow(/not allowed/);
    expect(server.calls.length).toBe(before);
    client.stop();
    vi.useRealTimers();
  });
});

import { describe, expect, it } from 'vitest';
import { CommandGateway } from '../src/lib/actions/gateway';
import { resetIntegrationRuntime, setIntegrationRuntime } from '../src/lib/integrations/runtime';
import { RpcError } from '../src/lib/moonraker/client';
import type { PrinterConnection } from '../src/lib/printer/source';
import {
  detailProxyParams,
  listProxyParams,
  materialMismatch,
  parseProxy,
  parseSpool,
  quantityText,
  spoolmanProxyAllowed,
  spoolmanWriteAllowed,
} from '../src/lib/spoolman/api';
import { SpoolmanCancelled, SpoolmanSession, type SpoolmanIo } from '../src/lib/spoolman/session';
import type { UnloadOutcome } from '../src/lib/spoolman/types';
import { readyState, withJob } from './stateFixture';

function raw(id: number, extra: Record<string, unknown> = {}) {
  const name = typeof extra.name === 'string' ? extra.name : `Spool ${id}`;
  return {
    id,
    remaining_weight: 842.4,
    remaining_length: 311_200,
    filament: { name, material: 'ASA', color_hex: '1C1C1C', vendor: { name: 'Polymaker' } },
    extra: { photo: 'https://example.invalid/spool.png' },
  };
}

function scripted(handler: SpoolmanIo['call']): SpoolmanIo {
  return {
    printerId: 'p1',
    endpoint: 'http://printer.local:7125',
    call: handler,
    execute: null,
    confirm: null,
  };
}

describe('Spoolman proxy allow-list', () => {
  it('allows the documented list and detail reads, and nothing else', () => {
    expect(spoolmanProxyAllowed(listProxyParams(0))).toBe(true);
    expect(spoolmanProxyAllowed(listProxyParams(100))).toBe(true);
    expect(spoolmanProxyAllowed(detailProxyParams(7))).toBe(true);
    expect(spoolmanProxyAllowed({ ...listProxyParams(0), request_method: 'POST' })).toBe(false);
    expect(spoolmanProxyAllowed({ ...listProxyParams(0), query: 'limit=100' })).toBe(false);
    expect(spoolmanProxyAllowed({ ...detailProxyParams(7), path: '/v1/spool/../secret' })).toBe(false);
    expect(spoolmanProxyAllowed({ ...detailProxyParams(7), path: 'https://example.invalid/v1/spool/7' })).toBe(false);
    expect(spoolmanProxyAllowed({ ...listProxyParams(0), body: '{}' })).toBe(false);
    expect(spoolmanWriteAllowed({ spool_id: 4 })).toBe(true);
    expect(spoolmanWriteAllowed({ spool_id: null })).toBe(true);
    expect(spoolmanWriteAllowed({ spool_id: 1.5 })).toBe(false);
    expect(spoolmanWriteAllowed({ spool_id: true })).toBe(false);
    expect(spoolmanWriteAllowed({ spool_id: 4, other: 1 })).toBe(false);
  });
});

describe('Spoolman parsing', () => {
  it('reads material, colour, and remaining quantity, and drops image URLs', () => {
    const page = parseProxy({
      response: [
        raw(7, { name: 'Galaxy Black' }),
        { id: 3, filament: { name: 'Clearance Red', material: 'PLA', multi_color_hexes: 'D7263D,FFFFFF' } },
        { id: 'nope', filament: { name: 'Bad' } },
      ],
    });
    expect(page.ok).toBe(true);
    expect(page.received).toBe(3);
    expect(page.spools).toHaveLength(2);
    const galaxy = page.spools[0]!;
    expect(galaxy).toMatchObject({
      id: 7,
      name: 'Galaxy Black',
      material: 'ASA',
      vendor: 'Polymaker',
      colorHex: '1c1c1c',
      remainingWeightG: 842.4,
      remainingLengthMm: 311_200,
    });
    expect(JSON.stringify(galaxy)).not.toContain('example.invalid');
    expect(quantityText(galaxy)).toBe('842 g · 311 m left');
    expect(page.spools[1]).toMatchObject({ colorHex: 'd7263d', remainingWeightG: null, remainingLengthMm: null });
    expect(quantityText(page.spools[1]!)).toBe('Quantity not reported');
    expect(parseSpool({ id: 9, remaining_weight: 0, remaining_length: 0, filament: { name: 'Empty', material: 'PETG' } })).toMatchObject({
      remainingWeightG: 0,
      remainingLengthMm: 0,
    });
    expect(quantityText({ remainingWeightG: 0, remainingLengthMm: 0 })).toBe('0 g · 0 mm left');
  });

  it('classifies unauthorized and offline proxy errors without a catalogue', () => {
    expect(parseProxy({ error: { status_code: 401, message: 'Unauthorized' } })).toMatchObject({ ok: false, failure: 'unauthorized', spools: [] });
    expect(parseProxy({ error: { status_code: 503, message: 'Spoolman server not available' } })).toMatchObject({ ok: false, failure: 'offline', spools: [] });
  });

  it('warns when a file asks for a different material and stays quiet when either side is missing', () => {
    const spool = parseSpool(raw(1, { name: 'Galaxy', material: 'ASA' }))!;
    expect(materialMismatch('PETG', spool)).toMatch(/PETG/);
    expect(materialMismatch('asa', spool)).toBeNull();
    expect(materialMismatch(null, spool)).toBeNull();
    expect(materialMismatch('PETG', { ...spool, material: null })).toBeNull();
  });
});

describe('Spoolman session', () => {
  it('ignores a stale response after the printer disconnects', async () => {
    let release: (value: unknown) => void = () => {};
    const session = new SpoolmanSession(scripted(() => new Promise((resolve) => {
      release = resolve;
    })));
    const first = session.refresh();
    await Promise.resolve();
    expect(session.snapshot.phase).toBe('loading');
    session.dropConnection();
    release({ spoolman_connected: true, spool_id: 4, response: [raw(4, { name: 'Too late' })] });
    await first;
    expect(session.snapshot.spools).toEqual([]);
    expect(JSON.stringify(session.snapshot)).not.toContain('Too late');
    expect(session.snapshot.message).toMatch(/hidden/);
  });

  it('hides Spoolman and ignores later reads after the switch turns it off', async () => {
    const calls: string[] = [];
    const session = new SpoolmanSession(scripted(async (method) => {
      calls.push(method);
      if (method === 'server.spoolman.status') return { spoolman_connected: true, spool_id: 4 };
      if (method === 'server.spoolman.get_spool_id') return { spool_id: 4 };
      return { response: [raw(4, { name: 'Galaxy Black' })] };
    }));
    await session.onServerInfo({ components: ['spoolman'] });
    expect(session.snapshot.tracked).toBe(true);
    expect(session.snapshot.spools[0]?.name).toBe('Galaxy Black');
    const seen = calls.length;
    session.suspend();
    expect(session.snapshot.tracked).toBe(false);
    expect(session.snapshot.phase).toBe('idle');
    expect(session.snapshot.spools).toEqual([]);
    await session.refresh();
    session.onNotice({ kind: 'active', spoolId: 9, known: true });
    await session.onServerInfo({ components: ['spoolman'] });
    expect(calls).toHaveLength(seen);
    expect(session.snapshot.tracked).toBe(false);
    session.activate();
    await session.onServerInfo({ components: ['spoolman'] });
    expect(session.snapshot.tracked).toBe(true);
    expect(session.snapshot.spools[0]?.name).toBe('Galaxy Black');
  });

  it('loads every list page', async () => {
    const session = new SpoolmanSession(scripted(async (method, params) => {
      if (method === 'server.spoolman.status') return { spoolman_connected: true, spool_id: 1 };
      if (method === 'server.spoolman.get_spool_id') return { spool_id: 1 };
      const offset = Number(new URLSearchParams(String(params?.query ?? '')).get('offset'));
      const page = offset === 0 ? Array.from({ length: 100 }, (_, index) => raw(index + 1)) : [raw(101, { name: 'Last' })];
      return { response: page };
    }));
    await session.onServerInfo({ components: ['spoolman'] });
    expect(session.snapshot.phase).toBe('ready');
    expect(session.snapshot.spools).toHaveLength(101);
    expect(session.snapshot.spools.at(-1)?.name).toBe('Last');
    expect(session.snapshot.activeId).toBe(1);
  });

  it('stays absent without weights when the component or method is missing', async () => {
    const calls: string[] = [];
    const missing = new SpoolmanSession(scripted(async (method) => {
      calls.push(method);
      throw new RpcError('Method not found', -32601);
    }));
    await missing.onServerInfo({ components: ['database', 'machine'] });
    expect(missing.snapshot.phase).toBe('absent');
    expect(missing.snapshot.tracked).toBe(false);
    expect(calls).toEqual([]);

    const probed = new SpoolmanSession(scripted(async () => {
      throw new RpcError('Method not found', -32601);
    }));
    await probed.onServerInfo({});
    expect(probed.snapshot.phase).toBe('absent');
    expect(probed.snapshot.spools).toEqual([]);

    const failed = new SpoolmanSession(scripted(async () => ({ spoolman_connected: true })));
    await failed.onServerInfo({ failed_components: ['spoolman'], components: ['database'] });
    expect(failed.snapshot.phase).toBe('failed');
    expect(failed.snapshot.spools).toEqual([]);
    expect(failed.snapshot.message).toMatch(/failed to start/);
  });

  it('hides quantities when Spoolman is offline or unauthorized', async () => {
    const offline = new SpoolmanSession(scripted(async (method) => {
      if (method === 'server.spoolman.status') return { spoolman_connected: false, spool_id: 7 };
      throw new Error(`unexpected ${method}`);
    }));
    await offline.onServerInfo({ components: ['spoolman'] });
    expect(offline.snapshot.phase).toBe('offline');
    expect(offline.snapshot.spools).toEqual([]);
    expect(offline.snapshot.activeId).toBeNull();
    expect(JSON.stringify(offline.snapshot)).not.toMatch(/\d+ g/);

    const denied = new SpoolmanSession(scripted(async () => {
      throw new RpcError('Unauthorized', 401);
    }));
    await denied.onServerInfo({ components: ['spoolman'] });
    expect(denied.snapshot.phase).toBe('unauthorized');
    expect(denied.snapshot.spools).toEqual([]);
    expect(denied.snapshot.message).toMatch(/API key/);
  });

  it('does not show one printer’s spools for another printer or URL', async () => {
    const spoolFor = (name: string) => async (method: string) => {
      if (method === 'server.spoolman.status') return { spoolman_connected: true, spool_id: 4 };
      if (method === 'server.spoolman.get_spool_id') return { spool_id: 4 };
      if (method === 'server.spoolman.proxy') return { response: [raw(4, { name })] };
      throw new Error(method);
    };
    const alpha = new SpoolmanSession({ ...scripted(spoolFor('Only On A')), printerId: 'a', endpoint: 'http://a:7125' });
    const beta = new SpoolmanSession({ ...scripted(spoolFor('Only On B')), printerId: 'b', endpoint: 'http://b:7125' });
    await alpha.onServerInfo({ components: ['spoolman'] });
    expect(alpha.snapshot.spools.map((spool) => spool.name)).toEqual(['Only On A']);
    await expect(beta.listSpools('a')).rejects.toThrow(/not associated/);
    expect(beta.snapshot.spools).toEqual([]);
    alpha.retarget('http://other:7125');
    expect(alpha.snapshot.endpoint).toBe('http://other:7125');
    expect(alpha.snapshot.spools).toEqual([]);
    expect(JSON.stringify(alpha.snapshot)).not.toContain('Only On A');
    await beta.onServerInfo({ components: ['spoolman'] });
    expect(beta.snapshot.spools.map((spool) => spool.name)).toEqual(['Only On B']);
    expect(JSON.stringify(beta.snapshot)).not.toContain('Only On A');
  });

  it('follows active-spool and link notifications without keeping offline weights', async () => {
    const session = new SpoolmanSession(scripted(async (method) => {
      if (method === 'server.spoolman.status') return { spoolman_connected: true, spool_id: 4 };
      if (method === 'server.spoolman.get_spool_id') return { spool_id: 4 };
      if (method === 'server.spoolman.proxy') return { response: [raw(4, { name: 'Charcoal' })] };
      throw new Error(method);
    }));
    await session.onServerInfo({ components: ['spoolman'] });
    session.onNotice({ kind: 'active', spoolId: null, known: true });
    expect(session.snapshot.activeId).toBeNull();
    expect(session.snapshot.spools).toHaveLength(1);
    session.onNotice({ kind: 'link', connected: false });
    expect(session.snapshot.phase).toBe('offline');
    expect(session.snapshot.spools).toEqual([]);
  });

  it('writes only through a confirmed gateway, and clears only after Klipper accepts the unload', async () => {
    setIntegrationRuntime({ spoolman: true, happyHare: false, afc: false });
    let state = readyState({ printerId: 'p1' });
    const calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
    const connection: PrinterConnection = {
      hasApiKey: false,
      connected: true,
      call: (method, params) => {
        calls.push({ method, params });
        return Promise.resolve({ spool_id: params?.spool_id ?? null }) as Promise<never>;
      },
      httpUrl: (path) => path,
      fetchHttp: () => Promise.reject(new Error('unused')),
      reconnect: () => {},
      onReady: () => () => {},
      onGcodeResponse: () => () => {},
      onFilelistChanged: () => () => {},
      onTransport: () => () => {},
      onServerInfo: () => () => {},
      onSpoolmanNotice: () => () => {},
    };
    const gateway = new CommandGateway(connection, () => state);
    let accept = false;
    const session = new SpoolmanSession({
      printerId: 'p1',
      endpoint: 'http://printer.local:7125',
      call: connection.call,
      execute: (command, options) => gateway.execute(command, options),
      confirm: async () => accept,
    });
    session.snapshot = {
      ...session.snapshot,
      phase: 'ready',
      tracked: true,
      activeId: 4,
      activeKnown: true,
      spools: [{ id: 4, name: 'Charcoal', material: 'ASA', vendor: null, colorHex: null, remainingWeightG: 10, remainingLengthMm: null, archived: false }],
    };

    await expect(session.setActiveSpool('p1', 8)).rejects.toBeInstanceOf(SpoolmanCancelled);
    expect(calls).toEqual([]);
    accept = true;
    await session.setActiveSpool('p1', 8);
    expect(calls).toEqual([{ method: 'server.spoolman.post_spool_id', params: { spool_id: 8 } }]);

    state = withJob(readyState({ printerId: 'p1' }), 'printing');
    await expect(session.setActiveSpool('p1', 4)).rejects.toThrow(/locked/);
    expect(calls).toHaveLength(1);

    state = readyState({ printerId: 'p1' });
    const kept: UnloadOutcome[] = [
      { kind: 'failed', reason: 'Move out of range' },
      { kind: 'unconfirmed', reason: 'no reply' },
      { kind: 'cancelled' },
    ];
    for (const outcome of kept) {
      const result = await session.clearAfterUnload('p1', outcome);
      expect(result).not.toBe('cleared');
    }
    expect(calls).toHaveLength(1);
    await expect(session.clearAfterUnload('other', { kind: 'confirmed-success' })).rejects.toThrow(/not associated/);
    expect(calls).toHaveLength(1);
    expect(await session.clearAfterUnload('p1', { kind: 'confirmed-success' })).toBe('cleared');
    expect(calls.at(-1)).toEqual({ method: 'server.spoolman.post_spool_id', params: { spool_id: null } });
    expect(session.snapshot.activeId).toBeNull();
    resetIntegrationRuntime();
  });
});

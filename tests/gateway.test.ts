import { describe, expect, it, vi } from 'vitest';
import { CommandGateway } from '../src/lib/actions/gateway';
import { RpcError, RpcUnconfirmedError } from '../src/lib/moonraker/client';
import type { PrinterState } from '../src/lib/printer/model';
import type { PrinterConnection } from '../src/lib/printer/source';
import { readyState, withJob } from './stateFixture';

function fakeConnection(impl: (method: string, params?: Record<string, unknown>) => Promise<unknown> = async () => 'ok') {
  const calls: Array<{ method: string; params?: Record<string, unknown>; timeoutMs?: number }> = [];
  const connection: PrinterConnection = {
    hasApiKey: false,
    connected: true,
    call: (method, params, options) => {
      calls.push({ method, params, timeoutMs: options?.timeoutMs });
      return impl(method, params) as Promise<never>;
    },
    httpUrl: (p) => p,
    fetchHttp: () => Promise.reject(new Error('unused')),
    reconnect: () => {},
    onReady: () => () => {},
    onGcodeResponse: () => () => {},
    onFilelistChanged: () => () => {},
    onTransport: () => () => {},
    onServerInfo: () => () => {},
    onSpoolmanNotice: () => () => {},
  };
  return { connection, calls };
}

describe('CommandGateway', () => {
  it('refuses everything when no endpoint is configured', async () => {
    const gateway = new CommandGateway(null, () => readyState());
    expect(gateway.live).toBe(false);
    expect(gateway.availability({ kind: 'home', axes: [] })).toEqual({ allowed: false, message: 'Set up the printer connection in Settings' });
    expect(await gateway.execute({ kind: 'emergency_stop' })).toMatchObject({ status: 'blocked' });
  });

  it('requires an explicit confirmation for hazardous commands and sends nothing until then', async () => {
    const { connection, calls } = fakeConnection();
    const gateway = new CommandGateway(connection, () => withJob(readyState(), 'printing'));
    const first = await gateway.execute({ kind: 'cancel' });
    expect(first).toMatchObject({ status: 'needs_confirmation', confirm: { confirmLabel: 'Cancel print' } });
    expect(calls).toEqual([]);
    expect(await gateway.execute({ kind: 'cancel' }, { confirmed: true })).toMatchObject({ status: 'ok', summary: 'Cancel print' });
    expect(calls.map((c) => c.method)).toEqual(['printer.print.cancel']);
  });

  it('re-validates against the latest state at execution time', async () => {
    const { connection, calls } = fakeConnection();
    let state: PrinterState = readyState();
    const gateway = new CommandGateway(connection, () => state);
    expect(gateway.availability({ kind: 'home', axes: [] }).allowed).toBe(true);
    state = withJob(readyState(), 'printing');
    expect(await gateway.execute({ kind: 'home', axes: [] })).toMatchObject({ status: 'blocked' });
    state = readyState({ transport: 'waiting', status: 'disconnected' });
    expect(await gateway.execute({ kind: 'start_print', filename: 'a.gcode' }, { confirmed: true })).toEqual({
      status: 'blocked',
      message: 'Printer is offline',
    });
    expect(calls).toEqual([]);
  });

  it('rejects repeated taps while the same group is in flight, but never blocks the emergency stop', async () => {
    let release: () => void = () => {};
    const { connection, calls } = fakeConnection(
      (method) => (method === 'printer.gcode.script' ? new Promise((resolve) => (release = () => resolve('ok'))) : Promise.resolve('ok')),
    );
    const gateway = new CommandGateway(connection, () => readyState());
    const busy: string[][] = [];
    gateway.onBusyChange((groups) => busy.push([...groups]));

    const first = gateway.execute({ kind: 'home', axes: [] });
    expect(await gateway.execute({ kind: 'home', axes: [] })).toMatchObject({ status: 'busy' });
    expect(await gateway.execute({ kind: 'jog', axis: 'x', distance: 1, speed: 50 })).toMatchObject({ status: 'busy' });
    // Other groups are independent.
    expect(gateway.isBusy('motion')).toBe(true);
    expect(await gateway.execute({ kind: 'emergency_stop' })).toMatchObject({ status: 'ok' });
    release();
    expect(await first).toMatchObject({ status: 'ok', summary: 'Home all axes' });
    expect(gateway.isBusy('motion')).toBe(false);
    expect(calls.map((c) => c.method)).toEqual(['printer.gcode.script', 'printer.emergency_stop']);
    expect(busy).toEqual([['motion'], []]);
  });

  it('reports Klipper errors as failed and lost replies as unconfirmed', async () => {
    const { connection } = fakeConnection(async (_m, params) => {
      if (params?.script === 'G28') throw new RpcError('!! Must home axis first: 0.000 0.000 0.000 [0.000]', 400);
      throw new RpcUnconfirmedError('Connection closed before Moonraker replied');
    });
    const gateway = new CommandGateway(connection, () => readyState());
    expect(await gateway.execute({ kind: 'home', axes: [] })).toEqual({
      status: 'failed',
      summary: 'Home all axes',
      message: 'Must home axis first: 0.000 0.000 0.000 [0.000]',
    });
    expect(await gateway.execute({ kind: 'set_fan', fan: 'fan', speed: 1 })).toMatchObject({
      status: 'unconfirmed',
      message: expect.stringContaining('Check the printer before retrying'),
    });
    expect(gateway.isBusy('motion')).toBe(false);
  });

  it('passes long timeouts for slow commands', async () => {
    const { connection, calls } = fakeConnection();
    const gateway = new CommandGateway(connection, () => readyState());
    await gateway.execute({ kind: 'home', axes: [] });
    await gateway.execute({ kind: 'macro', name: 'LOAD_FILAMENT' }, { confirmed: true });
    expect(calls.map((c) => c.timeoutMs)).toEqual([180_000, 15 * 60_000]);
  });

  it('keeps a jog busy until the new position is reported', async () => {
    vi.useFakeTimers();
    try {
      const { connection } = fakeConnection();
      let state = readyState();
      const gateway = new CommandGateway(connection, () => state, { settleTimeoutMs: 1000, settlePollMs: 50 });
      const jog = gateway.execute({ kind: 'jog', axis: 'x', distance: 10, speed: 50 });
      await vi.advanceTimersByTimeAsync(100);
      expect(gateway.isBusy('motion')).toBe(true);
      expect(await gateway.execute({ kind: 'jog', axis: 'x', distance: 10, speed: 50 })).toMatchObject({ status: 'busy' });
      state = readyState({ toolhead: { position: [135, 125, 10, 0] } });
      await vi.advanceTimersByTimeAsync(50);
      expect(await jog).toMatchObject({ status: 'ok' });
      expect(gateway.isBusy('motion')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

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

  it('sends printer host power only after confirmation, and only on this connection', async () => {
    const idle = readyState({ hostMachine: 'available', printState: 'standby', hostname: 'trident', idleState: 'Idle' });
    const { connection, calls } = fakeConnection();
    const other = fakeConnection();
    const gateway = new CommandGateway(connection, () => idle);
    const elsewhere = new CommandGateway(other.connection, () => idle);
    const preview = await gateway.execute({ kind: 'host_reboot' });
    expect(preview).toMatchObject({
      status: 'needs_confirmation',
      confirm: { title: 'Reboot the printer host?', confirmLabel: 'Reboot printer host' },
    });
    expect(calls).toEqual([]);
    expect(await gateway.execute({ kind: 'host_reboot' }, { confirmed: true })).toMatchObject({
      status: 'ok',
      summary: 'Reboot printer host',
      note: expect.stringContaining('does not mean the printer host has finished restarting'),
    });
    expect(calls).toEqual([{ method: 'machine.reboot', params: undefined, timeoutMs: 15_000 }]);
    expect(other.calls).toEqual([]);
    await elsewhere.execute({ kind: 'host_shutdown' }, { confirmed: true });
    expect(calls).toHaveLength(1);
    expect(other.calls.map((call) => call.method)).toEqual(['machine.shutdown']);
    expect(other.calls[0]?.params).toBeUndefined();
  });

  it('re-checks print and connection state before a confirmed host action is sent', async () => {
    const { connection, calls } = fakeConnection();
    let state = readyState({ hostMachine: 'available', printState: 'standby', hostname: 'trident', idleState: 'Idle' });
    const gateway = new CommandGateway(connection, () => state);
    expect((await gateway.execute({ kind: 'host_shutdown' })).status).toBe('needs_confirmation');
    state = withJob(state, 'printing');
    expect(await gateway.execute({ kind: 'host_shutdown' }, { confirmed: true })).toMatchObject({
      status: 'blocked',
      message: 'Not available during a print',
    });
    state = readyState({
      hostMachine: 'available',
      printState: 'standby',
      transport: 'waiting',
      status: 'disconnected',
    });
    expect(await gateway.execute({ kind: 'host_reboot' }, { confirmed: true })).toEqual({
      status: 'blocked',
      message: 'Printer is offline',
    });
    expect(calls).toEqual([]);
  });

  it('treats a dropped host socket as unconfirmed and an auth error as a failure', async () => {
    const idle = readyState({ hostMachine: 'available', printState: 'standby', hostname: 'trident', idleState: 'Idle' });
    const { connection } = fakeConnection(async (method) => {
      if (method === 'machine.reboot') throw new RpcUnconfirmedError('Connection closed before Moonraker replied');
      if (method === 'machine.shutdown') throw new RpcError('Unauthorized', 401);
      throw new RpcError('Cannot reboot from within a docker container', 400);
    });
    const gateway = new CommandGateway(connection, () => idle);
    expect(await gateway.execute({ kind: 'host_reboot' }, { confirmed: true })).toEqual({
      status: 'unconfirmed',
      summary: 'Reboot printer host',
      message:
        'Connection closed before Moonraker replied. The printer host may still be running. This is not a confirmed reboot or shutdown',
    });
    expect(await gateway.execute({ kind: 'host_shutdown' }, { confirmed: true })).toEqual({
      status: 'failed',
      summary: 'Shut down printer host',
      message: 'Moonraker denied printer host control for this connection',
      reason: 'unauthorized',
    });
  });

  it('rejects a second host tap while the first request is still in flight', async () => {
    let release: () => void = () => {};
    const { connection, calls } = fakeConnection(
      () => new Promise((resolve) => (release = () => resolve('ok'))),
    );
    const gateway = new CommandGateway(connection, () =>
      readyState({ hostMachine: 'available', printState: 'standby', hostname: 'trident', idleState: 'Idle' }),
    );
    const first = gateway.execute({ kind: 'host_reboot' }, { confirmed: true });
    expect(await gateway.execute({ kind: 'host_shutdown' }, { confirmed: true })).toMatchObject({ status: 'busy' });
    expect(await gateway.execute({ kind: 'host_reboot' }, { confirmed: true })).toMatchObject({ status: 'busy' });
    release();
    expect(await first).toMatchObject({ status: 'ok' });
    expect(calls.map((call) => call.method)).toEqual(['machine.reboot']);
    expect(gateway.isBusy('pi-host')).toBe(false);
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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetIntegrationRuntime, setIntegrationRuntime } from '../src/lib/integrations/runtime';
import { Backoff } from '../src/lib/moonraker/backoff';
import {
  CONTROL_METHODS,
  MethodNotAllowedError,
  MoonrakerClient,
  READ_METHODS,
  toHttpUrl,
  toWebSocketUrl,
  type ClientEvent,
} from '../src/lib/moonraker/client';
import { listProxyParams } from '../src/lib/spoolman/api';
import { FakeMoonraker } from './fakeMoonraker';

function setup(server: FakeMoonraker, extra: Partial<ConstructorParameters<typeof MoonrakerClient>[0]> = {}) {
  const events: ClientEvent[] = [];
  const client = new MoonrakerClient({
    baseUrl: 'http://printer.local:7125',
    onEvent: (e) => events.push(e),
    createSocket: server.createSocket,
    backoff: new Backoff({ initialMs: 1000, maxMs: 8000, factor: 2, jitter: 0 }),
    requestTimeoutMs: 5000,
    klippyPollMs: 2000,
    now: () => Date.now(),
    ...extra,
  });
  const transports = () => events.filter((e) => e.type === 'transport').map((e) => e.state);
  const klippy = () => events.filter((e) => e.type === 'klippy').map((e) => e.state);
  return { client, events, transports, klippy };
}

const flush = () => vi.advanceTimersByTimeAsync(0);

describe('URL helpers', () => {
  it('converts http(s) base URLs to the websocket endpoint', () => {
    expect(toWebSocketUrl('http://pi.local:7125')).toBe('ws://pi.local:7125/websocket');
    expect(toWebSocketUrl('https://pi.local/moonraker/')).toBe('wss://pi.local/moonraker/websocket');
    expect(toWebSocketUrl('ws://pi.local:7125/websocket')).toBe('ws://pi.local:7125/websocket');
    expect(() => toWebSocketUrl('ftp://pi.local')).toThrow();
  });

  it('builds REST URLs', () => {
    expect(toHttpUrl('ws://pi.local:7125', '/access/oneshot_token')).toBe('http://pi.local:7125/access/oneshot_token');
  });
});

describe('MoonrakerClient', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('identifies, lists objects and subscribes only to available objects', async () => {
    const server = new FakeMoonraker({
      objects: ['webhooks', 'print_stats', 'extruder', 'temperature_sensor chamber', 'toolhead'],
      status: {
        webhooks: { state: 'ready' },
        print_stats: { state: 'standby', filename: '' },
        extruder: { temperature: 30, target: 0, power: 0 },
        'temperature_sensor chamber': { temperature: 28 },
      },
    });
    const { client, events, transports, klippy } = setup(server);
    client.start();
    await flush();

    expect(server.last.url).toBe('ws://printer.local:7125/websocket');
    expect(server.calls.slice(0, 5)).toEqual([
      'server.connection.identify',
      'server.info',
      'printer.info',
      'printer.objects.list',
      'printer.objects.subscribe',
    ]);
    const identify = server.last.sent[0]!;
    expect(identify.params).toMatchObject({ client_name: 'LAYR', type: 'display' });

    const subscribed = Object.keys(server.subscribeParams?.objects as object);
    expect(subscribed).toContain('temperature_sensor chamber');
    expect(subscribed).not.toContain('heater_bed');
    expect(subscribed).not.toContain('display_status');
    expect(subscribed).not.toContain('mmu');
    expect(server.calls).not.toContain('printer.gcode.help');

    const snapshot = events.find((e) => e.type === 'snapshot');
    expect(snapshot).toMatchObject({
      hostname: 'fake-host',
      missing: expect.arrayContaining(['heater_bed', 'display_status', 'virtual_sdcard']),
    });
    expect(transports()).toEqual(['connecting', 'connected']);
    expect(klippy()).toEqual(['ready']);
    client.stop();
  });

  it('subscribes to motion_report and configfile and skips the settings query when the snapshot has them', async () => {
    const server = new FakeMoonraker({
      objects: ['webhooks', 'print_stats', 'extruder', 'motion_report', 'configfile', 'toolhead'],
      status: {
        webhooks: { state: 'ready' },
        print_stats: { state: 'standby', filename: '' },
        extruder: { temperature: 30, target: 0, power: 0 },
        motion_report: { live_velocity: 12, live_extruder_velocity: 1 },
        configfile: { settings: { extruder: { filament_diameter: '1.75' } } },
      },
    });
    const { client, events } = setup(server);
    client.start();
    await flush();
    expect(server.subscribeParams?.objects).toMatchObject({
      motion_report: ['live_velocity', 'live_extruder_velocity'],
      configfile: ['settings'],
    });
    expect(server.calls).not.toContain('printer.objects.query');
    const snapshot = events.find((e) => e.type === 'snapshot');
    expect(snapshot).toMatchObject({ settings: { extruder: { filament_diameter: '1.75' } }, gcodeCommands: null });
    client.stop();
  });

  it('does not subscribe to Happy Hare or ask for help while the switch is off', async () => {
    resetIntegrationRuntime();
    const server = new FakeMoonraker({
      objects: ['webhooks', 'extruder', 'mmu'],
      status: { webhooks: { state: 'ready' }, extruder: { temperature: 30 }, mmu: { tool: 1 } },
    });
    server.help = { MMU_LOAD: 'Load' };
    const { client } = setup(server);
    client.start();
    await flush();
    expect(server.subscribeParams?.objects).not.toHaveProperty('mmu');
    expect(server.calls).not.toContain('printer.gcode.help');
    client.stop();
  });

  it('subscribes to Happy Hare fields and keeps only registered commands', async () => {
    setIntegrationRuntime({ spoolman: false, happyHare: true, afc: false });
    const server = new FakeMoonraker({
      objects: ['webhooks', 'extruder', 'mmu'],
      status: {
        webhooks: { state: 'ready' },
        extruder: { temperature: 30 },
        mmu: { tool: 1, gate: 2, filament: 'Loaded', enabled: true },
      },
    });
    server.help = { MMU_LOAD: 'Load', MMU_CHANGE_TOOL: 'Change', G28: 'Home', MMU_TEST_CONFIG: 'test' };
    const { client, events } = setup(server);
    client.start();
    await flush();
    const objects = server.subscribeParams?.objects as Record<string, string[]>;
    expect(objects.mmu).toContain('tool');
    expect(objects.mmu).toContain('gate_status');
    expect(objects.mmu).not.toContain('nfc');
    expect(objects.mmu).not.toContain('sensors');
    expect(server.calls).toContain('printer.gcode.help');
    const snapshot = events.find((e) => e.type === 'snapshot');
    expect(snapshot && snapshot.type === 'snapshot' && snapshot.gcodeCommands).toEqual(['MMU_LOAD', 'MMU_CHANGE_TOOL']);
    client.stop();
    resetIntegrationRuntime();
  });

  it('stays connected when Happy Hare command help fails', async () => {
    setIntegrationRuntime({ spoolman: false, happyHare: true, afc: false });
    const server = new FakeMoonraker({
      objects: ['webhooks', 'extruder', 'mmu'],
      status: { webhooks: { state: 'ready' }, extruder: { temperature: 30 }, mmu: { tool: 0 } },
    });
    server.help = 'error';
    const { client, events, klippy } = setup(server);
    client.start();
    await flush();
    const snapshot = events.find((e) => e.type === 'snapshot');
    expect(snapshot && snapshot.type === 'snapshot' && snapshot.gcodeCommands).toBeNull();
    expect(klippy()).toEqual(['ready']);
    expect(server.calls).toContain('printer.gcode.help');
    client.stop();
    resetIntegrationRuntime();
  });

  it('reconnects with bounded exponential backoff and resets after success', async () => {
    const server = new FakeMoonraker();
    server.online = false;
    const { client, events } = setup(server);
    client.start();
    await flush();

    const waits = () =>
      events
        .filter((e): e is Extract<ClientEvent, { type: 'transport' }> => e.type === 'transport' && e.state === 'waiting')
        .map((e) => (e.nextRetryAt ?? 0) - Date.now());

    // Attempts at 1s, 2s, 4s, 8s, then capped at 8s.
    const expected = [1000, 2000, 4000, 8000, 8000];
    for (let i = 0; i < expected.length; i++) {
      expect(waits().at(-1)).toBe(expected[i]);
      await vi.advanceTimersByTimeAsync(expected[i]!);
    }
    expect(server.sockets.length).toBe(expected.length + 1);

    server.online = true;
    await vi.advanceTimersByTimeAsync(8000);
    expect(events.at(-1)).toMatchObject({ type: 'klippy', state: 'ready' });

    // A drop after a successful connection starts again from the initial delay.
    server.last.drop();
    await flush();
    expect(events.filter((e) => e.type === 'transport').at(-1)).toMatchObject({ state: 'waiting', attempt: 1 });
    expect(waits().at(-1)).toBe(1000);
    client.stop();
  });

  it('does not reconnect after stop()', async () => {
    const server = new FakeMoonraker();
    const { client, transports } = setup(server);
    client.start();
    await flush();
    client.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(server.sockets.length).toBe(1);
    expect(transports().at(-1)).toBe('idle');
  });

  it('ignores late events from a replaced socket', async () => {
    const server = new FakeMoonraker();
    const { client, events } = setup(server);
    client.start();
    await flush();
    const first = server.last;
    first.drop();
    await vi.advanceTimersByTimeAsync(1000);
    const count = events.length;
    first.notify('notify_status_update', [{ extruder: { temperature: 999 } }, 1]);
    expect(events.length).toBe(count);
    client.stop();
  });

  it('polls until Klipper becomes ready, then subscribes', async () => {
    const server = new FakeMoonraker({ klippyState: 'startup' });
    const { client, klippy } = setup(server);
    client.start();
    await flush();
    expect(klippy()).toEqual(['startup']);
    expect(server.calls).not.toContain('printer.objects.subscribe');

    await vi.advanceTimersByTimeAsync(2000);
    expect(server.calls.filter((c) => c === 'server.info').length).toBe(2);

    server.klippyState = 'ready';
    await vi.advanceTimersByTimeAsync(2000);
    expect(server.calls).toContain('printer.objects.subscribe');
    expect(klippy().at(-1)).toBe('ready');
    client.stop();
  });

  it('follows Klippy shutdown and disconnect notifications', async () => {
    const server = new FakeMoonraker();
    const { client, klippy, events } = setup(server);
    client.start();
    await flush();

    server.klippyState = 'shutdown';
    server.last.notify('notify_klippy_shutdown');
    await flush();
    expect(klippy().slice(-2)).toEqual(['shutdown', 'shutdown']);
    expect(events.at(-1)).toMatchObject({ type: 'klippy', message: 'Klipper shutdown' });

    server.klippyState = 'disconnected';
    server.last.notify('notify_klippy_disconnected');
    expect(klippy().at(-1)).toBe('disconnected');

    server.klippyState = 'ready';
    server.last.notify('notify_klippy_ready');
    await flush();
    expect(klippy().at(-1)).toBe('ready');
    client.stop();
  });

  it('forwards status diffs and webhooks state changes', async () => {
    const server = new FakeMoonraker();
    const { client, events, klippy } = setup(server);
    client.start();
    await flush();
    server.last.notify('notify_status_update', [{ extruder: { temperature: 200 } }, 2]);
    expect(events.at(-1)).toEqual({ type: 'status', diff: { extruder: { temperature: 200 } } });

    server.last.notify('notify_status_update', [{ webhooks: { state: 'shutdown', state_message: 'MCU error' } }, 3]);
    expect(klippy().at(-1)).toBe('shutdown');
    expect(events.at(-1)).toMatchObject({ message: 'MCU error' });
    client.stop();
  });

  it('reconnects when the initial handshake times out', async () => {
    const server = new FakeMoonraker({ silent: ['server.connection.identify'] });
    const { client, transports } = setup(server);
    client.start();
    await flush();
    expect(transports()).toEqual(['connecting']);
    await vi.advanceTimersByTimeAsync(5000);
    expect(transports().at(-1)).toBe('waiting');
    expect(server.sockets[0]!.closedByClient).toBe(true);
    client.stop();
  });

  it('rejects host and file-write methods, and keeps reads separate from controls', async () => {
    const server = new FakeMoonraker();
    const { client } = setup(server);
    client.start();
    await flush();
    const before = server.calls.length;
    for (const method of [
      'machine.reboot',
      'machine.shutdown',
      'server.restart',
      'server.files.write',
      'server.files.upload',
      'server.config.write',
    ]) {
      await expect(client.call(method, { script: 'G28' })).rejects.toBeInstanceOf(MethodNotAllowedError);
    }
    expect(server.calls.length).toBe(before);
    expect([...READ_METHODS].some((m) => /gcode\.script|print\.|emergency|machine\.|write|delete|upload/.test(m))).toBe(false);
    expect([...CONTROL_METHODS].sort()).toEqual(
      [
        'printer.emergency_stop',
        'printer.firmware_restart',
        'printer.gcode.script',
        'printer.print.cancel',
        'printer.print.pause',
        'printer.print.resume',
        'printer.print.start',
        'printer.restart',
        'server.files.delete_file',
        'server.spoolman.post_spool_id',
      ].sort(),
    );
    client.stop();
  });

  it('uses a oneshot token when an API key is configured', async () => {
    const server = new FakeMoonraker();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ result: 'tok123' }), { status: 200 }));
    const { client } = setup(server, { apiKey: 'secret', fetch: fetchMock as unknown as typeof fetch });
    client.start();
    await flush();
    expect(fetchMock).toHaveBeenCalledWith('http://printer.local:7125/access/oneshot_token', {
      headers: { 'X-Api-Key': 'secret' },
    });
    expect(server.last.url).toBe('ws://printer.local:7125/websocket?token=tok123');
    client.stop();
  });

  it('treats an authentication failure as a retryable connection failure', async () => {
    const server = new FakeMoonraker();
    const fetchMock = vi.fn(async () => new Response('nope', { status: 401 }));
    const { client, events } = setup(server, { apiKey: 'bad', fetch: fetchMock as unknown as typeof fetch });
    client.start();
    await flush();
    expect(server.sockets.length).toBe(0);
    expect(events.at(-1)).toMatchObject({
      type: 'transport',
      state: 'waiting',
      reason: 'Authentication failed (HTTP 401). Check the API key or trusted_clients',
    });
    client.stop();
  });

  it('emits server info and spoolman notices, and refuses a proxy that is not a spool read', async () => {
    const server = new FakeMoonraker();
    const { client, events } = setup(server);
    client.start();
    await flush();
    expect(events.some((event) => event.type === 'server')).toBe(true);
    server.last.notify('notify_active_spool_set', [{ spool_id: 4 }]);
    server.last.notify('notify_spoolman_status_changed', [{ spoolman_connected: false }]);
    expect(events.filter((event) => event.type === 'spoolman')).toEqual([
      { type: 'spoolman', notice: { kind: 'active', spoolId: 4, known: true } },
      { type: 'spoolman', notice: { kind: 'link', connected: false } },
    ]);
    const before = server.calls.length;
    await expect(
      client.call('server.spoolman.proxy', { request_method: 'POST', path: '/v1/spool', use_v2_response: true }),
    ).rejects.toBeInstanceOf(MethodNotAllowedError);
    await expect(client.call('server.spoolman.post_spool_id', { spool_id: 1, extra: true })).rejects.toBeInstanceOf(MethodNotAllowedError);
    expect(server.calls.length).toBe(before);
    await expect(client.call('server.spoolman.proxy', listProxyParams(0))).rejects.toThrow(/not found/i);
    expect(server.calls.at(-1)).toBe('server.spoolman.proxy');
    client.stop();
  });
});

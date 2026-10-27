import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Backoff } from '../src/lib/moonraker/backoff';
import { LiveSource } from '../src/lib/printer/liveSource';
import type { PrinterState } from '../src/lib/printer/model';
import { patchInPlace } from '../src/lib/printer/patch';
import { FakeMoonraker } from './fakeMoonraker';

const profile = { id: 'p1', name: '', moonrakerUrl: 'http://pi:7125', apiKey: null };

describe('LiveSource', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function start(server: FakeMoonraker) {
    const states: PrinterState[] = [];
    const source = new LiveSource(profile, {
      flushIntervalMs: 250,
      client: { createSocket: server.createSocket, backoff: new Backoff({ jitter: 0 }) },
    });
    source.start((s) => states.push(s));
    return { source, states };
  }

  it('reaches ready with mapped data', async () => {
    const server = new FakeMoonraker();
    const { source, states } = start(server);
    await vi.advanceTimersByTimeAsync(0);
    const last = states.at(-1)!;
    expect(last).toMatchObject({ status: 'ready', printerName: 'fake-host', transport: 'connected' });
    expect(last.extruder?.temperature).toBe(25);
    source.stop();
  });

  it('coalesces bursts of status updates into throttled emissions', async () => {
    const server = new FakeMoonraker();
    const { source, states } = start(server);
    await vi.advanceTimersByTimeAsync(300);
    const before = states.length;

    for (let i = 0; i < 20; i++) {
      server.last.notify('notify_status_update', [{ extruder: { temperature: 100 + i } }, i]);
    }
    expect(states.length).toBe(before);
    await vi.advanceTimersByTimeAsync(250);
    expect(states.length).toBe(before + 1);
    expect(states.at(-1)!.extruder?.temperature).toBe(119);
    source.stop();
  });

  it('shows disconnected while waiting to retry, then recovers', async () => {
    const server = new FakeMoonraker();
    const { source, states } = start(server);
    await vi.advanceTimersByTimeAsync(0);
    server.online = false;
    server.last.drop();
    await vi.advanceTimersByTimeAsync(0);
    expect(states.at(-1)).toMatchObject({ status: 'disconnected', transport: 'waiting', reconnectAttempt: 1, extruder: null });

    server.online = true;
    await vi.advanceTimersByTimeAsync(1000);
    expect(states.at(-1)).toMatchObject({ status: 'ready', transport: 'connected' });
    source.stop();
  });

  it('fetches slicer metadata once per file', async () => {
    const server = new FakeMoonraker();
    server.status.print_stats = { filename: 'a.gcode', state: 'printing', print_duration: 60, total_duration: 60 };
    const { source, states } = start(server);
    await vi.advanceTimersByTimeAsync(500);
    expect(server.calls.filter((c) => c === 'server.files.metadata')).toHaveLength(1);
    expect(states.at(-1)!.job).toMatchObject({ remaining: 3540, remainingSource: 'slicer' });
    server.last.notify('notify_status_update', [{ print_stats: { print_duration: 61 } }, 1]);
    await vi.advanceTimersByTimeAsync(500);
    expect(server.calls.filter((c) => c === 'server.files.metadata')).toHaveLength(1);
    source.stop();
  });

  it('resubscribes after a reconnect and replaces stale values with a fresh snapshot', async () => {
    const server = new FakeMoonraker();
    const { source, states } = start(server);
    const ready: number[] = [];
    source.onReady(() => ready.push(states.length));
    await vi.advanceTimersByTimeAsync(0);
    expect(ready).toHaveLength(1);

    server.last.notify('notify_status_update', [{ extruder: { temperature: 180, target: 200 } }, 1]);
    await vi.advanceTimersByTimeAsync(300);
    expect(states.at(-1)!.extruder?.temperature).toBe(180);

    server.last.drop();
    await vi.advanceTimersByTimeAsync(0);
    expect(states.at(-1)).toMatchObject({ status: 'disconnected', extruder: null, toolhead: null, macros: [] });

    // While offline the printer cooled down; the next snapshot must win over the cached diff.
    server.status.extruder = { temperature: 40, target: 0, power: 0 };
    await vi.advanceTimersByTimeAsync(1000);
    expect(states.at(-1)).toMatchObject({ status: 'ready', extruder: { temperature: 40, target: 0 } });
    expect(server.calls.filter((c) => c === 'printer.objects.subscribe')).toHaveLength(2);
    expect(ready).toHaveLength(2);
    source.stop();
  });

  it('forwards G-code responses and exposes an allow-listed call()', async () => {
    const server = new FakeMoonraker();
    const { source } = start(server);
    await vi.advanceTimersByTimeAsync(0);
    const lines: string[] = [];
    source.onGcodeResponse((l) => lines.push(l));
    server.last.notify('notify_gcode_response', ['// hello']);
    expect(lines).toEqual(['// hello']);
    await expect(source.call('printer.gcode.script', { script: 'G28' })).resolves.toBe('ok');
    await expect(source.call('machine.reboot')).rejects.toThrow(/not permitted/);
    source.stop();
    await expect(source.call('printer.gcode.script', { script: 'G28' })).rejects.toThrow('Not connected to Moonraker');
  });

  it('shows Klipper live speed and volumetric flow, not the percentage overrides', async () => {
    const server = new FakeMoonraker();
    server.status.motion_report = { live_velocity: 48.2, live_extruder_velocity: 5 };
    server.status.gcode_move = { speed_factor: 1.5, extrude_factor: 1.2 };
    server.status.toolhead = { extruder: 'extruder' };
    server.objects = [...Object.keys(server.status), 'configfile'];
    server.settings = { extruder: { filament_diameter: '1.75' } };
    const { source, states } = start(server);
    await vi.advanceTimersByTimeAsync(0);
    expect(states.at(-1)!.motion).toMatchObject({ speedMmS: 48, flowMm3S: 12, filamentDiameterMm: 1.75, flowGap: null });
    expect(states.at(-1)!.toolhead?.speedFactor).toBe(1.5);
    source.stop();
  });

  it('drops a stale thumbnail when the file changes, including nested paths', async () => {
    const server = new FakeMoonraker();
    server.status.print_stats = { filename: 'a.gcode', state: 'printing', print_duration: 30, total_duration: 30 };
    server.metadata['a.gcode'] = { thumbnails: [{ width: 300, height: 300, relative_path: '.thumbs/a.png' }] };
    server.metadata['nested/b.gcode'] = { thumbnails: [{ width: 32, height: 32, relative_path: '.thumbs/b.png' }] };
    const { source, states } = start(server);
    await vi.advanceTimersByTimeAsync(500);
    expect(states.at(-1)!.job?.thumbnailPath).toBe('.thumbs/a.png');

    server.last.notify('notify_status_update', [{ print_stats: { filename: 'nested/b.gcode' } }, 1]);
    await vi.advanceTimersByTimeAsync(500);
    expect(states.at(-1)!.job?.thumbnailPath).toBe('nested/.thumbs/b.png');

    server.last.notify('notify_status_update', [{ print_stats: { filename: 'gone.gcode' } }, 2]);
    await vi.advanceTimersByTimeAsync(500);
    expect(states.at(-1)!.job?.thumbnailPath).toBeNull();
    source.stop();
  });

  it('coalesces motion_report bursts and clears them on disconnect', async () => {
    const server = new FakeMoonraker();
    server.status.motion_report = { live_velocity: 10, live_extruder_velocity: 0 };
    server.objects = [...Object.keys(server.status), 'configfile'];
    server.settings = { extruder: { filament_diameter: '1.75' } };
    const { source, states } = start(server);
    await vi.advanceTimersByTimeAsync(300);
    const before = states.length;
    for (let i = 0; i < 20; i++) {
      server.last.notify('notify_status_update', [{ motion_report: { live_velocity: 10.2 + i * 0.01, live_extruder_velocity: 0 } }, i]);
    }
    expect(states.length).toBe(before);
    await vi.advanceTimersByTimeAsync(250);
    expect(states.length).toBe(before + 1);
    expect(states.at(-1)!.motion.speedMmS).toBe(10);

    server.online = false;
    server.last.drop();
    await vi.advanceTimersByTimeAsync(0);
    expect(states.at(-1)!.motion).toMatchObject({ speedMmS: null, flowMm3S: null });
    source.stop();
  });

  it('stops all timers on stop()', async () => {
    const server = new FakeMoonraker();
    const { source } = start(server);
    await vi.advanceTimersByTimeAsync(0);
    source.stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('patchInPlace', () => {
  it('only writes changed leaves', () => {
    const target = { a: 1, nested: { b: 2, c: 3 }, list: [{ x: 1 }], gone: true } as Record<string, unknown>;
    const writes = patchInPlace(target, { a: 1, nested: { b: 2, c: 4 }, list: [{ x: 1 }], extra: null });
    expect(writes).toBe(3);
    expect(target).toEqual({ a: 1, nested: { b: 2, c: 4 }, list: [{ x: 1 }], extra: null });
    expect(patchInPlace(target, structuredClone(target))).toBe(0);
  });

  it('replaces values that change shape', () => {
    const target: Record<string, unknown> = { job: null, list: [1] };
    patchInPlace(target, { job: { a: 1 }, list: [1, 2] });
    expect(target).toEqual({ job: { a: 1 }, list: [1, 2] });
    patchInPlace(target, { job: null, list: [] });
    expect(target).toEqual({ job: null, list: [] });
  });
});

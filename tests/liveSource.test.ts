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

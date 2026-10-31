import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MoonrakerClient, RpcUnconfirmedError, type ClientEvent, type MoonrakerClientOptions } from '../src/lib/moonraker/client';
import { Backoff } from '../src/lib/moonraker/backoff';
import { FakeMoonraker } from './fakeMoonraker';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}

function setup(server = new FakeMoonraker(), options: Partial<MoonrakerClientOptions> = {}) {
  const events: ClientEvent[] = [];
  const client = new MoonrakerClient({
    baseUrl: 'http://mock:7125', createSocket: server.createSocket, onEvent: event => events.push(event),
    httpTimeoutMs: 100, connectTimeoutMs: 100, heartbeatIntervalMs: 200, heartbeatTimeoutMs: 100,
    backoff: new Backoff({ initialMs: 100, maxMs: 800, jitter: 0 }), ...options,
  });
  return { client, events, server };
}

const flush = () => vi.advanceTimersByTimeAsync(0);
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('bounded HTTP and cancellation', () => {
  for (const phase of ['headers', 'body'] as const) {
    it(`times out token ${phase}, aborts transport, and retries with backoff`, async () => {
      const stalled = deferred<Response>();
      const signals: AbortSignal[] = [];
      const fetch = vi.fn(async (_url, init) => {
        signals.push(init.signal);
        if (phase === 'headers') return stalled.promise;
        return new Response(new ReadableStream({ start() {} }));
      });
      const { client, events, server } = setup(undefined, { apiKey: 'fixture', fetch });
      client.start(); await flush();
      await vi.advanceTimersByTimeAsync(100);
      expect(signals[0]!.aborted).toBe(true);
      expect(events.at(-1)).toMatchObject({ type: 'transport', state: 'waiting', reason: 'Moonraker HTTP request timed out', attempt: 1 });
      expect(server.sockets).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(100);
      expect(fetch).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(100);
      expect(events.at(-1)).toMatchObject({ state: 'waiting', attempt: 2 });
      client.stop();
      stalled.resolve(new Response(JSON.stringify({ result: 'late-token' })));
      await flush();
      expect(server.sockets).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(0);
    });

    it(`bounds authenticated thumbnail ${phase} without closing a healthy socket`, async () => {
      let signal!: AbortSignal;
      const fetch: typeof globalThis.fetch = async (_url, init) => {
        signal = init!.signal!;
        return phase === 'headers' ? new Promise(() => {}) : new Response(new ReadableStream({ start() {} }));
      };
      const { client, server } = setup(undefined, { fetch });
      client.start(); await flush();
      const request = client.fetchHttp('/server/files/gcodes/a.png');
      const outcome = expect(request).rejects.toThrow('HTTP request timed out');
      await vi.advanceTimersByTimeAsync(100); await outcome;
      expect(signal.aborted).toBe(true);
      expect(server.sockets).toHaveLength(1);
      expect(client.connected).toBe(true);
      client.stop();
      expect(vi.getTimerCount()).toBe(0);
    });
  }

  it('keeps API-key headers and successful response bytes intact', async () => {
    const fetch = vi.fn(async () => new Response('image-bytes', { headers: { 'Content-Type': 'image/png' } }));
    const { client } = setup(undefined, { apiKey: 'fixture-key', fetch });
    const response = await client.fetchHttp('/server/files/gcodes/a.png');
    expect(await response.text()).toBe('image-bytes');
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(fetch).toHaveBeenCalledWith('http://mock:7125/server/files/gcodes/a.png', expect.objectContaining({
      headers: { 'X-Api-Key': 'fixture-key' }, signal: expect.any(AbortSignal),
    }));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels one caller without cancelling a concurrent thumbnail', async () => {
    const one = deferred<Response>(); const two = deferred<Response>();
    const fetch = vi.fn().mockReturnValueOnce(one.promise).mockReturnValueOnce(two.promise);
    const { client } = setup(undefined, { fetch });
    const controller = new AbortController();
    const a = client.fetchHttp('/a', controller.signal);
    const b = client.fetchHttp('/b');
    const cancelled = expect(a).rejects.toMatchObject({ name: 'AbortError' });
    await flush(); controller.abort(); await cancelled;
    two.resolve(new Response('current'));
    expect(await (await b).text()).toBe('current');
    one.resolve(new Response('old')); await flush();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not fetch for an already cancelled caller', async () => {
    const fetch = vi.fn(); const { client } = setup(undefined, { fetch });
    const controller = new AbortController(); controller.abort();
    await expect(client.fetchHttp('/a', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('aborts an old token on reconnect and ignores its eventual response', async () => {
    const old = deferred<Response>();
    const signals: AbortSignal[] = [];
    const fetch: typeof globalThis.fetch = async (_url, init) => {
      signals.push(init!.signal!);
      return signals.length === 1 ? old.promise : new Response(JSON.stringify({ result: 'current-token' }));
    };
    const { client, server } = setup(undefined, { apiKey: 'fixture', fetch });
    client.start(); await flush(); client.reconnect(); await flush();
    expect(signals[0]!.aborted).toBe(true);
    expect(server.last.url).toContain('current-token');
    old.resolve(new Response(JSON.stringify({ result: 'stale-token' }))); await flush();
    expect(server.sockets).toHaveLength(1);
    client.stop(); expect(vi.getTimerCount()).toBe(0);
  });

  it('aborts pending thumbnails on disconnect and discards late response bodies', async () => {
    const old = deferred<Response>();
    let signal!: AbortSignal;
    const { client, server } = setup(undefined, { fetch: async (_url, init) => { signal = init!.signal!; return old.promise; } });
    client.start(); await flush();
    const pending = client.fetchHttp('/a');
    const cancelled = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await flush(); server.last.drop(); await cancelled;
    expect(signal.aborted).toBe(true);
    const cancel = vi.fn();
    old.resolve(new Response(new ReadableStream({ cancel })));
    await flush(); expect(cancel).toHaveBeenCalledTimes(1);
    client.stop(); expect(vi.getTimerCount()).toBe(0);
  });
});

describe('WebSocket liveness', () => {
  it('bounds an unopened socket and ignores its late open callback', async () => {
    const { client, server, events } = setup(new FakeMoonraker({ autoOpen: false }));
    client.start(); await flush();
    const old = server.last;
    const lateOpen = old.onopen!;
    await vi.advanceTimersByTimeAsync(100);
    expect(old.closedByClient).toBe(true);
    expect(events.at(-1)).toMatchObject({ state: 'waiting', reason: 'Moonraker WebSocket connection timed out' });
    server.autoOpen = true;
    await vi.advanceTimersByTimeAsync(100);
    lateOpen({}); await flush();
    expect(events.filter(event => event.type === 'snapshot')).toHaveLength(1);
    client.stop(); expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps a quiet but responsive connection and uses only read-only probes', async () => {
    const { client, server } = setup();
    client.start(); await flush(); const initial = server.calls.length;
    await vi.advanceTimersByTimeAsync(2000);
    expect(server.sockets).toHaveLength(1);
    expect(server.calls.slice(initial)).toEqual(Array(10).fill('server.info'));
    client.stop(); expect(vi.getTimerCount()).toBe(0);
  });

  it('disconnects a half-open socket, rejects controls as unknown, and never replays them', async () => {
    const { client, server, events } = setup();
    client.start(); await flush(); const old = server.last;
    const lateMessage = old.onmessage!;
    server.silent.add('server.info'); server.silentScripts = true;
    const command = client.call('printer.gcode.script', { script: 'G28' }, { timeoutMs: 10_000 });
    const unknown = expect(command).rejects.toBeInstanceOf(RpcUnconfirmedError);
    await vi.advanceTimersByTimeAsync(300); await unknown;
    expect(old.closedByClient).toBe(true);
    expect(client.connected).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: 'transport', state: 'waiting', reason: 'Moonraker is not responding' });
    server.silent.clear();
    await vi.advanceTimersByTimeAsync(100);
    expect(server.sockets).toHaveLength(2);
    const before = events.length;
    lateMessage({ data: JSON.stringify({ method: 'notify_status_update', params: [{ extruder: { temperature: 999 } }] }) });
    await flush(); expect(events).toHaveLength(before);
    expect(server.calls.filter(method => method === 'printer.gcode.script')).toHaveLength(1);
    client.stop(); expect(vi.getTimerCount()).toBe(0);
  });

  it('does not treat slow command replies as a dead connection when probes succeed', async () => {
    const { client, server } = setup(); client.start(); await flush();
    server.silentScripts = true;
    const command = client.call('printer.gcode.script', { script: 'G28' }, { timeoutMs: 2000 });
    await vi.advanceTimersByTimeAsync(1000);
    const sent = server.last.sent.find(message => message.method === 'printer.gcode.script')!;
    server.last.push({ id: sent.id, result: 'ok' });
    await expect(command).resolves.toBe('ok');
    expect(server.sockets).toHaveLength(1);
    client.stop();
  });

  it('cannot publish old initialization state after reconnecting mid-initialization', async () => {
    const server = new FakeMoonraker({ silent: ['printer.info'] });
    const { client, events } = setup(server); client.start(); await flush();
    const old = server.last; const late = old.onmessage!;
    const request = old.sent.find(message => message.method === 'printer.info')!;
    server.silent.clear(); client.reconnect(); await flush();
    const snapshots = events.filter(event => event.type === 'snapshot').length;
    late({ data: JSON.stringify({ id: request.id, result: { state: 'shutdown', hostname: 'old' } }) });
    await flush();
    expect(events.filter(event => event.type === 'snapshot')).toHaveLength(snapshots);
    expect(events.at(-1)).toMatchObject({ type: 'klippy', state: 'ready' });
    client.stop();
  });

  it('cleans up a pending health probe on stop without reconnecting', async () => {
    const { client, server } = setup(); client.start(); await flush();
    server.silent.add('server.info');
    await vi.advanceTimersByTimeAsync(200);
    client.stop(); await vi.advanceTimersByTimeAsync(10_000);
    expect(server.sockets).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

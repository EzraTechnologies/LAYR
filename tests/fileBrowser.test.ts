import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileBrowser } from '../src/lib/files/browser.svelte';
import type { PrinterConnection } from '../src/lib/printer/source';

function setup() {
  let ready = () => {};
  let transport: (state: string) => void = () => {};
  let changed: (change: { root: string | null; path: string | null; action: string }) => void = () => {};
  const call = vi.fn().mockResolvedValue({ dirs: [], files: [] });
  const connection = {
    call, hasApiKey: false, httpUrl: (path: string) => `http://mock${path}`,
    onReady: (listener: typeof ready) => { ready = listener; return () => {}; },
    onTransport: (listener: typeof transport) => { transport = listener; return () => {}; },
    onFilelistChanged: (listener: typeof changed) => { changed = listener; return () => {}; },
  } as unknown as PrinterConnection;
  return { browser: new FileBrowser(connection), call, ready: () => ready(), transport: (state: string) => transport(state),
    changed: () => changed({ root: 'gcodes', path: 'a.gcode', action: 'create_file' }) };
}

const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
afterEach(() => vi.useRealTimers());

describe('Files request lifecycle', () => {
  it('attempts once on entry/readiness and leaves a persistent failure visible', async () => {
    vi.useFakeTimers();
    const { browser, call, ready } = setup();
    call.mockRejectedValue(new Error('Directory unavailable'));
    const leave = browser.enter();
    expect(call).not.toHaveBeenCalled();
    ready(); await flush();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(call).toHaveBeenCalledTimes(1);
    expect(browser.error).toBe('Directory unavailable');
    expect(browser.loading).toBe(false);
    await browser.load();
    expect(call).toHaveBeenCalledTimes(2);
    leave(); browser.enter(); await flush();
    expect(call).toHaveBeenCalledTimes(3);
    browser.dispose();
  });

  it('recovers manually and after reconnection without retry timers', async () => {
    const { browser, call, ready, transport } = setup();
    call.mockRejectedValueOnce(new Error('Failed'));
    browser.enter(); ready(); await flush();
    await browser.load();
    expect(browser.loaded).toBe(true);
    expect(browser.error).toBeNull();
    transport('waiting'); ready(); await flush();
    expect(call).toHaveBeenCalledTimes(3);
    browser.dispose();
  });

  it('recovers an initial failure after reconnect or a real file-change notification', async () => {
    vi.useFakeTimers();
    const { browser, call, ready, transport, changed } = setup();
    call.mockRejectedValueOnce(new Error('Failed'));
    browser.enter(); ready(); await flush();
    transport('waiting'); ready(); await flush();
    expect(browser.loaded).toBe(true);
    changed(); changed(); changed();
    await vi.advanceTimersByTimeAsync(600);
    expect(call).toHaveBeenCalledTimes(3);
    browser.dispose();
  });

  it('ignores stale directory responses during folder navigation and after disposal', async () => {
    const { browser, call } = setup();
    let release!: (value: unknown) => void;
    call.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const old = browser.open('old');
    await browser.open('new');
    release({ dirs: [], files: [{ filename: 'stale.gcode', size: 1, modified: 1 }] });
    await old;
    expect(browser.dir).toBe('new');
    expect(browser.files).toEqual([]);
    call.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const late = browser.load(); browser.dispose();
    release({ dirs: [], files: [{ filename: 'late.gcode', size: 1, modified: 1 }] });
    await late;
    expect(browser.files).toEqual([]);
  });

  it('ignores an old error after a newer successful response and invalidates requests on disconnect', async () => {
    const { browser, call, transport } = setup();
    let reject!: (error: Error) => void;
    call.mockImplementationOnce(() => new Promise((_, no) => { reject = no; }));
    const old = browser.load();
    await browser.load(); reject(new Error('Old error')); await old;
    expect(browser.error).toBeNull();
    let release!: (value: unknown) => void;
    call.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const pending = browser.load(); transport('waiting');
    release({ dirs: [], files: [{ filename: 'stale.gcode', size: 1, modified: 1 }] }); await pending;
    expect(browser.files).toEqual([]);
    expect(browser.loading).toBe(false);
    browser.dispose();
  });

  it('keeps unauthenticated thumbnails as direct HTTP URLs', async () => {
    const { browser } = setup();
    const lease = browser.thumbnail('folder/a.png', 12);
    expect(await lease.url).toBe('http://mock/server/files/gcodes/folder/a.png?timestamp=12');
    lease.release(); browser.dispose();
  });
});

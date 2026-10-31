import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThumbnailCache } from '../src/lib/files/thumbnailCache';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('authenticated thumbnail ownership', () => {
  let serial = 0;
  beforeEach(() => {
    serial = 0;
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:test-${++serial}`);
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('deduplicates downloads and never evicts an owned URL, even above the entry budget', async () => {
    const download = vi.fn(async () => new Blob(['image']));
    const cache = new ThumbnailCache(download, 1);
    const a = cache.acquire('a');
    const same = cache.acquire('a');
    const first = await a.url;
    expect(await same.url).toBe(first);
    expect(download).toHaveBeenCalledTimes(1);
    const b = cache.acquire('b');
    await b.url;
    a.release();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    same.release();
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith(first);
    same.release();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    b.release();
    cache.dispose();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it('evicts the least recently acquired unused URL', async () => {
    const cache = new ThumbnailCache(async () => new Blob(['image']), 2);
    const a = cache.acquire('a'); const aUrl = await a.url; a.release();
    const b = cache.acquire('b'); const bUrl = await b.url; b.release();
    const reuse = cache.acquire('a'); expect(await reuse.url).toBe(aUrl); reuse.release();
    const c = cache.acquire('c'); await c.url; c.release();
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith(bUrl);
    cache.dispose();
  });

  it('enforces the byte budget and releases an oversized image after its owner leaves', async () => {
    const cache = new ThumbnailCache(async () => new Blob(['12345']), 32, 8);
    const a = cache.acquire('a'); const aUrl = await a.url; a.release();
    const b = cache.acquire('b'); await b.url;
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith(aUrl);
    b.release(); cache.dispose();
    const huge = new ThumbnailCache(async () => new Blob(['123456789']), 32, 8);
    const lease = huge.acquire('huge'); const url = await lease.url;
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(url);
    lease.release();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(url);
  });

  it('does not allocate a URL for a released pending download or replace a newer entry', async () => {
    const old = deferred<Blob>();
    const download = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue(new Blob(['new']));
    const cache = new ThumbnailCache(download);
    const a = cache.acquire('same'); a.release();
    const b = cache.acquire('same'); const newUrl = await b.url;
    old.resolve(new Blob(['old']));
    await expect(a.url).rejects.toThrow('released');
    const c = cache.acquire('same'); expect(await c.url).toBe(newUrl);
    expect(download).toHaveBeenCalledTimes(2);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    b.release(); c.release(); cache.dispose();
  });

  it('allows a new request after failure and releases failed owners safely', async () => {
    const download = vi.fn().mockRejectedValueOnce(new Error('HTTP 401')).mockResolvedValue(new Blob(['ok']));
    const cache = new ThumbnailCache(download);
    const failed = cache.acquire('a');
    await expect(failed.url).rejects.toThrow('HTTP 401');
    const retry = cache.acquire('a'); const url = await retry.url;
    failed.release();
    const shared = cache.acquire('a');
    expect(await shared.url).toBe(url);
    expect(download).toHaveBeenCalledTimes(2);
    retry.release();
    // Dispose keeps even the remaining owner's URL valid.
    cache.dispose();
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(url);
    shared.release();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(url);
  });

  it('clears reusable entries while keeping active images valid through replacement', async () => {
    const cache = new ThumbnailCache(async () => new Blob(['image']));
    const old = cache.acquire('same'); const oldUrl = await old.url;
    cache.clear();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    const next = cache.acquire('same'); const nextUrl = await next.url;
    expect(nextUrl).not.toBe(oldUrl);
    old.release();
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith(oldUrl);
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(nextUrl);
    next.release(); cache.dispose();
  });

  it('keeps all active leases valid during disposal and rejects further acquisition', async () => {
    const cache = new ThumbnailCache(async () => new Blob(['image']));
    const a = cache.acquire('a'); const b = cache.acquire('a'); const url = await a.url;
    cache.dispose();
    expect(() => cache.acquire('b')).toThrow('disposed');
    a.release(); expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    b.release(); expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith(url);
  });

  it('does not leak a late download after disposal', async () => {
    const pending = deferred<Blob>();
    const cache = new ThumbnailCache(() => pending.promise);
    const a = cache.acquire('a');
    cache.dispose(); a.release();
    pending.resolve(new Blob(['late']));
    await expect(a.url).rejects.toThrow('released');
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('keeps a shared pending download alive for its remaining owner', async () => {
    const pending = deferred<Blob>();
    const download = vi.fn(() => pending.promise);
    const cache = new ThumbnailCache(download);
    const gone = cache.acquire('a');
    const active = cache.acquire('a');
    gone.release();
    pending.resolve(new Blob(['image']));
    const url = await active.url;
    expect(download).toHaveBeenCalledTimes(1);
    cache.clear();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    active.release();
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith(url);
  });

  it('aborts a pending download only after its final owner releases it', async () => {
    const pending = deferred<Blob>(); let signal!: AbortSignal;
    const cache = new ThumbnailCache((_key, current) => { signal = current; return pending.promise; });
    const a = cache.acquire('a'); const b = cache.acquire('a');
    await Promise.resolve();
    a.release(); expect(signal.aborted).toBe(false);
    b.release(); expect(signal.aborted).toBe(true);
    pending.resolve(new Blob(['late']));
    await expect(a.url).rejects.toThrow('released');
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('aborts pending downloads during disposal without revoking displayed images', async () => {
    const pending = deferred<Blob>(); let signal!: AbortSignal;
    const cache = new ThumbnailCache((_key, current) => { signal = current; return pending.promise; });
    const a = cache.acquire('a'); await Promise.resolve();
    cache.dispose(); expect(signal.aborted).toBe(true);
    a.release(); pending.resolve(new Blob(['late']));
    await expect(a.url).rejects.toThrow('released');
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});

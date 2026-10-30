import { describe, expect, it } from 'vitest';
import { integrationScopeKey } from '../src/lib/integrations/preferences';
import { ImageLibrary, MemoryPrinterImageRepository } from '../src/lib/printerImage/library';
import {
  LIMITS,
  classifyFile,
  coerceStoredImage,
  fittedSize,
  formatStoredSize,
  hasJpegMagic,
  isUsableImage,
  keysToForget,
  previewChoice,
  printerImageErrorText,
  printerImageScopeKey,
  printerImageStorageNote,
  type ImageProblem,
  type StoredPrinterImage,
} from '../src/lib/printerImage/policy';
import type { PrinterStatus } from '../src/lib/printer/model';

const STATUSES: PrinterStatus[] = ['unconfigured', 'disconnected', 'connecting', 'ready', 'printing', 'paused', 'error'];

function jpeg(size: number, marker: number): Blob {
  const bytes = new Uint8Array(Math.max(4, size));
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  bytes[2] = 0xff;
  bytes[3] = marker;
  return new Blob([bytes], { type: 'image/jpeg' });
}

function image(scopeKey: string, marker: number, savedAt: number, patch: Partial<StoredPrinterImage> = {}): StoredPrinterImage {
  return {
    scopeKey,
    blob: jpeg(32, marker),
    mime: 'image/jpeg',
    width: 32,
    height: 24,
    savedAt,
    ...patch,
  };
}

describe('printer image scope', () => {
  it('uses the same printer and Moonraker identity as other per-printer settings', () => {
    expect(printerImageScopeKey('default', 'HTTP://Printer.local:7125/')).toBe(
      integrationScopeKey('default', 'http://printer.local:7125'),
    );
    expect(printerImageScopeKey('  ', null)).toBe(integrationScopeKey('default', null));
  });

  it('keeps future printer profiles apart even when they share a host shape', () => {
    const url = 'http://printer.local:7125';
    expect(printerImageScopeKey('trident', url)).not.toBe(printerImageScopeKey('v0', url));
    expect(printerImageScopeKey('trident', url)).not.toBe(printerImageScopeKey('trident', 'http://printer.local:7126'));
  });
});

describe('printer image files', () => {
  it('accepts the formats the chooser offers and refuses svg and other files', () => {
    expect(classifyFile({ type: 'image/jpeg', size: 100 })).toBeNull();
    expect(classifyFile({ type: 'image/png', size: 100 })).toBeNull();
    expect(classifyFile({ type: 'image/webp', size: 100 })).toBeNull();
    expect(classifyFile({ type: 'image/gif', size: 100 })).toBeNull();
    expect(classifyFile({ type: 'IMAGE/JPEG', size: LIMITS.maxInputBytes })).toBeNull();
    expect(classifyFile({ type: '', size: 20, name: 'photo.PNG' })).toBeNull();
    expect(classifyFile({ type: 'image/svg+xml', size: 20, name: 'photo.svg' })).toBe('type');
    expect(classifyFile({ type: 'text/plain', size: 20, name: 'notes.txt' })).toBe('type');
    expect(classifyFile({ type: '', size: 20, name: 'notes.txt' })).toBe('type');
    expect(classifyFile({ type: 'image/png', size: 0 })).toBe('empty');
    expect(classifyFile({ type: 'image/png', size: Number.NaN })).toBe('empty');
    expect(classifyFile({ type: 'image/png', size: LIMITS.maxInputBytes + 1 })).toBe('too-large');
  });

  it('scales down to the panel and does not enlarge a small photo', () => {
    expect(fittedSize(4000, 3000, LIMITS.maxEdge)).toEqual({ width: 1024, height: 768 });
    expect(fittedSize(100, 80, LIMITS.maxEdge)).toEqual({ width: 100, height: 80 });
    expect(fittedSize(100, 2000, 1024)).toEqual({ width: 51, height: 1024 });
    expect(fittedSize(0, 10, 100)).toBeNull();
    expect(fittedSize(10, Number.NaN, 100)).toBeNull();
    for (let i = 1; i < LIMITS.steps.length; i += 1) {
      expect(LIMITS.steps[i]!.edge).toBeLessThan(LIMITS.steps[i - 1]!.edge);
      expect(LIMITS.steps[i]!.quality).toBeGreaterThan(0);
      expect(LIMITS.steps[i]!.quality).toBeLessThanOrEqual(1);
    }
  });
});

describe('home preview choice', () => {
  it('uses the printer photo for idle, finished, and standby, and the file thumbnail only while printing or paused', () => {
    for (const status of STATUSES) {
      const art = previewChoice({ status, jobThumbnailReady: true, printerImageReady: true });
      expect(art).toBe(status === 'printing' || status === 'paused' ? 'job' : 'printer');
    }
    expect(previewChoice({ status: 'ready', jobThumbnailReady: true, printerImageReady: false })).toBe('generic');
    expect(previewChoice({ status: 'printing', jobThumbnailReady: false, printerImageReady: true })).toBe('printer');
    expect(previewChoice({ status: 'paused', jobThumbnailReady: false, printerImageReady: false })).toBe('generic');
    expect(previewChoice({ status: 'error', jobThumbnailReady: true, printerImageReady: false })).toBe('generic');
    expect(previewChoice({ status: 'disconnected', jobThumbnailReady: true, printerImageReady: true })).toBe('printer');
  });
});

describe('printer image storage', () => {
  const trident = printerImageScopeKey('trident', 'http://trident.local:7125');
  const other = printerImageScopeKey('switchwire', 'http://switchwire.local:7125');

  it('explains the size and persistence limits without claiming a printer upload', () => {
    const note = printerImageStorageNote();
    expect(note).toContain(String(LIMITS.maxEdge));
    expect(note).toContain(String(Math.round(LIMITS.maxStoredBytes / 1024)));
    expect(note).toContain(String(LIMITS.maxPrinters));
    expect(note).toContain('Chromium restart');
    expect(note).toContain('not sent to the printer');
    expect(note).not.toContain('http://');
    const codes: ImageProblem[] = ['type', 'empty', 'too-large', 'unreadable', 'over-budget', 'storage', 'quota', 'read', 'invalid', 'remove'];
    for (const code of codes) expect(printerImageErrorText(code).length).toBeGreaterThan(8);
    expect(formatStoredSize(86_000)).toBe('84 KB');
  });

  it('stores each printer separately and replaces only that printer', async () => {
    const library = new ImageLibrary(new MemoryPrinterImageRepository());
    expect(await library.save(image(trident, 1, 10))).toEqual({ ok: true });
    expect(await library.save(image(other, 2, 11))).toEqual({ ok: true });
    expect(await library.save(image(trident, 3, 12))).toEqual({ ok: true });

    const kept = await library.read(trident);
    const neighbor = await library.read(other);
    expect(kept.status).toBe('ok');
    expect(neighbor.status).toBe('ok');
    if (kept.status !== 'ok' || neighbor.status !== 'ok') return;
    expect(new Uint8Array(await kept.image.blob.arrayBuffer())[3]).toBe(3);
    expect(new Uint8Array(await neighbor.image.blob.arrayBuffer())[3]).toBe(2);
    expect(kept.image.scopeKey).toBe(trident);
  });

  it('drops an invalid saved photo and leaves a different printer alone', async () => {
    const repo = new MemoryPrinterImageRepository();
    const library = new ImageLibrary(repo);
    await library.save(image(other, 4, 1));
    repo.items.set(trident, image(trident, 5, 2, { mime: 'image/png', blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }) }));

    expect(await library.read(trident)).toEqual({ status: 'invalid' });
    expect(repo.items.has(trident)).toBe(false);
    expect((await library.read(other)).status).toBe('ok');
    expect(await library.read('missing-printer')).toEqual({ status: 'empty' });
    expect(await library.read('')).toEqual({ status: 'failed' });
  });

  it('keeps the previous photo when storage rejects the new one', async () => {
    const repo = new MemoryPrinterImageRepository();
    const library = new ImageLibrary(repo);
    await library.save(image(trident, 7, 1));
    repo.failPut = 'quota';
    expect(await library.save(image(trident, 8, 2))).toEqual({ ok: false, code: 'quota' });
    const still = await library.read(trident);
    expect(still.status).toBe('ok');
    if (still.status !== 'ok') return;
    expect(new Uint8Array(await still.image.blob.arrayBuffer())[3]).toBe(7);

    repo.failPut = 'storage';
    expect(await library.save(image(trident, 9, 3))).toEqual({ ok: false, code: 'storage' });
    const afterBlock = await library.read(trident);
    expect(afterBlock.status).toBe('ok');
    repo.failGet = true;
    expect(await library.read(trident)).toEqual({ status: 'failed' });
  });

  it('forgets the oldest other printers and never the one just saved', () => {
    const existing = Array.from({ length: LIMITS.maxPrinters }, (_, index) => ({
      scopeKey: `p${index}`,
      savedAt: index + 1,
    }));
    expect(keysToForget(existing, 'p-new', LIMITS.maxPrinters)).toEqual(['p0']);
    expect(keysToForget(existing, 'p0', LIMITS.maxPrinters)).toEqual([]);
    const tied = [
      { scopeKey: 'b', savedAt: 5 },
      { scopeKey: 'a', savedAt: 5 },
    ];
    expect(keysToForget(tied, 'fresh', 1)).toEqual(['a', 'b']);
    expect(keysToForget(tied, 'a', 1)).toEqual(['b']);
  });

  it('refuses a record that is not a bounded jpeg', async () => {
    const good = image('default\nhttp://printer.local:7125', 1, 1);
    expect(isUsableImage(good)).toBe(true);
    expect(await hasJpegMagic(good.blob)).toBe(true);
    expect(isUsableImage({ ...good, width: LIMITS.maxEdge + 1 })).toBe(false);
    expect(isUsableImage({ ...good, blob: jpeg(LIMITS.maxStoredBytes + 1, 1) })).toBe(false);
    expect(isUsableImage({ ...good, mime: 'image/png' })).toBe(false);
    expect(coerceStoredImage(null)).toBeNull();
    expect(coerceStoredImage({ scopeKey: good.scopeKey, mime: 'image/png' })).toBeNull();
    const coerced = coerceStoredImage({ ...good, mime: 'image/png' });
    expect(coerced?.mime).toBe('image/png');
    expect(coerced?.blob).toBeInstanceOf(Blob);
  });

  it('drops the oldest other printer when the book is full', async () => {
    const library = new ImageLibrary(new MemoryPrinterImageRepository());
    for (let index = 0; index < LIMITS.maxPrinters; index += 1) {
      expect(await library.save(image(`printer-${index}\nhttp://p${index}.local:7125`, index + 1, index + 1))).toEqual({ ok: true });
    }
    const newest = 'printer-new\nhttp://new.local:7125';
    expect(await library.save(image(newest, 20, 100))).toEqual({ ok: true });
    expect((await library.read('printer-0\nhttp://p0.local:7125')).status).toBe('empty');
    expect((await library.read(newest)).status).toBe('ok');
    expect((await library.read('printer-1\nhttp://p1.local:7125')).status).toBe('ok');
  });

  it('removes one printer without touching another', async () => {
    const repo = new MemoryPrinterImageRepository();
    const library = new ImageLibrary(repo);
    await library.save(image(trident, 1, 1));
    await library.save(image(other, 2, 2));
    expect(await library.remove(trident)).toEqual({ ok: true });
    expect(await library.read(trident)).toEqual({ status: 'empty' });
    expect((await library.read(other)).status).toBe('ok');
    expect(await library.remove('')).toEqual({ ok: false, code: 'remove' });
  });
});

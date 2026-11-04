import { integrationScopeKey } from '../integrations/preferences';
import { isJobActive, type PrinterStatus } from '../printer/model';

/**
 * Printer photo for the Home preview.
 *
 * The bytes live in IndexedDB on this browser origin, keyed by printer id and Moonraker
 * address. That survives a LAYR update and a Chromium restart, and it is not bundled
 * into the release. A future printer switcher uses the same scope as integration
 * switches, so one printer cannot display another's photo.
 *
 * IndexedDB on a kiosk profile is large enough for these copies, but it is still
 * finite and can be wiped if the browser profile is reset. The caps below keep a
 * photo small enough for the 1024×600 and 800×480 panels and for several printers.
 */
export const PRINTER_IMAGE_DB = 'layr.printer-image';
export const PRINTER_IMAGE_STORE = 'images';

export const LIMITS = {
  /** Reject larger originals before decode so a Pi does not expand a huge file. */
  maxInputBytes: 8 * 1024 * 1024,
  /** Largest JPEG this browser is asked to keep for one printer. */
  maxStoredBytes: 400 * 1024,
  /** Longest stored edge. Covers the Home hero on both kiosk panels without upscaling. */
  maxEdge: 1024,
  /** Other printers' photos beyond this are dropped, oldest first. The one just saved stays. */
  maxPrinters: 8,
  steps: [
    { edge: 1024, quality: 0.82 },
    { edge: 800, quality: 0.74 },
    { edge: 640, quality: 0.66 },
    { edge: 480, quality: 0.58 },
  ],
} as const;

export type ImageProblem =
  | 'type'
  | 'empty'
  | 'too-large'
  | 'unreadable'
  | 'over-budget'
  | 'storage'
  | 'quota'
  | 'read'
  | 'invalid'
  | 'remove';

const PROBLEM_TEXT: Record<ImageProblem, string> = {
  type: 'Use a JPEG, PNG, WebP, or GIF photo.',
  empty: 'That file is empty. Choose a photo.',
  'too-large': `Choose a photo that is ${LIMITS.maxInputBytes / (1024 * 1024)} MB or smaller.`,
  unreadable: 'LAYR could not read that image. Try a different JPEG or PNG.',
  'over-budget': 'That photo is still too large after shrinking. Try a simpler picture.',
  storage: 'This browser blocked saving the photo. It will not stay after a restart.',
  quota: 'This device has no room left for a photo. Remove one and try again.',
  read: 'The saved photo could not be opened. It is still on this device if storage recovers.',
  invalid: 'The saved photo could not be used, so LAYR removed it. Choose another.',
  remove: 'The photo could not be removed. It is still saved on this device.',
};

export function printerImageErrorText(code: ImageProblem): string {
  return PROBLEM_TEXT[code];
}

/** Shown under the Settings control. Numbers come from `LIMITS`. */
export function printerImageStorageNote(): string {
  const megabytes = LIMITS.maxInputBytes / (1024 * 1024);
  const kilobytes = Math.round(LIMITS.maxStoredBytes / 1024);
  return `Saved in this browser for this Moonraker address, so a different printer does not reuse it. It remains after a LAYR update and a Chromium restart. Your saved copy is not sent to the printer or added to an app release. A photo must be ${megabytes} MB or smaller; LAYR stores a copy up to ${LIMITS.maxEdge} px and ${kilobytes} KB. GIF files keep the first frame. At most ${LIMITS.maxPrinters} printers are kept.`;
}

export class PrinterImageError extends Error {
  readonly code: ImageProblem;

  constructor(code: ImageProblem) {
    super(PROBLEM_TEXT[code]);
    this.name = 'PrinterImageError';
    this.code = code;
  }
}

const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']);

export function printerImageScopeKey(printerId: string, moonrakerUrl: string | null): string {
  return integrationScopeKey(printerId, moonrakerUrl);
}

export function isScopeKey(key: string): boolean {
  return key.length > 0 && key.length <= 1024 && !key.includes('\u0000');
}

/** Null when the file may be decoded. SVG is refused so it is never painted as markup. */
export function classifyFile(file: { type: string; size: number; name?: string }): ImageProblem | null {
  if (!Number.isFinite(file.size) || file.size < 1) return 'empty';
  if (file.size > LIMITS.maxInputBytes) return 'too-large';
  const type = file.type.trim().toLowerCase();
  if (type === 'image/svg+xml') return 'type';
  if (ACCEPTED_TYPES.has(type)) return null;
  if (!type && file.name && /\.(jpe?g|png|webp|gif)$/i.test(file.name)) return null;
  return 'type';
}

/** Fit inside a square of `edge` without upscaling. Null when the size is not usable. */
export function fittedSize(width: number, height: number, edge: number): { width: number; height: number } | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return null;
  if (!Number.isFinite(edge) || edge < 1) return null;
  const longest = Math.max(width, height);
  if (longest <= edge) return { width: Math.round(width), height: Math.round(height) };
  const scale = edge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export interface StoredPrinterImage {
  scopeKey: string;
  blob: Blob;
  mime: string;
  width: number;
  height: number;
  savedAt: number;
}

/** Structural read of an IndexedDB value. Limit checks happen in `isUsableImage`. */
export function coerceStoredImage(value: unknown): StoredPrinterImage | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.scopeKey !== 'string' || !(record.blob instanceof Blob)) return null;
  return {
    scopeKey: record.scopeKey,
    blob: record.blob,
    mime: typeof record.mime === 'string' ? record.mime : '',
    width: typeof record.width === 'number' ? record.width : Number.NaN,
    height: typeof record.height === 'number' ? record.height : Number.NaN,
    savedAt: typeof record.savedAt === 'number' ? record.savedAt : Number.NaN,
  };
}

export function isUsableImage(image: StoredPrinterImage): boolean {
  if (image.mime !== 'image/jpeg') return false;
  if (!isScopeKey(image.scopeKey)) return false;
  if (!Number.isInteger(image.width) || image.width < 1 || image.width > LIMITS.maxEdge) return false;
  if (!Number.isInteger(image.height) || image.height < 1 || image.height > LIMITS.maxEdge) return false;
  if (!Number.isFinite(image.savedAt)) return false;
  const size = image.blob.size;
  if (!Number.isFinite(size) || size < 3 || size > LIMITS.maxStoredBytes) return false;
  return true;
}

export async function hasJpegMagic(blob: Blob): Promise<boolean> {
  if (blob.size < 3) return false;
  const bytes = new Uint8Array(await blob.slice(0, 3).arrayBuffer());
  return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

export type PreviewArt = 'job' | 'printer' | 'generic';

/**
 * Artwork inside the Home job card.
 * Printing and paused use the G-code thumbnail once it has loaded.
 * Idle, standby, complete, cancelled, and a non-running error use the printer
 * photo even when an old job thumbnail is still known. Connection failures are
 * not drawn here; Dashboard keeps those on the connection card.
 */
export function previewChoice(input: {
  status: PrinterStatus;
  jobThumbnailReady: boolean;
  printerImageReady: boolean;
}): PreviewArt {
  if (isJobActive(input.status) && input.jobThumbnailReady) return 'job';
  if (input.printerImageReady) return 'printer';
  return 'generic';
}

/** Keys to drop after a successful save. Never includes the printer just saved. */
export function keysToForget(
  existing: ReadonlyArray<{ scopeKey: string; savedAt: number }>,
  savedKey: string,
  maxPrinters: number,
): string[] {
  const known = new Set(existing.map((entry) => entry.scopeKey));
  const total = known.has(savedKey) ? existing.length : existing.length + 1;
  const overflow = total - maxPrinters;
  if (overflow <= 0) return [];
  return existing
    .filter((entry) => entry.scopeKey !== savedKey)
    .sort((a, b) => a.savedAt - b.savedAt || a.scopeKey.localeCompare(b.scopeKey))
    .slice(0, overflow)
    .map((entry) => entry.scopeKey);
}

export function formatStoredSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

import { toNumber } from '../moonraker/mapping';
import type { DirectoryResult, FileMetadata, ThumbnailInfo } from '../moonraker/types';

export const GCODE_EXTENSIONS = /\.(gcode|gco|g|ufp)$/i;

export interface Thumbnail {
  width: number;
  height: number;
  /** Path relative to the `gcodes` root, e.g. `parts/.thumbs/clip-300x300.png`. */
  path: string;
}

export interface FileMeta {
  estimatedTime: number | null;
  filamentTotal: number | null;
  filamentWeight: number | null;
  filamentType: string | null;
  filamentName: string | null;
  layerHeight: number | null;
  firstLayerHeight: number | null;
  objectHeight: number | null;
  nozzleDiameter: number | null;
  slicer: string | null;
  firstLayerExtruderTemp: number | null;
  firstLayerBedTemp: number | null;
  chamberTemp: number | null;
  thumbnails: Thumbnail[];
}

export interface FileEntry {
  /** Path relative to the `gcodes` root. */
  path: string;
  name: string;
  /** Unix time in seconds. */
  modified: number | null;
  size: number | null;
  /** Null until metadata has been loaded; may stay null if Moonraker has none. */
  meta: FileMeta | null;
}

export interface DirEntry {
  /** Path relative to the `gcodes` root. */
  path: string;
  name: string;
  modified: number | null;
}

export type SortKey = 'modified' | 'name' | 'size' | 'time';

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** Joins and normalises a path relative to the `gcodes` root (resolves `.` and `..`, never escapes the root). */
export function joinPath(...parts: string[]): string {
  const out: string[] = [];
  for (const part of parts.join('/').split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

export function parentDir(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
}

/** Encodes each path segment, keeping `/` separators: `my dir/a#1.png` → `my%20dir/a%231.png`. */
export function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

/** Moonraker download path for a file in the `gcodes` root. */
export function gcodesFileUrlPath(path: string, cacheKey?: number | null): string {
  const query = cacheKey ? `?timestamp=${encodeURIComponent(String(cacheKey))}` : '';
  return `/server/files/gcodes/${encodePath(path)}${query}`;
}

/**
 * Metadata thumbnails carry `relative_path`, relative to the G-code file's folder (Moonraker docs, "Thumbnail
 * Info"). This resolves them against the file's folder so nested files load the right image.
 */
export function mapThumbnails(filePath: string, thumbs: ThumbnailInfo[] | undefined): Thumbnail[] {
  if (!Array.isArray(thumbs)) return [];
  const dir = parentDir(filePath);
  return thumbs
    .filter((t) => typeof t?.relative_path === 'string' && t.relative_path !== '')
    .map((t) => ({
      width: toNumber(t.width) ?? 0,
      height: toNumber(t.height) ?? 0,
      path: joinPath(dir, t.relative_path!),
    }));
}

/** The smallest thumbnail at least `minWidth` wide, else the largest available. */
export function pickThumbnail(thumbs: readonly Thumbnail[], minWidth: number): Thumbnail | null {
  if (thumbs.length === 0) return null;
  const sorted = [...thumbs].sort((a, b) => a.width - b.width);
  return sorted.find((t) => t.width >= minWidth) ?? sorted.at(-1)!;
}

export function mapMetadata(filePath: string, meta: FileMetadata): FileMeta {
  return {
    estimatedTime: toNumber(meta.estimated_time),
    filamentTotal: toNumber(meta.filament_total),
    filamentWeight: toNumber(meta.filament_weight_total),
    filamentType: text(meta.filament_type),
    filamentName: text(meta.filament_name),
    layerHeight: toNumber(meta.layer_height),
    firstLayerHeight: toNumber(meta.first_layer_height),
    objectHeight: toNumber(meta.object_height),
    nozzleDiameter: toNumber(meta.nozzle_diameter),
    slicer: text(meta.slicer) ? [text(meta.slicer), text(meta.slicer_version)].filter(Boolean).join(' ') : null,
    firstLayerExtruderTemp: toNumber(meta.first_layer_extr_temp),
    firstLayerBedTemp: toNumber(meta.first_layer_bed_temp),
    chamberTemp: toNumber(meta.chamber_temp),
    thumbnails: mapThumbnails(filePath, meta.thumbnails),
  };
}

/** True when an extended directory listing included slicer metadata for this file. */
function hasMetadata(file: Record<string, unknown>): boolean {
  return 'estimated_time' in file || 'thumbnails' in file || 'slicer' in file;
}

/** Maps `server.files.get_directory` for `gcodes/<dir>`: hidden folders and non-G-code files are skipped. */
export function mapDirectory(dir: string, result: DirectoryResult): { dirs: DirEntry[]; files: FileEntry[] } {
  const dirs: DirEntry[] = [];
  for (const d of result.dirs ?? []) {
    const name = text(d.dirname);
    if (!name || name.startsWith('.')) continue;
    dirs.push({ path: joinPath(dir, name), name, modified: toNumber(d.modified) });
  }
  const files: FileEntry[] = [];
  for (const f of result.files ?? []) {
    const name = text(f.filename);
    if (!name || name.startsWith('.') || !GCODE_EXTENSIONS.test(name)) continue;
    const path = joinPath(dir, name);
    files.push({
      path,
      name,
      modified: toNumber(f.modified),
      size: toNumber(f.size),
      meta: hasMetadata(f as Record<string, unknown>) ? mapMetadata(path, f) : null,
    });
  }
  dirs.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  return { dirs, files };
}

export function sortFiles(files: readonly FileEntry[], key: SortKey): FileEntry[] {
  const byName = (a: FileEntry, b: FileEntry) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  const desc = (pick: (f: FileEntry) => number | null) => (a: FileEntry, b: FileEntry) =>
    (pick(b) ?? -1) - (pick(a) ?? -1) || byName(a, b);
  switch (key) {
    case 'name':
      return [...files].sort(byName);
    case 'size':
      return [...files].sort(desc((f) => f.size));
    case 'time':
      return [...files].sort(desc((f) => f.meta?.estimatedTime ?? null));
    case 'modified':
      return [...files].sort(desc((f) => f.modified));
  }
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

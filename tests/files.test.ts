import { describe, expect, it } from 'vitest';
import {
  encodePath,
  formatBytes,
  gcodesFileUrlPath,
  joinPath,
  mapDirectory,
  pathCrumbs,
  mapMetadata,
  mapThumbnails,
  pickThumbnail,
  sortFiles,
  type FileEntry,
} from '../src/lib/files/files';

describe('thumbnail paths', () => {
  it('resolves metadata relative_path against the G-code file folder (Moonraker "Thumbnail Info")', () => {
    const thumbs = mapThumbnails('sb/parts/body.gcode', [
      { width: 32, height: 32, relative_path: '.thumbs/body-32x32.png' },
      { width: 300, height: 300, relative_path: '.thumbs/body-300x300.png' },
      { width: 10, height: 10 },
    ]);
    expect(thumbs.map((t) => t.path)).toEqual(['sb/parts/.thumbs/body-32x32.png', 'sb/parts/.thumbs/body-300x300.png']);
    expect(mapThumbnails('root.gcode', [{ width: 1, relative_path: '.thumbs/root.png' }])[0]!.path).toBe('.thumbs/root.png');
    expect(mapThumbnails('x.gcode', undefined)).toEqual([]);
  });

  it('never escapes the gcodes root', () => {
    expect(joinPath('a', '../../etc/passwd')).toBe('etc/passwd');
    expect(joinPath('a/b', './.thumbs//c.png')).toBe('a/b/.thumbs/c.png');
  });

  it('encodes each segment for the download URL and adds a cache key', () => {
    expect(encodePath('first layer #2/.thumbs/a?b.png')).toBe('first%20layer%20%232/.thumbs/a%3Fb.png');
    expect(gcodesFileUrlPath('my dir/.thumbs/x.png', 1700000000.5)).toBe('/server/files/gcodes/my%20dir/.thumbs/x.png?timestamp=1700000000.5');
    expect(gcodesFileUrlPath('x.png', null)).toBe('/server/files/gcodes/x.png');
  });

  it('picks the smallest thumbnail that is large enough, else the largest', () => {
    const thumbs = [
      { width: 300, height: 300, path: 'big' },
      { width: 32, height: 32, path: 'small' },
      { width: 128, height: 128, path: 'mid' },
    ];
    expect(pickThumbnail(thumbs, 64)?.path).toBe('mid');
    expect(pickThumbnail(thumbs, 400)?.path).toBe('big');
    expect(pickThumbnail(thumbs, 1)?.path).toBe('small');
    expect(pickThumbnail([], 64)).toBeNull();
  });
});

describe('metadata mapping', () => {
  it('maps slicer metadata and tolerates missing fields', () => {
    const meta = mapMetadata('a/b.gcode', {
      estimated_time: 3600,
      filament_total: 1234.5,
      filament_weight_total: 3.7,
      filament_type: 'ASA',
      layer_height: 0.2,
      slicer: 'OrcaSlicer',
      slicer_version: '2.3.0',
      first_layer_extr_temp: 255,
      thumbnails: [{ width: 300, height: 300, relative_path: '.thumbs/b.png' }],
    });
    expect(meta).toMatchObject({
      estimatedTime: 3600,
      filamentTotal: 1234.5,
      filamentWeight: 3.7,
      filamentType: 'ASA',
      layerHeight: 0.2,
      slicer: 'OrcaSlicer 2.3.0',
      firstLayerExtruderTemp: 255,
      firstLayerBedTemp: null,
      thumbnails: [{ width: 300, height: 300, path: 'a/.thumbs/b.png' }],
    });
    expect(mapMetadata('x.gcode', {})).toMatchObject({ estimatedTime: null, slicer: null, thumbnails: [] });
  });

  it('maps a directory listing, skipping hidden folders and non-G-code files', () => {
    const result = mapDirectory('sb', {
      dirs: [{ dirname: '.thumbs' }, { dirname: 'Zeta' }, { dirname: 'alpha' }],
      files: [
        { filename: 'part.gcode', modified: 10, size: 100, estimated_time: 60, thumbnails: [] },
        { filename: 'notes.txt', modified: 11, size: 1 },
        { filename: 'legacy.gcode', modified: 12, size: 5 },
      ],
    });
    expect(result.dirs.map((d) => d.path)).toEqual(['sb/alpha', 'sb/Zeta']);
    expect(result.files.map((f) => [f.path, f.meta === null])).toEqual([
      ['sb/part.gcode', false],
      // No metadata in the listing (older Moonraker): fetched separately.
      ['sb/legacy.gcode', true],
    ]);
  });

  it('keeps the current directory only, including an empty folder, and does not pull in nested files', () => {
    const result = mapDirectory('jobs', {
      dirs: [{ dirname: 'empty bin' }, { dirname: '.thumbs' }, { dirname: 'customer #1' }],
      files: [{ filename: 'panel.gcode', modified: 1, size: 10, estimated_time: 30 }],
    });
    expect(result.dirs.map((d) => d.path)).toEqual(['jobs/customer #1', 'jobs/empty bin']);
    expect(result.files.map((f) => f.path)).toEqual(['jobs/panel.gcode']);
  });
});

describe('folder path', () => {
  it('builds a breadcrumb from the real directory and cannot leave the gcodes root', () => {
    expect(pathCrumbs('')).toEqual([{ label: 'G-code files', path: '' }]);
    expect(pathCrumbs('stealthburner')).toEqual([
      { label: 'G-code files', path: '' },
      { label: 'stealthburner', path: 'stealthburner' },
    ]);
    expect(pathCrumbs('stealthburner/parts/hardware')).toEqual([
      { label: 'G-code files', path: '' },
      { label: 'stealthburner', path: 'stealthburner' },
      { label: 'parts', path: 'stealthburner/parts' },
      { label: 'hardware', path: 'stealthburner/parts/hardware' },
    ]);
    expect(pathCrumbs('a//b/../c')).toEqual([
      { label: 'G-code files', path: '' },
      { label: 'a', path: 'a' },
      { label: 'c', path: 'a/c' },
    ]);
    expect(pathCrumbs('../etc')).toEqual([
      { label: 'G-code files', path: '' },
      { label: 'etc', path: 'etc' },
    ]);
  });
});

describe('sorting and formatting', () => {
  const file = (name: string, modified: number, size: number, time: number | null): FileEntry => ({
    path: name,
    name,
    modified,
    size,
    meta: time === null ? null : { ...mapMetadata(name, {}), estimatedTime: time },
  });
  const files = [file('b10.gcode', 3, 50, 100), file('b9.gcode', 1, 500, null), file('A.gcode', 2, 5, 900)];

  it('sorts by date, natural name, size and print time', () => {
    expect(sortFiles(files, 'modified').map((f) => f.name)).toEqual(['b10.gcode', 'A.gcode', 'b9.gcode']);
    expect(sortFiles(files, 'name').map((f) => f.name)).toEqual(['A.gcode', 'b9.gcode', 'b10.gcode']);
    expect(sortFiles(files, 'size').map((f) => f.name)).toEqual(['b9.gcode', 'b10.gcode', 'A.gcode']);
    expect(sortFiles(files, 'time').map((f) => f.name)).toEqual(['A.gcode', 'b10.gcode', 'b9.gcode']);
  });

  it('formats sizes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(4_812_300)).toBe('4.6 MB');
    expect(formatBytes(null)).toBe('—');
  });
});

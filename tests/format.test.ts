import { describe, expect, it } from 'vitest';
import { displayFilename, formatClock, formatDuration, formatFilament, formatFlow, formatPercent, formatSpeed, formatTemp } from '../src/lib/format';
import { parseRoute } from '../src/lib/routes';

describe('format', () => {
  it('formats durations with reduced precision for long values', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(-1)).toBe('—');
    expect(formatDuration(42)).toBe('42s');
    expect(formatDuration(245)).toBe('4m 05s');
    expect(formatDuration(1500)).toBe('25m');
    expect(formatDuration(3723)).toBe('1h 02m');
  });

  it('formats clock, temperatures, percent, filament and filenames', () => {
    expect(formatClock(Date.UTC(2026, 0, 1, 9, 5), 'UTC')).toBe('09:05');
    expect(formatTemp(214.6)).toBe('215');
    expect(formatTemp(null)).toBe('—');
    expect(formatPercent(0.999)).toBe('99');
    expect(formatPercent(1.2)).toBe('100');
    expect(formatFilament(950)).toBe('950 mm');
    expect(formatFilament(12345)).toBe('12.35 m');
    expect(displayFilename('a/b/part_v2.gcode')).toBe('part_v2');
    expect(formatSpeed(48.2)).toBe('48');
    expect(formatSpeed(null)).toBe('—');
    expect(formatFlow(12)).toBe('12.0');
    expect(formatFlow(-1.26)).toBe('-1.3');
    expect(formatFlow(null)).toBe('—');
  });

  it('parses hash routes', () => {
    expect(parseRoute('#/files')).toBe('files');
    expect(parseRoute('')).toBe('home');
    expect(parseRoute('#/nope')).toBe('home');
  });
});

/**
 * Formats seconds as `1h 07m`, `42m` or `4m 05s`. Seconds are only shown under 10 minutes so live values
 * do not change (and re-render) every second for most of a print.
 */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return '—';
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m >= 10) return `${m}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, '0')}s`;
  return `${sec}s`;
}

/** Formats an epoch ms timestamp as a 24h wall-clock time, e.g. `16:47`. */
export function formatClock(epochMs: number | null | undefined, timeZone?: string): string {
  if (epochMs === null || epochMs === undefined || !Number.isFinite(epochMs)) return '—';
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone }).format(
    new Date(epochMs),
  );
}

export function formatTemp(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return String(Math.round(value));
}

export function formatPercent(progress: number | null | undefined): string {
  if (progress === null || progress === undefined || !Number.isFinite(progress)) return '—';
  return `${Math.floor(Math.min(1, Math.max(0, progress)) * 100)}`;
}

/** `prints/sub/part_v2.gcode` → `part_v2`. */
export function displayFilename(path: string): string {
  const name = path.split('/').pop() ?? path;
  return name.replace(/\.(gcode|gco|g|ufp)$/i, '');
}

/** Formats Unix seconds as `15 Jan 14:32` (or `15 Jan 2025` for other years). */
export function formatDate(unixSeconds: number | null | undefined, now = Date.now()): string {
  if (unixSeconds === null || unixSeconds === undefined || !Number.isFinite(unixSeconds)) return '—';
  const date = new Date(unixSeconds * 1000);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat('en-GB', sameYear
    ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }
    : { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

/** Live toolhead speed in mm/s. Never a percentage. */
export function formatSpeed(mmPerS: number | null | undefined): string {
  if (mmPerS === null || mmPerS === undefined || !Number.isFinite(mmPerS)) return '—';
  return String(Math.round(mmPerS));
}

/** Live volumetric flow in mm³/s, one decimal. Negative is retraction. */
export function formatFlow(mm3PerS: number | null | undefined): string {
  if (mm3PerS === null || mm3PerS === undefined || !Number.isFinite(mm3PerS)) return '—';
  const quantized = Math.round(mm3PerS * 10) / 10;
  return (Object.is(quantized, -0) ? 0 : quantized).toFixed(1);
}

export function formatFilament(mm: number | null | undefined): string {
  if (mm === null || mm === undefined || !Number.isFinite(mm) || mm <= 0) return '—';
  return mm >= 1000 ? `${(mm / 1000).toFixed(2)} m` : `${Math.round(mm)} mm`;
}

import { cssColor, materialText, quantityText, type SpoolmanSnapshot } from './api';
import type { SpoolSummary } from './types';

export interface SpoolHeadline {
  title: string;
  detail: string;
  /** CSS colour, or null when Spoolman did not send one. */
  color: string | null;
  titleAttr: string;
}

function pack(title: string, detail: string, color: string | null, titleAttr: string): SpoolHeadline {
  return { title, detail, color, titleAttr };
}

/** Compact line for Home, Extrude, and the job card. Null when Spoolman is not in use. */
export function headlineFor(snapshot: SpoolmanSnapshot, spool: SpoolSummary | null): SpoolHeadline | null {
  if (!snapshot.tracked) return null;
  if (snapshot.phase === 'loading') return pack('Spoolman', 'Reading Spoolman…', null, 'Reading Spoolman');
  if (snapshot.phase !== 'ready') {
    const title =
      snapshot.phase === 'unauthorized' ? 'Spoolman unauthorized' : snapshot.phase === 'offline' ? 'Spoolman offline' : 'Spoolman unavailable';
    return pack(title, 'Tap to retry', null, snapshot.message || title);
  }
  if (!snapshot.activeKnown || snapshot.activeId == null) {
    return pack('No active spool', 'Browse to choose one', null, 'No active spool');
  }
  const name = spool?.name ?? `Spool ${snapshot.activeId}`;
  const material = spool ? materialText(spool) : 'Material not reported';
  const qty = spool ? quantityText(spool) : 'Quantity not reported';
  return pack(name, `${material} · ${qty}`, cssColor(spool?.colorHex ?? null), `${name}. ${material}. ${qty}.`);
}

/** Extra text for the printing job line. Null when Spoolman is not in use. */
export function jobSpoolSuffix(snapshot: SpoolmanSnapshot, spool: SpoolSummary | null): string | null {
  const line = headlineFor(snapshot, spool);
  if (!line) return null;
  if (snapshot.phase !== 'ready' || snapshot.activeId == null) return line.title;
  return `${line.title} · ${line.detail}`;
}

import enclosed from '../../assets/printer-illustrations/enclosed.png?inline';
import openFrame from '../../assets/printer-illustrations/open-frame.png?inline';
import compact from '../../assets/printer-illustrations/compact.png?inline';
import { PrinterImageError } from './policy';

/** Original, bundled raster artwork. No remote URLs or operating-system chooser. */
export const PRINTER_ILLUSTRATIONS = [
  { id: 'enclosed', label: 'Enclosed', src: enclosed },
  { id: 'open-frame', label: 'Open frame', src: openFrame },
  { id: 'compact', label: 'Compact', src: compact },
] as const;

/** Use the same File validation, JPEG compression and per-printer storage as uploads. */
export function printerIllustrationFile(id: string): File {
  const illustration = PRINTER_ILLUSTRATIONS.find((item) => item.id === id);
  if (!illustration) throw new PrinterImageError('unreadable');
  const encoded = illustration.src.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/)?.[1];
  if (!encoded) throw new PrinterImageError('unreadable');
  const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  return new File([bytes], `${illustration.id}.png`, { type: 'image/png' });
}

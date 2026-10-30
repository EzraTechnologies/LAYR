import { fittedSize, LIMITS, PrinterImageError } from './policy';

export interface EncodedPrinterPhoto {
  blob: Blob;
  width: number;
  height: number;
}

function encodeJpeg(bitmap: ImageBitmap, width: number, height: number, quality: number): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) return Promise.reject(new PrinterImageError('unreadable'));
  context.fillStyle = '#11141b';
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob || blob.size < 1 || (blob.type && blob.type !== 'image/jpeg')) reject(new PrinterImageError('unreadable'));
        else resolve(blob);
      },
      'image/jpeg',
      quality,
    );
  });
}

/**
 * Draws the file to a bounded JPEG. The stored bytes are the canvas output, so a
 * chosen SVG, script, or exotic container is never what Home displays.
 */
export async function compressPrinterPhoto(file: Blob): Promise<EncodedPrinterPhoto> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new PrinterImageError('unreadable');
  }
  try {
    let last: EncodedPrinterPhoto | null = null;
    for (const step of LIMITS.steps) {
      const size = fittedSize(bitmap.width, bitmap.height, step.edge);
      if (!size) throw new PrinterImageError('unreadable');
      const blob = await encodeJpeg(bitmap, size.width, size.height, step.quality);
      last = { blob, width: size.width, height: size.height };
      if (blob.size <= LIMITS.maxStoredBytes) return last;
    }
    if (last && last.blob.size <= LIMITS.maxStoredBytes) return last;
    throw new PrinterImageError('over-budget');
  } finally {
    bitmap.close();
  }
}

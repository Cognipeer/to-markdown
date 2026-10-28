/** Image media types that VLM APIs (OpenAI, Anthropic, Ollama) accept as-is. */
const VLM_NATIVE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

/** Sniffs the media type of common image formats from their magic bytes. */
export function sniffImageMimeType(buffer: Buffer): string | undefined {
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer.toString('latin1', 1, 4) === 'PNG') {
    return 'image/png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (buffer.length >= 6 && buffer.toString('latin1', 0, 4) === 'GIF8') return 'image/gif';
  if (
    buffer.length >= 12 &&
    buffer.toString('latin1', 0, 4) === 'RIFF' &&
    buffer.toString('latin1', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (buffer.length >= 2 && buffer[0] === 0x42 && buffer[1] === 0x4d) return 'image/bmp';
  if (
    buffer.length >= 4 &&
    ((buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2a && buffer[3] === 0x00) ||
      (buffer[0] === 0x4d && buffer[1] === 0x4d && buffer[2] === 0x00 && buffer[3] === 0x2a))
  ) {
    return 'image/tiff';
  }
  return undefined;
}

function normalizeMime(mime?: string): string | undefined {
  if (!mime) return undefined;
  const m = mime.split(';')[0].trim().toLowerCase();
  return m === 'image/jpg' ? 'image/jpeg' : m;
}

/**
 * Re-encodes an image as PNG. Uses sharp (TIFF, WebP, AVIF, SVG, ...) and falls
 * back to the bundled canvas for formats sharp cannot read (BMP).
 */
export async function transcodeToPng(buffer: Buffer, mimeType?: string): Promise<Buffer> {
  const isBmp = normalizeMime(mimeType) === 'image/bmp' || sniffImageMimeType(buffer) === 'image/bmp';
  let sharpError: unknown;
  if (!isBmp) {
    try {
      const sharp = (await import('sharp')).default;
      return await sharp(buffer).png().toBuffer();
    } catch (err) {
      sharpError = err;
    }
  }
  try {
    const { createCanvas, loadImage } = await import('@napi-rs/canvas');
    const image = await loadImage(buffer);
    const canvas = createCanvas(image.width, image.height);
    canvas.getContext('2d').drawImage(image, 0, 0);
    return Buffer.from(canvas.toBuffer('image/png'));
  } catch (err) {
    const cause = sharpError ?? err;
    throw new Error(
      `cannot convert ${mimeType ?? 'image'} to PNG: ${cause instanceof Error ? cause.message : String(cause)}`
    );
  }
}

/**
 * Prepares an image for a vision-language model: keeps png/jpeg/gif/webp bytes
 * untouched (with their real media type) and transcodes anything else to PNG.
 * When the media type is unknown it is sniffed from the bytes; when that fails
 * too the bytes are sent as PNG like 3.5.0 did.
 */
export async function prepareImageForVlm(
  buffer: Buffer,
  mimeType?: string
): Promise<{ buffer: Buffer; mimeType: string }> {
  // The declared type (context.mimeType) wins; the bytes are only sniffed without one.
  const actual = normalizeMime(mimeType) ?? sniffImageMimeType(buffer);
  if (actual && VLM_NATIVE_TYPES.has(actual)) return { buffer, mimeType: actual };
  if (!actual) return { buffer, mimeType: 'image/png' };
  return { buffer: await transcodeToPng(buffer, actual), mimeType: 'image/png' };
}

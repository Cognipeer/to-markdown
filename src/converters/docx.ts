import AdmZip from 'adm-zip';
import { createHash } from 'crypto';
import { convertToHtml, images as mammothImages } from 'mammoth';
import { formatMarkdown } from '../utils/markdown.js';
import { htmlToMarkdown } from './html.js';
import type { ConverterOptions } from '../types/index.js';
import { withConversionContext, type ConversionContext } from '../utils/conversionContext.js';
import {
  EmbeddedImageSession,
  IMAGE_TOKEN_SCHEME,
  replaceImageTokens,
  resolveEmbeddedImagePolicy,
  type EmbeddedImagePolicy,
} from '../utils/embeddedImages.js';

/**
 * Converts DOCX buffer to Markdown
 *
 * Embedded pictures are inlined as data URIs (3.5.0 behaviour) unless
 * `options.images` is `'placeholder'` / `'omit'` or `options.ocr.embeddedImages`
 * is on; then every picture goes through the embedded image policy (placeholder
 * name, removal, OCR text as a blockquote after the image).
 *
 * @param buffer  - DOCX file buffer
 * @param options - Converter options (`images`, `ocr`)
 * @param ctx     - Conversion context (reports, warnings, shared OCR engine); internal
 * @returns Markdown string
 */
export async function convertDocxToMarkdown(
  buffer: Buffer,
  options?: ConverterOptions,
  ctx?: ConversionContext
): Promise<string> {
  const policy = resolveEmbeddedImagePolicy(options);
  if (!policy) {
    try {
      const result = await convertToHtml({ buffer }, { styleMap: [] });
      const html = result.value || '';

      let markdown = htmlToMarkdown(html);
      markdown = formatMarkdown(markdown);

      return markdown;
    } catch (err: any) {
      throw new Error(`Failed to convert DOCX: ${err.message}`);
    }
  }
  return withConversionContext(ctx, options ?? {}, (conv) =>
    convertDocxWithImages(buffer, policy, conv)
  );
}

interface DocxImage {
  buffer: Buffer | undefined;
  contentType: string;
}

async function convertDocxWithImages(
  buffer: Buffer,
  policy: EmbeddedImagePolicy,
  conv: ConversionContext
): Promise<string> {
  // The picture bytes are only needed for OCR and for keeping the data URI.
  const needBytes = !!policy.ocr || policy.mode === 'inline';
  const found: DocxImage[] = [];
  let html: string;
  try {
    const result = await convertToHtml(
      { buffer },
      {
        styleMap: [],
        // The id is taken before the first await, so it follows document order.
        convertImage: mammothImages.imgElement(async (image) => {
          const id = found.length;
          const slot: DocxImage = { buffer: undefined, contentType: image.contentType };
          found.push(slot);
          if (needBytes) slot.buffer = Buffer.from(await image.read());
          return { src: `${IMAGE_TOKEN_SCHEME}${id}` };
        }),
      }
    );
    html = result.value || '';
  } catch (err: any) {
    throw new Error(`Failed to convert DOCX: ${err.message}`);
  }

  const session = new EmbeddedImageSession(conv, policy);
  const paths = policy.ocr ? docxMediaPaths(buffer) : new Map<string, string>();
  for (const image of found) {
    const bytes = image.buffer ?? Buffer.alloc(0);
    const sourcePath = bytes.length > 0 ? paths.get(sha1(bytes)) : undefined;
    session.register({
      buffer: bytes,
      mimeType: image.contentType,
      ...(sourcePath ? { sourcePath } : {}),
    });
  }

  // Cancellation and `onError: 'throw'` surface unchanged.
  await session.runOcr();

  try {
    const markdown = replaceImageTokens(htmlToMarkdown(html), (id, alt, title) => {
      const entry = session.entries[id];
      const block = entry?.block || undefined;
      if (!entry || policy.mode === 'omit') return { image: '', block };
      const target =
        policy.mode === 'placeholder'
          ? entry.placeholder
          : `data:${found[id].contentType};base64,${(found[id].buffer ?? Buffer.alloc(0)).toString('base64')}`;
      return { image: `![${alt}](${target}${title})`, block };
    });
    return formatMarkdown(markdown);
  } catch (err: any) {
    throw new Error(`Failed to convert DOCX: ${err.message}`);
  }
}

function sha1(bytes: Buffer): string {
  return createHash('sha1').update(bytes).digest('hex');
}

/** sha1 of every `word/media/*` entry -> its path (mammoth does not expose where a picture came from). */
function docxMediaPaths(buffer: Buffer): Map<string, string> {
  const paths = new Map<string, string>();
  try {
    const zip = new AdmZip(buffer);
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory || !entry.entryName.startsWith('word/media/')) continue;
      const hash = sha1(entry.getData());
      if (!paths.has(hash)) paths.set(hash, entry.entryName);
    }
  } catch {
    /* paths are optional */
  }
  return paths;
}

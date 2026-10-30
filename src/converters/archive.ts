import AdmZip from 'adm-zip';
import { extname, posix } from 'path';
import { parseStringPromise } from 'xml2js';
import { formatMarkdown } from '../utils/markdown.js';
import { convertHtmlToMarkdown } from './html.js';
import { convertCsvToMarkdown } from './spreadsheet.js';
import type { ConverterOptions } from '../types/index.js';
import { withConversionContext, type ConversionContext } from '../utils/conversionContext.js';
import {
  EmbeddedImageSession,
  resolveEmbeddedImagePolicy,
  type EmbeddedImagePolicy,
} from '../utils/embeddedImages.js';

/**
 * Converts PowerPoint buffer to Markdown
 *
 * By default only slide text is emitted. With `options.images` set to
 * `'placeholder'` / `'omit'` (or `'inline'` together with `ocr.embeddedImages`),
 * each slide also lists its pictures (`![alt](image1.png)`, alt text from the
 * picture's description) followed by the OCR text as a blockquote.
 *
 * @param buffer  - PPTX file buffer
 * @param options - Converter options (`images`, `ocr`)
 * @param ctx     - Conversion context (reports, warnings, shared OCR engine); internal
 * @returns Markdown string
 */
export async function convertPptxToMarkdown(
  buffer: Buffer,
  options?: ConverterOptions,
  ctx?: ConversionContext
): Promise<string> {
  const policy = resolveEmbeddedImagePolicy(options);
  if (policy) {
    return withConversionContext(ctx, options ?? {}, (conv) =>
      convertPptxWithImages(buffer, policy, conv)
    );
  }
  try {
    const zip = new AdmZip(buffer);
    const entries = zip.getEntries();

    let md = '';

    for (const entry of entries) {
      if (entry.entryName.startsWith('ppt/slides/slide')) {
        const slideXml = entry.getData().toString('utf-8');
        const slideMd = await extractTextFromSlideXml(slideXml);

        md += `\n\n<!-- ${entry.entryName} -->\n` + slideMd + '\n';
      }
    }

    return formatMarkdown(md);
  } catch (err: any) {
    throw new Error(`Failed to convert PPTX: ${err.message}`);
  }
}

interface SlidePicture {
  alt: string;
  /** Archive path of the media file */
  mediaPath: string;
  entryIndex: number;
}

/**
 * PPTX with embedded image handling: same slide text as the default path, plus a
 * picture list (and OCR text) per slide.
 */
async function convertPptxWithImages(
  buffer: Buffer,
  policy: EmbeddedImagePolicy,
  conv: ConversionContext
): Promise<string> {
  let zip: AdmZip;
  const slides: Array<{ name: string; text: string; pictures: SlidePicture[] }> = [];
  const session = new EmbeddedImageSession(conv, policy);
  try {
    zip = new AdmZip(buffer);
    for (const entry of zip.getEntries()) {
      if (!entry.entryName.startsWith('ppt/slides/slide')) continue;
      const slideXml = entry.getData().toString('utf-8');
      const text = await extractTextFromSlideXml(slideXml);
      const pictures: SlidePicture[] = [];
      const slideNumber = /slide(\d+)\.xml$/.exec(entry.entryName)?.[1];
      if (slideNumber) {
        for (const pic of await extractPicturesFromSlideXml(zip, entry.entryName, slideXml)) {
          const media = zip.getEntry(pic.mediaPath);
          if (!media) continue;
          const registered = session.register({
            // The bytes are only needed for OCR; the type comes from the file name.
            buffer: policy.ocr ? media.getData() : Buffer.alloc(0),
            sourcePath: pic.mediaPath,
            slide: Number(slideNumber),
          });
          pictures.push({ alt: pic.alt, mediaPath: pic.mediaPath, entryIndex: registered.index });
        }
      }
      slides.push({ name: entry.entryName, text, pictures });
    }
  } catch (err: any) {
    throw new Error(`Failed to convert PPTX: ${err.message}`);
  }

  // Cancellation and `onError: 'throw'` surface unchanged.
  await session.runOcr();

  try {
    let md = '';
    for (const slide of slides) {
      md += `\n\n<!-- ${slide.name} -->\n` + slide.text + '\n';
      for (const picture of slide.pictures) {
        const entry = session.entries[picture.entryIndex];
        // Blank lines keep pictures and OCR text out of the slide's text paragraph.
        if (policy.mode !== 'omit') {
          // A backslash is escaped too: left alone before a bracket, it would cancel that bracket's escape.
          const alt = picture.alt.replace(/\s+/g, ' ').trim().replace(/[\\[\]]/g, '\\$&');
          md += `\n![${alt}](${posix.basename(picture.mediaPath)})\n`;
        }
        if (entry.block) md += `\n${entry.block}\n`;
      }
    }
    return formatMarkdown(md);
  } catch (err: any) {
    throw new Error(`Failed to convert PPTX: ${err.message}`);
  }
}

/**
 * Finds the `p:pic` elements of a slide: alt text (`descr`) and the media file
 * their `a:blip r:embed` points to (through the slide's relationships).
 */
async function extractPicturesFromSlideXml(
  zip: AdmZip,
  slideEntryName: string,
  slideXml: string
): Promise<Array<{ alt: string; mediaPath: string }>> {
  const relsEntry = zip.getEntry(
    `${posix.dirname(slideEntryName)}/_rels/${posix.basename(slideEntryName)}.rels`
  );
  if (!relsEntry) return [];
  const rels = await parseStringPromise(relsEntry.getData().toString('utf-8'));
  const targets = new Map<string, string>();
  for (const rel of rels?.Relationships?.Relationship ?? []) {
    const attrs = rel?.['$'];
    if (attrs?.Id && attrs.Target && !/^external$/i.test(attrs.TargetMode ?? '')) {
      targets.set(attrs.Id, attrs.Target);
    }
  }

  const parsed = await parseStringPromise(slideXml);
  const pictures: Array<{ alt: string; mediaPath: string }> = [];
  const visit = (node: any): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node['p:pic'])) {
      for (const pic of node['p:pic']) {
        const alt: string = pic?.['p:nvPicPr']?.[0]?.['p:cNvPr']?.[0]?.['$']?.descr ?? '';
        const embed: string | undefined =
          pic?.['p:blipFill']?.[0]?.['a:blip']?.[0]?.['$']?.['r:embed'];
        const target = embed ? targets.get(embed) : undefined;
        if (!target) continue;
        const mediaPath = target.startsWith('/')
          ? target.slice(1)
          : posix.normalize(`${posix.dirname(slideEntryName)}/${target}`);
        pictures.push({ alt, mediaPath });
      }
    }
    for (const key of Object.keys(node)) {
      if (key !== 'p:pic') visit(node[key]);
    }
  };
  visit(parsed);
  return pictures;
}

/**
 * Extracts text from PowerPoint slide XML
 * @param xml - Slide XML content
 * @returns Extracted text
 */
async function extractTextFromSlideXml(xml: string): Promise<string> {
  const result = await parseStringPromise(xml);
  const texts: string[] = [];

  function traverse(obj: any): void {
    if (!obj) return;
    if (obj['a:t']) {
      texts.push(obj['a:t'].join(' '));
    }
    for (const k in obj) {
      if (typeof obj[k] === 'object') {
        traverse(obj[k]);
      }
    }
  }

  traverse(result);

  return texts.join(' ');
}

/**
 * Converts ZIP archive buffer to Markdown
 * @param buffer - ZIP file buffer
 * @param options - Converter options
 * @returns Markdown string
 */
export async function convertZipToMarkdown(
  buffer: Buffer,
  options: ConverterOptions,
  _ctx?: ConversionContext
): Promise<string> {
  try {
    const zip = new AdmZip(buffer);
    const entries = zip.getEntries();

    const TEXT_EXTS = new Set(['.txt', '.md', '.csv', '.html', '.htm', '.xml', '.json', '.yaml', '.yml', '.js', '.ts', '.py', '.sh', '.css', '.sql']);

    let md = `# ZIP Archive Contents\n\n`;

    for (const entry of entries) {
      if (entry.isDirectory) continue;

      const fileName = entry.entryName;
      const ext = extname(fileName).toLowerCase();
      md += `## File: ${fileName}\n\n`;

      if (TEXT_EXTS.has(ext)) {
        try {
          const content = entry.getData().toString('utf-8');
          if (ext === '.md') {
            md += content + '\n\n';
          } else if (ext === '.csv') {
            md += convertCsvToMarkdown(entry.getData()) + '\n\n';
          } else if (ext === '.html' || ext === '.htm') {
            md += convertHtmlToMarkdown(entry.getData()) + '\n\n';
          } else if (ext === '.json') {
            md += '```json\n' + content.trim() + '\n```\n\n';
          } else if (ext === '.yaml' || ext === '.yml') {
            md += '```yaml\n' + content.trim() + '\n```\n\n';
          } else if (['.js', '.ts', '.py', '.sh', '.css', '.sql'].includes(ext)) {
            md += '```' + ext.slice(1) + '\n' + content.trim() + '\n```\n\n';
          } else {
            md += content + '\n\n';
          }
        } catch {
          md += `(Could not read content - ${entry.getData().length} bytes)\n\n`;
        }
      } else {
        md += `(Binary file - ${entry.getData().length} bytes)\n\n`;
      }
    }

    return md.trim();
  } catch (err: any) {
    throw new Error(`Failed to convert ZIP: ${err.message}`);
  }
}

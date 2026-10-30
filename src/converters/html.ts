import { load, type CheerioAPI } from 'cheerio';
import { existsSync, readFileSync } from 'fs';
import TurndownService from 'turndown';
import { formatMarkdown } from '../utils/markdown.js';
import type { ConverterOptions, TurndownOptions } from '../types/index.js';
import { withConversionContext, type ConversionContext } from '../utils/conversionContext.js';
import {
  EmbeddedImageSession,
  hoistTokenImagesOutOfTables,
  IMAGE_TOKEN_SCHEME,
  replaceImageTokens,
  resolveEmbeddedImagePolicy,
  type EmbeddedImagePolicy,
} from '../utils/embeddedImages.js';

/**
 * Converts HTML buffer or string to Markdown
 * @param input - HTML content as buffer, string, or file path
 * @returns Markdown string
 */
export function convertHtmlToMarkdown(input: Buffer | string): string {
  try {
    const htmlContent = readHtmlInput(input);

    let markdown = htmlToMarkdown(htmlContent);
    markdown = formatMarkdown(markdown);

    return markdown;
  } catch (err: any) {
    throw new Error(`Failed to convert HTML: ${err.message}`);
  }
}

function readHtmlInput(input: Buffer | string): string {
  if (Buffer.isBuffer(input)) {
    return input.toString('utf-8');
  }
  if (typeof input === 'string' && existsSync(input)) {
    return readFileSync(input, 'utf-8');
  }
  if (typeof input === 'string') {
    return input;
  }
  throw new Error('Invalid HTML content');
}

// Elements that legitimately have no text content and must survive the
// empty-element cleanup below (or whose removal would corrupt structure,
// e.g. dropping an empty <td> shifts every following table column).
const EMPTY_KEEP_SELECTOR =
  'img, br, hr, input, iframe, svg, video, audio, source, track, embed, ' +
  'object, canvas, picture, td, th, tr, table, thead, tbody, tfoot, colgroup, col';

/** Elements that never carry document content (shared by the Markdown and image passes). */
function stripNonContent($: CheerioAPI): void {
  // Remove non-content elements. <head> in particular: its <title> text used
  // to leak into the markdown body as a stray first line.
  $('head, script, style, noscript, template').remove();

  // Remove navigation/sidebar elements (Wikipedia, MediaWiki, generic nav).
  // Use `body > header` and `body > footer` (not bare `header`/`footer`) so that
  // legitimate <header>/<footer> elements inside <article> or <main> are preserved.
  $('nav, [role="navigation"], .mw-navigation, #mw-navigation, ' +
    '.sidebar, #sidebar, .toc, #toc, ' +
    '.mw-portlet, .vector-toc, .navbox, .noprint, ' +
    '[role="banner"], [role="contentinfo"], ' +
    'body > header, body > footer').remove();
}

/**
 * Converts HTML string to Markdown using Turndown
 * @param htmlString - HTML content string
 * @returns Markdown string
 */
export function htmlToMarkdown(htmlString: string): string {
  // NOTE: parse in standard HTML mode. The previous `xml.normalizeWhitespace`
  // parse collapsed the newlines inside <pre> blocks (destroying code
  // formatting) and mis-parsed void elements like <img>.
  const $ = load(htmlString);

  stripNonContent($);

  // Remove empty elements (layout divs/spans with no content), but keep
  // void/media/table elements and anything that contains one — removing a
  // wrapper <div> that only holds an <img> would drop the image.
  $('*').each(function () {
    const element = $(this);
    if (element.is(EMPTY_KEEP_SELECTOR)) return;
    if (element.parents('pre').length > 0) return;
    if (element.text().trim() !== '') return;
    if (element.find(EMPTY_KEEP_SELECTOR).length > 0) return;
    element.remove();
  });

  const turndownOptions: TurndownOptions = {
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '*',
    codeBlockStyle: 'fenced',
    emDelimiter: '_',
    keepHeaderLevels: true,
  };

  // Turndown's built-in rules handle headings, ordered/unordered lists
  // (numbering + nested indentation) and fenced code correctly — the custom
  // heading/listItem rules that used to live here flattened every <ol>/<ul>
  // into top-level `* ` bullets, so they were removed on purpose.
  const turndownService = new TurndownService(turndownOptions as any);

  // Custom rule for tables (turndown core has no table support).
  turndownService.addRule('tableConversion', {
    filter: 'table',
    replacement: function (content, node: any) {
      let header = '';
      let rows: string[] = [];

      const trs = node.querySelectorAll('tr');
      if (trs.length === 0) {
        return '';
      }

      // Cell text may contain newlines/indentation from the source HTML —
      // collapse it so a multi-line cell can't break the row line. Escape
      // backslashes *before* pipes so a literal `\` preceding a `|` can't
      // combine with the inserted escape and leave the pipe unescaped.
      const cellText = (cell: any) =>
        cell.textContent
          .replace(/\s+/g, ' ')
          .trim()
          .replace(/\\/g, '\\\\')
          .replace(/\|/g, '\\|');

      const firstRowCells = trs[0].querySelectorAll('th,td');
      const headers = Array.from(firstRowCells).map(cellText);
      header = '| ' + headers.join(' | ') + ' |';

      const underline = '| ' + headers.map(() => '---').join(' | ') + ' |';

      for (let i = 1; i < trs.length; i++) {
        const rowCells = trs[i].querySelectorAll('th,td');
        const rowValues = Array.from(rowCells).map(cellText);
        const rowText = '| ' + rowValues.join(' | ') + ' |';
        rows.push(rowText);
      }

      const tableMarkdown =
        '\n\n' + header + '\n' + underline + '\n' + rows.join('\n') + '\n\n';
      return tableMarkdown;
    },
  });

  // Gentle whitespace normalization only. The previous pipeline here
  // (`split('\n').map(trim).filter(Boolean).join('\n\n')`) destroyed all
  // multi-line structures: table rows and code lines ended up merged /
  // blank-line separated, producing invalid markdown.
  return turndownService
    .turndown($.html())
    .replace(/[^\S\n]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Converts HTML to Markdown honouring the embedded image options
 * (`images: 'placeholder' | 'omit'`, `ocr.embeddedImages`). Without them this is
 * exactly {@link convertHtmlToMarkdown}.
 *
 * Embedded images are `data:` URIs; remote or relative image URLs are never fetched.
 *
 * @param input   - HTML content as buffer, string, or file path
 * @param options - Converter options (internal use: `images`, `ocr`)
 * @param ctx     - Conversion context (reports, warnings, shared OCR engine); internal
 */
export async function convertHtmlToMarkdownAsync(
  input: Buffer | string,
  options?: ConverterOptions,
  ctx?: ConversionContext
): Promise<string> {
  const policy = resolveEmbeddedImagePolicy(options);
  if (!policy) return convertHtmlToMarkdown(input);
  return withConversionContext(ctx, options ?? {}, (conv) =>
    convertHtmlWithSession(input, new EmbeddedImageSession(conv, policy))
  );
}

/** Parses a `data:image/...` URI into bytes; `undefined` for anything else. */
function decodeImageDataUri(
  src: string,
  needBytes = true
): { buffer: Buffer; mimeType: string } | undefined {
  const match = /^data:([^;,]*)((?:;[^,]*)?),([\s\S]*)$/i.exec(src.trim());
  if (!match) return undefined;
  const mimeType = match[1].trim().toLowerCase();
  if (!mimeType.startsWith('image/')) return undefined;
  // Without OCR only the type matters: do not decode (and hold) the bytes.
  if (!needBytes) return { buffer: Buffer.alloc(0), mimeType };
  try {
    const buffer = /;base64/i.test(match[2])
      ? Buffer.from(match[3].replace(/\s+/g, ''), 'base64')
      : Buffer.from(decodeURIComponent(match[3]), 'utf-8');
    return buffer.length > 0 ? { buffer, mimeType } : undefined;
  } catch {
    return undefined;
  }
}

/**
 * HTML conversion with image handling driven by a shared {@link EmbeddedImageSession}
 * (EPUB chapters share one session so image numbers continue across chapters).
 */
export async function convertHtmlWithSession(
  input: Buffer | string,
  session: EmbeddedImageSession
): Promise<string> {
  const policy: EmbeddedImagePolicy = session.policy;
  const sources = new Map<number, string>();
  let prepared: string;
  try {
    const $ = load(readHtmlInput(input));
    stripNonContent($);
    $('img')
      .toArray()
      .forEach((el) => {
        const node = $(el);
        const src = node.attr('src') ?? '';
        const decoded = decodeImageDataUri(src, !!policy.ocr);
        if (decoded) {
          const entry = session.register({ buffer: decoded.buffer, mimeType: decoded.mimeType });
          sources.set(entry.index, src);
          node.attr('src', `${IMAGE_TOKEN_SCHEME}${entry.index}`);
        } else if (policy.mode === 'omit') {
          node.remove();
        }
      });
    hoistTokenImagesOutOfTables($);
    prepared = $.html();
  } catch (err: any) {
    throw new Error(`Failed to convert HTML: ${err.message}`);
  }

  // Cancellation and `onError: 'throw'` surface unchanged.
  await session.runOcr();

  try {
    const markdown = replaceImageTokens(htmlToMarkdown(prepared), (id, alt, title) => {
      const entry = session.entries[id];
      const block = entry?.block || undefined;
      if (!entry || policy.mode === 'omit') return { image: '', block };
      const target = policy.mode === 'placeholder' ? entry.placeholder : (sources.get(id) ?? '');
      return { image: `![${alt}](${target}${title})`, block };
    });
    return formatMarkdown(markdown);
  } catch (err: any) {
    throw new Error(`Failed to convert HTML: ${err.message}`);
  }
}

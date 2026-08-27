import { load } from 'cheerio';
import { existsSync, readFileSync } from 'fs';
import TurndownService from 'turndown';
import { formatMarkdown } from '../utils/markdown.js';
import type { TurndownOptions } from '../types/index.js';

/**
 * Converts HTML buffer or string to Markdown
 * @param input - HTML content as buffer, string, or file path
 * @returns Markdown string
 */
export function convertHtmlToMarkdown(input: Buffer | string): string {
  try {
    let htmlContent: string;

    if (Buffer.isBuffer(input)) {
      htmlContent = input.toString('utf-8');
    } else if (typeof input === 'string' && existsSync(input)) {
      htmlContent = readFileSync(input, 'utf-8');
    } else if (typeof input === 'string') {
      htmlContent = input;
    } else {
      throw new Error('Invalid HTML content');
    }

    let markdown = htmlToMarkdown(htmlContent);
    markdown = formatMarkdown(markdown);

    return markdown;
  } catch (err: any) {
    throw new Error(`Failed to convert HTML: ${err.message}`);
  }
}

// Elements that legitimately have no text content and must survive the
// empty-element cleanup below (or whose removal would corrupt structure,
// e.g. dropping an empty <td> shifts every following table column).
const EMPTY_KEEP_SELECTOR =
  'img, br, hr, input, iframe, svg, video, audio, source, track, embed, ' +
  'object, canvas, picture, td, th, tr, table, thead, tbody, tfoot, colgroup, col';

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

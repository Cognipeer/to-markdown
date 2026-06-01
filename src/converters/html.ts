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

/**
 * Converts HTML string to Markdown using Turndown
 * @param htmlString - HTML content string
 * @returns Markdown string
 */
export function htmlToMarkdown(htmlString: string): string {
  const $ = load(htmlString, {
    xml: {
      normalizeWhitespace: true,
    },
  } as any);

  // Remove script and style tags
  $('script, style').remove();

  // Remove navigation/sidebar elements (Wikipedia, MediaWiki, generic nav).
  // Use `body > header` and `body > footer` (not bare `header`/`footer`) so that
  // legitimate <header>/<footer> elements inside <article> or <main> are preserved.
  $('nav, [role="navigation"], .mw-navigation, #mw-navigation, ' +
    '.sidebar, #sidebar, .toc, #toc, ' +
    '.mw-portlet, .vector-toc, .navbox, .noprint, ' +
    '[role="banner"], [role="contentinfo"], ' +
    'body > header, body > footer').remove();

  // Remove empty elements
  $('*').each(function () {
    const element = $(this);
    if (element.text().trim() === '') {
      element.remove();
    }
  });

  const turndownOptions: TurndownOptions = {
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '*',
    codeBlockStyle: 'fenced',
    emDelimiter: '_',
    keepHeaderLevels: true,
  };

  const turndownService = new TurndownService(turndownOptions as any);

  // Custom rule for headings
  turndownService.addRule('heading', {
    filter: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
    replacement: function (content, node: any) {
      const level = Number(node.nodeName.charAt(1));
      return '\n' + '#'.repeat(level) + ' ' + content + '\n\n';
    },
  });

  // Custom rule for list items
  turndownService.addRule('listItem', {
    filter: 'li',
    replacement: function (content) {
      content = content.trim();
      return '* ' + content + '\n';
    },
  });

  // Custom rule for tables
  turndownService.addRule('tableConversion', {
    filter: 'table',
    replacement: function (content, node: any) {
      let header = '';
      let rows: string[] = [];

      const trs = node.querySelectorAll('tr');
      if (trs.length === 0) {
        return '';
      }

      const firstRowCells = trs[0].querySelectorAll('th,td');
      const headers = Array.from(firstRowCells).map((cell: any) =>
        cell.textContent.trim().replace(/\|/g, '\\|')
      );
      header = '| ' + headers.join(' | ') + ' |';

      const underline = '| ' + headers.map(() => '---').join(' | ') + ' |';

      for (let i = 1; i < trs.length; i++) {
        const rowCells = trs[i].querySelectorAll('th,td');
        const rowValues = Array.from(rowCells).map((cell: any) =>
          cell.textContent.trim().replace(/\|/g, '\\|')
        );
        const rowText = '| ' + rowValues.join(' | ') + ' |';
        rows.push(rowText);
      }

      const tableMarkdown =
        '\n\n' + header + '\n' + underline + '\n' + rows.join('\n') + '\n\n';
      return tableMarkdown;
    },
  });

  let markdown = turndownService.turndown($.html());
  markdown = markdown
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s+|\s+$/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line)
    .join('\n\n')
    .trim();

  return markdown;
}

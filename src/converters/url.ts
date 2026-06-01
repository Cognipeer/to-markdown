import { convertHtmlToMarkdown } from './html.js';
import type { ConverterOptions } from '../types/index.js';

/**
 * Fetches a URL and converts its HTML content to Markdown.
 * Requires Node.js 18+ (built-in fetch).
 */
export async function convertUrlToMarkdown(
  url: string,
  options: ConverterOptions = {}
): Promise<string> {
  if (typeof fetch === 'undefined') {
    throw new Error('convertUrlToMarkdown requires Node.js 18 or higher (built-in fetch)');
  }

  let targetUrl: string;
  try {
    targetUrl = new URL(url).toString();
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }

  let response: Response;
  try {
    response = await fetch(targetUrl, {
      headers: { 'User-Agent': 'to-markdown/2.0 (HTML converter)' },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err: any) {
    throw new Error(`Failed to fetch URL: ${err.message}`);
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching ${targetUrl}`);
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('html') && !contentType.includes('text')) {
    throw new Error(`Unsupported content type "${contentType}" from ${targetUrl}`);
  }

  const html = await response.text();
  return convertHtmlToMarkdown(Buffer.from(html, 'utf-8'), { ...options, url: targetUrl });
}

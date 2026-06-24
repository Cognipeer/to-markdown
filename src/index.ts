import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { isAbsolute, join } from 'path';
import { convertToMarkdown } from './convert.js';
import type { BatchInput, BatchResult } from './types/index.js';

// ── Re-exports ─────────────────────────────────────────────────────────────
export { convertToMarkdown } from './convert.js';
export { convertUrlToMarkdown } from './converters/url.js';

// New AI/RAG API
export { convertToRichMarkdown } from './rich.js';
export type { RichOptions, RichOutput } from './rich.js';

export { chunkMarkdown } from './utils/chunker.js';
export type { Chunk, ChunkMeta, ChunkOptions } from './utils/chunker.js';

export { countTokens } from './utils/tokenizer.js';
export type { TokenizerMode } from './utils/tokenizer.js';

export { extractSections, buildFrontmatter, emitFrontmatter } from './utils/metadata.js';
export type { Section, Frontmatter } from './utils/metadata.js';

export { ocrImage } from './utils/ocr.js';

/**
 * Main function to convert various file formats to Markdown
 * 
 * @param input - File path (string), base64 data (string), or Buffer
 * @param options - Optional configuration for conversion
 * @returns Promise<string> - The converted markdown content
 * 
 * @example
 * ```typescript
 * // Convert from file path
 * const result = await convertToMarkdown('/path/to/document.docx');
 * 
 * // Convert from buffer
 * const buffer = fs.readFileSync('document.pdf');
 * const result = await convertToMarkdown(buffer, { fileName: 'document.pdf' });
 * 
 * // Convert from base64
 * const base64 = 'data:application/pdf;base64,JVBERi0xLjUNCiW...';
 * const result = await convertToMarkdown(base64);
 * 
 * // With OCR (opt-in, requires: npm install tesseract.js)
 * const result = await convertToMarkdown('scan.pdf', { ocr: true });
 * ```
 */
// convertToMarkdown is re-exported above from './convert.js'

/**
 * Saves markdown content to a file
 * 
 * @param content - The markdown content to save
 * @param fileName - Name for the output file (without extension)
 * @param outputDir - Directory to save the file (defaults to "output")
 * @returns Promise<string> - Path to the saved file
 * 
 * @example
 * ```typescript
 * const markdown = await convertToMarkdown('document.pdf');
 * const filePath = await saveToMarkdownFile(markdown, 'document', './output');
 * console.log(`Saved to: ${filePath}`);
 * ```
 */
export async function saveToMarkdownFile(
  content: string,
  fileName: string,
  outputDir: string = 'output'
): Promise<string> {
  try {
    const outputPath = isAbsolute(outputDir)
      ? outputDir
      : join(process.cwd(), outputDir);

    if (!existsSync(outputPath)) {
      mkdirSync(outputPath, { recursive: true });
    }

    const mdFileName = fileName.endsWith('.md') ? fileName : `${fileName}.md`;
    const filePath = join(outputPath, mdFileName);

    writeFileSync(filePath, content, 'utf-8');
    return filePath;
  } catch (err: any) {
    throw new Error(`Failed to save markdown file: ${err.message}`);
  }
}

/**
 * Converts multiple inputs to Markdown in parallel.
 *
 * @param items  - Array of {input, options?} objects
 * @returns Array of BatchResult — one entry per input, with result or error
 *
 * @example
 * ```typescript
 * const results = await convertBatchToMarkdown([
 *   { input: 'report.pdf' },
 *   { input: Buffer.from('<h1>Hi</h1>'), options: { forceExtension: '.html' } },
 * ]);
 * ```
 */
export async function convertBatchToMarkdown(items: BatchInput[]): Promise<BatchResult[]> {
  return Promise.all(
    items.map(async ({ input, options = {} }, index) => {
      const inputId = typeof input === 'string' ? input : `buffer:${index}`;
      try {
        const result = await convertToMarkdown(input, options);
        return { inputId, result };
      } catch (err: any) {
        return { inputId, error: err.message };
      }
    })
  );
}

// Export all types
export * from './types/index.js';

// Default export for backward compatibility
export default {
  convertToMarkdown,
  convertBatchToMarkdown,
  saveToMarkdownFile,
};

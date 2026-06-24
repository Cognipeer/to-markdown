import { convertToMarkdown } from './convert.js';
import { extractSections, buildFrontmatter } from './utils/metadata.js';
import { chunkMarkdown } from './utils/chunker.js';
import type { ConverterInput, ConverterOptions } from './types/index.js';
import type { Section, Frontmatter } from './utils/metadata.js';
import type { Chunk, ChunkOptions } from './utils/chunker.js';
import type { TokenizerMode } from './utils/tokenizer.js';

// ── Public types ──────────────────────────────────────────────────────────

export interface RichOptions extends ConverterOptions {
  /**
   * Chunking options, or `false` to skip chunking entirely.
   * Default: `{}` (chunk with default settings).
   */
  chunk?: ChunkOptions | false;
  /** Extra key/value pairs merged into the generated frontmatter. */
  frontmatterSeed?: Record<string, unknown>;
  /** Tokenizer used for token counts and chunking (default: 'approx'). */
  tokenizer?: TokenizerMode;
}

export interface RichOutput {
  /** The raw Markdown string produced by the underlying converter. */
  markdown: string;
  /** Structured frontmatter (title, sections list, token count, …). */
  frontmatter: Frontmatter;
  /** Array of sections extracted from the Markdown headings. */
  sections: Section[];
  /** Token-bounded chunks with section-path metadata. */
  chunks: Chunk[];
}

// ── Main export ───────────────────────────────────────────────────────────

/**
 * Converts input to Markdown **and** returns rich AI/RAG-ready metadata:
 * structured frontmatter, section breakdown, and token-bounded chunks.
 *
 * The underlying `convertToMarkdown` call is unchanged — all existing
 * converter options continue to work.
 *
 * @example
 * ```typescript
 * const { markdown, frontmatter, sections, chunks } =
 *   await convertToRichMarkdown('report.pdf', {
 *     chunk: { maxTokens: 512, overlap: 64 },
 *   });
 * ```
 */
export async function convertToRichMarkdown(
  input: ConverterInput,
  opts: RichOptions = {}
): Promise<RichOutput> {
  const {
    chunk: chunkOpts = {},
    frontmatterSeed = {},
    tokenizer = 'approx',
    ...converterOpts
  } = opts;

  const markdown = await convertToMarkdown(input, converterOpts);
  const sections = extractSections(markdown);
  const frontmatter = await buildFrontmatter(markdown, frontmatterSeed, tokenizer);

  let chunks: Chunk[] = [];
  if (chunkOpts !== false) {
    chunks = await chunkMarkdown(markdown, { tokenizer, ...chunkOpts });
    frontmatter.chunkCount = chunks.length;
  }

  return { markdown, frontmatter, sections, chunks };
}

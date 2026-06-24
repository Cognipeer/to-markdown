import { countTokens } from './tokenizer.js';
import type { TokenizerMode } from './tokenizer.js';

// ── Public types ──────────────────────────────────────────────────────────

export interface ChunkOptions {
  /** Maximum tokens per chunk (default: 512) */
  maxTokens?: number;
  /** Token overlap between consecutive chunks (default: 0) */
  overlap?: number;
  /** Tokenizer to use (default: 'approx') */
  tokenizer?: TokenizerMode;
  /** Never split code fences across chunks (default: true) */
  preserveCodeBlocks?: boolean;
  /** Never split markdown tables across chunks (default: true) */
  preserveTables?: boolean;
}

export interface ChunkMeta {
  chunkIndex: number;
  totalChunks?: number;
  tokenCount: number;
  /** Breadcrumb of heading texts leading to this chunk */
  sectionPath: string[];
  /** Deepest heading level in effect when this chunk was created */
  headingLevel: number;
  [key: string]: unknown;
}

export interface Chunk {
  content: string;
  metadata: ChunkMeta;
}

// ── Internal ──────────────────────────────────────────────────────────────

interface Block {
  type: 'heading' | 'code' | 'table' | 'text';
  content: string;
  level?: number;
}

function parseBlocks(markdown: string): Block[] {
  const lines = markdown.split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Skip blank lines
    if (!line.trim()) {
      i++;
      continue;
    }

    // ATX heading
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      blocks.push({ type: 'heading', content: line, level: headingMatch[1].length });
      i++;
      continue;
    }

    // Fenced code block
    const fenceMatch = line.match(/^(`{3,}|~{3,})/);
    if (fenceMatch) {
      const openFence = fenceMatch[1];
      const fenceChar = openFence[0];
      const minLen = openFence.length;
      const codeLines: string[] = [line];
      i++;
      while (i < lines.length) {
        codeLines.push(lines[i]);
        const closing = lines[i].match(/^(`{3,}|~{3,})\s*$/);
        if (closing && closing[1][0] === fenceChar && closing[1].length >= minLen) {
          i++;
          break;
        }
        i++;
      }
      blocks.push({ type: 'code', content: codeLines.join('\n') });
      continue;
    }

    // Markdown table (lines starting with |)
    if (line.startsWith('|')) {
      const tableLines: string[] = [line];
      i++;
      while (i < lines.length && lines[i].startsWith('|')) {
        tableLines.push(lines[i]);
        i++;
      }
      blocks.push({ type: 'table', content: tableLines.join('\n') });
      continue;
    }

    // Text paragraph — accumulate until blank line / heading / code / table
    const textLines: string[] = [line];
    i++;
    while (i < lines.length) {
      const next = lines[i];
      if (!next.trim()) break;
      if (next.match(/^#{1,6}\s/)) break;
      if (next.match(/^(`{3,}|~{3,})/)) break;
      if (next.startsWith('|')) break;
      textLines.push(next);
      i++;
    }
    blocks.push({ type: 'text', content: textLines.join('\n') });
  }

  return blocks;
}

// ── Main export ───────────────────────────────────────────────────────────

/**
 * Splits a Markdown string into token-bounded chunks while:
 * - Tracking the current section path from headings.
 * - Never breaking code fences or tables across chunk boundaries.
 * - Optionally overlapping the end of one chunk into the start of the next.
 */
export async function chunkMarkdown(
  markdown: string,
  opts: ChunkOptions = {},
  baseMeta: Record<string, unknown> = {}
): Promise<Chunk[]> {
  const {
    maxTokens = 512,
    overlap = 0,
    tokenizer = 'approx',
    preserveCodeBlocks = true,
    preserveTables = true,
  } = opts;

  const blocks = parseBlocks(markdown);
  const chunks: Chunk[] = [];

  let currentBlocks: string[] = [];
  let currentTokens = 0;
  let sectionPath: string[] = [];
  let currentHeadingLevel = 0;
  let overlapBlocks: string[] = [];
  let overlapTokens = 0;

  const flushChunk = async (): Promise<void> => {
    if (currentBlocks.length === 0) return;
    const content = currentBlocks.join('\n\n').trim();
    if (!content) {
      currentBlocks = [];
      currentTokens = 0;
      return;
    }

    const tokenCount = await countTokens(content, tokenizer);
    chunks.push({
      content,
      metadata: {
        ...baseMeta,
        chunkIndex: chunks.length,
        tokenCount,
        sectionPath: [...sectionPath],
        headingLevel: currentHeadingLevel,
      },
    });

    // Build overlap carry-over
    overlapBlocks = [];
    overlapTokens = 0;
    if (overlap > 0) {
      for (let idx = currentBlocks.length - 1; idx >= 0; idx--) {
        const bt = await countTokens(currentBlocks[idx], tokenizer);
        if (overlapTokens + bt <= overlap) {
          overlapBlocks.unshift(currentBlocks[idx]);
          overlapTokens += bt;
        } else {
          break;
        }
      }
    }

    currentBlocks = [];
    currentTokens = 0;
  };

  for (const block of blocks) {
    if (block.type === 'heading') {
      const level = block.level!;
      const headingText = block.content.replace(/^#{1,6}\s+/, '').trim();
      const newPath = sectionPath.slice(0, level - 1);
      newPath[level - 1] = headingText;
      sectionPath = newPath.filter(Boolean);
      currentHeadingLevel = level;
      currentBlocks.push(block.content);
      currentTokens += await countTokens(block.content, tokenizer);
      continue;
    }

    const blockTokens = await countTokens(block.content, tokenizer);
    const isAtomic =
      (preserveCodeBlocks && block.type === 'code') ||
      (preserveTables && block.type === 'table');

    // Flush if adding this block would overflow (and we already have content)
    if (currentTokens + blockTokens > maxTokens && currentBlocks.length > 0) {
      await flushChunk();
      // Prepend overlap from previous chunk
      if (overlapBlocks.length > 0) {
        currentBlocks = [...overlapBlocks];
        currentTokens = overlapTokens;
        overlapBlocks = [];
        overlapTokens = 0;
      }
    }

    currentBlocks.push(block.content);
    currentTokens += blockTokens;

    // Flush immediately after a large atomic block so it forms its own chunk
    if (isAtomic && currentTokens >= maxTokens) {
      await flushChunk();
    }
  }

  await flushChunk();

  // Back-fill totalChunks
  const total = chunks.length;
  for (const c of chunks) {
    c.metadata.totalChunks = total;
  }

  return chunks;
}

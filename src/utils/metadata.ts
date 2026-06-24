import yaml from 'js-yaml';
import { countTokens } from './tokenizer.js';
import type { TokenizerMode } from './tokenizer.js';

// ── Public types ──────────────────────────────────────────────────────────

export interface Section {
  /** The heading text (without `#` prefix) */
  heading: string;
  /** ATX heading level 1–6 */
  level: number;
  /** Full text content of this section (including the heading line) */
  content: string;
  /** Breadcrumb: ancestor headings → this heading */
  path: string[];
}

export interface Frontmatter {
  title?: string;
  sections: string[];
  tokenCount: number;
  chunkCount?: number;
  generatedAt: string;
  [key: string]: unknown;
}

// ── extractSections ───────────────────────────────────────────────────────

/**
 * Parses a Markdown string into an array of sections, each defined by its
 * heading.  Content before the first heading is ignored.
 */
export function extractSections(markdown: string): Section[] {
  const lines = markdown.split('\n');
  const sections: Section[] = [];

  let currentHeading: string | null = null;
  let currentLevel = 0;
  let currentLines: string[] = [];
  let sectionPath: string[] = [];

  const flush = (): void => {
    if (currentHeading === null) return;
    sections.push({
      heading: currentHeading,
      level: currentLevel,
      content: currentLines.join('\n').trim(),
      path: [...sectionPath],
    });
    currentLines = [];
  };

  for (const line of lines) {
    const m = line.match(/^(#{1,6})\s+(.+)/);
    if (m) {
      flush();
      currentLevel = m[1].length;
      currentHeading = m[2].trim();
      const newPath = sectionPath.slice(0, currentLevel - 1);
      newPath[currentLevel - 1] = currentHeading;
      sectionPath = newPath.filter(Boolean);
      currentLines = [line];
    } else if (currentHeading !== null) {
      currentLines.push(line);
    }
  }

  flush();
  return sections;
}

// ── buildFrontmatter ──────────────────────────────────────────────────────

/**
 * Builds a frontmatter object from a Markdown string.
 * Extracts the title from the first H1 and enumerates all section headings.
 *
 * @param seed - Extra key/value pairs merged into the output (last-write wins).
 */
export async function buildFrontmatter(
  markdown: string,
  seed: Record<string, unknown> = {},
  tokenizer: TokenizerMode = 'approx'
): Promise<Frontmatter> {
  const sections = extractSections(markdown);
  const tokenCount = await countTokens(markdown, tokenizer);
  const h1 = markdown.match(/^#\s+(.+)/m);
  const title = h1 ? h1[1].trim() : undefined;

  return {
    title,
    sections: sections.map(s => s.heading),
    tokenCount,
    generatedAt: new Date().toISOString(),
    ...seed,
  };
}

// ── emitFrontmatter ───────────────────────────────────────────────────────

/**
 * Prepends YAML front matter to a Markdown string.
 *
 * ```
 * ---
 * title: "My Doc"
 * ...
 * ---
 *
 * # My Doc
 * ...
 * ```
 */
export function emitFrontmatter(fm: Frontmatter, markdown: string): string {
  const fmYaml = yaml.dump(fm, { lineWidth: -1 });
  return `---\n${fmYaml}---\n\n${markdown}`;
}

/**
 * Formats markdown text by applying consistent styling and spacing.
 *
 * Structure-aware: fenced code blocks, table rows, list items, blockquotes,
 * headings and horizontal rules pass through with their line structure
 * intact. Only consecutive plain-prose lines within the same paragraph are
 * merged (useful for hard-wrapped text extracted from PDFs/plain files);
 * blank lines are respected as paragraph boundaries.
 *
 * @param text - The markdown text to format
 * @returns Formatted markdown string
 */

/** Lines that carry markdown structure and must never be merged or rewritten. */
function isStructuralLine(line: string): boolean {
  return (
    /^#{1,6}\s/.test(line) || // heading
    /^\|/.test(line) || // table row
    /^>/.test(line) || // blockquote
    /^([*+•-]|\d+[.)])\s/.test(line) || // list item
    /^([-*_])\s*(\1\s*){2,}$/.test(line) || // horizontal rule
    /^(```|~~~)/.test(line) // fence delimiter
  );
}

export function formatMarkdown(text: string): string {
  const rawLines = text.split('\n');
  const out: string[] = [];
  let inFence = false;
  // Index in `out` of the previous prose line of the current paragraph, or -1
  // when the paragraph was broken (blank line / structural line / fence).
  let mergeTarget = -1;

  for (const rawLine of rawLines) {
    // Fenced code: verbatim passthrough, indentation preserved.
    if (/^\s*(```|~~~)/.test(rawLine)) {
      inFence = !inFence;
      out.push(rawLine.trimEnd());
      mergeTarget = -1;
      continue;
    }
    if (inFence) {
      out.push(rawLine.trimEnd());
      continue;
    }

    let line = rawLine.trim();

    // Blank line: paragraph boundary. Keep a single one.
    if (!line) {
      if (out.length > 0 && out[out.length - 1] !== '') {
        out.push('');
      }
      mergeTarget = -1;
      continue;
    }

    if (isStructuralLine(line)) {
      // Preserve leading indentation — it encodes list nesting.
      const indent = (rawLine.match(/^[^\S\n]*/) as RegExpMatchArray)[0];
      // Normalize bullet markers (•/- → *) without touching hr lines.
      if (/^[•\-]\s/.test(line)) {
        line = '* ' + line.replace(/^[•\-]\s+/, '');
      }
      out.push(indent + line);
      mergeTarget = -1;
      continue;
    }

    // Convert bold-only lines to heading (e.g. **Title** → ## Title)
    if (line.startsWith('**') && line.endsWith('**') && line.length > 4) {
      out.push('## ' + line.replace(/^\*\*|\*\*$/g, ''));
      mergeTarget = -1;
      continue;
    }

    // Plain prose: merge with the previous prose line of the same paragraph.
    if (mergeTarget >= 0) {
      out[mergeTarget] += ' ' + line;
    } else {
      out.push(line);
      mergeTarget = out.length - 1;
    }
  }

  return out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[^\S\n]+$/gm, '')
    .trim();
}

/**
 * Converts a 2D array to a markdown table
 * @param data - 2D array where first row is headers
 * @returns Markdown table string
 */
export function arrayToMarkdownTable(data: any[][]): string {
  if (!data || data.length === 0) {
    return '';
  }

  const header = data[0];
  const rows = data.slice(1);

  let md = '| ' + header.join(' | ') + ' |\n';
  md += '| ' + header.map(() => '---').join(' | ') + ' |\n';

  for (const row of rows) {
    md += '| ' + row.join(' | ') + ' |\n';
  }

  return md;
}

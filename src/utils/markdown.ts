/**
 * Formats markdown text by applying consistent styling and spacing
 * @param text - The markdown text to format
 * @returns Formatted markdown string
 */
export function formatMarkdown(text: string): string {
  const lines = text.split('\n').map((line) => line.trim());
  const formattedLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    if (!line) continue;

    // Convert bold-only lines to heading (e.g. **Title** → ## Title)
    if (line.startsWith('**') && line.endsWith('**') && line.length > 4) {
      line = '## ' + line.replace(/^\*\*|\*\*$/g, '');
    }

    // Normalize list markers
    if (/^[•\-\*]\s/.test(line)) {
      line = '* ' + line.replace(/^[•\-\*]\s+/, '');
    }

    // Merge continuous non-heading, non-list lines
    if (!line.startsWith('#') && !line.startsWith('*')) {
      if (
        formattedLines.length > 0 &&
        !formattedLines[formattedLines.length - 1].startsWith('#') &&
        !formattedLines[formattedLines.length - 1].startsWith('*')
      ) {
        formattedLines[formattedLines.length - 1] += ' ' + line;
        continue;
      }
    }

    formattedLines.push(line);
  }

  return formattedLines
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s+$/gm, '')
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

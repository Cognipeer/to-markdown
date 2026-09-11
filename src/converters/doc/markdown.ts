import type { ListMarkerResolver } from './lists.js';
import type { DocParagraph } from './word.js';

const isListLine = (line: string): boolean => (
  /^\s*(?:[*+]|\d+[.)]|\d+(?:\.\d+)+[.)]?)\s+/u.test(line)
);

const trimOuterBlankLines = (value: string): string => value
  .replace(/^\n+/u, '')
  .replace(/\n+$/u, '');

const normalizeLine = (line: string): string => {
  const normalized = line.replace(/\u00A0/gu, ' ');
  const indent = normalized.match(/^[\t ]*/u)?.[0] || '';
  const content = normalized.slice(indent.length).trim();
  if (!content) {
    return '';
  }

  const bullet = content.match(/^[•·▪◦]\s*(.+)$/u);
  if (bullet) {
    return `${indent}* ${bullet[1].trim()}`;
  }
  if (/^[-+]\s+/u.test(content)) {
    return `${indent}* ${content.replace(/^[-+]\s+/u, '')}`;
  }
  return `${indent}${content}`;
};

export const renderDocMarkdown = (text: string): string => {
  const lines = text.normalize('NFC').replace(/\r\n?/gu, '\n').split('\n');
  const output: string[] = [];
  let previousWasList = false;
  let previousWasTabular = false;

  for (const rawLine of lines) {
    const line = normalizeLine(rawLine);
    if (!line) {
      if (output.length > 0 && output[output.length - 1] !== '') {
        output.push('');
      }
      previousWasList = false;
      previousWasTabular = false;
      continue;
    }

    const isList = isListLine(line);
    const isTabular = line.includes('\t');
    if (output.length > 0 && output[output.length - 1] !== '' && !(isList && previousWasList) && !(isTabular && previousWasTabular)) {
      output.push('');
    }
    output.push(line);
    previousWasList = isList;
    previousWasTabular = isTabular;
  }

  return trimOuterBlankLines(output.join('\n').replace(/\n{3,}/gu, '\n\n'));
};

const hasExplicitMarker = (text: string): boolean => (
  /^\s*(?:[*+•·▪◦-]\s+|\d+(?:\.\d+)*[.)-]\s+)/u.test(text)
);

const commonMarkOrderedMarker = (value: string): string => {
  const numericMarker = value.match(/(\d+)[.)-]?$/u);
  return `${numericMarker?.[1] || '1'}.`;
};

const normalizeExplicitOrderedMarker = (text: string, indent: string): string => (
  text.replace(
    /^\s*\d+(?:\.\d+)*[.)-]\s+/u,
    `${indent}${commonMarkOrderedMarker(text.match(/^\s*([^\s]+)/u)?.[1] || '')} `,
  )
);

const renderParagraph = (paragraph: DocParagraph, listMarkerResolver: ListMarkerResolver): {
  markdown: string;
  isList: boolean;
  isTableRow: boolean;
} => {
  const markdown = renderDocMarkdown(paragraph.text);
  const marker = listMarkerResolver.markerFor(paragraph.listId, paragraph.listLevel);
  if (!marker) {
    return {
      markdown,
      isList: isListLine(markdown),
      isTableRow: paragraph.tableRowEnd || markdown.includes('\t'),
    };
  }
  if (hasExplicitMarker(markdown)) {
    const indent = '    '.repeat(marker.level);
    return {
      markdown: marker.ordered ? normalizeExplicitOrderedMarker(markdown, indent) : markdown,
      isList: true,
      isTableRow: paragraph.tableRowEnd || markdown.includes('\t'),
    };
  }

  const indent = '    '.repeat(marker.level);
  const prefix = marker.ordered
    ? `${commonMarkOrderedMarker(marker.value)} `
    : marker.value === '*'
      ? '* '
      : `* ${marker.value} `;
  return {
    markdown: `${indent}${prefix}${markdown}`.trimEnd(),
    isList: true,
    isTableRow: paragraph.tableRowEnd || markdown.includes('\t'),
  };
};

export const renderDocParagraphs = (
  paragraphs: DocParagraph[],
  listMarkerResolver: ListMarkerResolver,
): string => {
  const output: string[] = [];
  let previousWasList = false;
  let previousWasTableRow = false;

  for (const paragraph of paragraphs) {
    const rendered = renderParagraph(paragraph, listMarkerResolver);
    if (!rendered.markdown) {
      continue;
    }
    if (output.length > 0 && !(rendered.isList && previousWasList) && !(rendered.isTableRow && previousWasTableRow)) {
      output.push('');
    }
    output.push(rendered.markdown);
    previousWasList = rendered.isList;
    previousWasTableRow = rendered.isTableRow;
  }

  return trimOuterBlankLines(output.join('\n').replace(/\n{3,}/gu, '\n\n'));
};
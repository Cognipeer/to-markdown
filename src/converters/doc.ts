import type { DocOptions } from '../types/index.js';
import { openCompoundFile } from './doc/cfb.js';
import { DocConversionError } from './doc/errors.js';
import { resolveDocLimits } from './doc/limits.js';
import { renderDocMarkdown, renderDocParagraphs } from './doc/markdown.js';
import { readDocContent } from './doc/word.js';

const appendSection = (sections: string[], heading: string, text: string): void => {
  const markdown = renderDocMarkdown(text);
  if (markdown) {
    sections.push(`## ${heading}\n\n${markdown}`);
  }
};

export async function convertDocToMarkdown(
  buffer: Buffer,
  options: DocOptions = {},
): Promise<string> {
  const limits = resolveDocLimits(options);
  const compoundFile = openCompoundFile(buffer, limits);
  const includeHeaders = options.includeHeaders ?? true;
  const includeFootnotes = options.includeFootnotes ?? true;
  const content = readDocContent(compoundFile, limits, { includeHeaders, includeFootnotes });
  const body = renderDocParagraphs(content.body, content.listMarkerResolver);

  const sections = body ? [body] : [];
  if (includeHeaders) {
    appendSection(sections, 'Document headers', content.headers);
  }
  if (includeFootnotes) {
    appendSection(sections, 'Footnotes', content.footnotes);
  }
  if (sections.length === 0) {
    throw new DocConversionError('DOC_INVALID', 'Legacy DOC contains no extractable content');
  }
  const markdown = sections.join('\n\n');

  if (markdown.length > limits.maxOutputChars) {
    throw new DocConversionError('DOC_LIMIT_EXCEEDED', `Legacy DOC output exceeds ${limits.maxOutputChars} characters`);
  }
  return markdown;
}
import { describe, expect, it } from 'vitest';
import { DocConversionError } from '../converters/doc/errors.ts';
import { renderDocMarkdown, renderDocParagraphs } from '../converters/doc/markdown.ts';
import { convertToMarkdown } from '../convert.ts';

describe('legacy DOC markdown rendering', () => {
  it('preserves paragraphs and normalizes bullet markers', () => {
    const markdown = renderDocMarkdown('Başlık\r\n• Birinci\r\n• İkinci\r\nSon paragraf');

    expect(markdown).toBe('Başlık\n\n* Birinci\n* İkinci\n\nSon paragraf');
  });

  it('preserves numbered markers, indentation, and tabular rows', () => {
    const markdown = renderDocMarkdown('1. Madde\n  1.1 Alt madde\nAd\tTutar\nA\t10');

    expect(markdown).toContain('1. Madde\n  1.1 Alt madde');
    expect(markdown).toContain('Ad\tTutar\nA\t10');
  });

  it('routes DOC buffers through the DOC converter instead of text fallback', async () => {
    await expect(convertToMarkdown(Buffer.from([0xD0, 0xCF, 0x11, 0xE0]), {
      fileName: 'invalid.doc',
    })).rejects.toMatchObject<Partial<DocConversionError>>({
      name: 'DocConversionError',
      code: 'DOC_INVALID',
    });
  });

  it('renders metadata-backed list markers without duplicating explicit markers', () => {
    const markers = ['1.', '*'];
    const markdown = renderDocParagraphs([
      { text: 'Birinci', listId: 1, listLevel: 0, inTable: false, tableRowEnd: false },
      { text: '• İkinci', listId: 1, listLevel: 0, inTable: false, tableRowEnd: false },
    ], {
      markerFor: () => ({ value: markers.shift() || '*', level: 0, ordered: true }),
    });

    expect(markdown).toBe('1. Birinci\n* İkinci');
  });

  it('normalizes Word-specific ordered markers to CommonMark', () => {
    const markdown = renderDocParagraphs([
      { text: 'Bölüm', listId: 1, listLevel: 0, inTable: false, tableRowEnd: false },
    ], {
      markerFor: () => ({ value: '1-', level: 0, ordered: true }),
    });

    expect(markdown).toBe('1. Bölüm');
  });

  it('uses nested CommonMark indentation for hierarchical ordered markers', () => {
    const markdown = renderDocParagraphs([
      { text: '1.1- Alt bölüm', listId: 1, listLevel: 1, inTable: false, tableRowEnd: false },
    ], {
      markerFor: () => ({ value: '1.1-', level: 1, ordered: true }),
    });

    expect(markdown).toBe('    1. Alt bölüm');
  });

  it('keeps metadata-free hyphenated section text unchanged', () => {
    const markdown = renderDocParagraphs([
      { text: '1.1- Bölüm başlığı', listId: null, listLevel: 0, inTable: false, tableRowEnd: false },
    ], {
      markerFor: () => null,
    });

    expect(markdown).toBe('1.1- Bölüm başlığı');
  });

  it('does not mistake a legal-reference number for an explicit list marker', () => {
    const markdown = renderDocParagraphs([
      { text: '4857 Sayılı İş Kanunu', listId: 1, listLevel: 0, inTable: false, tableRowEnd: false },
    ], {
      markerFor: () => ({ value: '*', level: 0, ordered: false }),
    });

    expect(markdown).toBe('* 4857 Sayılı İş Kanunu');
  });
});
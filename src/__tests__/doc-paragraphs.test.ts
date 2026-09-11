import { describe, expect, it } from 'vitest';
import { DocConversionError } from '../converters/doc/errors.ts';
import { resolveDocLimits } from '../converters/doc/limits.ts';
import {
  findParagraphProperties,
  parseParagraphProperties,
} from '../converters/doc/paragraphs.ts';

const createParagraphFixture = (): { wordDocument: Buffer; table: Buffer } => {
  const wordDocument = Buffer.alloc(512);
  wordDocument.writeUInt32LE(100, 0);
  wordDocument.writeUInt32LE(200, 4);
  wordDocument[511] = 1;
  wordDocument[8] = 8;
  wordDocument[16] = 8;
  wordDocument.writeUInt16LE(7, 17);
  wordDocument.writeUInt16LE(0x460B, 19);
  wordDocument.writeUInt16LE(2, 21);
  wordDocument.writeUInt16LE(0x260A, 23);
  wordDocument[25] = 1;
  wordDocument.writeUInt16LE(0x2417, 26);
  wordDocument[28] = 1;

  const table = Buffer.alloc(12);
  table.writeUInt32LE(0, 0);
  table.writeUInt32LE(200, 4);
  table.writeUInt32LE(0, 8);
  return { wordDocument, table };
};

describe('legacy DOC paragraph properties', () => {
  it('reads direct list and table-row properties from an FKP run', () => {
    const { wordDocument, table } = createParagraphFixture();
    const runs = parseParagraphProperties(wordDocument, table, { offset: 0, length: 12 }, resolveDocLimits());

    expect(runs).toEqual([{
      start: 100,
      end: 200,
      styleId: 7,
      listId: 2,
      listLevel: 1,
      inTable: false,
      tableRowEnd: true,
    }]);
    expect(findParagraphProperties(runs, 150)?.listId).toBe(2);
  });

  it('rejects an FKP run table that exceeds a page', () => {
    const { wordDocument, table } = createParagraphFixture();
    wordDocument[511] = 255;

    expect(() => parseParagraphProperties(wordDocument, table, { offset: 0, length: 12 }, resolveDocLimits())).toThrow(DocConversionError);
  });

  it('rejects a paragraph property record that crosses into the next FKP page', () => {
    const { wordDocument, table } = createParagraphFixture();
    const expandedWordDocument = Buffer.alloc(1024);
    wordDocument.copy(expandedWordDocument);
    expandedWordDocument[8] = 250;
    expandedWordDocument[500] = 8;
    expandedWordDocument.writeUInt16LE(7, 501);

    expect(() => parseParagraphProperties(expandedWordDocument, table, { offset: 0, length: 12 }, resolveDocLimits())).toThrow(DocConversionError);
  });
});
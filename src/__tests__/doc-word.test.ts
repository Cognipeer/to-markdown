import { describe, expect, it } from 'vitest';
import { DocConversionError } from '../converters/doc/errors.ts';
import { resolveDocLimits } from '../converters/doc/limits.ts';
import {
  extractStoryParagraphs,
  extractStoryText,
  parsePieceTable,
  readDocStories,
  type DocPiece,
} from '../converters/doc/word.ts';

const makePieceTable = (encodedOffset = 0x40000000): Buffer => {
  const table = Buffer.alloc(21);
  table[0] = 0x02;
  table.writeUInt32LE(16, 1);
  table.writeUInt32LE(0, 5);
  table.writeUInt32LE(5, 9);
  table.writeUInt32LE(encodedOffset, 15);
  return table;
};

describe('legacy DOC Word reader', () => {
  it('reads a compressed piece table with validated offsets', () => {
    const pieces = parsePieceTable(makePieceTable(), 0, 21, resolveDocLimits());

    expect(pieces).toEqual([{ start: 0, end: 5, offset: 0, compressed: true }]);
  });

  it('extracts a compressed piece with a non-zero encoded offset', () => {
    const pieces = parsePieceTable(makePieceTable(0x40000008), 0, 21, resolveDocLimits());
    const wordDocument = Buffer.from('skiphello', 'ascii');

    expect(extractStoryText(wordDocument, pieces, 0, 5, { used: 0, maximum: 100 })).toBe('hello');
  });

  it('rejects a CLX property record that extends beyond its declared range', () => {
    const table = Buffer.from([0x01, 0xFF, 0xFF]);

    expect(() => parsePieceTable(table, 0, table.length, resolveDocLimits())).toThrow(DocConversionError);
  });

  it('converts text controls without retaining field instructions', () => {
    const wordDocument = Buffer.from([
      0x41, 0x0D, 0x42, 0x13, 0x49, 0x4E, 0x53, 0x54, 0x14, 0x52, 0x45, 0x53, 0x15,
    ]);
    const pieces: DocPiece[] = [{
      start: 0,
      end: wordDocument.length,
      offset: 0,
      compressed: true,
    }];
    const budget = { used: 0, maximum: 100 };

    expect(extractStoryText(wordDocument, pieces, 0, wordDocument.length, budget)).toBe('A\nBRES');
  });

  it('preserves tabs in visible field results while omitting instructions', () => {
    const wordDocument = Buffer.from([
      0x45, 0x6E, 0x74, 0x72, 0x79,
      0x13, 0x50, 0x41, 0x47, 0x45, 0x52, 0x45, 0x46,
      0x14, 0x09, 0x33, 0x15, 0x0D,
    ]);
    const pieces: DocPiece[] = [{
      start: 0,
      end: wordDocument.length,
      offset: 0,
      compressed: true,
    }];

    expect(extractStoryText(wordDocument, pieces, 0, wordDocument.length, { used: 0, maximum: 100 }))
      .toBe('Entry\t3\n');
    expect(extractStoryParagraphs(wordDocument, pieces, 0, wordDocument.length, [], { used: 0, maximum: 100 }))
      .toEqual([{ text: 'Entry\t3', listId: null, listLevel: 0, inTable: false, tableRowEnd: false }]);
  });

  it('classifies Word 6/95 identifiers as unsupported', () => {
    const wordDocument = Buffer.alloc(0x20);
    wordDocument.writeUInt16LE(0xA5DC, 0);
    const compoundFile = {
      getStream: (name: string): Buffer | null => (name === 'WordDocument' ? wordDocument : null),
    };

    try {
      readDocStories(compoundFile, resolveDocLimits());
    } catch (error) {
      expect(error).toMatchObject({ code: 'DOC_UNSUPPORTED' });
      return;
    }
    throw new Error('Expected Word 6/95 input to be rejected as unsupported');
  });

  it('decodes Unicode pieces and enforces the configured output cap', () => {
    const wordDocument = Buffer.from('İş', 'utf16le');
    const pieces: DocPiece[] = [{ start: 0, end: 2, offset: 0, compressed: false }];

    expect(extractStoryText(wordDocument, pieces, 0, 2, { used: 0, maximum: 10 })).toBe('İş');
    expect(() => extractStoryText(wordDocument, pieces, 0, 2, { used: 0, maximum: 1 })).toThrow(DocConversionError);
  });

  it('maps paragraph list and table metadata to structured output', () => {
    const wordDocument = Buffer.from([
      0x41, 0x0D,
      0x42, 0x13, 0x49, 0x4E, 0x53, 0x54, 0x14, 0x52, 0x45, 0x53, 0x15, 0x07,
    ]);
    const pieces: DocPiece[] = [{
      start: 0,
      end: wordDocument.length,
      offset: 0,
      compressed: true,
    }];
    const paragraphs = extractStoryParagraphs(wordDocument, pieces, 0, wordDocument.length, [
      { start: 0, end: 2, styleId: 0, listId: 5, listLevel: 1, inTable: false, tableRowEnd: false },
      { start: 2, end: wordDocument.length, styleId: 0, listId: null, listLevel: 0, inTable: true, tableRowEnd: true },
    ], { used: 0, maximum: 100 });

    expect(paragraphs).toEqual([
      { text: 'A', listId: 5, listLevel: 1, inTable: false, tableRowEnd: false },
      { text: 'BRES', listId: null, listLevel: 0, inTable: true, tableRowEnd: true },
    ]);
  });

  it('keeps compressed Word bullet bytes in structured paragraphs', () => {
    const wordDocument = Buffer.from([0x95, 0x20, 0x4D, 0x61, 0x64, 0x64, 0x65, 0x0D]);
    const pieces: DocPiece[] = [{
      start: 0,
      end: wordDocument.length,
      offset: 0,
      compressed: true,
    }];

    expect(extractStoryParagraphs(wordDocument, pieces, 0, wordDocument.length, [], { used: 0, maximum: 100 })).toEqual([
      { text: '• Madde', listId: null, listLevel: 0, inTable: false, tableRowEnd: false },
    ]);
  });
});
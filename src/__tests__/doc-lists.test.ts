import { describe, expect, it } from 'vitest';
import { DocConversionError } from '../converters/doc/errors.ts';
import { resolveDocLimits } from '../converters/doc/limits.ts';
import { createListMarkerResolver } from '../converters/doc/lists.ts';

const appendListLevel = (
  buffer: Buffer,
  offset: number,
  startAt: number,
  numberFormat: number,
  template: number[],
): number => {
  buffer.writeInt32LE(startAt, offset);
  buffer[offset + 4] = numberFormat;
  buffer[offset + 24] = 0;
  buffer[offset + 25] = 0;
  buffer.writeUInt16LE(template.length, offset + 28);
  template.forEach((character, index) => buffer.writeUInt16LE(character, offset + 30 + (index * 2)));
  return offset + 30 + (template.length * 2);
};

const createListFixture = (): {
  table: Buffer;
  listReference: { offset: number; length: number };
  overrideReference: { offset: number; length: number };
} => {
  const table = Buffer.alloc(160);
  table.writeUInt16LE(2, 0);
  table.writeUInt32LE(100, 2);
  table[2 + 26] = 1;
  table.writeUInt32LE(200, 30);
  table[30 + 26] = 1;
  let offset = 58;
  offset = appendListLevel(table, offset, 1, 0, [0, 46]);
  offset = appendListLevel(table, offset, 1, 23, [0x2022]);
  const overrideOffset = offset;
  table.writeUInt32LE(2, overrideOffset);
  table.writeUInt32LE(100, overrideOffset + 4);
  table.writeUInt32LE(200, overrideOffset + 20);
  return {
    table,
    listReference: { offset: 0, length: 58 },
    overrideReference: { offset: overrideOffset, length: 36 },
  };
};

describe('legacy DOC list markers', () => {
  it('resolves ordered and bullet list markers through list overrides', () => {
    const { table, listReference, overrideReference } = createListFixture();
    const resolver = createListMarkerResolver(table, listReference, overrideReference, resolveDocLimits());

    expect(resolver.markerFor(1, 0)).toEqual({ value: '1.', level: 0, ordered: true });
    expect(resolver.markerFor(1, 0)).toEqual({ value: '2.', level: 0, ordered: true });
    expect(resolver.markerFor(2, 0)).toEqual({ value: '*', level: 0, ordered: false });
  });

  it('uses a bounded fallback marker when a paragraph references an unknown list', () => {
    const { table, listReference, overrideReference } = createListFixture();
    const resolver = createListMarkerResolver(table, listReference, overrideReference, resolveDocLimits());

    expect(resolver.markerFor(999, 0)).toEqual({ value: '*', level: 0, ordered: false });
  });

  it('keeps a hyphenated number template ordered', () => {
    const { table, listReference, overrideReference } = createListFixture();
    table.writeUInt16LE(2, 58 + 28);
    table.writeUInt16LE(0, 58 + 30);
    table.writeUInt16LE(45, 58 + 32);
    const resolver = createListMarkerResolver(table, listReference, overrideReference, resolveDocLimits());

    expect(resolver.markerFor(1, 0)).toEqual({ value: '1-', level: 0, ordered: true });
  });

  it('rejects a list marker template over the parser safety cap', () => {
    const { table, listReference, overrideReference } = createListFixture();
    table.writeUInt16LE(129, 58 + 28);

    expect(() => createListMarkerResolver(table, listReference, overrideReference, resolveDocLimits())).toThrow(DocConversionError);
  });
});
import { describe, expect, it } from 'vitest';
import { DocConversionError as PublicDocConversionError } from '../index.ts';
import { convertToMarkdown } from '../convert.ts';
import { DocConversionError } from '../converters/doc/errors.ts';

const HEADER_SIZE = 512;
const SECTOR_SIZE = 512;
const STREAM_SECTOR_COUNT = 8;
const FREE_SECTOR = 0xFFFFFFFF;
const END_OF_CHAIN = 0xFFFFFFFE;
const FAT_SECTOR = 0xFFFFFFFD;
const WORD_DOCUMENT_SECTOR = 2;
const TABLE_SECTOR = WORD_DOCUMENT_SECTOR + STREAM_SECTOR_COUNT;
const TEXT_OFFSET = 1024;

const writeDirectoryEntry = (
  buffer: Buffer,
  offset: number,
  name: string,
  type: number,
  startSector: number,
  size: number,
  child = FREE_SECTOR,
  rightSibling = FREE_SECTOR,
): void => {
  const encodedName = Buffer.from(`${name}\0`, 'utf16le');
  encodedName.copy(buffer, offset);
  buffer.writeUInt16LE(encodedName.length, offset + 64);
  buffer[offset + 66] = type;
  buffer[offset + 67] = 1;
  buffer.writeUInt32LE(FREE_SECTOR, offset + 68);
  buffer.writeUInt32LE(rightSibling, offset + 72);
  buffer.writeUInt32LE(child, offset + 76);
  buffer.writeUInt32LE(startSector, offset + 116);
  buffer.writeUInt32LE(size, offset + 120);
};

const linkStreamSectors = (
  buffer: Buffer,
  fatOffset: number,
  firstSector: number,
): void => {
  for (let index = 0; index < STREAM_SECTOR_COUNT; index += 1) {
    const sector = firstSector + index;
    const next = index === STREAM_SECTOR_COUNT - 1 ? END_OF_CHAIN : sector + 1;
    buffer.writeUInt32LE(next, fatOffset + (sector * 4));
  }
};

const createBinaryDocFixture = ({
  body = Buffer.from([
    0x54, 0x69, 0x74, 0x6C, 0x65, 0x0D,
    0x95, 0x20, 0x46, 0x69, 0x72, 0x73, 0x74, 0x0D,
    0x95, 0x20, 0x53, 0x65, 0x63, 0x6F, 0x6E, 0x64, 0x0D,
  ]),
  footnotes = Buffer.from('Footnote text\r', 'latin1'),
  headers = Buffer.from('Revision 1\r', 'latin1'),
}: {
  body?: Buffer;
  footnotes?: Buffer;
  headers?: Buffer;
} = {}): Buffer => {
  const documentText = Buffer.concat([body, footnotes, headers]);
  const sectorCount = TABLE_SECTOR + STREAM_SECTOR_COUNT;
  const buffer = Buffer.alloc(HEADER_SIZE + (sectorCount * SECTOR_SIZE));

  Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]).copy(buffer, 0);
  buffer.writeUInt16LE(0x003E, 24);
  buffer.writeUInt16LE(3, 26);
  buffer.writeUInt16LE(0xFFFE, 28);
  buffer.writeUInt16LE(9, 30);
  buffer.writeUInt16LE(6, 32);
  buffer.writeUInt32LE(1, 44);
  buffer.writeUInt32LE(1, 48);
  buffer.writeUInt32LE(4096, 56);
  buffer.writeUInt32LE(END_OF_CHAIN, 60);
  buffer.writeUInt32LE(END_OF_CHAIN, 68);
  for (let index = 0; index < 109; index += 1) {
    buffer.writeUInt32LE(FREE_SECTOR, 76 + (index * 4));
  }
  buffer.writeUInt32LE(0, 76);

  const fatOffset = HEADER_SIZE;
  for (let index = 0; index < 128; index += 1) {
    buffer.writeUInt32LE(FREE_SECTOR, fatOffset + (index * 4));
  }
  buffer.writeUInt32LE(FAT_SECTOR, fatOffset);
  buffer.writeUInt32LE(END_OF_CHAIN, fatOffset + 4);
  linkStreamSectors(buffer, fatOffset, WORD_DOCUMENT_SECTOR);
  linkStreamSectors(buffer, fatOffset, TABLE_SECTOR);

  const directoryOffset = HEADER_SIZE + SECTOR_SIZE;
  writeDirectoryEntry(buffer, directoryOffset, 'Root Entry', 5, END_OF_CHAIN, 0, 1);
  writeDirectoryEntry(buffer, directoryOffset + 128, 'WordDocument', 2, WORD_DOCUMENT_SECTOR, 4096, FREE_SECTOR, 2);
  writeDirectoryEntry(buffer, directoryOffset + 256, '1Table', 2, TABLE_SECTOR, 4096);

  const wordOffset = HEADER_SIZE + (WORD_DOCUMENT_SECTOR * SECTOR_SIZE);
  const wordDocument = buffer.subarray(wordOffset, wordOffset + 4096);
  wordDocument.writeUInt16LE(0xA5EC, 0);
  wordDocument.writeUInt16LE(0x00C1, 2);
  wordDocument.writeUInt16LE(0x0200, 10);
  wordDocument.writeUInt16LE(0, 0x20);
  wordDocument.writeUInt16LE(11, 0x22);
  const longValueOffset = 0x24;
  wordDocument.writeUInt32LE(body.length, longValueOffset + (3 * 4));
  wordDocument.writeUInt32LE(footnotes.length, longValueOffset + (4 * 4));
  wordDocument.writeUInt32LE(headers.length, longValueOffset + (5 * 4));
  const pairCountOffset = longValueOffset + (11 * 4);
  wordDocument.writeUInt16LE(34, pairCountOffset);
  const pairOffset = pairCountOffset + 2;
  wordDocument.writeUInt32LE(0, pairOffset + (33 * 8));
  wordDocument.writeUInt32LE(21, pairOffset + (33 * 8) + 4);
  documentText.copy(wordDocument, TEXT_OFFSET);

  const tableOffset = HEADER_SIZE + (TABLE_SECTOR * SECTOR_SIZE);
  const table = buffer.subarray(tableOffset, tableOffset + 4096);
  table[0] = 0x02;
  table.writeUInt32LE(16, 1);
  table.writeUInt32LE(0, 5);
  table.writeUInt32LE(documentText.length, 9);
  table.writeUInt32LE(0x40000000 | (TEXT_OFFSET * 2), 15);

  return buffer;
};

describe('legacy DOC converter', () => {
  it('converts a binary DOC fixture with headers by default through the public API', async () => {
    const markdown = await convertToMarkdown(createBinaryDocFixture(), {
      fileName: 'policy.doc',
    });

    expect(markdown).toBe('Title\n\n* First\n* Second\n\n## Document headers\n\nRevision 1\n\n## Footnotes\n\nFootnote text');
  });

  it('allows callers to explicitly omit document headers', async () => {
    const markdown = await convertToMarkdown(createBinaryDocFixture(), {
      fileName: 'policy.doc',
      doc: { includeHeaders: false, includeFootnotes: false },
    });

    expect(markdown).toBe('Title\n\n* First\n* Second');
  });

  it('returns headers when the body story is empty', async () => {
    const markdown = await convertToMarkdown(createBinaryDocFixture({
      body: Buffer.alloc(0),
      footnotes: Buffer.alloc(0),
    }), {
      fileName: 'header-only.doc',
    });

    expect(markdown).toBe('## Document headers\n\nRevision 1');
  });

  it('returns footnotes when the body and header stories are empty', async () => {
    const markdown = await convertToMarkdown(createBinaryDocFixture({
      body: Buffer.alloc(0),
      headers: Buffer.alloc(0),
    }), {
      fileName: 'footnote-only.doc',
    });

    expect(markdown).toBe('## Footnotes\n\nFootnote text');
  });

  it('exports DOC conversion errors from the public entrypoint', () => {
    expect(PublicDocConversionError).toBe(DocConversionError);
  });

  it('includes optional document stories under explicit Markdown sections', async () => {
    const markdown = await convertToMarkdown(createBinaryDocFixture(), {
      fileName: 'policy.doc',
      doc: { includeHeaders: true, includeFootnotes: true },
    });

    expect(markdown).toContain('## Document headers\n\nRevision 1');
    expect(markdown).toContain('## Footnotes\n\nFootnote text');
  });

  it('produces the same Markdown from a Buffer and raw base64 input', async () => {
    const input = createBinaryDocFixture();
    const options = { fileName: 'policy.doc' };

    await expect(convertToMarkdown(input.toString('base64'), options)).resolves.toBe(
      await convertToMarkdown(input, options),
    );
  });

  it('enforces caller-provided DOC input and output limits', async () => {
    await expect(convertToMarkdown(createBinaryDocFixture(), {
      fileName: 'policy.doc',
      doc: { maxInputBytes: 1024 },
    })).rejects.toMatchObject<Partial<DocConversionError>>({
      code: 'DOC_LIMIT_EXCEEDED',
    });

    await expect(convertToMarkdown(createBinaryDocFixture(), {
      fileName: 'policy.doc',
      doc: { maxOutputChars: 5 },
    })).rejects.toMatchObject<Partial<DocConversionError>>({
      code: 'DOC_LIMIT_EXCEEDED',
    });
  });

  it('rejects encrypted DOC inputs before text extraction', async () => {
    const input = createBinaryDocFixture();
    const wordDocumentOffset = HEADER_SIZE + (WORD_DOCUMENT_SECTOR * SECTOR_SIZE);
    input.writeUInt16LE(0x0300, wordDocumentOffset + 10);

    await expect(convertToMarkdown(input, { fileName: 'encrypted.doc' })).rejects.toMatchObject<Partial<DocConversionError>>({
      code: 'DOC_ENCRYPTED',
    });
  });
});
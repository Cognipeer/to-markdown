import { describe, expect, it } from 'vitest';
import { openCompoundFile } from '../converters/doc/cfb.ts';
import { DocConversionError } from '../converters/doc/errors.ts';
import { resolveDocLimits } from '../converters/doc/limits.ts';

const HEADER_SIZE = 512;
const SECTOR_SIZE = 512;
const FREE_SECTOR = 0xFFFFFFFF;
const END_OF_CHAIN = 0xFFFFFFFE;
const FAT_SECTOR = 0xFFFFFFFD;

const writeDirectoryEntry = (
  buffer: Buffer,
  offset: number,
  name: string,
  type: number,
  startSector: number,
  size: number,
): void => {
  const encodedName = Buffer.from(`${name}\0`, 'utf16le');
  encodedName.copy(buffer, offset);
  buffer.writeUInt16LE(encodedName.length, offset + 64);
  buffer[offset + 66] = type;
  buffer[offset + 67] = 1;
  buffer.writeUInt32LE(FREE_SECTOR, offset + 68);
  buffer.writeUInt32LE(FREE_SECTOR, offset + 72);
  buffer.writeUInt32LE(FREE_SECTOR, offset + 76);
  buffer.writeUInt32LE(startSector, offset + 116);
  buffer.writeUInt32LE(size, offset + 120);
};

const createCompoundFixture = (cyclicStream = false, overlongStream = false): Buffer => {
  const streamSectorCount = 8;
  const streamSize = streamSectorCount * SECTOR_SIZE;
  const buffer = Buffer.alloc(HEADER_SIZE + (SECTOR_SIZE * (2 + streamSectorCount)));
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
  for (let index = 0; index < streamSectorCount; index += 1) {
    const sectorId = 2 + index;
    const nextSector = cyclicStream && index === 0
      ? sectorId
      : index === streamSectorCount - 1
        ? overlongStream ? 2 : END_OF_CHAIN
        : sectorId + 1;
    buffer.writeUInt32LE(nextSector, fatOffset + (sectorId * 4));
  }

  const directoryOffset = HEADER_SIZE + SECTOR_SIZE;
  writeDirectoryEntry(buffer, directoryOffset, 'Root Entry', 5, END_OF_CHAIN, 0);
  buffer.writeUInt32LE(1, directoryOffset + 76);
  writeDirectoryEntry(buffer, directoryOffset + 128, 'WordDocument', 2, 2, streamSize);
  buffer.write('hello', HEADER_SIZE + (SECTOR_SIZE * 2), 'ascii');
  return buffer;
};

const createMiniStreamFixture = (overlongStream = false): Buffer => {
  const buffer = Buffer.alloc(HEADER_SIZE + (SECTOR_SIZE * 4));
  Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]).copy(buffer, 0);
  buffer.writeUInt16LE(0x003E, 24);
  buffer.writeUInt16LE(3, 26);
  buffer.writeUInt16LE(0xFFFE, 28);
  buffer.writeUInt16LE(9, 30);
  buffer.writeUInt16LE(6, 32);
  buffer.writeUInt32LE(1, 44);
  buffer.writeUInt32LE(1, 48);
  buffer.writeUInt32LE(4096, 56);
  buffer.writeUInt32LE(3, 60);
  buffer.writeUInt32LE(1, 64);
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
  buffer.writeUInt32LE(END_OF_CHAIN, fatOffset + 8);
  buffer.writeUInt32LE(END_OF_CHAIN, fatOffset + 12);

  const directoryOffset = HEADER_SIZE + SECTOR_SIZE;
  writeDirectoryEntry(buffer, directoryOffset, 'Root Entry', 5, 2, 64);
  buffer.writeUInt32LE(1, directoryOffset + 76);
  writeDirectoryEntry(buffer, directoryOffset + 128, 'WordDocument', 2, 0, 5);
  buffer.write('hello', HEADER_SIZE + (SECTOR_SIZE * 2), 'ascii');

  const miniFatOffset = HEADER_SIZE + (SECTOR_SIZE * 3);
  buffer.writeUInt32LE(overlongStream ? 1 : END_OF_CHAIN, miniFatOffset);
  buffer.writeUInt32LE(END_OF_CHAIN, miniFatOffset + 4);
  return buffer;
};

describe('Compound File reader', () => {
  it('reads a bounded regular stream from a valid Compound File fixture', () => {
    const compoundFile = openCompoundFile(createCompoundFixture(), resolveDocLimits());

    expect(compoundFile.getStream('worddocument')?.subarray(0, 5).toString('ascii')).toBe('hello');
  });

  it('rejects a non-Compound File input', () => {
    expect(() => openCompoundFile(Buffer.from('not a DOC'), resolveDocLimits())).toThrow(DocConversionError);
  });

  it('rejects a cyclic stream chain before it can loop indefinitely', () => {
    const compoundFile = openCompoundFile(createCompoundFixture(true), resolveDocLimits());

    expect(() => compoundFile.getStream('WordDocument')).toThrow(DocConversionError);
  });

  it('rejects a stream chain that continues after its declared size', () => {
    const compoundFile = openCompoundFile(createCompoundFixture(false, true), resolveDocLimits());

    expect(() => compoundFile.getStream('WordDocument')).toThrow(DocConversionError);
  });

  it('reads a bounded mini stream from a valid Compound File fixture', () => {
    const compoundFile = openCompoundFile(createMiniStreamFixture(), resolveDocLimits());

    expect(compoundFile.getStream('WordDocument')?.toString('ascii')).toBe('hello');
  });

  it('rejects a mini stream chain that continues after its declared size', () => {
    const compoundFile = openCompoundFile(createMiniStreamFixture(true), resolveDocLimits());

    expect(() => compoundFile.getStream('WordDocument')).toThrow(DocConversionError);
  });

  it('rejects inputs over the caller configured byte limit', () => {
    expect(() => openCompoundFile(createCompoundFixture(), resolveDocLimits({ maxInputBytes: 1024 }))).toThrow(DocConversionError);
  });
});
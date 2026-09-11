import { assertDocInputSize, type DocLimits } from './limits.js';
import { DocConversionError } from './errors.js';

const HEADER_SIZE = 512;
const DIRECTORY_ENTRY_SIZE = 128;
const MINIFAT_CUTOFF = 4096;
const FREE_SECTOR = 0xFFFFFFFF;
const END_OF_CHAIN = 0xFFFFFFFE;
const FAT_SECTOR = 0xFFFFFFFD;
const DIFAT_SECTOR = 0xFFFFFFFC;
const CFB_SIGNATURE = Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]);

interface DirectoryEntry {
  id: number;
  name: string;
  type: number;
  leftSibling: number;
  rightSibling: number;
  child: number;
  startSector: number;
  size: number;
}

export interface CompoundFile {
  getStream(name: string): Buffer | null;
}

const invalid = (message: string): never => {
  throw new DocConversionError('DOC_INVALID', message);
};

const limitExceeded = (message: string): never => {
  throw new DocConversionError('DOC_LIMIT_EXCEEDED', message);
};

const requireValue = <T>(value: T | null | undefined, message: string): T => {
  if (value === null || value === undefined) {
    throw new DocConversionError('DOC_INVALID', message);
  }
  return value;
};

const assertRange = (buffer: Buffer, offset: number, length: number, label: string): void => {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > buffer.length) {
    invalid(`Invalid ${label} range`);
  }
};

const readUInt16 = (buffer: Buffer, offset: number, label: string): number => {
  assertRange(buffer, offset, 2, label);
  return buffer.readUInt16LE(offset);
};

const readUInt32 = (buffer: Buffer, offset: number, label: string): number => {
  assertRange(buffer, offset, 4, label);
  return buffer.readUInt32LE(offset);
};

const readStreamSize = (buffer: Buffer, offset: number, majorVersion: number): number => {
  const low = readUInt32(buffer, offset, 'stream size');
  if (majorVersion === 3) {
    return low;
  }
  const high = readUInt32(buffer, offset + 4, 'stream size');
  const size = (high * 0x1_0000_0000) + low;
  if (!Number.isSafeInteger(size)) {
    limitExceeded('Stream size exceeds the supported range');
  }
  return size;
};

const normalizeName = (name: string): string => name.toLowerCase();

const decodeName = (buffer: Buffer, offset: number): string => {
  const byteLength = readUInt16(buffer, offset + 64, 'directory name length');
  if (byteLength === 0) {
    return '';
  }
  if (byteLength < 2 || byteLength > 64 || byteLength % 2 !== 0) {
    invalid('Invalid directory entry name length');
  }
  assertRange(buffer, offset, byteLength, 'directory name');
  return buffer.subarray(offset, offset + byteLength - 2).toString('utf16le');
};

export const openCompoundFile = (buffer: Buffer, limits: DocLimits): CompoundFile => {
  assertDocInputSize(buffer.length, limits);
  if (buffer.length < HEADER_SIZE) {
    invalid('Legacy DOC input is smaller than a Compound File header');
  }
  if (!buffer.subarray(0, CFB_SIGNATURE.length).equals(CFB_SIGNATURE)) {
    invalid('Legacy DOC input is not a Compound File');
  }
  if (readUInt16(buffer, 28, 'byte order') !== 0xFFFE) {
    invalid('Unsupported Compound File byte order');
  }

  const majorVersion = readUInt16(buffer, 26, 'major version');
  if (majorVersion !== 3 && majorVersion !== 4) {
    throw new DocConversionError('DOC_UNSUPPORTED', 'Unsupported Compound File version');
  }

  const sectorShift = readUInt16(buffer, 30, 'sector shift');
  const miniSectorShift = readUInt16(buffer, 32, 'mini sector shift');
  const expectedSectorShift = majorVersion === 3 ? 9 : 12;
  if (sectorShift !== expectedSectorShift || miniSectorShift !== 6) {
    invalid('Unsupported Compound File sector geometry');
  }

  const sectorSize = 1 << sectorShift;
  if ((buffer.length - HEADER_SIZE) % sectorSize !== 0) {
    invalid('Compound File has a partial trailing sector');
  }
  const sectorCount = (buffer.length - HEADER_SIZE) / sectorSize;
  if (sectorCount < 1) {
    invalid('Compound File contains no sectors');
  }

  const numberOfFatSectors = readUInt32(buffer, 44, 'FAT sector count');
  const firstDirectorySector = readUInt32(buffer, 48, 'directory start sector');
  const miniStreamCutoff = readUInt32(buffer, 56, 'mini stream cutoff');
  const firstMiniFatSector = readUInt32(buffer, 60, 'mini FAT start sector');
  const numberOfMiniFatSectors = readUInt32(buffer, 64, 'mini FAT sector count');
  const firstDifatSector = readUInt32(buffer, 68, 'DIFAT start sector');
  const numberOfDifatSectors = readUInt32(buffer, 72, 'DIFAT sector count');

  if (miniStreamCutoff !== MINIFAT_CUTOFF) {
    invalid('Unsupported mini stream cutoff');
  }
  if (numberOfFatSectors === 0 || numberOfFatSectors > sectorCount) {
    invalid('Invalid FAT sector count');
  }
  if (numberOfMiniFatSectors > sectorCount || numberOfDifatSectors > sectorCount) {
    invalid('Invalid Compound File sector count');
  }

  const isDataSector = (sectorId: number): boolean => sectorId >= 0 && sectorId < sectorCount;
  const sectorOffset = (sectorId: number): number => HEADER_SIZE + (sectorId * sectorSize);
  const assertDataSector = (sectorId: number, label: string): void => {
    if (!isDataSector(sectorId)) {
      invalid(`Invalid ${label} sector reference`);
    }
  };

  const fatSectors: number[] = [];
  const knownFatSectors = new Set<number>();
  const addFatSector = (sectorId: number): void => {
    assertDataSector(sectorId, 'FAT');
    if (knownFatSectors.has(sectorId)) {
      invalid('Compound File repeats a FAT sector');
    }
    knownFatSectors.add(sectorId);
    fatSectors.push(sectorId);
  };

  for (let index = 0; index < 109 && fatSectors.length < numberOfFatSectors; index += 1) {
    const sectorId = readUInt32(buffer, 76 + (index * 4), 'header DIFAT entry');
    if (sectorId === FREE_SECTOR || sectorId === END_OF_CHAIN) {
      break;
    }
    addFatSector(sectorId);
  }

  let difatSector = firstDifatSector;
  let remainingDifatSectors = numberOfDifatSectors;
  const visitedDifatSectors = new Set<number>();
  const entriesPerDifatSector = (sectorSize / 4) - 1;

  while (fatSectors.length < numberOfFatSectors) {
    if (remainingDifatSectors === 0 || difatSector === END_OF_CHAIN || difatSector === FREE_SECTOR) {
      invalid('Compound File DIFAT chain ends before all FAT sectors are declared');
    }
    assertDataSector(difatSector, 'DIFAT');
    if (visitedDifatSectors.has(difatSector)) {
      invalid('Compound File DIFAT chain contains a cycle');
    }
    visitedDifatSectors.add(difatSector);

    const offset = sectorOffset(difatSector);
    for (let index = 0; index < entriesPerDifatSector && fatSectors.length < numberOfFatSectors; index += 1) {
      const sectorId = readUInt32(buffer, offset + (index * 4), 'DIFAT entry');
      if (sectorId === FREE_SECTOR || sectorId === END_OF_CHAIN) {
        continue;
      }
      addFatSector(sectorId);
    }

    difatSector = readUInt32(buffer, offset + sectorSize - 4, 'next DIFAT sector');
    remainingDifatSectors -= 1;
  }

  const entriesPerFatSector = sectorSize / 4;
  const fat = new Uint32Array(fatSectors.length * entriesPerFatSector);
  for (let fatIndex = 0; fatIndex < fatSectors.length; fatIndex += 1) {
    const offset = sectorOffset(fatSectors[fatIndex]);
    for (let entryIndex = 0; entryIndex < entriesPerFatSector; entryIndex += 1) {
      fat[(fatIndex * entriesPerFatSector) + entryIndex] = readUInt32(
        buffer,
        offset + (entryIndex * 4),
        'FAT entry',
      );
    }
  }
  if (fat.length < sectorCount) {
    invalid('Compound File FAT does not cover all sectors');
  }

  const readRegularChain = (startSector: number, size: number, label: string): Buffer => {
    if (size === 0) {
      return Buffer.alloc(0);
    }
    if (size > limits.maxInputBytes) {
      limitExceeded(`${label} exceeds the configured document limit`);
    }
    const requiredSectors = Math.ceil(size / sectorSize);
    if (requiredSectors > sectorCount) {
      invalid(`${label} declares more sectors than the file contains`);
    }

    const chunks: Buffer[] = [];
    const visitedSectors = new Set<number>();
    let currentSector = startSector;

    for (let index = 0; index < requiredSectors; index += 1) {
      assertDataSector(currentSector, label);
      if (visitedSectors.has(currentSector)) {
        invalid(`${label} chain contains a cycle`);
      }
      visitedSectors.add(currentSector);
      const offset = sectorOffset(currentSector);
      chunks.push(buffer.subarray(offset, offset + sectorSize));
      currentSector = fat[currentSector];
    }

    if (currentSector !== END_OF_CHAIN) {
      invalid(`${label} chain does not end at its declared size`);
    }

    return Buffer.concat(chunks, size);
  };

  const readDirectory = (): Buffer => {
    assertDataSector(firstDirectorySector, 'directory');
    const maximumBytes = limits.maxDirectoryEntries * DIRECTORY_ENTRY_SIZE;
    const chunks: Buffer[] = [];
    const visitedSectors = new Set<number>();
    let currentSector = firstDirectorySector;

    while (currentSector !== END_OF_CHAIN) {
      assertDataSector(currentSector, 'directory');
      if (visitedSectors.has(currentSector)) {
        invalid('Directory chain contains a cycle');
      }
      if ((chunks.length + 1) * sectorSize > maximumBytes) {
        limitExceeded('Compound File directory exceeds the configured entry limit');
      }
      visitedSectors.add(currentSector);
      const offset = sectorOffset(currentSector);
      chunks.push(buffer.subarray(offset, offset + sectorSize));
      currentSector = fat[currentSector];
    }

    return Buffer.concat(chunks);
  };

  const directoryBytes = readDirectory();
  const directoryEntryCount = Math.floor(directoryBytes.length / DIRECTORY_ENTRY_SIZE);
  if (directoryEntryCount > limits.maxDirectoryEntries) {
    limitExceeded('Compound File directory exceeds the configured entry limit');
  }
  const directoryEntries: Array<DirectoryEntry | null> = new Array(directoryEntryCount).fill(null);
  let rootEntry: DirectoryEntry | null = null;

  for (let index = 0; index < directoryEntryCount; index += 1) {
    const offset = index * DIRECTORY_ENTRY_SIZE;
    const type = directoryBytes[offset + 66];
    if (type === 0) {
      continue;
    }
    if (type !== 1 && type !== 2 && type !== 5) {
      continue;
    }

    const name = decodeName(directoryBytes, offset);
    if (!name) {
      invalid('Compound File has a named directory entry without a name');
    }
    const entry: DirectoryEntry = {
      id: index,
      name,
      type,
      leftSibling: readUInt32(directoryBytes, offset + 68, 'directory left sibling'),
      rightSibling: readUInt32(directoryBytes, offset + 72, 'directory right sibling'),
      child: readUInt32(directoryBytes, offset + 76, 'directory child'),
      startSector: readUInt32(directoryBytes, offset + 116, 'directory stream start sector'),
      size: readStreamSize(directoryBytes, offset + 120, majorVersion),
    };
    directoryEntries[index] = entry;

    if ((entry.type === 2 || entry.type === 5) && entry.size > limits.maxInputBytes) {
      limitExceeded(`Compound File stream ${entry.name} exceeds the configured document limit`);
    }

    if (entry.type === 5) {
      if (rootEntry) {
        invalid('Compound File has multiple root entries');
      }
      rootEntry = entry;
      continue;
    }
  }

  const root = requireValue(rootEntry, 'Compound File has no root entry');

  const entries = new Map<string, DirectoryEntry>();
  const pendingEntryIds = [root.child];
  const visitedEntryIds = new Set<number>();

  while (pendingEntryIds.length > 0) {
    const entryId = pendingEntryIds.pop()!;
    if (entryId === FREE_SECTOR) {
      continue;
    }
    if (entryId === END_OF_CHAIN || entryId >= directoryEntries.length || visitedEntryIds.has(entryId)) {
      invalid('Compound File root storage tree is invalid');
    }
    const entry = requireValue(
      directoryEntries[entryId],
      'Compound File root storage references an empty entry',
    );
    visitedEntryIds.add(entryId);
    pendingEntryIds.push(entry.leftSibling, entry.rightSibling);

    if (entry.type !== 2) {
      continue;
    }
    const normalizedName = normalizeName(entry.name);
    if (entries.has(normalizedName)) {
      invalid(`Compound File repeats root stream ${entry.name}`);
    }
    entries.set(normalizedName, entry);
  }

  let miniStream: Buffer | null = null;
  let miniFat: Uint32Array | null = null;

  const loadMiniStorage = (): void => {
    if (miniStream !== null && miniFat !== null) {
      return;
    }
    miniStream = root.size === 0
      ? Buffer.alloc(0)
      : readRegularChain(root.startSector, root.size, 'mini stream');

    if (numberOfMiniFatSectors === 0) {
      miniFat = new Uint32Array(0);
      return;
    }
    assertDataSector(firstMiniFatSector, 'mini FAT');
    const miniFatBytes = readRegularChain(
      firstMiniFatSector,
      numberOfMiniFatSectors * sectorSize,
      'mini FAT',
    );
    const parsedMiniFat = new Uint32Array(miniFatBytes.length / 4);
    for (let index = 0; index < parsedMiniFat.length; index += 1) {
      parsedMiniFat[index] = readUInt32(miniFatBytes, index * 4, 'mini FAT entry');
    }
    miniFat = parsedMiniFat;
  };

  const readMiniChain = (entry: DirectoryEntry): Buffer => {
    loadMiniStorage();
    const rootMiniStream = requireValue(miniStream, `Missing mini stream for ${entry.name}`);
    const miniFatEntries = requireValue(miniFat, `Missing mini FAT for ${entry.name}`);
    if (entry.size > rootMiniStream.length) {
      invalid(`Invalid mini stream ${entry.name}`);
    }
    const miniSectorSize = 64;
    const requiredSectors = Math.ceil(entry.size / miniSectorSize);
    if (requiredSectors > miniFatEntries.length) {
      invalid(`Mini stream ${entry.name} declares too many sectors`);
    }

    const chunks: Buffer[] = [];
    const visitedSectors = new Set<number>();
    let currentSector = entry.startSector;

    for (let index = 0; index < requiredSectors; index += 1) {
      if (currentSector >= miniFatEntries.length || visitedSectors.has(currentSector)) {
        invalid(`Mini stream ${entry.name} chain is invalid`);
      }
      const offset = currentSector * miniSectorSize;
      if (offset + miniSectorSize > rootMiniStream.length) {
        invalid(`Mini stream ${entry.name} exceeds the root mini stream`);
      }
      visitedSectors.add(currentSector);
      chunks.push(rootMiniStream.subarray(offset, offset + miniSectorSize));
      currentSector = miniFatEntries[currentSector];
    }

    if (currentSector !== END_OF_CHAIN) {
      invalid(`Mini stream ${entry.name} chain does not end at its declared size`);
    }

    return Buffer.concat(chunks, entry.size);
  };

  return {
    getStream(name: string): Buffer | null {
      const entry = entries.get(normalizeName(name));
      if (!entry) {
        return null;
      }
      if (entry.size === 0) {
        return Buffer.alloc(0);
      }
      return entry.size < MINIFAT_CUTOFF
        ? readMiniChain(entry)
        : readRegularChain(entry.startSector, entry.size, `stream ${entry.name}`);
    },
  };
};
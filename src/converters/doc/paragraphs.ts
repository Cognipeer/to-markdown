import type { DocLimits } from './limits.js';
import { DocConversionError } from './errors.js';

const PARAGRAPH_FKP_SIZE = 512;
const IN_TABLE_PROPERTY = 0x2416;
const TABLE_ROW_END_PROPERTY = 0x2417;
const LIST_ID_PROPERTY = 0x460B;
const LIST_LEVEL_PROPERTY = 0x260A;

export interface TableReference {
  offset: number;
  length: number;
}

export interface ParagraphProperties {
  start: number;
  end: number;
  styleId: number;
  listId: number | null;
  listLevel: number;
  inTable: boolean;
  tableRowEnd: boolean;
}

const invalid = (message: string): never => {
  throw new DocConversionError('DOC_INVALID', message);
};

const limitExceeded = (message: string): never => {
  throw new DocConversionError('DOC_LIMIT_EXCEEDED', message);
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

const propertyOperandLength = (code: number, buffer: Buffer, offset: number, end: number): number => {
  const kind = (code >>> 13) & 0x07;
  if (kind === 0 || kind === 1) return 1;
  if (kind === 2 || kind === 4 || kind === 5) return 2;
  if (kind === 3) return 4;
  if (kind === 7) return 3;
  assertRange(buffer, offset, 1, 'variable paragraph property length');
  const length = 1 + buffer[offset];
  if (offset + length > end) {
    invalid('Paragraph property extends beyond its record');
  }
  return length;
};

const readProperties = (buffer: Buffer, offset: number, pageStart: number, pageEnd: number): {
  styleId: number;
  listId: number | null;
  listLevel: number;
  inTable: boolean;
  tableRowEnd: boolean;
} => {
  if (offset < pageStart || offset >= pageEnd) {
    invalid('Paragraph property offset is outside its FKP page');
  }
  assertRange(buffer, offset, 1, 'paragraph property offset');
  const sizeByte = buffer[offset];
  const headerOffset = sizeByte === 0 ? offset + 2 : offset + 1;
  assertRange(buffer, headerOffset, 2, 'paragraph style identifier');
  const recordEnd = sizeByte === 0
    ? offset + 2 + (buffer[offset + 1] * 2)
    : offset + (sizeByte * 2);
  if (recordEnd <= headerOffset || recordEnd > pageEnd) {
    invalid('Paragraph property record is outside its FKP page');
  }

  const styleId = readUInt16(buffer, headerOffset, 'paragraph style identifier');
  let listId: number | null = null;
  let listLevel = 0;
  let inTable = false;
  let tableRowEnd = false;
  let cursor = headerOffset + 2;

  while (cursor < recordEnd) {
    const code = readUInt16(buffer, cursor, 'paragraph property code');
    const operandOffset = cursor + 2;
    const operandLength = propertyOperandLength(code, buffer, operandOffset, recordEnd);
    if (operandOffset + operandLength > recordEnd) {
      invalid('Paragraph property operand is outside its record');
    }

    if (code === LIST_ID_PROPERTY && operandLength >= 2) {
      listId = readUInt16(buffer, operandOffset, 'paragraph list identifier');
    } else if (code === LIST_LEVEL_PROPERTY) {
      listLevel = buffer[operandOffset];
    } else if (code === IN_TABLE_PROPERTY) {
      inTable = (buffer[operandOffset] & 0x01) === 0x01;
    } else if (code === TABLE_ROW_END_PROPERTY) {
      tableRowEnd = (buffer[operandOffset] & 0x01) === 0x01;
    }
    cursor = operandOffset + operandLength;
  }

  return { styleId, listId, listLevel, inTable, tableRowEnd };
};

export const parseParagraphProperties = (
  wordDocument: Buffer,
  table: Buffer,
  reference: TableReference | null,
  limits: DocLimits,
): ParagraphProperties[] => {
  if (!reference || reference.length === 0) {
    return [];
  }
  assertRange(table, reference.offset, reference.length, 'paragraph property table');
  if (reference.length < 12 || (reference.length - 4) % 8 !== 0) {
    invalid('Invalid paragraph property table layout');
  }

  const pageCount = (reference.length - 4) / 8;
  if (pageCount > limits.maxPieces) {
    limitExceeded(`Paragraph property page count exceeds ${limits.maxPieces}`);
  }
  const pageNumberOffset = reference.offset + ((pageCount + 1) * 4);
  const runs: ParagraphProperties[] = [];

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const pageNumber = readUInt32(table, pageNumberOffset + (pageIndex * 4), 'paragraph FKP page number') & 0x003FFFFF;
    const pageOffset = pageNumber * PARAGRAPH_FKP_SIZE;
    assertRange(wordDocument, pageOffset, PARAGRAPH_FKP_SIZE, 'paragraph FKP page');
    const runCount = wordDocument[pageOffset + PARAGRAPH_FKP_SIZE - 1];
    const runBoundaryOffset = pageOffset + ((runCount + 1) * 4);
    const runDescriptorEnd = runBoundaryOffset + (runCount * 13);
    if (runDescriptorEnd > pageOffset + PARAGRAPH_FKP_SIZE - 1) {
      invalid('Paragraph FKP run table exceeds its page');
    }

    for (let runIndex = 0; runIndex < runCount; runIndex += 1) {
      if (runs.length >= limits.maxPieces) {
        limitExceeded(`Paragraph property run count exceeds ${limits.maxPieces}`);
      }
      const start = readUInt32(wordDocument, pageOffset + (runIndex * 4), 'paragraph run start');
      const end = readUInt32(wordDocument, pageOffset + ((runIndex + 1) * 4), 'paragraph run end');
      if (end <= start) {
        continue;
      }
      const propertyWordOffset = wordDocument[runBoundaryOffset + (runIndex * 13)];
      if (propertyWordOffset === 0) {
        runs.push({
          start,
          end,
          styleId: 0,
          listId: null,
          listLevel: 0,
          inTable: false,
          tableRowEnd: false,
        });
        continue;
      }
      const propertyOffset = pageOffset + (propertyWordOffset * 2);
      const properties = readProperties(
        wordDocument,
        propertyOffset,
        pageOffset,
        pageOffset + PARAGRAPH_FKP_SIZE,
      );
      runs.push({ start, end, ...properties });
    }
  }

  return runs.sort((left, right) => left.start - right.start || left.end - right.end);
};

export const findParagraphProperties = (
  runs: ParagraphProperties[],
  fileOffset: number,
): ParagraphProperties | null => {
  let lower = 0;
  let upper = runs.length - 1;

  while (lower <= upper) {
    const middle = Math.floor((lower + upper) / 2);
    const run = runs[middle];
    if (fileOffset < run.start) {
      upper = middle - 1;
    } else if (fileOffset >= run.end) {
      lower = middle + 1;
    } else {
      return run;
    }
  }
  return null;
};
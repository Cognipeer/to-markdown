import type { CompoundFile } from './cfb.js';
import type { DocLimits } from './limits.js';
import { DocConversionError } from './errors.js';
import {
  findParagraphProperties,
  parseParagraphProperties,
  type ParagraphProperties,
  type TableReference,
} from './paragraphs.js';
import { createListMarkerResolver, type ListMarkerResolver } from './lists.js';

const ENCRYPTED_FLAG = 0x0100;
const OBFUSCATED_FLAG = 0x8000;
const COMPRESSED_FLAG = 0x40000000;
const OFFSET_MASK = 0x3FFFFFFF;
const MAX_FIELD_DEPTH = 64;
const WORD_6_95_IDENTIFIER = 0xA5DC;
const WORD_97_IDENTIFIER = 0xA5EC;

export interface DocPiece {
  start: number;
  end: number;
  offset: number;
  compressed: boolean;
}

export interface DocStories {
  body: string;
  headers: string;
  footnotes: string;
}

export interface DocStorySelection {
  includeHeaders?: boolean;
  includeFootnotes?: boolean;
}

export interface DocParagraph {
  text: string;
  listId: number | null;
  listLevel: number;
  inTable: boolean;
  tableRowEnd: boolean;
}

export interface ParsedDocContent {
  body: DocParagraph[];
  headers: string;
  footnotes: string;
  listMarkerResolver: ListMarkerResolver;
}

interface WordDocumentContext {
  wordDocument: Buffer;
  table: Buffer;
  pieces: DocPiece[];
  counts: Record<string, number>;
  paragraphProperties: TableReference | null;
  listDefinitions: TableReference | null;
  listOverrides: TableReference | null;
}

interface OutputBudget {
  used: number;
  maximum: number;
}

const invalid = (message: string): never => {
  throw new DocConversionError('DOC_INVALID', message);
};

const unsupported = (message: string): never => {
  throw new DocConversionError('DOC_UNSUPPORTED', message);
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

const remapCompressedCharacter = (value: number): string => {
  switch (value) {
    case 0x82: return '\u201A';
    case 0x83: return '\u0192';
    case 0x84: return '\u201E';
    case 0x85: return '\u2026';
    case 0x86: return '\u2020';
    case 0x87: return '\u2021';
    case 0x88: return '\u02C6';
    case 0x89: return '\u2030';
    case 0x8A: return '\u0160';
    case 0x8B: return '\u2039';
    case 0x8C: return '\u0152';
    case 0x91: return '\u2018';
    case 0x92: return '\u2019';
    case 0x93: return '\u201C';
    case 0x94: return '\u201D';
    case 0x95: return '\u2022';
    case 0x96: return '\u2013';
    case 0x97: return '\u2014';
    case 0x98: return '\u02DC';
    case 0x99: return '\u2122';
    case 0x9A: return '\u0161';
    case 0x9B: return '\u203A';
    case 0x9C: return '\u0153';
    case 0x9F: return '\u0178';
    default: return value >= 0x80 && value <= 0x9F ? '' : String.fromCharCode(value);
  }
};

const decodeCompressed = (buffer: Buffer): string => {
  let output = '';
  for (const value of buffer) {
    output += remapCompressedCharacter(value);
  }
  return output;
};

const decodePiece = (wordDocument: Buffer, piece: DocPiece, start: number, end: number): string => {
  const characterCount = end - start;
  if (characterCount < 0) {
    invalid('Piece has a negative character range');
  }
  const offsetWithinPiece = start - piece.start;

  if (piece.compressed) {
    const offset = piece.offset + offsetWithinPiece;
    assertRange(wordDocument, offset, characterCount, 'compressed text piece');
    return decodeCompressed(wordDocument.subarray(offset, offset + characterCount));
  }

  const offset = piece.offset + (offsetWithinPiece * 2);
  const byteLength = characterCount * 2;
  assertRange(wordDocument, offset, byteLength, 'Unicode text piece');
  return wordDocument.subarray(offset, offset + byteLength).toString('utf16le');
};

const appendOutput = (budget: OutputBudget, parts: string[], value: string): void => {
  if (!value) {
    return;
  }
  if (budget.used + value.length > budget.maximum) {
    limitExceeded(`Legacy DOC output exceeds ${budget.maximum} characters`);
  }
  budget.used += value.length;
  parts.push(value);
};

const walkStoryCharacters = (
  wordDocument: Buffer,
  pieces: DocPiece[],
  start: number,
  end: number,
  visitor: (code: number, fileOffset: number) => void,
): void => {
  for (const piece of pieces) {
    const pieceStart = Math.max(start, piece.start);
    const pieceEnd = Math.min(end, piece.end);
    if (pieceStart >= pieceEnd) {
      continue;
    }
    const offsetWithinPiece = pieceStart - piece.start;
    const characterCount = pieceEnd - pieceStart;

    if (piece.compressed) {
      const offset = piece.offset + offsetWithinPiece;
      assertRange(wordDocument, offset, characterCount, 'compressed text piece');
      for (let index = 0; index < characterCount; index += 1) {
        const character = remapCompressedCharacter(wordDocument[offset + index]);
        if (character) {
          visitor(character.charCodeAt(0), offset + index);
        }
      }
      continue;
    }

    const offset = piece.offset + (offsetWithinPiece * 2);
    const byteLength = characterCount * 2;
    assertRange(wordDocument, offset, byteLength, 'Unicode text piece');
    for (let index = 0; index < characterCount; index += 1) {
      const fileOffset = offset + (index * 2);
      visitor(readUInt16(wordDocument, fileOffset, 'Unicode text character'), fileOffset);
    }
  }
};

const visibleCharacter = (code: number): string => {
  if (code === 0x1E) {
    return '-';
  }
  if (code === 0xA0) {
    return ' ';
  }
  if (code < 0x20 || (code >= 0x7F && code <= 0x9F)) {
    return '';
  }
  return String.fromCharCode(code);
};

export const extractStoryParagraphs = (
  wordDocument: Buffer,
  pieces: DocPiece[],
  start: number,
  end: number,
  paragraphRuns: ParagraphProperties[],
  budget: OutputBudget,
): DocParagraph[] => {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) {
    invalid('Invalid story character range');
  }

  const paragraphs: DocParagraph[] = [];
  const fieldStates: boolean[] = [];
  const parts: string[] = [];
  let paragraphStartOffset: number | null = null;

  const append = (value: string): void => {
    if (!value) {
      return;
    }
    if (budget.used + value.length > budget.maximum) {
      limitExceeded(`Legacy DOC output exceeds ${budget.maximum} characters`);
    }
    budget.used += value.length;
    parts.push(value);
  };

  const flushParagraph = (boundaryOffset: number): void => {
    const text = parts.join('').trimEnd();
    const properties = findParagraphProperties(paragraphRuns, boundaryOffset)
      || (paragraphStartOffset === null ? null : findParagraphProperties(paragraphRuns, paragraphStartOffset));
    if (text || properties?.listId) {
      paragraphs.push({
        text,
        listId: properties?.listId ?? null,
        listLevel: properties?.listLevel ?? 0,
        inTable: properties?.inTable ?? false,
        tableRowEnd: properties?.tableRowEnd ?? false,
      });
    }
    parts.length = 0;
    paragraphStartOffset = null;
  };

  walkStoryCharacters(wordDocument, pieces, start, end, (code, fileOffset) => {
    if (paragraphStartOffset === null) {
      paragraphStartOffset = fileOffset;
    }
    if (code === 0x13) {
      if (fieldStates.length >= MAX_FIELD_DEPTH) {
        limitExceeded('Legacy DOC field nesting exceeds the supported limit');
      }
      fieldStates.push(true);
      return;
    }
    if (code === 0x14) {
      if (fieldStates.length > 0) {
        fieldStates[fieldStates.length - 1] = false;
      }
      return;
    }
    if (code === 0x15) {
      fieldStates.pop();
      return;
    }
    if (fieldStates.some(Boolean)) {
      return;
    }
    if (code === 0x07) {
      const properties = findParagraphProperties(paragraphRuns, fileOffset);
      if (properties?.tableRowEnd) {
        flushParagraph(fileOffset);
      } else {
        append('\t');
      }
      return;
    }
    if (code === 0x09) {
      append('\t');
      return;
    }
    if (code === 0x0D) {
      flushParagraph(fileOffset);
      return;
    }
    if (code === 0x0A || code === 0x0B || code === 0x0C) {
      append('\n');
      return;
    }
    append(visibleCharacter(code));
  });

  if (parts.length > 0) {
    flushParagraph(paragraphStartOffset ?? 0);
  }
  return paragraphs;
};

export const extractStoryText = (
  wordDocument: Buffer,
  pieces: DocPiece[],
  start: number,
  end: number,
  budget: OutputBudget,
): string => {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) {
    invalid('Invalid story character range');
  }

  const parts: string[] = [];
  const fieldStates: boolean[] = [];

  for (const piece of pieces) {
    const pieceStart = Math.max(start, piece.start);
    const pieceEnd = Math.min(end, piece.end);
    if (pieceStart >= pieceEnd) {
      continue;
    }
    if (pieceEnd - pieceStart > budget.maximum - budget.used) {
      limitExceeded(`Legacy DOC output exceeds ${budget.maximum} characters`);
    }

    const text = decodePiece(wordDocument, piece, pieceStart, pieceEnd);
    let plainStart = 0;
    const flushPlainText = (position: number): void => {
      if (position > plainStart && !fieldStates.some(Boolean)) {
        appendOutput(budget, parts, text.slice(plainStart, position));
      }
      plainStart = position + 1;
    };

    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      if (code === 0x13) {
        flushPlainText(index);
        if (fieldStates.length >= MAX_FIELD_DEPTH) {
          limitExceeded('Legacy DOC field nesting exceeds the supported limit');
        }
        fieldStates.push(true);
        continue;
      }
      if (code === 0x14) {
        flushPlainText(index);
        if (fieldStates.length > 0) {
          fieldStates[fieldStates.length - 1] = false;
        }
        continue;
      }
      if (code === 0x15) {
        flushPlainText(index);
        fieldStates.pop();
        continue;
      }
      if (fieldStates.some(Boolean)) {
        plainStart = index + 1;
        continue;
      }
      if (code === 0x07) {
        flushPlainText(index);
        appendOutput(budget, parts, '\t');
        continue;
      }
      if (code === 0x09) {
        flushPlainText(index);
        appendOutput(budget, parts, '\t');
        continue;
      }
      if (code === 0x0A || code === 0x0B || code === 0x0C || code === 0x0D) {
        flushPlainText(index);
        appendOutput(budget, parts, '\n');
        continue;
      }
      if (code === 0x1E) {
        flushPlainText(index);
        appendOutput(budget, parts, '-');
        continue;
      }
      if (code === 0xA0) {
        flushPlainText(index);
        appendOutput(budget, parts, ' ');
        continue;
      }
      if (code < 0x20 || (code >= 0x7F && code <= 0x9F)) {
        flushPlainText(index);
      }
    }
    if (!fieldStates.some(Boolean) && plainStart < text.length) {
      appendOutput(budget, parts, text.slice(plainStart));
    }
  }

  return parts.join('');
};

export const parsePieceTable = (
  table: Buffer,
  offset: number,
  length: number,
  limits: DocLimits,
): DocPiece[] => {
  assertRange(table, offset, length, 'CLX');
  const end = offset + length;
  let cursor = offset;

  while (cursor < end) {
    const recordType = table[cursor];
    if (recordType === 0x01) {
      const payloadLength = readUInt16(table, cursor + 1, 'CLX property record length');
      const nextCursor = cursor + 3 + payloadLength;
      if (nextCursor <= cursor || nextCursor > end) {
        invalid('Invalid CLX property record');
      }
      cursor = nextCursor;
      continue;
    }
    if (recordType !== 0x02) {
      invalid('CLX has no piece table record');
    }

    const pieceTableLength = readUInt32(table, cursor + 1, 'piece table length');
    const pieceTableOffset = cursor + 5;
    assertRange(table, pieceTableOffset, pieceTableLength, 'piece table');
    if (pieceTableLength < 16 || (pieceTableLength - 4) % 12 !== 0) {
      invalid('Invalid piece table layout');
    }

    const pieceCount = (pieceTableLength - 4) / 12;
    if (pieceCount > limits.maxPieces) {
      limitExceeded(`Legacy DOC piece count exceeds ${limits.maxPieces}`);
    }

    const pieces: DocPiece[] = [];
    const pieceDescriptorOffset = pieceTableOffset + ((pieceCount + 1) * 4);
    let previousEnd = -1;

    for (let index = 0; index < pieceCount; index += 1) {
      const start = readUInt32(table, pieceTableOffset + (index * 4), 'piece start');
      const pieceEnd = readUInt32(table, pieceTableOffset + ((index + 1) * 4), 'piece end');
      if (pieceEnd < start || (previousEnd >= 0 && start !== previousEnd)) {
        invalid('Piece table character ranges are invalid');
      }
      const descriptorOffset = pieceDescriptorOffset + (index * 8);
      const encodedOffset = readUInt32(table, descriptorOffset + 2, 'piece file offset');
      const compressed = (encodedOffset & COMPRESSED_FLAG) !== 0;
      const rawOffset = encodedOffset & OFFSET_MASK;
      pieces.push({
        start,
        end: pieceEnd,
        offset: compressed ? rawOffset >>> 1 : rawOffset,
        compressed,
      });
      previousEnd = pieceEnd;
    }

    return pieces;
  }

  return invalid('CLX has no piece table record');
};

const readStoryCounts = (compoundFile: CompoundFile, wordDocument: Buffer): {
  table: Buffer;
  clxOffset: number;
  clxLength: number;
  counts: Record<string, number>;
  paragraphProperties: TableReference | null;
  listDefinitions: TableReference | null;
  listOverrides: TableReference | null;
} => {
  if (wordDocument.length < 0x20) {
    invalid('WordDocument stream is too short');
  }
  const identifier = readUInt16(wordDocument, 0, 'WordDocument identifier');
  if (identifier === WORD_6_95_IDENTIFIER) {
    unsupported('Word 6/95 documents are not supported');
  }
  if (identifier !== WORD_97_IDENTIFIER) {
    invalid('WordDocument stream has an invalid identifier');
  }

  const version = readUInt16(wordDocument, 2, 'WordDocument version');
  if (version < 0x00C1) {
    unsupported('Word 6/95 documents are not supported');
  }

  const flags = readUInt16(wordDocument, 10, 'WordDocument flags');
  if ((flags & ENCRYPTED_FLAG) !== 0 || (flags & OBFUSCATED_FLAG) !== 0) {
    throw new DocConversionError('DOC_ENCRYPTED', 'Encrypted or obfuscated Word documents are not supported');
  }

  let cursor = 0x20;
  const shortWordCount = readUInt16(wordDocument, cursor, 'FIB short count');
  cursor += 2 + (shortWordCount * 2);
  assertRange(wordDocument, cursor, 2, 'FIB long count');
  const longWordCount = readUInt16(wordDocument, cursor, 'FIB long count');
  cursor += 2;
  const longWordOffset = cursor;
  assertRange(wordDocument, longWordOffset, longWordCount * 4, 'FIB long values');
  cursor += longWordCount * 4;
  const pairCount = readUInt16(wordDocument, cursor, 'FIB pair count');
  cursor += 2;
  const pairOffset = cursor;
  assertRange(wordDocument, pairOffset, pairCount * 8, 'FIB pair values');

  if (longWordCount < 11 || pairCount <= 33) {
    unsupported('WordDocument header does not contain the required Word 97-2003 fields');
  }

  const readLong = (index: number): number => readUInt32(
    wordDocument,
    longWordOffset + (index * 4),
    'FIB story character count',
  );
  const pairAt = (index: number): { offset: number; length: number } => {
    const offsetInPairs = pairOffset + (index * 8);
    return {
      offset: readUInt32(wordDocument, offsetInPairs, 'FIB table offset'),
      length: readUInt32(wordDocument, offsetInPairs + 4, 'FIB table length'),
    };
  };
  const optionalPairAt = (index: number): TableReference | null => {
    if (index >= pairCount) {
      return null;
    }
    const pair = pairAt(index);
    return pair.length > 0 ? pair : null;
  };

  const tablePreference = (flags & 0x0200) !== 0 ? ['1Table', '0Table'] : ['0Table', '1Table'];
  const selectedTable = tablePreference
    .map((name) => compoundFile.getStream(name))
    .find((stream): stream is Buffer => Boolean(stream));
  if (!selectedTable) {
    return invalid('Compound File has no Word table stream');
  }
  const table = selectedTable;

  const clx = pairAt(33);
  if (clx.length === 0) {
    invalid('WordDocument has no CLX piece table');
  }

  return {
    table,
    clxOffset: clx.offset,
    clxLength: clx.length,
    counts: {
      body: readLong(3),
      footnotes: readLong(4),
      headers: readLong(5),
      annotations: readLong(7),
      endnotes: readLong(8),
      textboxes: readLong(9),
      headerTextboxes: readLong(10),
    },
    paragraphProperties: optionalPairAt(13),
    listDefinitions: optionalPairAt(73),
    listOverrides: optionalPairAt(74),
  };
};

const openWordDocumentContext = (
  compoundFile: CompoundFile,
  limits: DocLimits,
): WordDocumentContext => {
  const wordDocument = compoundFile.getStream('WordDocument');
  if (!wordDocument) {
    return invalid('Compound File has no WordDocument stream');
  }
  const header = readStoryCounts(compoundFile, wordDocument);

  return {
    wordDocument,
    table: header.table,
    pieces: parsePieceTable(header.table, header.clxOffset, header.clxLength, limits),
    counts: header.counts,
    paragraphProperties: header.paragraphProperties,
    listDefinitions: header.listDefinitions,
    listOverrides: header.listOverrides,
  };
};

const storyRanges = (context: WordDocumentContext): Map<string, { start: number; end: number }> => {
  const maximumCharacterPosition = context.pieces[context.pieces.length - 1]?.end ?? 0;
  const ranges = new Map<string, { start: number; end: number }>();
  const names = ['body', 'footnotes', 'headers', 'annotations', 'endnotes', 'textboxes', 'headerTextboxes'];
  let start = 0;

  for (const name of names) {
    const count = context.counts[name] || 0;
    const end = start + count;
    if (!Number.isSafeInteger(end) || end > maximumCharacterPosition) {
      invalid(`Story ${name} exceeds the piece table`);
    }
    ranges.set(name, { start, end });
    start = end;
  }

  return ranges;
};

const getStoryRange = (
  ranges: Map<string, { start: number; end: number }>,
  name: string,
): { start: number; end: number } => {
  const range = ranges.get(name);
  if (!range) {
    return invalid(`Missing story range for ${name}`);
  }
  return range;
};

export const readDocContent = (
  compoundFile: CompoundFile,
  limits: DocLimits,
  selection: DocStorySelection = {},
): ParsedDocContent => {
  const context = openWordDocumentContext(compoundFile, limits);
  const ranges = storyRanges(context);
  const budget: OutputBudget = { used: 0, maximum: limits.maxOutputChars };
  const paragraphRuns = parseParagraphProperties(
    context.wordDocument,
    context.table,
    context.paragraphProperties,
    limits,
  );
  const listMarkerResolver = createListMarkerResolver(
    context.table,
    context.listDefinitions,
    context.listOverrides,
    limits,
  );
  const bodyRange = getStoryRange(ranges, 'body');
  const headerRange = getStoryRange(ranges, 'headers');
  const footnoteRange = getStoryRange(ranges, 'footnotes');

  return {
    body: extractStoryParagraphs(
      context.wordDocument,
      context.pieces,
      bodyRange.start,
      bodyRange.end,
      paragraphRuns,
      budget,
    ),
    headers: selection.includeHeaders
      ? extractStoryText(context.wordDocument, context.pieces, headerRange.start, headerRange.end, budget)
      : '',
    footnotes: selection.includeFootnotes
      ? extractStoryText(context.wordDocument, context.pieces, footnoteRange.start, footnoteRange.end, budget)
      : '',
    listMarkerResolver,
  };
};

export const readDocStories = (
  compoundFile: CompoundFile,
  limits: DocLimits,
  selection: DocStorySelection = {},
): DocStories => {
  const context = openWordDocumentContext(compoundFile, limits);
  const ranges = storyRanges(context);
  const budget: OutputBudget = { used: 0, maximum: limits.maxOutputChars };
  const stories: DocStories = { body: '', headers: '', footnotes: '' };

  const bodyRange = getStoryRange(ranges, 'body');
  stories.body = extractStoryText(
    context.wordDocument,
    context.pieces,
    bodyRange.start,
    bodyRange.end,
    budget,
  );
  if (selection.includeHeaders) {
    const headerRange = getStoryRange(ranges, 'headers');
    stories.headers = extractStoryText(
      context.wordDocument,
      context.pieces,
      headerRange.start,
      headerRange.end,
      budget,
    );
  }
  if (selection.includeFootnotes) {
    const footnoteRange = getStoryRange(ranges, 'footnotes');
    stories.footnotes = extractStoryText(
      context.wordDocument,
      context.pieces,
      footnoteRange.start,
      footnoteRange.end,
      budget,
    );
  }

  return stories;
};
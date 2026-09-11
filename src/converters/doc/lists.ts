import type { TableReference } from './paragraphs.js';
import type { DocLimits } from './limits.js';
import { DocConversionError } from './errors.js';

const BULLET_NUMBER_FORMAT = 23;
const MAX_LISTS = 4096;
const MAX_LIST_LEVELS = 9;
const MAX_MARKER_TEMPLATE_CHARS = 128;

interface ListLevel {
  startAt: number;
  numberFormat: number;
  template: number[];
}

interface ListDefinition {
  levels: ListLevel[];
}

export interface ListMarker {
  value: string;
  level: number;
  ordered: boolean;
}

export interface ListMarkerResolver {
  markerFor(listId: number | null, level: number): ListMarker | null;
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

const formatRoman = (value: number, upperCase: boolean): string => {
  if (value < 1 || value > 3999) {
    return String(value);
  }
  const symbols: Array<[string, number]> = [
    ['M', 1000], ['CM', 900], ['D', 500], ['CD', 400], ['C', 100], ['XC', 90],
    ['L', 50], ['XL', 40], ['X', 10], ['IX', 9], ['V', 5], ['IV', 4], ['I', 1],
  ];
  let remainder = value;
  let output = '';
  for (const [symbol, amount] of symbols) {
    while (remainder >= amount) {
      output += symbol;
      remainder -= amount;
    }
  }
  return upperCase ? output : output.toLowerCase();
};

const formatAlphabetic = (value: number, upperCase: boolean): string => {
  if (value < 1) {
    return String(value);
  }
  let number = value;
  let output = '';
  while (number > 0) {
    const remainder = (number - 1) % 26;
    output = String.fromCharCode((upperCase ? 65 : 97) + remainder) + output;
    number = Math.floor((number - 1) / 26);
  }
  return output;
};

const formatCounter = (value: number, numberFormat: number): string => {
  if (numberFormat === 1) return formatRoman(value, true);
  if (numberFormat === 2) return formatRoman(value, false);
  if (numberFormat === 3) return formatAlphabetic(value, true);
  if (numberFormat === 4) return formatAlphabetic(value, false);
  return String(value);
};

const parseListDefinitions = (
  table: Buffer,
  reference: TableReference | null,
  limits: DocLimits,
): Map<number, ListDefinition> => {
  if (!reference || reference.length === 0) {
    return new Map();
  }
  assertRange(table, reference.offset, reference.length, 'list table');
  const listCount = readUInt16(table, reference.offset, 'list count');
  const maximumListCount = Math.min(MAX_LISTS, limits.maxPieces);
  if (listCount > maximumListCount) {
    limitExceeded(`Legacy DOC list count exceeds ${maximumListCount}`);
  }
  const headerOffset = reference.offset + 2;
  const headerLength = listCount * 28;
  assertRange(table, headerOffset, headerLength, 'list headers');

  const definitionsById = new Map<number, ListDefinition>();
  let levelOffset = headerOffset + headerLength;

  for (let listIndex = 0; listIndex < listCount; listIndex += 1) {
    const listOffset = headerOffset + (listIndex * 28);
    const listId = readUInt32(table, listOffset, 'list identifier');
    const simpleList = (table[listOffset + 26] & 0x01) === 0x01;
    const levelCount = simpleList ? 1 : MAX_LIST_LEVELS;
    const levels: ListLevel[] = [];

    for (let level = 0; level < levelCount; level += 1) {
      assertRange(table, levelOffset, 28, 'list level header');
      const startAt = table.readInt32LE(levelOffset);
      const numberFormat = table[levelOffset + 4];
      const characterPropertiesLength = table[levelOffset + 24];
      const paragraphPropertiesLength = table[levelOffset + 25];
      const templateLengthOffset = levelOffset + 28 + characterPropertiesLength + paragraphPropertiesLength;
      const templateLength = readUInt16(table, templateLengthOffset, 'list marker template length');
      if (templateLength > MAX_MARKER_TEMPLATE_CHARS) {
        limitExceeded(`Legacy DOC list marker template exceeds ${MAX_MARKER_TEMPLATE_CHARS} characters`);
      }
      const templateOffset = templateLengthOffset + 2;
      assertRange(table, templateOffset, templateLength * 2, 'list marker template');
      const template: number[] = [];
      for (let index = 0; index < templateLength; index += 1) {
        template.push(readUInt16(table, templateOffset + (index * 2), 'list marker template character'));
      }
      levels.push({ startAt: startAt > 0 ? startAt : 1, numberFormat, template });
      levelOffset = templateOffset + (templateLength * 2);
    }
    definitionsById.set(listId, { levels });
  }

  return definitionsById;
};

const resolveListReferences = (
  table: Buffer,
  definitionsById: Map<number, ListDefinition>,
  reference: TableReference | null,
  limits: DocLimits,
): Map<number, ListDefinition> => {
  if (!reference || reference.length === 0) {
    return new Map();
  }
  assertRange(table, reference.offset, reference.length, 'list override table');
  const overrideCount = readUInt32(table, reference.offset, 'list override count');
  const maximumOverrideCount = Math.min(MAX_LISTS, limits.maxPieces);
  if (overrideCount > maximumOverrideCount) {
    limitExceeded(`Legacy DOC list override count exceeds ${maximumOverrideCount}`);
  }
  assertRange(table, reference.offset + 4, overrideCount * 16, 'list overrides');
  const definitions = new Map<number, ListDefinition>();

  for (let index = 0; index < overrideCount; index += 1) {
    const offset = reference.offset + 4 + (index * 16);
    const listId = readUInt32(table, offset, 'list override identifier');
    const definition = definitionsById.get(listId);
    if (definition) {
      definitions.set(index + 1, definition);
    }
  }

  return definitions;
};

export const createListMarkerResolver = (
  table: Buffer,
  listReference: TableReference | null,
  listOverrideReference: TableReference | null,
  limits: DocLimits,
): ListMarkerResolver => {
  const definitionsById = parseListDefinitions(table, listReference, limits);
  const definitions = resolveListReferences(table, definitionsById, listOverrideReference, limits);
  const counters = new Map<number, number[]>();

  return {
    markerFor(listId: number | null, requestedLevel: number): ListMarker | null {
      if (!listId || requestedLevel < 0 || requestedLevel >= MAX_LIST_LEVELS) {
        return null;
      }
      const definition = definitions.get(listId);
      if (!definition) {
        return { value: '*', level: requestedLevel, ordered: false };
      }
      const level = Math.min(requestedLevel, definition.levels.length - 1);
      const levelDefinition = definition.levels[level];
      if (!levelDefinition || levelDefinition.numberFormat === BULLET_NUMBER_FORMAT) {
        return { value: '*', level, ordered: false };
      }

      const values = counters.get(listId) || [];
      values[level] = values[level] === undefined
        ? levelDefinition.startAt
        : values[level] + 1;
      values.length = level + 1;
      counters.set(listId, values);

      const marker = levelDefinition.template
        .map((character) => {
          if (character >= 0 && character < MAX_LIST_LEVELS) {
            const referencedLevel = definition.levels[character] || levelDefinition;
            const value = values[character] ?? referencedLevel.startAt;
            return formatCounter(value, referencedLevel.numberFormat);
          }
          return String.fromCharCode(character);
        })
        .join('');

      return {
        value: marker || `${formatCounter(values[level], levelDefinition.numberFormat)}.`,
        level,
        ordered: true,
      };
    },
  };
};
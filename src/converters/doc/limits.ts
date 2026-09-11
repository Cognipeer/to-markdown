import type { DocOptions } from '../../types/index.js';
import { DocConversionError } from './errors.js';

const DEFAULT_MAX_INPUT_BYTES = 25 * 1024 * 1024;
const MAX_INPUT_BYTES = 50 * 1024 * 1024;
const DEFAULT_MAX_OUTPUT_CHARS = 2_000_000;
const MAX_OUTPUT_CHARS = 4_000_000;

export interface DocLimits {
  maxInputBytes: number;
  maxOutputChars: number;
  maxDirectoryEntries: number;
  maxPieces: number;
}

export const assertDocInputSize = (byteLength: number, limits: Pick<DocLimits, 'maxInputBytes'>): void => {
  if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
    throw new DocConversionError('DOC_INVALID', 'Legacy DOC input size is invalid');
  }
  if (byteLength > limits.maxInputBytes) {
    throw new DocConversionError('DOC_LIMIT_EXCEEDED', `Legacy DOC input exceeds ${limits.maxInputBytes} bytes`);
  }
};

const resolveLimit = (
  value: number | undefined,
  defaultValue: number,
  maximumValue: number,
  name: string,
): number => {
  if (value === undefined) {
    return defaultValue;
  }
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new DocConversionError('DOC_INVALID', `${name} must be a positive integer`);
  }
  if (value > maximumValue) {
    throw new DocConversionError('DOC_LIMIT_EXCEEDED', `${name} cannot exceed ${maximumValue}`);
  }
  return value;
};

export const resolveDocLimits = (options: DocOptions = {}): DocLimits => {
  const maxInputBytes = resolveLimit(
    options.maxInputBytes,
    DEFAULT_MAX_INPUT_BYTES,
    MAX_INPUT_BYTES,
    'legacy DOC maximum input bytes',
  );

  return {
    maxInputBytes,
    maxOutputChars: resolveLimit(
      options.maxOutputChars,
      DEFAULT_MAX_OUTPUT_CHARS,
      MAX_OUTPUT_CHARS,
      'legacy DOC maximum output characters',
    ),
    maxDirectoryEntries: Math.min(16_384, Math.floor(maxInputBytes / 128)),
    maxPieces: Math.min(100_000, Math.floor(maxInputBytes / 12)),
  };
};
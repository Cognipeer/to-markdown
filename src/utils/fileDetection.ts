import { fileTypeFromBuffer } from 'file-type';
import { extension, lookup } from 'mime-types';
import { existsSync, readFileSync, statSync } from 'fs';
import { extname } from 'path';
import type { ConverterInput, ConverterOptions, FileTypeResult } from '../types/index.js';
import { DocConversionError } from '../converters/doc/errors.js';
import { assertDocInputSize, resolveDocLimits } from '../converters/doc/limits.js';

const normalizeExtension = (value?: string): string | null => {
  if (!value) return null;
  const extensionValue = extname(value).toLowerCase();
  return extensionValue || null;
};

const forcedExtension = (options: ConverterOptions): string | null => (
  options.forceExtension?.toLowerCase() || null
);

const configuredExtension = (options: ConverterOptions): string | null => (
  forcedExtension(options) || normalizeExtension(options.fileName)
);

const assertConfiguredDocInputSize = (
  byteLength: number,
  extensionValue: string | null,
  options: ConverterOptions,
): void => {
  if (extensionValue === '.doc') {
    assertDocInputSize(byteLength, resolveDocLimits(options.doc));
  }
};

/**
 * Detects and returns file extension and buffer from various input types
 * @param input - File path, base64 string, or buffer
 * @param options - Converter options
 * @returns Object containing buffer and extension
 */
export async function detectFileType(
  input: ConverterInput,
  options: ConverterOptions = {}
): Promise<{ buffer: Buffer; extension: string }> {
  let fileBuffer: Buffer;
  let ext: string | null = null;

  if (typeof input === 'string') {
    // Handle base64 or data URL
    if (input.startsWith('data:') || /^[A-Za-z0-9+/]+={0,2}$/.test(input)) {
      try {
        const base64Data = input.split('base64,').pop() || input;

        ext = forcedExtension(options);
        if (!ext) {
          const mimeType = input.startsWith('data:')
            ? input.split(';')[0].split(':')[1]
            : lookup(options.fileName || '');
          ext = mimeType ? '.' + extension(mimeType) : normalizeExtension(options.fileName);
        }

        assertConfiguredDocInputSize(Buffer.byteLength(base64Data, 'base64'), ext, options);
        fileBuffer = Buffer.from(base64Data, 'base64');

        if (!ext) {
          const fType = await fileTypeFromBuffer(fileBuffer);
          if (fType) {
            ext = '.' + fType.ext;
          }
        }
      } catch (err: unknown) {
        if (err instanceof DocConversionError) {
          throw err;
        }
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to convert base64: ${message}`);
      }
    } else {
      // Handle file path
      if (!existsSync(input)) {
        throw new Error('File not found: ' + input);
      }

      ext = forcedExtension(options) || extname(input).toLowerCase();
  assertConfiguredDocInputSize(statSync(input).size, ext, options);
      fileBuffer = readFileSync(input);

      if (!ext || ext === '') {
        const fType = await fileTypeFromBuffer(fileBuffer);
        if (fType) {
          ext = '.' + fType.ext;
        } else {
          ext = '.txt';
        }
      }
    }
  } else if (Buffer.isBuffer(input)) {
    fileBuffer = input;
    ext = configuredExtension(options);
    assertConfiguredDocInputSize(fileBuffer.length, ext, options);

    if (!ext || ext === '') {
      const fType = await fileTypeFromBuffer(fileBuffer);
      if (fType) {
        ext = '.' + fType.ext;
      } else {
        ext = '.txt';
      }
    }
  } else {
    throw new Error(
      'Invalid input format. Must be a string (file path or base64) or Buffer'
    );
  }

  if (!ext) ext = '.txt';
  assertConfiguredDocInputSize(fileBuffer.length, ext, options);

  return { buffer: fileBuffer, extension: ext };
}

import { fileTypeFromBuffer } from 'file-type';
import { extension, lookup } from 'mime-types';
import { existsSync, readFileSync } from 'fs';
import { extname } from 'path';
import type { ConverterInput, ConverterOptions, FileTypeResult } from '../types/index.js';

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
        fileBuffer = Buffer.from(base64Data, 'base64');

        const mimeType = input.startsWith('data:')
          ? input.split(';')[0].split(':')[1]
          : lookup(options.fileName || '');

        ext = mimeType ? '.' + extension(mimeType) : null;

        if (!ext) {
          const fType = await fileTypeFromBuffer(fileBuffer);
          if (fType) {
            ext = '.' + fType.ext;
          }
        }
      } catch (err: any) {
        throw new Error(`Failed to convert base64: ${err.message}`);
      }
    } else {
      // Handle file path
      if (!existsSync(input)) {
        throw new Error('File not found: ' + input);
      }

      fileBuffer = readFileSync(input);
      ext = options.forceExtension
        ? options.forceExtension.toLowerCase()
        : extname(input).toLowerCase();

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
    ext = options.forceExtension ? options.forceExtension.toLowerCase() : null;

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

  return { buffer: fileBuffer, extension: ext };
}

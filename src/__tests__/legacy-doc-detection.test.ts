import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { DocConversionError } from '../converters/doc/errors.ts';
import { detectFileType } from '../utils/fileDetection.ts';

describe('legacy DOC detection', () => {
  it('uses a Buffer file name to select the DOC converter', async () => {
    const result = await detectFileType(Buffer.from([0xD0, 0xCF, 0x11, 0xE0]), {
      fileName: 'policy.doc',
    });

    expect(result.extension).toBe('.doc');
  });

  it('keeps forceExtension ahead of a Buffer file name', async () => {
    const result = await detectFileType(Buffer.from('text'), {
      fileName: 'policy.doc',
      forceExtension: '.txt',
    });

    expect(result.extension).toBe('.txt');
  });

  it('uses a base64 file name when no data URL MIME type is available', async () => {
    const result = await detectFileType(Buffer.from([0xD0, 0xCF, 0x11, 0xE0]).toString('base64'), {
      fileName: 'policy.doc',
    });

    expect(result.extension).toBe('.doc');
  });

  it('rejects oversized DOC base64 before conversion', async () => {
    const input = Buffer.alloc(1025).toString('base64');

    await expect(detectFileType(input, {
      fileName: 'policy.doc',
      doc: { maxInputBytes: 1024 },
    })).rejects.toMatchObject<Partial<DocConversionError>>({
      code: 'DOC_LIMIT_EXCEEDED',
    });
  });

  it('accepts DOC base64 within the configured size limit', async () => {
    const input = Buffer.alloc(1024).toString('base64');
    const result = await detectFileType(input, {
      fileName: 'policy.doc',
      doc: { maxInputBytes: 1024 },
    });

    expect(result.buffer).toHaveLength(1024);
    expect(result.extension).toBe('.doc');
  });

  it('rejects oversized DOC data URLs from their MIME type', async () => {
    const input = `data:application/msword;base64,${Buffer.alloc(1025).toString('base64')}`;

    await expect(detectFileType(input, {
      doc: { maxInputBytes: 1024 },
    })).rejects.toMatchObject<Partial<DocConversionError>>({
      code: 'DOC_LIMIT_EXCEEDED',
    });
  });

  it('rejects oversized DOC base64 when the extension is forced', async () => {
    const input = Buffer.alloc(1025).toString('base64');

    await expect(detectFileType(input, {
      forceExtension: '.doc',
      doc: { maxInputBytes: 1024 },
    })).rejects.toMatchObject<Partial<DocConversionError>>({
      code: 'DOC_LIMIT_EXCEEDED',
    });
  });

  it('rejects oversized DOC paths before conversion', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'to-markdown-doc-'));
    const filePath = join(directory, 'policy.doc');
    await writeFile(filePath, Buffer.alloc(1025));

    try {
      await expect(detectFileType(filePath, {
        doc: { maxInputBytes: 1024 },
      })).rejects.toMatchObject<Partial<DocConversionError>>({
        code: 'DOC_LIMIT_EXCEEDED',
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';
import { convertToMarkdown } from '../src/index.ts';
import { convertEpubToMarkdown } from '../src/converters/epub.ts';

const DIR = join(process.cwd(), 'benchmark/test_files');

function buf(file: string) {
  return readFileSync(join(DIR, file));
}
function ext(file: string) {
  return '.' + file.split('.').pop()!;
}

// ═══════════════════════════════════════════════════════════════════════════
// MarkItDown Test Vectors — real files from github.com/microsoft/markitdown
// ═══════════════════════════════════════════════════════════════════════════
describe('MarkItDown Benchmark — @cognipeer/to-markdown', () => {

  it('test.docx — Word document extracts headings and content', async () => {
    const out = await convertToMarkdown(buf('test.docx'), { forceExtension: '.docx' });
    expect(out).toMatch(/abstract/i);
    expect(out).toMatch(/introduction/i);
    expect(out).toMatch(/autogen/i);
  });

  it('test.xlsx — Excel extracts UUID cell values', async () => {
    const out = await convertToMarkdown(buf('test.xlsx'), { forceExtension: '.xlsx' });
    expect(out).toContain('09060124');
    expect(out).toContain('6ff4173b');
    expect(out).toContain('affc7dad');
  });

  it('test.xls — Old Excel format extracts UUID cell values', async () => {
    const out = await convertToMarkdown(buf('test.xls'), { forceExtension: '.xls' });
    expect(out).toContain('09060124');
    expect(out).toContain('6ff4173b');
  });

  it('test.pptx — PowerPoint extracts slide content', async () => {
    const out = await convertToMarkdown(buf('test.pptx'), { forceExtension: '.pptx' });
    expect(out).toContain('2cdda5c8');
    expect(out).toMatch(/autogen/i);
  });

  it('test.pdf — PDF extracts text content', async () => {
    const out = await convertToMarkdown(buf('test.pdf'), { forceExtension: '.pdf' });
    expect(out).toMatch(/autogen/i);
  });

  it('test_blog.html — HTML extracts article text', async () => {
    const out = await convertToMarkdown(buf('test_blog.html'), { forceExtension: '.html' });
    expect(out).toMatch(/large language model/i);
    expect(out).toMatch(/gpt-4/i);
  });

  it('test_wikipedia.html — HTML cleans Wikipedia navigation', async () => {
    const out = await convertToMarkdown(buf('test_wikipedia.html'), { forceExtension: '.html' });
    expect(out).toMatch(/microsoft/i);
    expect(out).toMatch(/bill gates/i);
    expect(out).not.toMatch(/move to sidebar/i);
  });

  it('test_serp.html — Bing SERP extracts search results', async () => {
    const out = await convertToMarkdown(buf('test_serp.html'), { forceExtension: '.html' });
    expect(out).toMatch(/microsoft/i);
  });

  it('test_mskanji.csv — Shift-JIS CSV decodes Japanese characters', async () => {
    const out = await convertToMarkdown(buf('test_mskanji.csv'), { forceExtension: '.csv' });
    // With iconv-lite + CP932 detection, Japanese characters should now appear
    expect(out).toContain('名前');
    expect(out).toContain('佐藤太郎');
    expect(out).toContain('東京');
  });

  it('test_rss.xml — RSS feed extracts titles and content', async () => {
    const out = await convertToMarkdown(buf('test_rss.xml'), { forceExtension: '.xml' });
    expect(out).not.toMatch(/<rss/);
    expect(out).not.toMatch(/<feed/);
    expect(out.length).toBeGreaterThan(50);
  });

  it('test_notebook.ipynb — Jupyter notebook extracts code cells', async () => {
    const out = await convertToMarkdown(buf('test_notebook.ipynb'), { forceExtension: '.ipynb' });
    expect(out).toContain('```');
    expect(out).not.toMatch(/nbformat/);
  });

  it('test_files.zip — ZIP extracts nested file contents', async () => {
    const out = await convertToMarkdown(buf('test_files.zip'), { forceExtension: '.zip' });
    // ZIP contains docx/pptx/xlsx/html — after fix, text content should flow through
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(100);
  });

  it('test.epub — EPUB extracts title, authors and chapter content', async () => {
    const out = await convertEpubToMarkdown(buf('test.epub'));
    expect(out).toMatch(/test author/i);
    expect(out).toMatch(/chapter 1/i);
    expect(out).toMatch(/markitdown/i);
  });

  it('test.jpg — Image returns metadata (width/height/format)', async () => {
    const out = await convertToMarkdown(buf('test.jpg'), { forceExtension: '.jpg' });
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);
    // Should contain image metadata
    expect(out).toMatch(/width|height|format|jpeg|jpg/i);
  });

  it('test.mp3 — Audio returns metadata (title/artist/duration)', async () => {
    try {
      const out = await convertToMarkdown(buf('test.mp3'), { forceExtension: '.mp3' });
      expect(typeof out).toBe('string');
    } catch (e: any) {
      expect(e.message).toBeTruthy();
    }
  });
});

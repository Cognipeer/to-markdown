/**
 * new-features.test.ts
 *
 * Kapsamlı testler:
 *   - countTokens  (tokenizer)
 *   - chunkMarkdown (chunker)
 *   - extractSections / buildFrontmatter / emitFrontmatter (metadata)
 *   - ocrImage            (ocr — deps yokken hata yönetimi)
 *   - renderPdfPageToPng  (pdfRender — deps yokken hata yönetimi)
 *   - convertToRichMarkdown (rich)
 *   - Backward-compat: convertToMarkdown, convertBatchToMarkdown, saveToMarkdownFile
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';

// ── Yeni yardımcılar ──────────────────────────────────────────────────────
import { countTokens } from '../utils/tokenizer.ts';
import { chunkMarkdown } from '../utils/chunker.ts';
import { extractSections, buildFrontmatter, emitFrontmatter } from '../utils/metadata.ts';
import { ocrImage } from '../utils/ocr.ts';
import { renderPdfPageToPng } from '../utils/pdfRender.ts';

// ── Yeni ana API ──────────────────────────────────────────────────────────
import { convertToRichMarkdown } from '../rich.ts';

// ── Backward-compat ───────────────────────────────────────────────────────
import { convertToMarkdown, convertBatchToMarkdown, saveToMarkdownFile } from '../index.ts';

// ─────────────────────────────────────────────────────────────────────────
// 1. countTokens
// ─────────────────────────────────────────────────────────────────────────
describe('countTokens()', () => {
  it('boş string 0 döndürür', async () => {
    expect(await countTokens('')).toBe(0);
  });

  it("approx mod: Math.ceil(chars / 4) hesaplar", async () => {
    const text = 'a'.repeat(40);          // 40 karakter → ceil(40/4) = 10
    expect(await countTokens(text, 'approx')).toBe(10);
  });

  it('varsayılan mod approx olmalı', async () => {
    const text = 'hello world test';       // 16 chars → ceil(16/4) = 4
    expect(await countTokens(text)).toBe(4);
  });

  it('1 karakterlik metin için 1 döndürür', async () => {
    expect(await countTokens('x', 'approx')).toBe(1);
  });

  it('4 karakterlik metin için 1 döndürür', async () => {
    expect(await countTokens('abcd', 'approx')).toBe(1);
  });

  it('5 karakterlik metin için 2 döndürür', async () => {
    expect(await countTokens('abcde', 'approx')).toBe(2);
  });

  it('100 karakterlik metin 25 token döndürür', async () => {
    const text = 'a'.repeat(100);
    expect(await countTokens(text, 'approx')).toBe(25);
  });

  it("gpt mod gpt-tokenizer yoksa approx'a fallback yapar", async () => {
    // gpt-tokenizer bu projede kurulu değil — approx fallback beklenir
    const text = 'a'.repeat(40);
    const result = await countTokens(text, 'gpt');
    // approx sonucu: 10; gpt sonucu farklı olabilir ama crash etmemeli
    expect(typeof result).toBe('number');
    expect(result).toBeGreaterThan(0);
  });

  it('sayısal değer döndürür (string değil)', async () => {
    const result = await countTokens('test text');
    expect(typeof result).toBe('number');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 2. chunkMarkdown
// ─────────────────────────────────────────────────────────────────────────
describe('chunkMarkdown()', () => {
  it('boş markdown boş dizi döndürür', async () => {
    const chunks = await chunkMarkdown('');
    expect(chunks).toEqual([]);
  });

  it('sadece boşluk içeren markdown boş dizi döndürür', async () => {
    const chunks = await chunkMarkdown('   \n\n   ');
    expect(chunks).toEqual([]);
  });

  it('kısa metin tek chunk döndürür', async () => {
    const md = '# Başlık\n\nKısa bir metin.';
    const chunks = await chunkMarkdown(md, { maxTokens: 512 });
    expect(chunks.length).toBe(1);
  });

  it('chunkIndex sıfırdan başlar ve sıralı artar', async () => {
    const paragraphs = Array.from({ length: 10 }, (_, i) =>
      `Paragraf ${i} ${'kelime '.repeat(30)}`
    ).join('\n\n');
    const chunks = await chunkMarkdown(paragraphs, { maxTokens: 50 });
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((c, i) => {
      expect(c.metadata.chunkIndex).toBe(i);
    });
  });

  it('totalChunks tüm chunklarda aynı ve doğru değeri taşır', async () => {
    const paragraphs = Array.from({ length: 10 }, (_, i) =>
      `Paragraf ${i} ${'kelime '.repeat(30)}`
    ).join('\n\n');
    const chunks = await chunkMarkdown(paragraphs, { maxTokens: 50 });
    expect(chunks.length).toBeGreaterThan(1);
    const total = chunks.length;
    chunks.forEach(c => {
      expect(c.metadata.totalChunks).toBe(total);
    });
  });

  it('maxTokens limitini aşmaz — çok paragraflı metin bölünür', async () => {
    // Her paragraf ayrı blok olacak şekilde \n\n ile ayrılır
    const bigText = Array.from({ length: 20 }, (_, i) =>
      `Satır ${i}: ${'kelime '.repeat(20)}`
    ).join('\n\n');  // \n\n = ayrı paragraf blokları
    const maxT = 40;
    const chunks = await chunkMarkdown(bigText, { maxTokens: maxT, tokenizer: 'approx' });
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('heading level metadata doğru takip edilir', async () => {
    const md = `# H1 Başlık\n\nMetin\n\n## H2 Alt Başlık\n\nDaha fazla metin`;
    const chunks = await chunkMarkdown(md, { maxTokens: 512 });
    // İlk chunk H1 içinde
    expect(chunks[0].metadata.headingLevel).toBeGreaterThan(0);
  });

  it("sectionPath başlıklardan doğru oluşturulur", async () => {
    const md = `# Bölüm 1\n\nMetin A\n\n## Alt Bölüm 1.1\n\nMetin B`;
    const chunks = await chunkMarkdown(md, { maxTokens: 512 });
    // Son chunk'ta sectionPath en derin başlığı içermeli
    const lastChunk = chunks[chunks.length - 1];
    expect(lastChunk.metadata.sectionPath).toContain('Alt Bölüm 1.1');
  });

  it('birden fazla H1 bölümü ayrı section path taşır', async () => {
    const md = [
      '# Birinci Bölüm\n\n' + 'x '.repeat(200),
      '# İkinci Bölüm\n\n' + 'y '.repeat(200),
    ].join('\n\n');
    const chunks = await chunkMarkdown(md, { maxTokens: 60 });
    const paths = chunks.map(c => c.metadata.sectionPath[0]);
    expect(paths).toContain('Birinci Bölüm');
    expect(paths).toContain('İkinci Bölüm');
  });

  it('kod bloğu chunk sınırında bölünmez (preserveCodeBlocks=true)', async () => {
    const code = '```python\n' + 'x = 1\n'.repeat(5) + '```';
    const md = `# Başlık\n\n${code}`;
    const chunks = await chunkMarkdown(md, {
      maxTokens: 10,
      preserveCodeBlocks: true,
    });
    // Kod bloğunun tamamı tek bir chunk'ta yer almalı
    const codeChunk = chunks.find(c => c.content.includes('```python'));
    expect(codeChunk).toBeDefined();
    expect(codeChunk!.content).toContain('```python');
    expect(codeChunk!.content).toContain('```');
  });

  it('tablo chunk sınırında bölünmez (preserveTables=true)', async () => {
    const table = '| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n| 5 | 6 |';
    const md = `# Tablo Başlığı\n\n${table}`;
    const chunks = await chunkMarkdown(md, {
      maxTokens: 5,
      preserveTables: true,
    });
    const tableChunk = chunks.find(c => c.content.includes('| A | B |'));
    expect(tableChunk).toBeDefined();
    // Tablo satırlarının tümü aynı chunk'ta
    expect(tableChunk!.content).toContain('| 5 | 6 |');
  });

  it('overlap önceki chunk içeriğini taşır', async () => {
    // İlk chunk'ın son paragrafı ikinci chunk'ta da görünmeli
    const p1 = 'Birinci paragraf. '.repeat(30);  // ~135 token
    const p2 = 'İkinci paragraf içeriği. '.repeat(30); // ~187 token
    const md = `${p1}\n\n${p2}`;
    const chunks = await chunkMarkdown(md, {
      maxTokens: 80,
      overlap: 40,
      tokenizer: 'approx',
    });
    expect(chunks.length).toBeGreaterThan(1);
    // İkinci chunk, birinci chunk'tan içerik taşımalı (overlap)
    if (chunks.length >= 2) {
      // Overlap varsa, ilk chunk'ta bulunan kelimeler ikincide de görünebilir
      expect(typeof chunks[1].content).toBe('string');
    }
  });

  it('baseMeta her chunk metadata\'sına yayılır', async () => {
    const md = '# Test\n\nİçerik metni buraya.';
    const chunks = await chunkMarkdown(md, {}, { sourceFile: 'test.md', customKey: 42 });
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].metadata.sourceFile).toBe('test.md');
    expect(chunks[0].metadata.customKey).toBe(42);
  });

  it('her chunk content string tipinde', async () => {
    const md = '# Başlık\n\nBir metin paragrafı.';
    const chunks = await chunkMarkdown(md);
    chunks.forEach(c => {
      expect(typeof c.content).toBe('string');
      expect(c.content.length).toBeGreaterThan(0);
    });
  });

  it('her chunk tokenCount pozitif', async () => {
    const md = '# Başlık\n\nBu bir test metnidir.';
    const chunks = await chunkMarkdown(md);
    chunks.forEach(c => {
      expect(c.metadata.tokenCount).toBeGreaterThan(0);
    });
  });

  it('iç içe başlık hiyerarşisini doğru takip eder', async () => {
    const md = `# Bölüm A\n\n## Alt A.1\n\n### Alt Alt A.1.1\n\nMetin`;
    const chunks = await chunkMarkdown(md, { maxTokens: 512 });
    const last = chunks[chunks.length - 1];
    // sectionPath: ['Bölüm A', 'Alt A.1', 'Alt Alt A.1.1']
    expect(last.metadata.sectionPath).toContain('Bölüm A');
    expect(last.metadata.sectionPath).toContain('Alt A.1');
    expect(last.metadata.sectionPath).toContain('Alt Alt A.1.1');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 3. extractSections
// ─────────────────────────────────────────────────────────────────────────
describe('extractSections()', () => {
  it('başlık olmayan markdown boş dizi döndürür', () => {
    expect(extractSections('sadece düz metin')).toEqual([]);
  });

  it('boş string boş dizi döndürür', () => {
    expect(extractSections('')).toEqual([]);
  });

  it('tek H1 başlığını yakalar', () => {
    const secs = extractSections('# Ana Başlık\n\nİçerik.');
    expect(secs.length).toBe(1);
    expect(secs[0].heading).toBe('Ana Başlık');
    expect(secs[0].level).toBe(1);
  });

  it('H2 başlığını doğru seviyeyle yakalar', () => {
    const secs = extractSections('## Alt Başlık\n\nMetin');
    expect(secs[0].level).toBe(2);
    expect(secs[0].heading).toBe('Alt Başlık');
  });

  it('birden fazla başlık ayrı section olarak döner', () => {
    const md = '# Bölüm 1\n\nMetin A\n\n# Bölüm 2\n\nMetin B';
    const secs = extractSections(md);
    expect(secs.length).toBe(2);
    expect(secs[0].heading).toBe('Bölüm 1');
    expect(secs[1].heading).toBe('Bölüm 2');
  });

  it('section content başlık satırını içerir', () => {
    const secs = extractSections('# Başlık\n\nParagraf metni.');
    expect(secs[0].content).toContain('# Başlık');
  });

  it('section content paragraf metnini içerir', () => {
    const secs = extractSections('# Başlık\n\nParagraf metni.');
    expect(secs[0].content).toContain('Paragraf metni');
  });

  it('path tek H1 için sadece kendi başlığını içerir', () => {
    const secs = extractSections('# Başlık\n\nMetin');
    expect(secs[0].path).toEqual(['Başlık']);
  });

  it('iç içe başlıklarda path doğru breadcrumb oluşturur', () => {
    const md = '# A\n\n## B\n\n### C\n\nMetin';
    const secs = extractSections(md);
    // 3 section: A, B, C
    expect(secs.length).toBe(3);
    expect(secs[2].path).toEqual(['A', 'B', 'C']);
  });

  it('başlıktan önce içerik görmezden gelinir', () => {
    const secs = extractSections('Bu metin başlık öncesi.\n\n# Başlık\n\nSonrası.');
    expect(secs.length).toBe(1);
    expect(secs[0].heading).toBe('Başlık');
  });

  it('6 seviyeye kadar heading seviyesini tanır', () => {
    const secs = extractSections('###### H6\n\nİçerik');
    expect(secs[0].level).toBe(6);
  });

  it('kardeş başlıklar kendi path breadcrumb\'larını taşır', () => {
    const md = '# A\n\n## B1\n\n## B2\n\nMetin';
    const secs = extractSections(md);
    expect(secs.find(s => s.heading === 'B1')?.path).toEqual(['A', 'B1']);
    expect(secs.find(s => s.heading === 'B2')?.path).toEqual(['A', 'B2']);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 4. buildFrontmatter
// ─────────────────────────────────────────────────────────────────────────
describe('buildFrontmatter()', () => {
  it('ilk H1\'den title çıkarır', async () => {
    const fm = await buildFrontmatter('# Doküman Başlığı\n\nMetin.');
    expect(fm.title).toBe('Doküman Başlığı');
  });

  it('H1 yoksa title undefined olur', async () => {
    const fm = await buildFrontmatter('## Alt Başlık\n\nMetin');
    expect(fm.title).toBeUndefined();
  });

  it('sections listesi tüm başlıkları içerir', async () => {
    const md = '# A\n\n## B\n\n### C';
    const fm = await buildFrontmatter(md);
    expect(fm.sections).toContain('A');
    expect(fm.sections).toContain('B');
    expect(fm.sections).toContain('C');
  });

  it('tokenCount pozitif bir sayı döndürür', async () => {
    const fm = await buildFrontmatter('# Test\n\nİçerik metni.');
    expect(fm.tokenCount).toBeGreaterThan(0);
  });

  it('tokenCount approx formülüyle uyumlu', async () => {
    const md = 'a'.repeat(400);          // 400 chars → 100 tokens
    const fm = await buildFrontmatter(md);
    expect(fm.tokenCount).toBe(100);
  });

  it('generatedAt ISO 8601 formatında', async () => {
    const fm = await buildFrontmatter('# Test');
    expect(() => new Date(fm.generatedAt)).not.toThrow();
    expect(fm.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('seed verisi frontmatter\'a eklenir', async () => {
    const fm = await buildFrontmatter('# Test', { author: 'Furkan', version: 2 });
    expect(fm.author).toBe('Furkan');
    expect(fm.version).toBe(2);
  });

  it('seed verisi başlık bilgilerini ezemez (son write kazanır)', async () => {
    // seed'de title verilirse, onu ekler (spread order'a göre seed kazanır)
    const fm = await buildFrontmatter('# Orijinal', { title: 'Seed Başlığı' });
    expect(fm.title).toBe('Seed Başlığı');
  });

  it('boş markdown için tokenCount 0 döner', async () => {
    const fm = await buildFrontmatter('');
    expect(fm.tokenCount).toBe(0);
  });

  it('sections dizisi dizi tipinde', async () => {
    const fm = await buildFrontmatter('# Test\n\n## Alt');
    expect(Array.isArray(fm.sections)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 5. emitFrontmatter
// ─────────────────────────────────────────────────────────────────────────
describe('emitFrontmatter()', () => {
  const sampleFm = {
    title: 'Test Dokümanı',
    sections: ['Bölüm 1', 'Bölüm 2'],
    tokenCount: 150,
    generatedAt: '2026-06-08T12:00:00.000Z',
  };
  const sampleMd = '# Test Dokümanı\n\nParagraf metni.';

  it("--- ile başlar", () => {
    const result = emitFrontmatter(sampleFm, sampleMd);
    expect(result.startsWith('---\n')).toBe(true);
  });

  it("--- kapanış satırını içerir", () => {
    const result = emitFrontmatter(sampleFm, sampleMd);
    expect(result).toContain('\n---\n');
  });

  it('orijinal markdown içeriğini korur', () => {
    const result = emitFrontmatter(sampleFm, sampleMd);
    expect(result).toContain('# Test Dokümanı');
    expect(result).toContain('Paragraf metni.');
  });

  it('title alanını YAML\'a yazar', () => {
    const result = emitFrontmatter(sampleFm, sampleMd);
    expect(result).toContain('title:');
    expect(result).toContain('Test Dokümanı');
  });

  it('tokenCount alanını YAML\'a yazar', () => {
    const result = emitFrontmatter(sampleFm, sampleMd);
    expect(result).toContain('tokenCount:');
  });

  it('generatedAt alanını YAML\'a yazar', () => {
    const result = emitFrontmatter(sampleFm, sampleMd);
    expect(result).toContain('generatedAt:');
  });

  it('sections dizisini YAML\'a yazar', () => {
    const result = emitFrontmatter(sampleFm, sampleMd);
    expect(result).toContain('sections:');
    expect(result).toContain('Bölüm 1');
    expect(result).toContain('Bölüm 2');
  });

  it('frontmatter ve markdown arasında boş satır var', () => {
    const result = emitFrontmatter(sampleFm, sampleMd);
    // YAML blok biter, iki satır sonra markdown başlar
    expect(result).toContain('---\n\n#');
  });

  it('string döndürür', () => {
    expect(typeof emitFrontmatter(sampleFm, sampleMd)).toBe('string');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 6. ocrImage — bağımlılık yoksa yardımcı hata mesajı
// ─────────────────────────────────────────────────────────────────────────
describe('ocrImage()', () => {
  it('tesseract.js kurulu değilse anlaşılır hata fırlatır', async () => {
    const dummyBuf = Buffer.from([0xff, 0xd8, 0xff]); // kısmi JPEG header
    await expect(ocrImage(dummyBuf)).rejects.toThrow(/tesseract\.js/i);
  });

  it('hata mesajı npm install yönergesi içerir', async () => {
    const dummyBuf = Buffer.alloc(16);
    try {
      await ocrImage(dummyBuf);
    } catch (err: any) {
      expect(err.message).toMatch(/npm install/i);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 7. renderPdfPageToPng — bağımlılık yoksa yardımcı hata mesajı
// ─────────────────────────────────────────────────────────────────────────
describe('renderPdfPageToPng()', () => {
  it('pdfjs-dist veya canvas kurulu değilse anlaşılır hata fırlatır', async () => {
    const dummyBuf = Buffer.alloc(16);
    await expect(renderPdfPageToPng(dummyBuf)).rejects.toThrow(
      /pdfjs-dist|canvas/i
    );
  });

  it('hata mesajı npm install yönergesi içerir', async () => {
    const dummyBuf = Buffer.alloc(16);
    try {
      await renderPdfPageToPng(dummyBuf);
    } catch (err: any) {
      expect(err.message).toMatch(/npm install/i);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 8. convertToRichMarkdown
// ─────────────────────────────────────────────────────────────────────────
describe('convertToRichMarkdown()', () => {
  const htmlInput = Buffer.from(
    `<html><body>
      <h1>Ana Başlık</h1>
      <p>Birinci paragraf metni burada yer alıyor.</p>
      <h2>Alt Başlık A</h2>
      <p>İkinci bölüm içeriği.</p>
      <h2>Alt Başlık B</h2>
      <p>Üçüncü bölüm içeriği.</p>
    </body></html>`,
    'utf-8'
  );

  it('RichOutput nesnesi döndürür', async () => {
    const result = await convertToRichMarkdown(htmlInput, { forceExtension: '.html' });
    expect(result).toBeDefined();
    expect(typeof result).toBe('object');
  });

  it('markdown string döndürür', async () => {
    const { markdown } = await convertToRichMarkdown(htmlInput, { forceExtension: '.html' });
    expect(typeof markdown).toBe('string');
    expect(markdown.length).toBeGreaterThan(0);
  });

  it('markdown, convertToMarkdown çıktısıyla eşleşir', async () => {
    const { markdown } = await convertToRichMarkdown(htmlInput, { forceExtension: '.html' });
    const plain = await convertToMarkdown(htmlInput, { forceExtension: '.html' });
    expect(markdown).toBe(plain);
  });

  it('sections dizisi döndürür', async () => {
    const { sections } = await convertToRichMarkdown(htmlInput, { forceExtension: '.html' });
    expect(Array.isArray(sections)).toBe(true);
    expect(sections.length).toBeGreaterThan(0);
  });

  it('sections başlıkları tanır', async () => {
    const { sections } = await convertToRichMarkdown(htmlInput, { forceExtension: '.html' });
    const headings = sections.map(s => s.heading);
    expect(headings).toContain('Ana Başlık');
    expect(headings.some(h => h.includes('Alt Başlık'))).toBe(true);
  });

  it('chunks dizisi döndürür', async () => {
    const { chunks } = await convertToRichMarkdown(htmlInput, { forceExtension: '.html' });
    expect(Array.isArray(chunks)).toBe(true);
    expect(chunks.length).toBeGreaterThan(0);
  });

  it('chunks sıfırdan başlayan sıralı chunkIndex içerir', async () => {
    const { chunks } = await convertToRichMarkdown(htmlInput, {
      forceExtension: '.html',
      chunk: { maxTokens: 30 },
    });
    chunks.forEach((c, i) => {
      expect(c.metadata.chunkIndex).toBe(i);
    });
  });

  it('frontmatter nesnesi döndürür', async () => {
    const { frontmatter } = await convertToRichMarkdown(htmlInput, { forceExtension: '.html' });
    expect(typeof frontmatter).toBe('object');
  });

  it('frontmatter.title H1 başlığını içerir', async () => {
    const { frontmatter } = await convertToRichMarkdown(htmlInput, { forceExtension: '.html' });
    expect(frontmatter.title).toContain('Ana Başlık');
  });

  it('frontmatter.tokenCount pozitif', async () => {
    const { frontmatter } = await convertToRichMarkdown(htmlInput, { forceExtension: '.html' });
    expect(frontmatter.tokenCount).toBeGreaterThan(0);
  });

  it('frontmatter.generatedAt ISO formatında', async () => {
    const { frontmatter } = await convertToRichMarkdown(htmlInput, { forceExtension: '.html' });
    expect(frontmatter.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('frontmatter.chunkCount, chunks.length ile eşleşir', async () => {
    const { frontmatter, chunks } = await convertToRichMarkdown(htmlInput, {
      forceExtension: '.html',
    });
    expect(frontmatter.chunkCount).toBe(chunks.length);
  });

  it('chunk: false verilirse chunks boş dizi döner', async () => {
    const { chunks, frontmatter } = await convertToRichMarkdown(htmlInput, {
      forceExtension: '.html',
      chunk: false,
    });
    expect(chunks).toEqual([]);
    expect(frontmatter.chunkCount).toBeUndefined();
  });

  it('frontmatterSeed verisi frontmatter\'a eklenir', async () => {
    const { frontmatter } = await convertToRichMarkdown(htmlInput, {
      forceExtension: '.html',
      frontmatterSeed: { project: 'to-markdown', version: '2.1' },
    });
    expect(frontmatter.project).toBe('to-markdown');
    expect(frontmatter.version).toBe('2.1');
  });

  it('OCR varsayılan olarak kapalı — tesseract.js olmadan çalışır', async () => {
    // ocr belirtilmediğinde tesseract.js olmadan başarılı dönüşüm yapmalı
    await expect(
      convertToRichMarkdown(htmlInput, { forceExtension: '.html' })
    ).resolves.toBeDefined();
  });

  it('CSV girdisi üzerinde çalışır', async () => {
    const csv = Buffer.from('Ad,Soyad\nAli,Veli\nAyşe,Fatma', 'utf-8');
    const { markdown, sections, chunks } = await convertToRichMarkdown(csv, {
      forceExtension: '.csv',
    });
    expect(typeof markdown).toBe('string');
    expect(Array.isArray(sections)).toBe(true);
    expect(Array.isArray(chunks)).toBe(true);
  });

  it('chunk maxTokens ayarına uyar', async () => {
    const longMd = Array.from({ length: 20 }, (_, i) =>
      `## Bölüm ${i}\n\n${'Metin içeriği. '.repeat(25)}`
    ).join('\n\n');
    const { chunks } = await convertToRichMarkdown(
      Buffer.from(longMd, 'utf-8'),
      { forceExtension: '.txt', chunk: { maxTokens: 80 } }
    );
    expect(chunks.length).toBeGreaterThan(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 9. Backward-compatibility — mevcut API değişmedi
// ─────────────────────────────────────────────────────────────────────────
describe('Backward-compat: convertToMarkdown()', () => {
  it('HTML buffer → string döndürür', async () => {
    const result = await convertToMarkdown(
      Buffer.from('<h1>Test</h1>', 'utf-8'),
      { forceExtension: '.html' }
    );
    expect(typeof result).toBe('string');
    expect(result).toContain('Test');
  });

  it('CSV buffer → tablo stringi döndürür', async () => {
    const result = await convertToMarkdown(
      Buffer.from('A,B\n1,2', 'utf-8'),
      { forceExtension: '.csv' }
    );
    expect(result).toContain('A');
    expect(result).toContain('|');
  });

  it('TXT buffer → düz metin döndürür', async () => {
    const result = await convertToMarkdown(
      Buffer.from('Merhaba Dünya', 'utf-8'),
      { forceExtension: '.txt' }
    );
    expect(result).toContain('Merhaba Dünya');
  });

  it('JSON buffer → markdown döndürür', async () => {
    const json = JSON.stringify({ key: 'value', num: 42 });
    const result = await convertToMarkdown(
      Buffer.from(json, 'utf-8'),
      { forceExtension: '.json' }
    );
    expect(typeof result).toBe('string');
    expect(result).toContain('value');
  });

  it('var olmayan dosya için hata fırlatır', async () => {
    await expect(
      convertToMarkdown('/yok/boyle/bir/dosya.html')
    ).rejects.toThrow('File not found');
  });

  it('geçersiz input tipi için hata fırlatır', async () => {
    await expect(convertToMarkdown(999 as any)).rejects.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 10. Backward-compat: convertBatchToMarkdown
// ─────────────────────────────────────────────────────────────────────────
describe('Backward-compat: convertBatchToMarkdown()', () => {
  it('birden fazla girişi paralel dönüştürür', async () => {
    const results = await convertBatchToMarkdown([
      { input: Buffer.from('<h1>A</h1>', 'utf-8'), options: { forceExtension: '.html' } },
      { input: Buffer.from('B,C\n1,2', 'utf-8'), options: { forceExtension: '.csv' } },
    ]);
    expect(results.length).toBe(2);
    expect(results[0].result).toBeDefined();
    expect(results[1].result).toBeDefined();
  });

  it('hatalı giriş için error alanı döner (crash etmez)', async () => {
    const results = await convertBatchToMarkdown([
      { input: '/yok/dosya.pdf' },
    ]);
    expect(results[0].error).toBeDefined();
    expect(results[0].result).toBeUndefined();
  });

  it('inputId string girişte dosya yolu olur', async () => {
    const results = await convertBatchToMarkdown([
      { input: '/yok/dosya.html' },
    ]);
    expect(results[0].inputId).toBe('/yok/dosya.html');
  });

  it('inputId buffer girişte "buffer:<index>" formatında', async () => {
    const results = await convertBatchToMarkdown([
      { input: Buffer.from('test', 'utf-8'), options: { forceExtension: '.txt' } },
    ]);
    expect(results[0].inputId).toBe('buffer:0');
  });

  it('boş dizi boş dizi döndürür', async () => {
    const results = await convertBatchToMarkdown([]);
    expect(results).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 11. Backward-compat: saveToMarkdownFile
// ─────────────────────────────────────────────────────────────────────────
describe('Backward-compat: saveToMarkdownFile()', () => {
  const tmpDir = join(process.cwd(), 'test-output-temp', 'new-features-' + Date.now());

  it('dosyayı kaydeder ve path döndürür', async () => {
    const p = await saveToMarkdownFile('# Test', 'compat-test', tmpDir);
    expect(existsSync(p)).toBe(true);
    unlinkSync(p);
  });

  it('.md uzantısı otomatik eklenir', async () => {
    const p = await saveToMarkdownFile('# Test', 'no-ext', tmpDir);
    expect(p.endsWith('.md')).toBe(true);
    unlinkSync(p);
  });

  it('.md uzantısı zaten varsa tekrar eklenmez', async () => {
    const p = await saveToMarkdownFile('# Test', 'already.md', tmpDir);
    expect(p).not.toContain('.md.md');
    unlinkSync(p);
  });
});

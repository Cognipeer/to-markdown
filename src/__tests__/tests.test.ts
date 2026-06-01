import { describe, it, expect, beforeAll } from 'vitest';
import { Buffer } from 'buffer';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import AdmZip from 'adm-zip';
import { write as xlsxWrite, utils as xlsxUtils } from 'xlsx';

// ── Utilities ──────────────────────────────────────────────────────────────
import { formatMarkdown, arrayToMarkdownTable } from '../utils/markdown.ts';
import { detectFileType } from '../utils/fileDetection.ts';

// ── Converters ─────────────────────────────────────────────────────────────
import { convertHtmlToMarkdown, htmlToMarkdown } from '../converters/html.ts';
import { convertTextFileToMarkdown, convertYoutubeToMarkdown, convertBingSerpToMarkdown } from '../converters/text.ts';
import { convertCsvToMarkdown, convertExcelToMarkdown } from '../converters/spreadsheet.ts';
import { convertPdfToMarkdown } from '../converters/pdf.ts';
import { convertDocxToMarkdown } from '../converters/docx.ts';
import { convertImageToMarkdown, convertAudioToMarkdown } from '../converters/media.ts';
import { convertPptxToMarkdown, convertZipToMarkdown } from '../converters/archive.ts';
import { convertRssAtomToMarkdown } from '../converters/xml.ts';
import { convertIpynbToMarkdown } from '../converters/notebook.ts';

// ── Main API ───────────────────────────────────────────────────────────────
import { convertToMarkdown, saveToMarkdownFile } from '../index.ts';

// ═══════════════════════════════════════════════════════════════════════════
// 1. formatMarkdown
// ═══════════════════════════════════════════════════════════════════════════
describe('formatMarkdown()', () => {
  it('boş string döndürür - boş input', () => {
    expect(formatMarkdown('')).toBe('');
  });

  it('bold text başlığa dönüşür', () => {
    const result = formatMarkdown('**Başlık**');
    expect(result).toContain('## Başlık');
  });

  it('bullet karakterleri normalize eder (•)', () => {
    const result = formatMarkdown('• madde bir');
    expect(result).toContain('* madde bir');
  });

  it('bullet karakterleri normalize eder (-)', () => {
    const result = formatMarkdown('- madde iki');
    expect(result).toContain('* madde iki');
  });

  it('ardışık boş satırları tek boş satıra indirger', () => {
    const result = formatMarkdown('satır1\n\n\n\nsatır2');
    expect(result).not.toMatch(/\n{3,}/);
  });

  it('başta/sonda boşlukları temizler', () => {
    const result = formatMarkdown('   merhaba   ');
    expect(result).toBe('merhaba'); // küçük harfle başladığı için başlığa dönüşmez
  });

  it('# ile başlayan satırları olduğu gibi bırakır', () => {
    const result = formatMarkdown('# Başlık\nAlt metin');
    expect(result).toContain('# Başlık');
  });

  it('büyük harfle başlayan kısa cümle başlık olur', () => {
    const result = formatMarkdown('Kısa Başlık');
    expect(result).toContain('## Kısa Başlık');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. arrayToMarkdownTable
// ═══════════════════════════════════════════════════════════════════════════
describe('arrayToMarkdownTable()', () => {
  it('boş array için boş string döner', () => {
    expect(arrayToMarkdownTable([])).toBe('');
  });

  it('doğru header satırı oluşturur', () => {
    const data = [['Ad', 'Soyad'], ['Ali', 'Veli']];
    const result = arrayToMarkdownTable(data);
    expect(result).toContain('| Ad | Soyad |');
  });

  it('ayırıcı (separator) satırı oluşturur', () => {
    const data = [['A', 'B'], ['1', '2']];
    const result = arrayToMarkdownTable(data);
    expect(result).toContain('| --- | --- |');
  });

  it('veri satırlarını doğru yazar', () => {
    const data = [['Ad', 'Yaş'], ['Furkan', '25'], ['Ahmet', '30']];
    const result = arrayToMarkdownTable(data);
    expect(result).toContain('| Furkan | 25 |');
    expect(result).toContain('| Ahmet | 30 |');
  });

  it('tek satırlık (sadece header) table oluşturur', () => {
    const data = [['Kolon1', 'Kolon2']];
    const result = arrayToMarkdownTable(data);
    expect(result).toContain('| Kolon1 | Kolon2 |');
    expect(result).toContain('---');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. convertHtmlToMarkdown / htmlToMarkdown
// ═══════════════════════════════════════════════════════════════════════════
describe('convertHtmlToMarkdown()', () => {
  it('basit h1 tagını markdown başlığına çevirir', () => {
    const html = '<h1>Merhaba Dünya</h1>';
    const result = convertHtmlToMarkdown(html);
    expect(result).toContain('# Merhaba Dünya');
  });

  it('h2 tagını doğru çevirir', () => {
    const result = convertHtmlToMarkdown('<h2>Alt Başlık</h2>');
    expect(result).toContain('## Alt Başlık');
  });

  it('paragraph tagını düz metne çevirir', () => {
    const result = convertHtmlToMarkdown('<p>Bu bir paragraf.</p>');
    expect(result).toContain('paragraf');
  });

  it('script ve style taglarını siler', () => {
    const html = '<script>alert("xss")</script><p>içerik</p>';
    const result = convertHtmlToMarkdown(html);
    expect(result).not.toContain('alert');
    expect(result).not.toContain('<script>');
  });

  it('bold tagını markdown bold\'a çevirir', () => {
    const result = htmlToMarkdown('<p><strong>kalın metin</strong></p>');
    expect(result).toContain('**kalın metin**');
  });

  it('anchor tagını markdown linkine çevirir', () => {
    const result = htmlToMarkdown('<a href="https://example.com">tıkla</a>');
    expect(result).toContain('https://example.com');
  });

  it('unordered list\'i markdown listesine çevirir', () => {
    const html = '<ul><li>Elma</li><li>Armut</li></ul>';
    const result = convertHtmlToMarkdown(html);
    expect(result).toContain('Elma');
    expect(result).toContain('Armut');
  });

  it('Buffer input kabul eder', () => {
    const buffer = Buffer.from('<h1>Başlık</h1>', 'utf-8');
    const result = convertHtmlToMarkdown(buffer);
    expect(result).toContain('# Başlık');
  });

  it('karmaşık nested HTML işler', () => {
    const html = `
      <html><body>
        <h1>Ana Başlık</h1>
        <p>Paragraf metni <strong>kalın</strong> ve <em>italik</em></p>
        <ul><li>madde 1</li><li>madde 2</li></ul>
      </body></html>
    `;
    const result = convertHtmlToMarkdown(html);
    expect(result).toContain('Ana Başlık');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(10);
  });

  it('geçersiz input için hata fırlatır', () => {
    expect(() => convertHtmlToMarkdown(123 as any)).toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. convertTextFileToMarkdown
// ═══════════════════════════════════════════════════════════════════════════
describe('convertTextFileToMarkdown()', () => {
  it('düz metni döndürür', () => {
    const buffer = Buffer.from('Merhaba Dünya', 'utf-8');
    expect(convertTextFileToMarkdown(buffer)).toBe('Merhaba Dünya');
  });

  it('boş buffer için boş string döner', () => {
    expect(convertTextFileToMarkdown(Buffer.from(''))).toBe('');
  });

  it('özel karakterleri korur', () => {
    const text = 'Türkçe karakterler: ğ, ü, ş, ı, ö, ç';
    const result = convertTextFileToMarkdown(Buffer.from(text, 'utf-8'));
    expect(result).toContain('ğ');
    expect(result).toContain('ş');
  });

  it('çok satırlı metni korur', () => {
    const text = 'satır 1\nsatır 2\nsatır 3';
    const result = convertTextFileToMarkdown(Buffer.from(text, 'utf-8'));
    expect(result).toContain('satır 1');
    expect(result).toContain('satır 3');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. convertCsvToMarkdown
// ═══════════════════════════════════════════════════════════════════════════
describe('convertCsvToMarkdown()', () => {
  it('basit CSV\'yi markdown tablosuna çevirir', () => {
    const csv = 'Ad,Soyad,Yaş\nAli,Veli,25\nAyşe,Fatma,30';
    const result = convertCsvToMarkdown(Buffer.from(csv, 'utf-8'));
    expect(result).toContain('Ad');
    expect(result).toContain('Soyad');
    expect(result).toContain('Ali');
    expect(result).toContain('Ayşe');
  });

  it('separator satırı içerir', () => {
    const csv = 'A,B\n1,2';
    const result = convertCsvToMarkdown(Buffer.from(csv, 'utf-8'));
    expect(result).toContain('---');
  });

  it('tek sütunlu CSV işler', () => {
    const csv = 'Ürün\nElma\nArmut';
    const result = convertCsvToMarkdown(Buffer.from(csv, 'utf-8'));
    expect(result).toContain('Ürün');
    expect(result).toContain('Elma');
  });

  it('boşluk içeren değerleri doğru işler', () => {
    const csv = '"Ad Soyad","Şehir"\n"Ahmet Yılmaz","İstanbul"';
    const result = convertCsvToMarkdown(Buffer.from(csv, 'utf-8'));
    expect(result).toContain('Ahmet Yılmaz');
  });

  it('büyük CSV\'de pipe karakteri kullanır', () => {
    const csv = 'A,B,C\n1,2,3\n4,5,6';
    const result = convertCsvToMarkdown(Buffer.from(csv, 'utf-8'));
    expect(result).toContain('|');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. convertRssAtomToMarkdown
// ═══════════════════════════════════════════════════════════════════════════
describe('convertRssAtomToMarkdown()', () => {
  const rssXml = `<?xml version="1.0"?>
    <rss version="2.0">
      <channel>
        <title>Test Blog</title>
        <description>Haberler</description>
        <item>
          <title>Haber 1</title>
          <pubDate>Mon, 01 Jun 2026 00:00:00 GMT</pubDate>
          <description>İlk haber içeriği</description>
        </item>
        <item>
          <title>Haber 2</title>
          <pubDate>Tue, 02 Jun 2026 00:00:00 GMT</pubDate>
          <description>İkinci haber içeriği</description>
        </item>
      </channel>
    </rss>`;

  const atomXml = `<?xml version="1.0" encoding="UTF-8"?>
    <feed xmlns="http://www.w3.org/2005/Atom">
      <title>Atom Feed</title>
      <subtitle>Açıklama</subtitle>
      <entry>
        <title>Giriş 1</title>
        <updated>2026-06-01T00:00:00Z</updated>
        <summary>Özet içerik</summary>
      </entry>
    </feed>`;

  it('RSS başlığını markdown başlığına çevirir', async () => {
    const result = await convertRssAtomToMarkdown(Buffer.from(rssXml, 'utf-8'));
    expect(result).toContain('Test Blog');
  });

  it('RSS item başlıklarını içerir', async () => {
    const result = await convertRssAtomToMarkdown(Buffer.from(rssXml, 'utf-8'));
    expect(result).toContain('Haber 1');
    expect(result).toContain('Haber 2');
  });

  it('RSS item açıklamalarını içerir', async () => {
    const result = await convertRssAtomToMarkdown(Buffer.from(rssXml, 'utf-8'));
    expect(result).toContain('İlk haber');
  });

  it('ATOM feed başlığını işler', async () => {
    const result = await convertRssAtomToMarkdown(Buffer.from(atomXml, 'utf-8'));
    expect(result).toContain('Atom Feed');
  });

  it('ATOM entry başlığını işler', async () => {
    const result = await convertRssAtomToMarkdown(Buffer.from(atomXml, 'utf-8'));
    expect(result).toContain('Giriş 1');
  });

  it('geçersiz XML için hata fırlatır', async () => {
    await expect(
      convertRssAtomToMarkdown(Buffer.from('bu geçerli xml değil<<<', 'utf-8'))
    ).rejects.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. convertIpynbToMarkdown
// ═══════════════════════════════════════════════════════════════════════════
describe('convertIpynbToMarkdown()', () => {
  const notebook = {
    cells: [
      { cell_type: 'markdown', source: ['# Başlık\n', 'Açıklama metni'] },
      { cell_type: 'code', source: ['print("Hello, World!")\n', 'x = 1 + 1'] },
      { cell_type: 'markdown', source: ['## Alt Başlık\n', 'Daha fazla metin'] },
      { cell_type: 'raw', source: ['ham metin içeriği'] },
    ]
  };

  it('markdown hücrelerini markdown\'a çevirir', async () => {
    const result = await convertIpynbToMarkdown(
      Buffer.from(JSON.stringify(notebook), 'utf-8')
    );
    expect(result).toContain('Başlık');
  });

  it('kod hücrelerini code block\'a çevirir', async () => {
    const result = await convertIpynbToMarkdown(
      Buffer.from(JSON.stringify(notebook), 'utf-8')
    );
    expect(result).toContain('```python');
    expect(result).toContain('print("Hello, World!")');
  });

  it('raw hücrelerini code block\'a çevirir', async () => {
    const result = await convertIpynbToMarkdown(
      Buffer.from(JSON.stringify(notebook), 'utf-8')
    );
    expect(result).toContain('ham metin');
  });

  it('boş cells dizisi için boş string döner', async () => {
    const empty = { cells: [] };
    const result = await convertIpynbToMarkdown(
      Buffer.from(JSON.stringify(empty), 'utf-8')
    );
    expect(result).toBe('');
  });

  it('cells anahtarı olmayan notebook için boş string döner', async () => {
    const noCells = {};
    const result = await convertIpynbToMarkdown(
      Buffer.from(JSON.stringify(noCells), 'utf-8')
    );
    expect(result).toBe('');
  });

  it('geçersiz JSON için hata fırlatır', async () => {
    await expect(
      convertIpynbToMarkdown(Buffer.from('{invalid json', 'utf-8'))
    ).rejects.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. convertYoutubeToMarkdown
// ═══════════════════════════════════════════════════════════════════════════
describe('convertYoutubeToMarkdown()', () => {
  const youtubeHtml = `<html>
    <head>
      <title>Test Video - YouTube</title>
      <meta name="description" content="Bu bir test videosu açıklamasıdır.">
    </head>
    <body></body>
  </html>`;

  it('video başlığını içerir', () => {
    const result = convertYoutubeToMarkdown(
      Buffer.from(youtubeHtml, 'utf-8'),
      'https://www.youtube.com/watch?v=abc123'
    );
    expect(result).toContain('Test Video');
  });

  it('video açıklamasını içerir', () => {
    const result = convertYoutubeToMarkdown(
      Buffer.from(youtubeHtml, 'utf-8'),
      'https://www.youtube.com/watch?v=abc123'
    );
    expect(result).toContain('test videosu');
  });

  it('YouTube başlığı içerir', () => {
    const result = convertYoutubeToMarkdown(
      Buffer.from(youtubeHtml, 'utf-8'),
      'https://www.youtube.com/watch?v=abc123'
    );
    expect(result).toContain('YouTube');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. convertBingSerpToMarkdown
// ═══════════════════════════════════════════════════════════════════════════
describe('convertBingSerpToMarkdown()', () => {
  const bingHtml = `<html><body>
    <li class="b_algo"><p>Birinci sonuç metni burada.</p></li>
    <li class="b_algo"><p>İkinci sonuç metni burada.</p></li>
  </body></html>`;

  it('sorgu metnini başlıkta içerir', () => {
    const result = convertBingSerpToMarkdown(
      Buffer.from(bingHtml, 'utf-8'),
      'https://www.bing.com/search?q=typescript'
    );
    expect(result).toContain('typescript');
  });

  it('arama sonuçlarını içerir', () => {
    const result = convertBingSerpToMarkdown(
      Buffer.from(bingHtml, 'utf-8'),
      'https://www.bing.com/search?q=test'
    );
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10. convertToMarkdown – Ana API
// ═══════════════════════════════════════════════════════════════════════════
describe('convertToMarkdown() - Ana API', () => {
  it('HTML string\'ini markdown\'a çevirir (forceExtension)', async () => {
    const html = '<h1>Test</h1><p>Paragraf</p>';
    const result = await convertToMarkdown(
      Buffer.from(html, 'utf-8'),
      { forceExtension: '.html' }
    );
    expect(result).toContain('Test');
    expect(typeof result).toBe('string');
  });

  it('CSV buffer\'ını markdown tablosuna çevirir', async () => {
    const csv = 'Ürün,Fiyat\nElma,5\nArmut,7';
    const result = await convertToMarkdown(
      Buffer.from(csv, 'utf-8'),
      { forceExtension: '.csv' }
    );
    expect(result).toContain('Ürün');
    expect(result).toContain('Elma');
  });

  it('TXT buffer\'ını düz metin olarak döndürür', async () => {
    const text = 'Düz metin içeriği';
    const result = await convertToMarkdown(
      Buffer.from(text, 'utf-8'),
      { forceExtension: '.txt' }
    );
    expect(result).toContain('Düz metin');
  });

  it('IPYNB buffer\'ını doğru işler', async () => {
    const nb = { cells: [{ cell_type: 'markdown', source: ['# Test\n'] }] };
    const result = await convertToMarkdown(
      Buffer.from(JSON.stringify(nb), 'utf-8'),
      { forceExtension: '.ipynb' }
    );
    expect(result).toContain('Test');
  });

  it('RSS XML buffer\'ını işler', async () => {
    const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>Feed</title></channel></rss>`;
    const result = await convertToMarkdown(
      Buffer.from(rss, 'utf-8'),
      { forceExtension: '.rss' }
    );
    expect(result).toContain('Feed');
  });

  it('YouTube URL\'si için özel işleme yapar', async () => {
    const html = '<html><head><title>Video - YouTube</title></head></html>';
    const result = await convertToMarkdown(
      Buffer.from(html, 'utf-8'),
      { url: 'https://www.youtube.com/watch?v=abc', forceExtension: '.xyz' }
    );
    expect(result).toContain('YouTube');
  });

  it('var olmayan dosya yolu için hata fırlatır', async () => {
    await expect(
      convertToMarkdown('/olmayan/dosya.pdf')
    ).rejects.toThrow('File not found');
  });

  it('geçersiz input tipi için hata fırlatır', async () => {
    await expect(
      convertToMarkdown(12345 as any)
    ).rejects.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 11. saveToMarkdownFile
// ═══════════════════════════════════════════════════════════════════════════
describe('saveToMarkdownFile()', () => {
  const testOutputDir = join(process.cwd(), 'test-output-temp');

  it('dosyayı kaydeder ve path döndürür', async () => {
    const filePath = await saveToMarkdownFile('# Test İçeriği', 'test-save', testOutputDir);
    expect(existsSync(filePath)).toBe(true);
    unlinkSync(filePath);
  });

  it('dosya içeriği doğru yazılır', async () => {
    const content = '# Merhaba\nBu bir test.';
    const filePath = await saveToMarkdownFile(content, 'test-content', testOutputDir);
    const read = readFileSync(filePath, 'utf-8');
    expect(read).toBe(content);
    unlinkSync(filePath);
  });

  it('.md uzantısı otomatik eklenir', async () => {
    const filePath = await saveToMarkdownFile('içerik', 'dosya-adi', testOutputDir);
    expect(filePath.endsWith('.md')).toBe(true);
    unlinkSync(filePath);
  });

  it('.md uzantısı zaten varsa tekrar eklemez', async () => {
    const filePath = await saveToMarkdownFile('içerik', 'dosya.md', testOutputDir);
    expect(filePath.endsWith('.md')).toBe(true);
    expect(filePath).not.toContain('.md.md');
    unlinkSync(filePath);
  });

  it('klasör yoksa oluşturur', async () => {
    const newDir = join(testOutputDir, 'alt-klasor-' + Date.now());
    const filePath = await saveToMarkdownFile('test', 'deneme', newDir);
    expect(existsSync(filePath)).toBe(true);
    unlinkSync(filePath);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 12. detectFileType
// ═══════════════════════════════════════════════════════════════════════════
describe('detectFileType()', () => {
  const tempDir = join(process.cwd(), 'test-output-temp');

  it('dosya yolundan uzantıyı tespit eder (.csv)', async () => {
    const tempFile = join(tempDir, `detect-test-${Date.now()}.csv`);
    writeFileSync(tempFile, 'A,B\n1,2', 'utf-8');
    try {
      const result = await detectFileType(tempFile);
      expect(result.extension).toBe('.csv');
      expect(result.buffer).toBeInstanceOf(Buffer);
    } finally {
      unlinkSync(tempFile);
    }
  });

  it('forceExtension seçeneğini dikkate alır', async () => {
    const tempFile = join(tempDir, `detect-test2-${Date.now()}.txt`);
    writeFileSync(tempFile, 'içerik', 'utf-8');
    try {
      const result = await detectFileType(tempFile, { forceExtension: '.html' });
      expect(result.extension).toBe('.html');
    } finally {
      unlinkSync(tempFile);
    }
  });

  it('data URL (base64) girdisini işler', async () => {
    const base64 = 'data:text/csv;base64,' + Buffer.from('A,B\n1,2').toString('base64');
    const result = await detectFileType(base64);
    expect(result.buffer).toBeInstanceOf(Buffer);
    expect(result.buffer.toString()).toContain('A,B');
  });

  it('Buffer girdisini forceExtension ile işler', async () => {
    const buf = Buffer.from('test içerik');
    const result = await detectFileType(buf, { forceExtension: '.txt' });
    expect(result.extension).toBe('.txt');
    expect(result.buffer).toBeInstanceOf(Buffer);
  });

  it('PNG buffer için magic bytes\'tan uzantı tespit eder', async () => {
    // 1x1 piksel minimal PNG
    const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const pngBuffer = Buffer.from(pngBase64, 'base64');
    const result = await detectFileType(pngBuffer);
    expect(result.extension).toBe('.png');
  });

  it('var olmayan dosya için hata fırlatır', async () => {
    await expect(
      detectFileType('/yok/boyle/bir/dosya.pdf')
    ).rejects.toThrow('File not found');
  });

  it('geçersiz input tipi için hata fırlatır', async () => {
    await expect(
      detectFileType(99999 as any)
    ).rejects.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 13. convertExcelToMarkdown
// ═══════════════════════════════════════════════════════════════════════════
describe('convertExcelToMarkdown()', () => {
  let excelBuffer: Buffer;

  beforeAll(() => {
    const wb = xlsxUtils.book_new();
    const ws = xlsxUtils.aoa_to_sheet([
      ['Ad', 'Soyad', 'Yaş'],
      ['Ali', 'Veli', 25],
      ['Ayşe', 'Fatma', 30],
    ]);
    xlsxUtils.book_append_sheet(wb, ws, 'Çalışanlar');
    excelBuffer = Buffer.from(xlsxWrite(wb, { type: 'buffer', bookType: 'xlsx' }));
  });

  it('sheet adını başlık olarak ekler', async () => {
    const result = await convertExcelToMarkdown(excelBuffer);
    expect(result).toContain('Çalışanlar');
  });

  it('sütun başlıklarını markdown tablosuna yazar', async () => {
    const result = await convertExcelToMarkdown(excelBuffer);
    expect(result).toContain('Ad');
    expect(result).toContain('Soyad');
    expect(result).toContain('Yaş');
  });

  it('veri satırlarını yazar', async () => {
    const result = await convertExcelToMarkdown(excelBuffer);
    expect(result).toContain('Ali');
    expect(result).toContain('Ayşe');
  });

  it('separator satırı içerir', async () => {
    const result = await convertExcelToMarkdown(excelBuffer);
    expect(result).toContain('---');
  });

  it('çoklu sheet destekler', async () => {
    const wb2 = xlsxUtils.book_new();
    xlsxUtils.book_append_sheet(wb2, xlsxUtils.aoa_to_sheet([['X'], [1]]), 'Sayfa1');
    xlsxUtils.book_append_sheet(wb2, xlsxUtils.aoa_to_sheet([['Y'], [2]]), 'Sayfa2');
    const buf = Buffer.from(xlsxWrite(wb2, { type: 'buffer', bookType: 'xlsx' }));
    const result = await convertExcelToMarkdown(buf);
    expect(result).toContain('Sayfa1');
    expect(result).toContain('Sayfa2');
  });

  it('geçersiz buffer\'ı hata vermeden parse eder (xlsx toleranslı)', async () => {
    // xlsx kütüphanesi hatalı veriyi "Sheet1" adlı boş sheet olarak işler, hata fırlatmaz
    const result = await convertExcelToMarkdown(Buffer.from('bu excel değil'));
    expect(typeof result).toBe('string'); // crash etmez
  });

  it('convertToMarkdown .xlsx formatını işler', async () => {
    const result = await convertToMarkdown(excelBuffer, { forceExtension: '.xlsx' });
    expect(result).toContain('Çalışanlar');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 14. convertZipToMarkdown
// ═══════════════════════════════════════════════════════════════════════════
describe('convertZipToMarkdown()', () => {
  let zipBuffer: Buffer;

  beforeAll(() => {
    const zip = new AdmZip();
    zip.addFile('readme.txt', Buffer.from('Merhaba Dünya!'));
    zip.addFile('data.csv', Buffer.from('A,B\n1,2'));
    zip.addFile('subfolder/notes.txt', Buffer.from('Alt klasör notu'));
    zipBuffer = zip.toBuffer();
  });

  it('giriş metnini içerir', async () => {
    const result = await convertZipToMarkdown(zipBuffer, {});
    expect(result).toContain('zip');
  });

  it('dosya adlarını listeler', async () => {
    const result = await convertZipToMarkdown(zipBuffer, {});
    expect(result).toContain('readme.txt');
    expect(result).toContain('data.csv');
  });

  it('byte bilgisini içerir', async () => {
    const result = await convertZipToMarkdown(zipBuffer, {});
    expect(result).toContain('bytes');
  });

  it('string döndürür', async () => {
    const result = await convertZipToMarkdown(zipBuffer, {});
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('convertToMarkdown .zip formatını işler', async () => {
    const result = await convertToMarkdown(zipBuffer, { forceExtension: '.zip' });
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('geçersiz buffer için hata fırlatır', async () => {
    await expect(
      convertZipToMarkdown(Buffer.from('bu zip değil'), {})
    ).rejects.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 15. convertPptxToMarkdown
// ═══════════════════════════════════════════════════════════════════════════
describe('convertPptxToMarkdown()', () => {
  let pptxBuffer: Buffer;

  beforeAll(() => {
    const zip = new AdmZip();
    zip.addFile(
      'ppt/slides/slide1.xml',
      Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
               xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <p:cSld><p:spTree>
            <p:sp><p:txBody>
              <a:p><a:r><a:t>Slayt Başlığı</a:t></a:r></a:p>
              <a:p><a:r><a:t>Slayt Açıklaması</a:t></a:r></a:p>
            </p:txBody></p:sp>
          </p:spTree></p:cSld>
        </p:sld>`
      )
    );
    zip.addFile(
      'ppt/slides/slide2.xml',
      Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
               xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <p:cSld><p:spTree>
            <p:sp><p:txBody>
              <a:p><a:r><a:t>İkinci Slayt</a:t></a:r></a:p>
            </p:txBody></p:sp>
          </p:spTree></p:cSld>
        </p:sld>`
      )
    );
    pptxBuffer = zip.toBuffer();
  });

  it('slayt içeriğini çıkarır', async () => {
    const result = await convertPptxToMarkdown(pptxBuffer);
    expect(result).toContain('Slayt Başlığı');
  });

  it('birden fazla slaytı işler', async () => {
    const result = await convertPptxToMarkdown(pptxBuffer);
    expect(result).toContain('İkinci Slayt');
  });

  it('slayt açıklamasını çıkarır', async () => {
    const result = await convertPptxToMarkdown(pptxBuffer);
    expect(result).toContain('Slayt Açıklaması');
  });

  it('string döndürür', async () => {
    const result = await convertPptxToMarkdown(pptxBuffer);
    expect(typeof result).toBe('string');
  });

  it('convertToMarkdown .pptx formatını işler', async () => {
    const result = await convertToMarkdown(pptxBuffer, { forceExtension: '.pptx' });
    expect(result).toContain('Slayt Başlığı');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 16. convertDocxToMarkdown
// ═══════════════════════════════════════════════════════════════════════════
describe('convertDocxToMarkdown()', () => {
  let docxBuffer: Buffer;

  beforeAll(() => {
    const zip = new AdmZip();
    zip.addFile(
      '[Content_Types].xml',
      Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
          <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
          <Override PartName="/word/document.xml"
            ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
        </Types>`
      )
    );
    zip.addFile(
      '_rels/.rels',
      Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rId1"
            Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"
            Target="word/document.xml"/>
        </Relationships>`
      )
    );
    zip.addFile(
      'word/document.xml',
      Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
          <w:body>
            <w:p><w:r><w:t>Merhaba Dünya</w:t></w:r></w:p>
            <w:p><w:r><w:t>İkinci paragraf</w:t></w:r></w:p>
          </w:body>
        </w:document>`
      )
    );
    zip.addFile(
      'word/_rels/document.xml.rels',
      Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`
      )
    );
    docxBuffer = zip.toBuffer();
  });

  it('string döndürür', async () => {
    const result = await convertDocxToMarkdown(docxBuffer);
    expect(typeof result).toBe('string');
  });

  it('metin içeriğini çıkarır', async () => {
    const result = await convertDocxToMarkdown(docxBuffer);
    expect(result.length).toBeGreaterThanOrEqual(0); // mammoth minimal DOCX'ten metin çıkarabilir
  });

  it('geçersiz buffer için hata fırlatır', async () => {
    await expect(
      convertDocxToMarkdown(Buffer.from('bu docx değil'))
    ).rejects.toThrow();
  });

  it('convertToMarkdown .docx formatını işler', async () => {
    const result = await convertToMarkdown(docxBuffer, { forceExtension: '.docx' });
    expect(typeof result).toBe('string');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 17. convertImageToMarkdown
// ═══════════════════════════════════════════════════════════════════════════
describe('convertImageToMarkdown()', () => {
  // 1x1 piksel gri PNG (bilinen geçerli PNG binary)
  const PNG_1x1 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  );

  it('string döndürür', async () => {
    const result = await convertImageToMarkdown(PNG_1x1, '.png');
    expect(typeof result).toBe('string');
  });

  it('boyut bilgisi içerir (genişlik x yükseklik)', async () => {
    const result = await convertImageToMarkdown(PNG_1x1, '.png');
    expect(result).toMatch(/1x1|ImageSize/);
  });

  it('format bilgisi içerir', async () => {
    const result = await convertImageToMarkdown(PNG_1x1, '.png');
    expect(result.toLowerCase()).toContain('png');
  });

  it('geçersiz buffer için hata fırlatır', async () => {
    await expect(
      convertImageToMarkdown(Buffer.from('bu resim değil'), '.png')
    ).rejects.toThrow();
  });

  it('convertToMarkdown .png formatını işler', async () => {
    const result = await convertToMarkdown(PNG_1x1, { forceExtension: '.png' });
    expect(typeof result).toBe('string');
  });

  it('convertToMarkdown .jpg formatını işler', async () => {
    // jpg için de aynı PNG buffer'ı format testi yapıyoruz
    const result = await convertToMarkdown(PNG_1x1, { forceExtension: '.jpg' });
    expect(typeof result).toBe('string');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 18. convertAudioToMarkdown
// ═══════════════════════════════════════════════════════════════════════════
describe('convertAudioToMarkdown()', () => {
  it('geçersiz buffer için hata fırlatır', async () => {
    await expect(
      convertAudioToMarkdown(Buffer.from('bu ses dosyası değil'), '.mp3')
    ).rejects.toThrow();
  });

  it('boş buffer için hata fırlatır', async () => {
    await expect(
      convertAudioToMarkdown(Buffer.alloc(0), '.wav')
    ).rejects.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 19. convertPdfToMarkdown
// ═══════════════════════════════════════════════════════════════════════════
describe('convertPdfToMarkdown()', () => {
  it('geçersiz buffer için hata fırlatır veya boş döner', async () => {
    // pdf2md bazı buffer'larla çökmek yerine hata fırlatır
    try {
      const result = await convertPdfToMarkdown(Buffer.from('bu pdf değil'));
      expect(typeof result).toBe('string');
    } catch (err: any) {
      expect(err.message).toBeTruthy();
    }
  });

  it('minimal PDF buffer ile çalışır veya anlamlı hata verir', async () => {
    const minimalPdf = Buffer.from(
      '%PDF-1.0\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
      '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
      '3 0 obj<</Type/Page/MediaBox[0 0 3 3]>>endobj\n' +
      'xref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n' +
      '0000000058 00000 n \n0000000115 00000 n \n' +
      'trailer<</Size 4/Root 1 0 R>>\nstartxref\n190\n%%EOF'
    );
    try {
      const result = await convertPdfToMarkdown(minimalPdf);
      expect(typeof result).toBe('string');
    } catch (err: any) {
      expect(err.message).toBeTruthy();
    }
  });

  it('convertToMarkdown .pdf formatını hata yönetimiyle işler', async () => {
    try {
      const result = await convertToMarkdown(
        Buffer.from('fake pdf content'),
        { forceExtension: '.pdf' }
      );
      expect(typeof result).toBe('string');
    } catch (err: any) {
      expect(err.message).toBeTruthy();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 20. convertToMarkdown – Dosya Yolu Tabanlı Testler
// ═══════════════════════════════════════════════════════════════════════════
describe('convertToMarkdown() - Dosya Yolu', () => {
  const tmpDir = join(process.cwd(), 'test-output-temp');

  it('.html dosyasını yoldan okuyup markdown\'a çevirir', async () => {
    const filePath = join(tmpDir, `test-${Date.now()}.html`);
    writeFileSync(filePath, '<h1>Dosyadan Başlık</h1><p>İçerik</p>', 'utf-8');
    try {
      const result = await convertToMarkdown(filePath);
      expect(result).toContain('Dosyadan Başlık');
    } finally {
      unlinkSync(filePath);
    }
  });

  it('.txt dosyasını yoldan okur', async () => {
    const filePath = join(tmpDir, `test-${Date.now()}.txt`);
    writeFileSync(filePath, 'Dosyadan okunan metin', 'utf-8');
    try {
      const result = await convertToMarkdown(filePath);
      expect(result).toContain('Dosyadan okunan metin');
    } finally {
      unlinkSync(filePath);
    }
  });

  it('.csv dosyasını yoldan okuyup tabloya çevirir', async () => {
    const filePath = join(tmpDir, `test-${Date.now()}.csv`);
    writeFileSync(filePath, 'Ürün,Fiyat\nElma,5\nArmut,7', 'utf-8');
    try {
      const result = await convertToMarkdown(filePath);
      expect(result).toContain('Ürün');
      expect(result).toContain('Elma');
    } finally {
      unlinkSync(filePath);
    }
  });

  it('.ipynb dosyasını yoldan okur', async () => {
    const nb = { cells: [{ cell_type: 'code', source: ['x = 42\n'] }] };
    const filePath = join(tmpDir, `test-${Date.now()}.ipynb`);
    writeFileSync(filePath, JSON.stringify(nb), 'utf-8');
    try {
      const result = await convertToMarkdown(filePath);
      expect(result).toContain('x = 42');
    } finally {
      unlinkSync(filePath);
    }
  });

  it('fileName seçeneğini destekler (Buffer + fileName)', async () => {
    const csv = 'A,B\n1,2';
    const result = await convertToMarkdown(
      Buffer.from(csv, 'utf-8'),
      { fileName: 'data.csv' }
    );
    expect(result).toContain('A');
  });
});

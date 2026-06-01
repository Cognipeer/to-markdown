import AdmZip from 'adm-zip';
import { parseStringPromise } from 'xml2js';
import { convertHtmlToMarkdown } from './html.js';

/**
 * Converts an EPUB buffer to Markdown.
 * EPUB is a ZIP containing HTML/XHTML content files described by an OPF manifest.
 */
export async function convertEpubToMarkdown(buffer: Buffer): Promise<string> {
  try {
    const zip = new AdmZip(buffer);

    // 1. Read META-INF/container.xml to find the OPF package file path
    const containerEntry = zip.getEntry('META-INF/container.xml');
    if (!containerEntry) throw new Error('No META-INF/container.xml found — not a valid EPUB');

    const containerXml = containerEntry.getData().toString('utf-8');
    const container = await parseStringPromise(containerXml);
    const opfPath: string =
      container?.container?.rootfiles?.[0]?.rootfile?.[0]?.['$']?.['full-path'];
    if (!opfPath) throw new Error('Could not find OPF path in container.xml');

    // 2. Parse the OPF manifest
    const opfEntry = zip.getEntry(opfPath);
    if (!opfEntry) throw new Error(`OPF file not found: ${opfPath}`);
    const opfXml = opfEntry.getData().toString('utf-8');
    const opf = await parseStringPromise(opfXml);

    const baseDir = opfPath.includes('/')
      ? opfPath.split('/').slice(0, -1).join('/') + '/'
      : '';

    // Build id → href map from manifest
    const manifestItems: any[] = opf?.package?.manifest?.[0]?.item ?? [];
    const hrefById: Record<string, string> = {};
    for (const item of manifestItems) {
      hrefById[item['$'].id] = item['$'].href;
    }

    // Get spine reading order
    const spineItems: any[] = opf?.package?.spine?.[0]?.itemref ?? [];
    const spineIds: string[] = spineItems.map((s: any) => s['$']?.idref).filter(Boolean);

    // 3. Extract book metadata
    const meta = opf?.package?.metadata?.[0];
    const title = meta?.['dc:title']?.[0] ?? 'EPUB Document';
    const creatorRaw = meta?.['dc:creator']?.[0];
    const creator =
      typeof creatorRaw === 'string' ? creatorRaw : creatorRaw?.['_'] ?? '';
    const description = meta?.['dc:description']?.[0] ?? '';

    let md = `# ${title}\n\n`;
    if (creator) md += `**Authors:** ${creator}\n\n`;
    if (description) md += `${description}\n\n`;
    md += '---\n\n';

    // 4. Convert each spine item HTML → Markdown
    for (const id of spineIds) {
      const href = hrefById[id];
      if (!href) continue;

      // Try both with and without base dir
      const entry =
        zip.getEntry(baseDir + href) ??
        zip.getEntry(href) ??
        zip.getEntry(decodeURIComponent(baseDir + href));
      if (!entry) continue;

      const html = entry.getData().toString('utf-8');
      const converted = convertHtmlToMarkdown(Buffer.from(html, 'utf-8'));
      if (converted.trim()) md += converted.trim() + '\n\n';
    }

    return md.trim();
  } catch (err: any) {
    throw new Error(`Failed to convert EPUB: ${err.message}`);
  }
}

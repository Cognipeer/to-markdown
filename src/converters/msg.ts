import MsgReader from 'msgreader';

/**
 * Converts an Outlook MSG file buffer to Markdown.
 */
export function convertMsgToMarkdown(buffer: Buffer): string {
  try {
    const reader = new MsgReader(buffer);
    const msg = reader.getFileData();

    let md = '# Email Message\n\n';

    // Headers
    if (msg.senderName || msg.senderEmail) {
      const from = [msg.senderName, msg.senderEmail ? `<${msg.senderEmail}>` : '']
        .filter(Boolean).join(' ');
      md += `**From:** ${from}\n`;
    }

    if (Array.isArray((msg as any).recipients) && (msg as any).recipients.length) {
      const to = (msg as any).recipients
        .filter((r: any) => !r.recipType || r.recipType === 'to')
        .map((r: any) => r.email || r.name)
        .filter(Boolean)
        .join(', ');
      if (to) md += `**To:** ${to}\n`;

      const cc = (msg as any).recipients
        .filter((r: any) => r.recipType === 'cc')
        .map((r: any) => r.email || r.name)
        .filter(Boolean)
        .join(', ');
      if (cc) md += `**Cc:** ${cc}\n`;
    }

    if (msg.subject) md += `**Subject:** ${msg.subject}\n`;
    if ((msg as any).messageDeliveryTime || (msg as any).creationTime) {
      const date = (msg as any).messageDeliveryTime ?? (msg as any).creationTime;
      md += `**Date:** ${date}\n`;
    }

    md += '\n## Content\n\n';
    const body: string = (msg as any).body ?? (msg as any).bodyText ?? '';
    if (body) md += body.trim() + '\n';

    // Attachments list
    if (Array.isArray((msg as any).attachments) && (msg as any).attachments.length) {
      md += '\n## Attachments\n\n';
      for (const att of (msg as any).attachments) {
        const name = att.fileName || att.name || 'unnamed';
        md += `* ${name}\n`;
      }
    }

    return md.trim();
  } catch (err: any) {
    throw new Error(`Failed to convert MSG: ${err.message}`);
  }
}

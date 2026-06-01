import yaml from 'js-yaml';

/**
 * Recursively renders a parsed JSON/YAML value as Markdown.
 */
function renderValue(value: any, depth: number): string {
  if (value === null || value === undefined) return '_null_\n';
  if (typeof value === 'boolean') return (value ? '`true`' : '`false`') + '\n';
  if (typeof value === 'number') return `\`${value}\`\n`;
  if (typeof value === 'string') {
    if (value.includes('\n')) return '\n```\n' + value + '\n```\n';
    return value + '\n';
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return '_empty list_\n';
    // If array of scalars, render as bullet list
    if (value.every(v => typeof v !== 'object' || v === null)) {
      return value.map(v => `- ${v}`).join('\n') + '\n';
    }
    // Array of objects
    let out = '';
    value.forEach((item, i) => {
      const heading = '#'.repeat(Math.min(depth + 2, 6));
      out += `\n${heading} Item ${i + 1}\n\n`;
      out += renderValue(item, depth + 1);
    });
    return out;
  }

  if (typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 0) return '_empty object_\n';

    // Detect if this is a simple flat object that can be rendered as a table
    const isFlat = keys.every(k => typeof value[k] !== 'object' || value[k] === null);
    if (isFlat && keys.length <= 10) {
      let table = '| Key | Value |\n|-----|-------|\n';
      for (const k of keys) {
        table += `| ${k} | ${value[k] ?? '_null_'} |\n`;
      }
      return table;
    }

    // Nested object — render each key as a sub-heading
    let out = '';
    for (const key of keys) {
      const heading = '#'.repeat(Math.min(depth + 2, 6));
      out += `\n${heading} ${key}\n\n`;
      out += renderValue(value[key], depth + 1);
    }
    return out;
  }

  return String(value) + '\n';
}

/**
 * Converts a JSON Buffer to Markdown.
 */
export function convertJsonToMarkdown(buffer: Buffer): string {
  try {
    const text = buffer.toString('utf-8').trim();
    const parsed = JSON.parse(text);
    let md = '# JSON Document\n';
    md += renderValue(parsed, 0);
    return md.trim();
  } catch (err: any) {
    throw new Error(`Failed to parse JSON: ${err.message}`);
  }
}

/**
 * Converts a YAML Buffer to Markdown.
 */
export function convertYamlToMarkdown(buffer: Buffer): string {
  try {
    const text = buffer.toString('utf-8').trim();
    const parsed = yaml.load(text);
    let md = '# YAML Document\n';
    md += renderValue(parsed, 0);
    return md.trim();
  } catch (err: any) {
    throw new Error(`Failed to parse YAML: ${err.message}`);
  }
}

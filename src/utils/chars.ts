/** Number of non-whitespace characters, the unit of `PageReport.chars` / `ImageReport.chars`. */
export function countChars(text: string): number {
  return text.replace(/\s/g, '').length;
}

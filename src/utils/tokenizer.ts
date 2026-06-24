export type TokenizerMode = 'approx' | 'gpt';

/**
 * Counts tokens in text.
 *
 * - 'approx' (default): chars / 4 heuristic — fast, zero dependencies.
 * - 'gpt': uses gpt-tokenizer (optional peer dep). Falls back to approx
 *   automatically if the package is not installed.
 */
export async function countTokens(
  text: string,
  mode: TokenizerMode = 'approx'
): Promise<number> {
  if (!text) return 0;

  if (mode === 'gpt') {
    try {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore — optional peer dependency
      const { encode } = await import('gpt-tokenizer');
      return encode(text).length;
    } catch {
      // gpt-tokenizer not installed — fall through to approx
    }
  }

  return Math.ceil(text.length / 4);
}

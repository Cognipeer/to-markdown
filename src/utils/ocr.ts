import type { OCRHandlerContext, OCROptions, VLMOptions } from '../types/index.js';
import type { ConversionContext } from './conversionContext.js';
import { fetchWithRetry } from './http.js';
import { prepareImageForVlm } from './imageTranscode.js';
import { toIsoLangList } from './lang.js';
import { combineSignals } from './abort.js';
import { normalizeHandlerResult, OcrTimeoutError, type NormalizedOcrResult } from './ocrRunner.js';
import { TesseractSession } from './tesseract.js';

const DEFAULT_OCR_PROMPT =
  'Extract all text from this image exactly as it appears. Return only the extracted text, preserving the original layout and line breaks as closely as possible.';

/**
 * Extracts text from an image buffer using the configured OCR provider.
 *
 * With a handler that returns `{ text, markdown }` the markdown rendering is
 * returned when present. Use `convertToMarkdownDetailed` for reports and stats.
 *
 * @param buffer  - Image buffer (PNG, JPEG, etc.)
 * @param opts    - OCR options including provider selection and provider-specific config
 * @param context - Metadata forwarded to handler provider
 */
export async function ocrImage(
  buffer: Buffer,
  opts: OCROptions = {},
  context: OCRHandlerContext = {}
): Promise<string> {
  const result = await ocrImageDetailed(buffer, opts, context);
  return result.markdown ?? result.text;
}

/**
 * Internal variant of {@link ocrImage}: returns text, markdown and confidence and
 * records stats / reuses the tesseract session of a conversion when `conversion`
 * is given. Without one it behaves like the standalone `ocrImage()` (its own
 * worker, terminated afterwards).
 */
export async function ocrImageDetailed(
  buffer: Buffer,
  opts: OCROptions = {},
  context: OCRHandlerContext = {},
  conversion?: ConversionContext
): Promise<NormalizedOcrResult> {
  const baseSignal = context.signal ?? conversion?.signal ?? opts.signal;
  // Inside a conversion the shared runner applies `timeoutMs`; a standalone call does it here.
  if (!conversion && opts.timeoutMs && opts.timeoutMs > 0) {
    const timeoutController = new AbortController();
    const combined = combineSignals(baseSignal, timeoutController.signal);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          const err = new OcrTimeoutError(opts.timeoutMs!);
          timeoutController.abort(err);
          reject(err);
        }, opts.timeoutMs);
      });
      const running = runProvider(buffer, opts, context, combined.signal, conversion);
      running.catch(() => undefined);
      return await Promise.race([running, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
      combined.dispose();
    }
  }
  return runProvider(buffer, opts, context, baseSignal, conversion);
}

async function runProvider(
  buffer: Buffer,
  opts: OCROptions,
  context: OCRHandlerContext,
  signal: AbortSignal | undefined,
  conversion: ConversionContext | undefined
): Promise<NormalizedOcrResult> {
  const provider = opts.provider ?? 'tesseract';
  const started = Date.now();
  if (conversion) conversion.stats.ocrCalls++;

  try {
    let result: NormalizedOcrResult;
    switch (provider) {
      case 'tesseract':
        result = await ocrWithTesseract(buffer, opts, signal, conversion);
        break;
      case 'openai-vlm':
        result = { text: await ocrWithOpenAI(buffer, requireVlm(opts, 'openai-vlm'), context, signal) };
        break;
      case 'anthropic-vlm':
        result = { text: await ocrWithAnthropic(buffer, requireVlm(opts, 'anthropic-vlm'), context, signal) };
        break;
      case 'ollama-vlm':
        result = { text: await ocrWithOllama(buffer, requireVlm(opts, 'ollama-vlm'), context, signal) };
        break;
      case 'azure-vision':
        result = { text: await ocrWithAzureVision(buffer, requireVlm(opts, 'azure-vision'), signal) };
        break;
      case 'custom-vlm':
        result = { text: await ocrWithOpenAI(buffer, requireVlm(opts, 'custom-vlm'), context, signal) };
        break;
      case 'handler':
        result = await ocrWithHandler(buffer, opts, context, signal);
        break;
      default: {
        // Exhaustiveness check — TypeScript will catch unknown providers at compile time
        const _never: never = provider;
        throw new Error(`Unknown OCR provider: ${_never}`);
      }
    }
    if (conversion) {
      if (context.kind === 'pdf-page' || context.kind === 'tiff-page') conversion.stats.ocrPages++;
      else if (context.kind === 'image' || context.kind === 'embedded-image') conversion.stats.ocrImages++;
    }
    return result;
  } finally {
    if (conversion) conversion.stats.ocrMs += Date.now() - started;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

async function ocrWithHandler(
  buffer: Buffer,
  opts: OCROptions,
  context: OCRHandlerContext,
  signal: AbortSignal | undefined
): Promise<NormalizedOcrResult> {
  if (!opts.handler) {
    throw new Error("OCR provider 'handler' requires opts.handler");
  }
  const handlerContext: OCRHandlerContext = { ...context };
  if (handlerContext.langHint === undefined) {
    const hint = toIsoLangList(opts.languages ?? opts.lang);
    if (hint) handlerContext.langHint = hint;
  }
  if (handlerContext.signal === undefined && signal) handlerContext.signal = signal;
  return normalizeHandlerResult(await opts.handler(buffer, handlerContext));
}

function vlmRetryOptions(vlm: VLMOptions, signal: AbortSignal | undefined) {
  return { retries: vlm.retries, timeoutMs: vlm.timeoutMs, signal };
}

function requireVlm(opts: OCROptions, provider: string): VLMOptions {
  if (!opts.vlm) {
    throw new Error(`OCR provider '${provider}' requires opts.vlm configuration`);
  }
  return opts.vlm;
}

// ── Tesseract ─────────────────────────────────────────────────────────────

async function ocrWithTesseract(
  buffer: Buffer,
  opts: OCROptions,
  signal: AbortSignal | undefined,
  conversion: ConversionContext | undefined
): Promise<NormalizedOcrResult> {
  if (conversion) {
    // One engine per conversion, terminated by the conversion's `finally`.
    return conversion.getTesseract(opts).recognize(buffer, signal);
  }
  // Standalone call: own worker, terminated right away (as in 3.5.0).
  const session = new TesseractSession(opts);
  try {
    return await session.recognize(buffer, signal);
  } finally {
    await session.terminate();
  }
}

// ── OpenAI Vision (also used by custom-vlm) ───────────────────────────────

async function ocrWithOpenAI(
  buffer: Buffer,
  vlm: VLMOptions,
  context: OCRHandlerContext,
  signal: AbortSignal | undefined
): Promise<string> {
  if (!vlm.model) throw new Error("openai-vlm/custom-vlm: vlm.model is required");
  if (!vlm.apiKey) throw new Error("openai-vlm/custom-vlm: vlm.apiKey is required");

  const apiBase = (vlm.apiBase ?? 'https://api.openai.com/v1').replace(/\/$/, '');
  const prompt  = vlm.prompt ?? DEFAULT_OCR_PROMPT;
  const image   = await prepareImageForVlm(buffer, context.mimeType);
  const base64  = image.buffer.toString('base64');

  const response = await fetchWithRetry(`${apiBase}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${vlm.apiKey}`,
    },
    body: JSON.stringify({
      model: vlm.model,
      max_completion_tokens: vlm.maxTokens ?? 4096,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${base64}` } },
          ],
        },
      ],
    }),
  }, vlmRetryOptions(vlm, signal));

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`openai-vlm request failed (${response.status}): ${body}`);
  }

  const data = (await response.json()) as any;
  return (data.choices?.[0]?.message?.content ?? '').trim();
}

// ── Anthropic Vision ──────────────────────────────────────────────────────

async function ocrWithAnthropic(
  buffer: Buffer,
  vlm: VLMOptions,
  context: OCRHandlerContext,
  signal: AbortSignal | undefined
): Promise<string> {
  if (!vlm.model) throw new Error("anthropic-vlm: vlm.model is required");
  if (!vlm.apiKey) throw new Error("anthropic-vlm: vlm.apiKey is required");

  const apiBase = (vlm.apiBase ?? 'https://api.anthropic.com').replace(/\/$/, '');
  const prompt  = vlm.prompt ?? DEFAULT_OCR_PROMPT;
  const image   = await prepareImageForVlm(buffer, context.mimeType);
  const base64  = image.buffer.toString('base64');

  const response = await fetchWithRetry(`${apiBase}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': vlm.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: vlm.model,
      max_tokens: vlm.maxTokens ?? 4096,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: image.mimeType, data: base64 },
            },
            { type: 'text', text: prompt },
          ],
        },
      ],
    }),
  }, vlmRetryOptions(vlm, signal));

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`anthropic-vlm request failed (${response.status}): ${body}`);
  }

  const data = (await response.json()) as any;
  return (data.content?.[0]?.text ?? '').trim();
}

// ── Ollama Vision ─────────────────────────────────────────────────────────

async function ocrWithOllama(
  buffer: Buffer,
  vlm: VLMOptions,
  context: OCRHandlerContext,
  signal: AbortSignal | undefined
): Promise<string> {
  if (!vlm.model) throw new Error("ollama-vlm: vlm.model is required");

  const apiBase = (vlm.apiBase ?? 'http://localhost:11434').replace(/\/$/, '');
  const prompt  = vlm.prompt ?? DEFAULT_OCR_PROMPT;
  const image   = await prepareImageForVlm(buffer, context.mimeType);
  const base64  = image.buffer.toString('base64');

  const response = await fetchWithRetry(`${apiBase}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: vlm.model,
      stream: false,
      messages: [
        {
          role: 'user',
          content: prompt,
          images: [base64],
        },
      ],
    }),
  }, vlmRetryOptions(vlm, signal));

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`ollama-vlm request failed (${response.status}): ${body}`);
  }

  const data = (await response.json()) as any;
  return (data.message?.content ?? '').trim();
}

// ── Azure Computer Vision ─────────────────────────────────────────────────

async function ocrWithAzureVision(
  buffer: Buffer,
  vlm: VLMOptions,
  signal: AbortSignal | undefined
): Promise<string> {
  if (!vlm.apiKey)  throw new Error("azure-vision: vlm.apiKey is required");
  if (!vlm.apiBase) throw new Error("azure-vision: vlm.apiBase (Azure endpoint URL) is required");

  const endpoint = vlm.apiBase.replace(/\/$/, '');

  const response = await fetchWithRetry(
    `${endpoint}/computervision/imageanalysis:analyze?api-version=2023-02-01-preview&features=read`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Ocp-Apim-Subscription-Key': vlm.apiKey,
      },
      body: buffer,
    },
    vlmRetryOptions(vlm, signal)
  );

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`azure-vision request failed (${response.status}): ${body}`);
  }

  const data = (await response.json()) as any;
  const lines: string[] =
    data.readResult?.blocks
      ?.flatMap((b: any) => b.lines ?? [])
      ?.map((l: any) => l.text ?? '') ?? [];
  return lines.join('\n').trim();
}


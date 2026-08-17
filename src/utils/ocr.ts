import type { OCRHandlerContext, OCROptions, VLMOptions } from '../types/index.js';

const DEFAULT_OCR_PROMPT =
  'Extract all text from this image exactly as it appears. Return only the extracted text, preserving the original layout and line breaks as closely as possible.';

/**
 * Extracts text from an image buffer using the configured OCR provider.
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
  const provider = opts.provider ?? 'tesseract';

  switch (provider) {
    case 'tesseract':
      return ocrWithTesseract(buffer, opts);
    case 'openai-vlm':
      return ocrWithOpenAI(buffer, requireVlm(opts, 'openai-vlm'));
    case 'anthropic-vlm':
      return ocrWithAnthropic(buffer, requireVlm(opts, 'anthropic-vlm'));
    case 'ollama-vlm':
      return ocrWithOllama(buffer, requireVlm(opts, 'ollama-vlm'));
    case 'azure-vision':
      return ocrWithAzureVision(buffer, requireVlm(opts, 'azure-vision'));
    case 'custom-vlm':
      return ocrWithOpenAI(buffer, requireVlm(opts, 'custom-vlm'));
    case 'handler':
      return ocrWithHandler(buffer, opts, context);
    default: {
      // Exhaustiveness check — TypeScript will catch unknown providers at compile time
      const _never: never = provider;
      throw new Error(`Unknown OCR provider: ${_never}`);
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

async function ocrWithHandler(
  buffer: Buffer,
  opts: OCROptions,
  context: OCRHandlerContext
): Promise<string> {
  if (!opts.handler) {
    throw new Error("OCR provider 'handler' requires opts.handler");
  }
  const text = await opts.handler(buffer, context);
  return (text ?? '').trim();
}

function requireVlm(opts: OCROptions, provider: string): VLMOptions {
  if (!opts.vlm) {
    throw new Error(`OCR provider '${provider}' requires opts.vlm configuration`);
  }
  return opts.vlm;
}

// ── Tesseract ─────────────────────────────────────────────────────────────

async function ocrWithTesseract(buffer: Buffer, opts: OCROptions): Promise<string> {
  const { lang = 'eng' } = opts;

  let createWorker: (lang: string) => Promise<any>;
  try {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const tesseract = await import('tesseract.js');
    createWorker = tesseract.createWorker;
  } catch {
    throw new Error(
      "OCR with 'tesseract' provider requires tesseract.js: npm install tesseract.js"
    );
  }

  const worker = await createWorker(lang);
  try {
    const { data } = await worker.recognize(buffer);
    return (data.text ?? '').trim();
  } finally {
    await worker.terminate();
  }
}

// ── OpenAI Vision (also used by custom-vlm) ───────────────────────────────

async function ocrWithOpenAI(buffer: Buffer, vlm: VLMOptions): Promise<string> {
  if (!vlm.model) throw new Error("openai-vlm/custom-vlm: vlm.model is required");
  if (!vlm.apiKey) throw new Error("openai-vlm/custom-vlm: vlm.apiKey is required");

  const apiBase = (vlm.apiBase ?? 'https://api.openai.com/v1').replace(/\/$/, '');
  const prompt  = vlm.prompt ?? DEFAULT_OCR_PROMPT;
  const base64  = buffer.toString('base64');

  const response = await fetch(`${apiBase}/chat/completions`, {
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
            { type: 'image_url', image_url: { url: `data:image/png;base64,${base64}` } },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`openai-vlm request failed (${response.status}): ${body}`);
  }

  const data = (await response.json()) as any;
  return (data.choices?.[0]?.message?.content ?? '').trim();
}

// ── Anthropic Vision ──────────────────────────────────────────────────────

async function ocrWithAnthropic(buffer: Buffer, vlm: VLMOptions): Promise<string> {
  if (!vlm.model) throw new Error("anthropic-vlm: vlm.model is required");
  if (!vlm.apiKey) throw new Error("anthropic-vlm: vlm.apiKey is required");

  const apiBase = (vlm.apiBase ?? 'https://api.anthropic.com').replace(/\/$/, '');
  const prompt  = vlm.prompt ?? DEFAULT_OCR_PROMPT;
  const base64  = buffer.toString('base64');

  const response = await fetch(`${apiBase}/v1/messages`, {
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
              source: { type: 'base64', media_type: 'image/png', data: base64 },
            },
            { type: 'text', text: prompt },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`anthropic-vlm request failed (${response.status}): ${body}`);
  }

  const data = (await response.json()) as any;
  return (data.content?.[0]?.text ?? '').trim();
}

// ── Ollama Vision ─────────────────────────────────────────────────────────

async function ocrWithOllama(buffer: Buffer, vlm: VLMOptions): Promise<string> {
  if (!vlm.model) throw new Error("ollama-vlm: vlm.model is required");

  const apiBase = (vlm.apiBase ?? 'http://localhost:11434').replace(/\/$/, '');
  const prompt  = vlm.prompt ?? DEFAULT_OCR_PROMPT;
  const base64  = buffer.toString('base64');

  const response = await fetch(`${apiBase}/api/chat`, {
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
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`ollama-vlm request failed (${response.status}): ${body}`);
  }

  const data = (await response.json()) as any;
  return (data.message?.content ?? '').trim();
}

// ── Azure Computer Vision ─────────────────────────────────────────────────

async function ocrWithAzureVision(buffer: Buffer, vlm: VLMOptions): Promise<string> {
  if (!vlm.apiKey)  throw new Error("azure-vision: vlm.apiKey is required");
  if (!vlm.apiBase) throw new Error("azure-vision: vlm.apiBase (Azure endpoint URL) is required");

  const endpoint = vlm.apiBase.replace(/\/$/, '');

  const response = await fetch(
    `${endpoint}/computervision/imageanalysis:analyze?api-version=2023-02-01-preview&features=read`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Ocp-Apim-Subscription-Key': vlm.apiKey,
      },
      body: buffer,
    }
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


import type { OCRHandlerResult, OCRImageKind, OCROptions, OCRProgressEvent } from '../types/index.js';
import { abortReason, combineSignals } from './abort.js';
import { MAX_TESSERACT_WORKERS } from './tesseract.js';

/** Thrown (and reported as `ocr_timeout`) when one OCR task exceeds `timeoutMs`. */
export class OcrTimeoutError extends Error {
  readonly code = 'ocr_timeout';
  constructor(public readonly timeoutMs: number) {
    super(`OCR timed out after ${timeoutMs}ms`);
    this.name = 'OcrTimeoutError';
  }
}

export interface OcrTask<T> {
  /** Page number, forwarded to progress events */
  page?: number;
  /** Runs the task. `signal` aborts on user cancellation and on task timeout. */
  run(signal: AbortSignal | undefined): Promise<T>;
}

export type OcrTaskOutcome<T> =
  | { status: 'ok'; value: T; ms: number }
  | { status: 'error'; error: Error; timedOut: boolean; ms: number }
  /** Not started because `stopOnError` stopped the scheduling after a failure */
  | { status: 'skipped' };

export interface OcrRunnerOptions {
  /** Parallel tasks (default 1) */
  concurrency?: number;
  /** Per-task timeout in ms (default none) */
  timeoutMs?: number;
  /** Cancels the run: stops scheduling and rejects with the signal's reason */
  signal?: AbortSignal;
  onProgress?: (event: OCRProgressEvent) => void;
  /** Kind reported in progress events (default 'image') */
  kind?: OCRImageKind;
  /** Stop starting new tasks after the first failed one (legacy sequential semantics) */
  stopOnError?: boolean;
}

/**
 * Task concurrency to hand to {@link runOcrTasks} for `opts`. With the tesseract
 * provider it is capped at the number of engine workers, so tasks never wait for
 * a free worker inside their own timeout window (and rendered pages do not pile up).
 */
export function ocrConcurrency(opts: OCROptions): number {
  const requested = Math.max(1, Math.floor(opts.concurrency ?? 1) || 1);
  const provider = opts.provider ?? 'tesseract';
  return provider === 'tesseract' ? Math.min(requested, MAX_TESSERACT_WORKERS) : requested;
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

/**
 * Order-preserving promise pool for OCR work.
 *
 * Task failures (including timeouts) do not reject: they come back as `error`
 * outcomes in task order so callers can apply their `onError` policy. A
 * cancellation through `signal` is never swallowed: the returned promise
 * rejects with the signal's reason (an `AbortError` by default).
 */
export async function runOcrTasks<T>(
  tasks: Array<OcrTask<T>>,
  options: OcrRunnerOptions = {}
): Promise<Array<OcrTaskOutcome<T>>> {
  const { signal, timeoutMs, onProgress, kind = 'image', stopOnError = false } = options;
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? 1) || 1);
  const total = tasks.length;
  const outcomes: Array<OcrTaskOutcome<T>> = tasks.map(() => ({ status: 'skipped' as const }));
  if (total === 0) return outcomes;
  if (signal && signal.aborted) throw abortReason(signal);

  let next = 0;
  let completed = 0;
  let stopped = false;

  const notify = (page?: number) => {
    if (!onProgress) return;
    try {
      const event: OCRProgressEvent = { kind, completed, total };
      if (page !== undefined) event.page = page;
      onProgress(event);
    } catch {
      /* progress callbacks must not break the conversion */
    }
  };

  const runOne = async (task: OcrTask<T>): Promise<OcrTaskOutcome<T>> => {
    const started = Date.now();
    const timeoutController = new AbortController();
    const combined = combineSignals(signal, timeoutController.signal);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const running = task.run(combined.signal);
      let value: T;
      if (timeoutMs && timeoutMs > 0) {
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            const err = new OcrTimeoutError(timeoutMs);
            timeoutController.abort(err);
            reject(err);
          }, timeoutMs);
        });
        // The task may settle after the timeout won the race; keep it from
        // surfacing as an unhandled rejection.
        running.catch(() => undefined);
        value = await Promise.race([running, timeout]);
      } else {
        value = await running;
      }
      return { status: 'ok', value, ms: Date.now() - started };
    } catch (err) {
      if (signal && signal.aborted) throw abortReason(signal);
      return {
        status: 'error',
        error: toError(err),
        timedOut: err instanceof OcrTimeoutError,
        ms: Date.now() - started,
      };
    } finally {
      if (timer) clearTimeout(timer);
      combined.dispose();
    }
  };

  const worker = async () => {
    while (!stopped && next < total) {
      if (signal && signal.aborted) return;
      const index = next++;
      const task = tasks[index];
      const outcome = await runOne(task);
      outcomes[index] = outcome;
      completed++;
      notify(task.page);
      if (outcome.status === 'error' && stopOnError) stopped = true;
    }
  };

  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    if (!signal) return;
    onAbort = () => reject(abortReason(signal));
    signal.addEventListener('abort', onAbort, { once: true });
  });
  aborted.catch(() => undefined);

  const pool: Array<Promise<void>> = [];
  for (let i = 0; i < Math.min(concurrency, total); i++) pool.push(worker());
  try {
    await (signal ? Promise.race([Promise.all(pool), aborted]) : Promise.all(pool));
  } finally {
    if (signal && onAbort) signal.removeEventListener('abort', onAbort);
  }
  if (signal && signal.aborted) throw abortReason(signal);
  return outcomes;
}

/** Normalised handler output: both fields trimmed, `markdown` only when non-empty. */
export interface NormalizedOcrResult {
  text: string;
  markdown?: string;
  confidence?: number;
}

/**
 * Normalises what an OCR handler returned (`string | { text, markdown?, confidence? }`
 * | nullish) into `{ text, markdown? }`, both trimmed.
 */
export function normalizeHandlerResult(
  result: string | OCRHandlerResult | null | undefined
): NormalizedOcrResult {
  if (result === null || result === undefined) return { text: '' };
  if (typeof result === 'string') return { text: result.trim() };
  const text = (typeof result.text === 'string' ? result.text : '').trim();
  const markdown = typeof result.markdown === 'string' ? result.markdown.trim() : '';
  const out: NormalizedOcrResult = { text };
  if (markdown) out.markdown = markdown;
  if (typeof result.confidence === 'number') out.confidence = result.confidence;
  return out;
}

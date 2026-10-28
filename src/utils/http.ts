import { abortReason, combineSignals, isAbortError, sleep } from './abort.js';

export interface FetchRetryOptions {
  /** Retries after the first attempt (default 2) */
  retries?: number;
  /** Timeout of one attempt in ms (default none) */
  timeoutMs?: number;
  /** User cancellation: never retried, rejects with the signal's reason */
  signal?: AbortSignal;
}

/** `Retry-After` values above this are not waited for (seconds). */
const MAX_RETRY_AFTER_S = 30;

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

/** Parses `Retry-After` (delta-seconds or HTTP date) into milliseconds. */
export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Math.round(parseFloat(trimmed) * 1000);
  const date = Date.parse(trimmed);
  if (!Number.isNaN(date)) return Math.max(0, date - now);
  return undefined;
}

/**
 * `fetch` with retries on HTTP 429 / 5xx / network errors / attempt timeouts.
 * Backoff is 1 s, 2 s, 4 s, ...; a `Retry-After` header (up to 30 s) replaces the
 * backoff, a longer one stops retrying. The final response (also an error
 * status) is returned so callers keep their own error messages.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  options: FetchRetryOptions = {}
): Promise<Response> {
  const retries = Math.max(0, Math.floor(options.retries ?? 2));
  const { signal, timeoutMs } = options;

  for (let attempt = 0; ; attempt++) {
    if (signal && signal.aborted) throw abortReason(signal);

    const timeoutController = new AbortController();
    const combined = combineSignals(signal, timeoutController.signal);
    const timer =
      timeoutMs && timeoutMs > 0
        ? setTimeout(
            () => timeoutController.abort(new Error(`request timed out after ${timeoutMs}ms`)),
            timeoutMs
          )
        : undefined;

    let response: Response | undefined;
    let failure: unknown;
    try {
      response = await fetch(url, { ...init, signal: combined.signal });
    } catch (err) {
      if (signal && signal.aborted) throw abortReason(signal);
      failure = timeoutController.signal.aborted && isAbortError(err)
        ? timeoutController.signal.reason
        : err;
    } finally {
      if (timer) clearTimeout(timer);
      combined.dispose();
    }

    if (response && !isRetryableStatus(response.status)) return response;

    const canRetry = attempt < retries;
    if (!canRetry) {
      if (response) return response;
      throw failure;
    }

    let delay = 1000 * Math.pow(2, attempt);
    if (response) {
      const retryAfter = parseRetryAfter(response.headers.get('retry-after'));
      if (retryAfter !== undefined) {
        if (retryAfter > MAX_RETRY_AFTER_S * 1000) return response;
        delay = retryAfter;
      }
      // Drain the body so the connection can be reused.
      await response.arrayBuffer().catch(() => undefined);
    }
    await sleep(delay, signal);
  }
}

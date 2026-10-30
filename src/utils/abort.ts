/**
 * AbortSignal helpers. `AbortSignal.any` needs Node 20, so the package ships its
 * own small implementation (engines.node >= 18).
 */

/** Creates an `AbortError` like the one `AbortController.abort()` produces. */
export function createAbortError(message = 'The operation was aborted'): Error {
  if (typeof DOMException === 'function') {
    return new DOMException(message, 'AbortError') as unknown as Error;
  }
  const err = new Error(message);
  err.name = 'AbortError';
  return err;
}

/** The error a rejected operation should throw for an aborted signal. */
export function abortReason(signal: AbortSignal): unknown {
  return signal.reason !== undefined ? signal.reason : createAbortError();
}

/** Throws the signal's abort reason when the signal is aborted. */
export function throwIfAborted(signal?: AbortSignal): void {
  if (signal && signal.aborted) throw abortReason(signal);
}

/** True for errors that represent a cancellation (never swallowed by `onError`). */
export function isAbortError(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { name?: string }).name === 'AbortError';
}

export interface CombinedSignal {
  /** `undefined` when no input signal was given */
  signal: AbortSignal | undefined;
  /** Removes the listeners installed on the input signals */
  dispose(): void;
}

/**
 * Returns a signal that aborts as soon as any of the given signals aborts (with
 * the same reason). Call `dispose()` when done to release the listeners.
 */
export function combineSignals(...signals: Array<AbortSignal | undefined | null>): CombinedSignal {
  const active = signals.filter((s): s is AbortSignal => !!s);
  if (active.length === 0) return { signal: undefined, dispose() {} };
  if (active.length === 1) return { signal: active[0], dispose() {} };

  const controller = new AbortController();
  const cleanups: Array<() => void> = [];
  const dispose = () => {
    while (cleanups.length) cleanups.pop()!();
  };

  for (const s of active) {
    if (s.aborted) {
      controller.abort(abortReason(s));
      dispose();
      return { signal: controller.signal, dispose() {} };
    }
  }
  for (const s of active) {
    const onAbort = () => {
      controller.abort(abortReason(s));
      dispose();
    };
    s.addEventListener('abort', onAbort, { once: true });
    cleanups.push(() => s.removeEventListener('abort', onAbort));
  }
  return { signal: controller.signal, dispose };
}

/** Resolves after `ms`, or rejects with the abort reason when `signal` aborts first. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) {
      reject(abortReason(signal));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortReason(signal!));
    };
    const timer = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });
}

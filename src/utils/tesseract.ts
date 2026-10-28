import { existsSync } from 'fs';
import { join } from 'path';
import type { OCROptions } from '../types/index.js';
import { abortReason } from './abort.js';
import { toTesseractLang } from './lang.js';

/** Upper bound for parallel tesseract workers. */
export const MAX_TESSERACT_WORKERS = 4;
/** `OEM.LSTM_ONLY`, the tesseract.js default. */
const DEFAULT_OEM = 1;

export interface TesseractRecognizeResult {
  text: string;
  confidence?: number;
}

export type TesseractWarn = (code: string, detail: string) => void;

function hasTesseractSettings(opts: OCROptions): boolean {
  const t = opts.tesseract;
  if (!t) return false;
  return Object.keys(t).some((k) => (t as Record<string, unknown>)[k] !== undefined);
}

function isRemote(path: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(path);
}

async function loadTesseract(): Promise<any> {
  try {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    return await import('tesseract.js');
  } catch {
    throw new Error(
      "OCR with 'tesseract' provider requires tesseract.js: npm install tesseract.js"
    );
  }
}

function raceAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    promise.catch(() => undefined);
    return Promise.reject(abortReason(signal));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortReason(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      }
    );
  });
}

/**
 * A lazily created tesseract engine shared by all OCR calls of one conversion:
 * one worker, or a scheduler with up to four workers when `concurrency > 1`.
 * `terminate()` must be called once in a `finally`.
 */
export class TesseractSession {
  private worker: any;
  private scheduler: any;
  private starting: Promise<void> | undefined;
  private terminated = false;
  /** Engine fully created (set synchronously with the assignment of worker/scheduler) */
  private ready = false;

  constructor(
    private readonly opts: OCROptions,
    private readonly warn?: TesseractWarn
  ) {}

  /** Number of workers this session spawns. */
  get workerCount(): number {
    const c = Math.floor(this.opts.concurrency ?? 1) || 1;
    return Math.max(1, Math.min(c, MAX_TESSERACT_WORKERS));
  }

  private checkOffline(lang: string): void {
    const t = this.opts.tesseract;
    if (!t || !t.offline) return;
    if (!t.langPath) {
      throw new Error('tesseract.offline requires tesseract.langPath (a directory with <lang>.traineddata files)');
    }
    if (isRemote(t.langPath)) return;
    const suffix = t.gzip === false ? '.traineddata' : '.traineddata.gz';
    for (const code of lang.split('+')) {
      const file = join(t.langPath, code + suffix);
      if (!existsSync(file)) {
        this.warn?.('tesseract_lang_missing', code);
        throw new Error(
          `Tesseract language data for '${code}' not found at ${file} (offline mode never downloads language data)`
        );
      }
    }
  }

  private async createOne(createWorker: (...args: any[]) => Promise<any>, lang: string): Promise<any> {
    let worker: any;
    if (!hasTesseractSettings(this.opts)) {
      // Legacy call: identical to 3.5.0.
      worker = await createWorker(lang);
    } else {
      const t = this.opts.tesseract!;
      const workerOptions: Record<string, unknown> = {};
      if (t.langPath !== undefined) workerOptions.langPath = t.langPath;
      if (t.cachePath !== undefined) workerOptions.cachePath = t.cachePath;
      if (t.gzip !== undefined) workerOptions.gzip = t.gzip;
      if (t.offline) workerOptions.cacheMethod = 'none';
      worker = await createWorker(lang, t.oem ?? DEFAULT_OEM, workerOptions);
    }
    const psm = this.opts.tesseract?.psm;
    if (psm !== undefined) {
      try {
        await worker.setParameters({ tessedit_pageseg_mode: String(psm) });
      } catch (err) {
        await worker.terminate().catch(() => undefined);
        throw err;
      }
    }
    return worker;
  }

  private async start(): Promise<void> {
    const lang = toTesseractLang(this.opts.lang) ?? 'eng';
    this.checkOffline(lang);
    const tesseract = await loadTesseract();
    this.assertAlive();
    const createWorker = tesseract.createWorker ?? tesseract.default?.createWorker;
    const count = this.workerCount;
    if (count <= 1) {
      const worker = await this.createOne(createWorker, lang);
      if (this.terminated) {
        // Disposed while the engine was starting: release it right away.
        await worker.terminate().catch(() => undefined);
        this.assertAlive();
      }
      this.worker = worker;
      this.ready = true;
      return;
    }
    const createScheduler = tesseract.createScheduler ?? tesseract.default?.createScheduler;
    const results = await Promise.allSettled(
      Array.from({ length: count }, () => this.createOne(createWorker, lang))
    );
    const workers = results.filter((r) => r.status === 'fulfilled').map((r) => (r as PromiseFulfilledResult<any>).value);
    const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
    if (failed) {
      await Promise.all(workers.map((w) => w.terminate().catch(() => undefined)));
      throw failed.reason;
    }
    if (this.terminated) {
      await Promise.all(workers.map((w) => w.terminate().catch(() => undefined)));
      this.assertAlive();
    }
    const scheduler = createScheduler();
    for (const w of workers) scheduler.addWorker(w);
    this.scheduler = scheduler;
    this.ready = true;
  }

  private assertAlive(): void {
    if (this.terminated) throw new Error('Tesseract session already terminated');
  }

  private ensure(): Promise<void> {
    if (!this.starting) this.starting = this.start();
    return this.starting;
  }

  async recognize(buffer: Buffer, signal?: AbortSignal): Promise<TesseractRecognizeResult> {
    this.assertAlive();
    await raceAbort(this.ensure(), signal);
    this.assertAlive();
    const worker = this.worker;
    const job: Promise<any> = this.scheduler
      ? this.scheduler.addJob('recognize', buffer)
      : worker.recognize(buffer);
    let data: any;
    try {
      ({ data } = await raceAbort(job, signal));
    } catch (err) {
      // tesseract.js cannot cancel a running job. After a timeout / cancellation the
      // single worker is dropped (and recreated on demand) so the next page does not
      // queue behind the abandoned one and inherit its remaining run time.
      if (signal?.aborted && worker && !this.scheduler && this.worker === worker && !this.terminated) {
        this.worker = undefined;
        this.starting = undefined;
        this.ready = false;
        worker.terminate().catch(() => undefined);
      }
      throw err;
    }
    const out: TesseractRecognizeResult = { text: (data?.text ?? '').trim() };
    if (typeof data?.confidence === 'number') out.confidence = data.confidence;
    return out;
  }

  async terminate(): Promise<void> {
    this.terminated = true;
    // A start still in flight (abort / dispose during the traineddata download) releases
    // its own workers once it notices `terminated`; do not wait for it.
    if (this.starting && !this.ready) {
      this.starting.catch(() => undefined);
      return;
    }
    const { worker, scheduler } = this;
    this.worker = undefined;
    this.scheduler = undefined;
    if (scheduler) await scheduler.terminate();
    else if (worker) await worker.terminate();
  }
}

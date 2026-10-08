export type TaskContext = {
  signal: AbortSignal;
  isCurrent: () => boolean;
};

type Job<T> = {
  value: T;
  version: number;
  run: (value: T, context: TaskContext) => Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
};

/** Keep one request in flight and retain only the newest queued request. */
export class LatestTask<T> {
  private version = 0;
  private running = false;
  private pending: Job<T> | null = null;
  private controller: AbortController | null = null;

  invalidate() {
    this.version++;
    this.controller?.abort();
    this.pending?.resolve();
    this.pending = null;
  }

  submit(value: T, run: Job<T>["run"]): Promise<void> {
    this.invalidate();
    return new Promise((resolve, reject) => {
      const job = { value, run, resolve, reject, version: this.version };
      if (this.running) this.pending = job;
      else void this.execute(job);
    });
  }

  private async execute(job: Job<T>) {
    this.running = true;
    const controller = new AbortController();
    this.controller = controller;
    try {
      await job.run(job.value, {
        signal: controller.signal,
        isCurrent: () => job.version === this.version && !controller.signal.aborted,
      });
      job.resolve();
    } catch (error) {
      job.reject(error);
    } finally {
      this.running = false;
      this.controller = null;
      const next = this.pending;
      this.pending = null;
      if (next) void this.execute(next);
    }
  }
}

/** Tauri rejects with strings; browser fetch rejects with Error objects. */
export function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return String(error);
}

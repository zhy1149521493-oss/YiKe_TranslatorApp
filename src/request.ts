export const TRANSLATION_TIMEOUT_MS = 60000;

/** Bound the complete operation, including response-body reads and native invokes. */
export async function boundedRequest<T>(
  run: (signal: AbortSignal) => Promise<T>, outer?: AbortSignal, timeoutMs = TRANSLATION_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectCancelled: (reason: unknown) => void = () => {};
  const cancelled = new Promise<never>((_, reject) => { rejectCancelled = reject; });
  const abort = () => {
    controller.abort();
    rejectCancelled(new DOMException("Request cancelled", "AbortError"));
  };
  outer?.addEventListener("abort", abort, { once: true });
  try {
    if (outer?.aborted) abort();
    else timer = setTimeout(() => {
      rejectCancelled(new Error(`翻译请求超时(${Math.round(timeoutMs / 1000)}s)`));
      controller.abort();
    }, timeoutMs);
    const work = outer?.aborted ? cancelled : run(controller.signal);
    return await Promise.race([work, cancelled]);
  } finally {
    if (timer) clearTimeout(timer);
    outer?.removeEventListener("abort", abort);
  }
}

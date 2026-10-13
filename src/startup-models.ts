/** Retry connection failures while Ollama starts; an empty successful list is final. */
export async function startupModels<T>(load: (signal: AbortSignal) => Promise<T[]>, signal: AbortSignal,
  pause: (signal: AbortSignal) => Promise<void> = retryPause, attempts = 12): Promise<T[]> {
  for (let attempt = 0; ; attempt++) {
    if (signal.aborted) throw new DOMException("Request cancelled", "AbortError");
    try { return await load(signal); }
    catch (error) {
      if (signal.aborted || attempt + 1 >= attempts) throw error;
      await pause(signal);
    }
  }
}

function retryPause(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new DOMException("Request cancelled", "AbortError")); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, 700);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}

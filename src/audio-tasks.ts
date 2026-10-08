import type { TaskContext } from "./latest-task";

export type AudioLine = { id: string; source: string; text: string; result: string; isFinal: boolean };
export type AudioJob = Omit<AudioLine, "result"> & { session: number };
type Job = { value: AudioJob; run: (value: AudioJob, context: TaskContext) => Promise<void> };

/** Preserve queued finals; coalesce partials of each utterance. One queue per source. */
export class AudioTaskQueue {
  private generation = 0;
  private running = false;
  private controller: AbortController | null = null;
  private pending: Job[] = [];

  invalidate() {
    this.generation++;
    this.pending = [];
    this.controller?.abort();
  }

  enqueue(value: AudioJob, run: Job["run"]) {
    const existing = this.pending.findIndex(job => job.value.id === value.id);
    if (existing >= 0) {
      if (this.pending[existing].value.isFinal && !value.isFinal) return;
      this.pending[existing] = { value, run };
    } else {
      // Keep finalized utterances and only the newest unfinalized utterance.
      this.pending = this.pending.filter(job => job.value.isFinal);
      this.pending.push({ value, run });
    }
    // Histories display at most three lines; bound queued work under slow inference.
    if (this.pending.length > 3) this.pending.shift();
    if (!this.running) void this.drain();
  }

  private async drain() {
    const job = this.pending.shift();
    if (!job) return;
    this.running = true;
    const generation = this.generation;
    const controller = new AbortController();
    this.controller = controller;
    try {
      await job.run(job.value, { signal: controller.signal, isCurrent: () => this.generation === generation && !controller.signal.aborted });
    } catch (error) {
      if (!controller.signal.aborted) console.error("Audio translation task failed", error);
    } finally {
      this.running = false;
      this.controller = null;
      void this.drain();
    }
  }
}

export function updateAudioLine(history: AudioLine[], job: AudioJob): AudioLine[] {
  const existing = history.find(line => line.id === job.id);
  if (existing?.isFinal) return history;
  const line: AudioLine = { ...job, result: job.isFinal && existing?.text !== job.text ? "" : existing?.result ?? "" };
  const updated = existing ? history.map(old => old.id === job.id ? line : old)
    : [...history.filter(old => old.id || old.source !== job.source), line];
  if (job.isFinal) updated.push({ id: "", source: job.source, text: "", result: "", isFinal: false });
  return updated.slice(-3);
}

export function applyAudioResult(history: AudioLine[], job: AudioJob, result: string): AudioLine[] {
  return history.map(line => line.id === job.id && line.text === job.text && (!line.isFinal || job.isFinal)
    ? { ...line, result } : line);
}

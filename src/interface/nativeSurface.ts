export interface SurfaceRect { x: number; y: number; width: number; height: number; radius: number }

/** Preserve the reading canvas while removing hidden desktop hit areas. */
export function navigationSurface(nav: DOMRect, logo: DOMRect, expanded: boolean, poetry: boolean): SurfaceRect {
  if (expanded) return { x: nav.x, y: nav.y, width: nav.width, height: nav.height, radius: poetry ? nav.height / 2 : 10 };
  return { x: logo.x,
    y: logo.y, width: logo.width, height: logo.height, radius: logo.height / 2 };
}

export function interpolateSurface(from: SurfaceRect, to: SurfaceRect, progress: number): SurfaceRect {
  const p = Math.min(1, Math.max(0, progress));
  // Match navigation's CSS cubic-bezier(.23, 1, .32, 1), including its time axis.
  let low = 0, high = 1;
  for (let i = 0; i < 18; i++) {
    const t = (low + high) / 2;
    const x = 3 * (1 - t) ** 2 * t * .23 + 3 * (1 - t) * t ** 2 * .32 + t ** 3;
    if (x < p) low = t; else high = t;
  }
  const ease = p === 0 || p === 1 ? p : 1 - (1 - (low + high) / 2) ** 3;
  return Object.fromEntries(Object.keys(to).map(key => {
    const k = key as keyof SurfaceRect;
    return [key, from[k] + (to[k] - from[k]) * ease];
  })) as unknown as SurfaceRect;
}

/** One IPC in flight; new targets interrupt from the displayed frame. */
export class SurfaceAnimator {
  private revision = 0;
  private running = false;
  private target: SurfaceRect | null = null;
  private current: SurfaceRect | null = null;
  private full: SurfaceRect = { x: 0, y: 0, width: 960, height: 640, radius: 0 };
  private duration = 0;
  private disposed = false;
  private lastRequest = "";
  constructor(private apply: (rect: SurfaceRect | null) => Promise<void>,
    private frame: () => Promise<number>, private now: () => number,
    private onError: (error: unknown) => void) {}
  update(target: SurfaceRect | null, full: SurfaceRect, duration: number, overlayKey = "") {
    const request = JSON.stringify([target, full, duration, overlayKey]);
    if (request === this.lastRequest) return;
    this.lastRequest = request;
    this.target = target; this.full = full; this.duration = duration; this.revision++;
    if (!this.running && !this.disposed) void this.run();
  }
  dispose() { this.disposed = true; this.revision++; }
  private async run() {
    this.running = true;
    try {
      while (!this.disposed) {
        const revision = this.revision;
        const target = this.target;
        const destination = target ?? this.full;
        const from = this.current ?? this.full;
        const duration = this.current === null && target === null ? 0 : this.duration;
        const start = this.now();
        let progress = duration ? 0 : 1;
        do {
          if (this.disposed || revision !== this.revision) break;
          this.current = interpolateSurface(from, destination, progress);
          await this.apply(progress === 1 ? target : this.current);
          if (progress === 1) break;
          progress = Math.min(1, ((await this.frame()) - start) / duration);
        } while (true);
        if (revision === this.revision) break;
      }
    } catch (error) {
      this.onError(error);
      try { await this.apply(null); } catch { /* Original error reported above. */ }
      this.current = null;
      this.lastRequest = "";
    } finally { this.running = false; }
  }
}

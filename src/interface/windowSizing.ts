import type { MainStyle } from "./model";

export type WindowSize = { width: number; height: number };
export type WindowSizes = Partial<Record<MainStyle, WindowSize>>;
export const WINDOW_SIZE_KEY = "yike.main-window.sizes.v1";
const defaults: Record<MainStyle, WindowSize> = {
  poetry: { width: 640, height: 860 },
  workbench: { width: 960, height: 640 },
  classic: { width: 960, height: 640 },
};
export function restoreWindowSizes(raw: string | null): WindowSizes {
  try {
    const parsed = JSON.parse(raw || "{}");
    const sizes: WindowSizes = {};
    for (const style of ["poetry", "workbench", "classic"] as const) {
      const size = parsed?.[style];
      if (size && Number.isFinite(size.width) && Number.isFinite(size.height)
        && size.width >= 320 && size.height >= 320 && size.width <= 10000 && size.height <= 10000)
        sizes[style] = { width: Math.round(size.width), height: Math.round(size.height) };
    }
    return sizes;
  } catch { return {}; }
}
export function windowSizePlan(style: MainStyle, saved?: WindowSize, area?: WindowSize) {
  const limit = area ? { width: Math.max(1, area.width - 32), height: Math.max(1, area.height - 32) }
    : { width: 10000, height: 10000 };
  const minimum = { width: Math.min(style === "poetry" ? 560 : 720, limit.width), height: Math.min(480, limit.height) };
  const preferred = saved || defaults[style];
  // Scale a new default uniformly on smaller monitors; retain user-set proportions.
  const scale = saved ? 1 : Math.min(1, limit.width / preferred.width, limit.height / preferred.height);
  const size = {
    width: Math.round(Math.max(minimum.width, Math.min(limit.width, preferred.width * scale))),
    height: Math.round(Math.max(minimum.height, Math.min(limit.height, preferred.height * scale))),
  };
  return { size, minimum };
}
const sameSize = (a: WindowSize, b?: WindowSize) => !!b && Math.abs(a.width - b.width) <= 1 && Math.abs(a.height - b.height) <= 1;
export type SizeSnapshot = { size: WindowSize; maximized: boolean; area?: WindowSize };
export type SizingPort = {
  snapshot(): Promise<SizeSnapshot>;
  apply(plan: ReturnType<typeof windowSizePlan>, snapshot: SizeSnapshot): Promise<void>;
  save(sizes: WindowSizes): void;
  error(error: unknown): void;
};

/** Serializes style changes and ignores resize events caused by our own sizing. */
export class StyleWindowSizing {
  private style?: MainStyle;
  private expected?: WindowSize;
  private revision = 0;
  private disposed = false;
  private changing = false;
  private restorePending = false;
  private chain: Promise<void> = Promise.resolve();
  private timer?: ReturnType<typeof setTimeout>;
  constructor(private port: SizingPort, private sizes: WindowSizes) {}
  private remember(snapshot: SizeSnapshot) {
    if (!this.style || snapshot.maximized || sameSize(snapshot.size, this.expected)) return;
    this.expected = undefined;
    if (!Number.isFinite(snapshot.size.width) || !Number.isFinite(snapshot.size.height)
      || snapshot.size.width < 320 || snapshot.size.height < 320) return;
    this.sizes = { ...this.sizes, [this.style]: snapshot.size };
    this.port.save(this.sizes);
  }
  select(style: MainStyle) {
    const revision = ++this.revision;
    clearTimeout(this.timer);
    this.chain = this.chain.then(async () => {
      if (this.disposed || revision !== this.revision) return;
      this.changing = true;
      try {
        const snapshot = await this.port.snapshot();
        if (this.disposed || revision !== this.revision) return;
        this.remember(snapshot);
        const plan = windowSizePlan(style, this.sizes[style], snapshot.area);
        await this.port.apply(plan, snapshot);
        // Even an interrupted application owns its applied size until the next job.
        this.style = style;
        this.expected = snapshot.maximized ? undefined : plan.size;
        this.restorePending = snapshot.maximized;
      } finally { this.changing = false; }
    }).catch(error => this.port.error(error));
    return this.chain;
  }
  resized() {
    if (this.disposed || this.changing || !this.style) return;
    clearTimeout(this.timer);
    const revision = this.revision;
    this.timer = setTimeout(() => {
      void this.port.snapshot().then(snapshot => {
        if (this.disposed || this.changing || revision !== this.revision) return;
        if (this.restorePending && !snapshot.maximized) {
          // Restoring a maximized window is not a manual resize of the new style.
          this.expected = snapshot.size;
          this.restorePending = false;
          void this.select(this.style!);
        } else this.remember(snapshot);
      }).catch(error => this.port.error(error));
    }, 300);
  }
  dispose() { this.disposed = true; ++this.revision; clearTimeout(this.timer); }
}

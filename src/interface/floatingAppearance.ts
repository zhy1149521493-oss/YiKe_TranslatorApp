export type AppearanceItem = { bg: string; opacity: number; textColor: string; fontSize: number };
export type SurfaceKey = "main" | "floating" | "audio" | "audioMic" | "subtitle";
export type AppearanceMap = Record<SurfaceKey, AppearanceItem>;
export type FloatingAppearance = { theme: "light" | "dark" | "system"; accent: string; appearance: AppearanceMap };
export const FLOATING_SURFACES = ["floating", "audio", "audioMic", "subtitle"] as const;

/** One in-flight write per WebView; intermediate slider positions coalesce to the latest value. */
export class FloatingOpacityWriter {
  private wanted: { surface: SurfaceKey; value: number } | null = null;
  private pending: Promise<void> | null = null;

  constructor(private save: (surface: SurfaceKey, value: number) => Promise<unknown>) {}

  update(surface: SurfaceKey, value: number): Promise<void> {
    this.wanted = { surface, value };
    return this.flush();
  }

  flush(): Promise<void> {
    if (this.pending) return this.pending;
    const drain = async () => {
      while (this.wanted) {
        const next = this.wanted;
        this.wanted = null;
        try { await this.save(next.surface, next.value); }
        catch (error) {
          // A failed final value stays dirty; a newer gesture supersedes it.
          this.wanted ??= next;
          throw error;
        }
      }
    };
    this.pending = drain().then(() => {
      this.pending = null;
      if (this.wanted) return this.flush();
    }, error => { this.pending = null; throw error; });
    return this.pending;
  }
}

/** Translation opacity is the migration source; other custom appearance values remain per surface. */
export function normalizeFloatingAppearance<T extends AppearanceMap>(appearance: T): T {
  return withFloatingOpacity(appearance, appearance.floating.opacity);
}

export function withFloatingOpacity<T extends AppearanceMap>(appearance: T, value: number): T {
  const opacity = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 88;
  const next = { ...appearance };
  for (const key of FLOATING_SURFACES) next[key] = { ...appearance[key], opacity };
  return next;
}

/** Opt-in reset for legacy explicit colors; main appearance and typography remain intact. */
export function followFloatingTheme<T extends AppearanceMap>(appearance: T): T {
  const next = { ...appearance };
  for (const key of FLOATING_SURFACES) next[key] = { ...appearance[key], bg: "", textColor: "" };
  return next;
}

function color(value: unknown, fallback = ""): string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

export function restoreFloatingAppearance(settings: unknown, defaults: AppearanceMap): FloatingAppearance {
  const saved = settings && typeof settings === "object" ? settings as Record<string, unknown> : {};
  const appearance = saved.appearance && typeof saved.appearance === "object" ? saved.appearance as Partial<AppearanceMap> : {};
  const merged = { ...defaults };
  for (const key of Object.keys(defaults) as SurfaceKey[]) {
    const item = appearance[key];
    merged[key] = {
      bg: color(item?.bg), textColor: color(item?.textColor),
      opacity: typeof item?.opacity === "number" && Number.isFinite(item.opacity) ? item.opacity : defaults[key].opacity,
      fontSize: typeof item?.fontSize === "number" && Number.isFinite(item.fontSize) && item.fontSize > 0 ? item.fontSize : defaults[key].fontSize,
    };
  }
  return {
    theme: saved.theme === "dark" || saved.theme === "system" ? saved.theme : "light",
    accent: color(saved.accentColor), appearance: normalizeFloatingAppearance(merged),
  };
}

function rgba(hex: string, alpha: number): string {
  const rgb = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16));
  return `rgba(${rgb.join(", ")}, ${alpha})`;
}

/** Shared warm-paper palette, independent of the chosen main-window layout. */
export function floatingThemeVariables(state: FloatingAppearance, surface: SurfaceKey, systemDark: boolean): Record<string, string> {
  const dark = state.theme === "dark" || (state.theme === "system" && systemDark);
  const item = state.appearance[surface];
  const accent = state.accent || (dark ? "#D9987F" : "#C8886D");
  const foreground = item.textColor || (dark ? "#E8E6E3" : "#2A2826");
  return {
    "--floating-card-bg": rgba(item.bg || (dark ? "#282624" : "#F9F7F4"), state.appearance.floating.opacity / 100),
    "--ios-text": foreground, "--ios-secondary": dark ? "#A39F99" : "#8A8784",
    "--ios-separator": dark ? "rgba(232, 230, 227, 0.12)" : "rgba(42, 40, 38, 0.12)",
    "--ios-blue": accent,
    "--ios-accent-rgb": [1, 3, 5].map(index => parseInt(accent.slice(index, index + 2), 16)).join(", "),
    "--scrollbar-thumb": dark ? "rgba(226, 215, 201, 0.3)" : "rgba(90, 78, 66, 0.28)",
    "--scrollbar-thumb-hover": dark ? "rgba(226, 215, 201, 0.48)" : "rgba(90, 78, 66, 0.48)",
    "--w-font": `${item.fontSize}px`,
  };
}

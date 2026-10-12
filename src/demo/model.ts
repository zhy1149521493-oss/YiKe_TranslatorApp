export type MainStyle = "poetry" | "workbench" | "classic";
export type Mode = "text" | "screenshot" | "subtitle" | "audio";
export type Theme = "light" | "dark" | "system";
export type Tone = "light" | "dark";
export type Scenario = "sample" | "empty" | "loading" | "error" | "long";
export type Phase = "idle" | "loading" | "success" | "error";
export type AudioSource = "system" | "mic" | "both";
export type Preferences = {
  mainStyle: MainStyle;
  floatingStyle: "classic" | "capsule";
  theme: Theme;
  accent: "clay" | "ocean" | "forest" | "custom";
  customAccent: string;
  background: Record<Tone, string | null>;
  foreground: Record<Tone, string | null>;
  fontSize: number;
};
export const STORAGE_KEY = "yike-design-demo-v1";
export const defaults: Preferences = {
  mainStyle: "poetry",
  floatingStyle: "capsule",
  theme: "light",
  accent: "clay",
  customAccent: "#C8886D",
  background: { light: null, dark: null },
  foreground: { light: null, dark: null },
  fontSize: 16,
};
const isColor = (value: unknown): value is string =>
  typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
// Preview preferences have their own schema and storage key; never migrate app config here.
export function normalizePreferences(value: unknown): Preferences {
  const raw =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const colors = (input: unknown): Record<Tone, string | null> => {
    const pair =
      input && typeof input === "object"
        ? (input as Record<string, unknown>)
        : {};
    return {
      light: isColor(pair.light) ? pair.light : null,
      dark: isColor(pair.dark) ? pair.dark : null,
    };
  };
  return {
    mainStyle: ["poetry", "workbench", "classic"].includes(
      String(raw.mainStyle),
    )
      ? (raw.mainStyle as MainStyle)
      : defaults.mainStyle,
    floatingStyle: raw.floatingStyle === "classic" ? "classic" : "capsule",
    theme: ["light", "dark", "system"].includes(String(raw.theme))
      ? (raw.theme as Theme)
      : defaults.theme,
    accent: ["clay", "ocean", "forest", "custom"].includes(String(raw.accent))
      ? (raw.accent as Preferences["accent"])
      : defaults.accent,
    customAccent: isColor(raw.customAccent)
      ? raw.customAccent
      : defaults.customAccent,
    background: colors(raw.background),
    foreground: colors(raw.foreground),
    fontSize:
      typeof raw.fontSize === "number" && Number.isFinite(raw.fontSize)
        ? Math.max(14, Math.min(22, raw.fontSize))
        : 16,
  };
}
export function themeColors(prefs: Preferences, tone: Tone) {
  const accents = {
    clay: ["#C8886D", "#D9987F"],
    ocean: ["#7A9299", "#8FA8AF"],
    forest: ["#70866C", "#A4B59A"],
  };
  const accent =
    prefs.accent === "custom"
      ? prefs.customAccent
      : accents[prefs.accent][tone === "dark" ? 1 : 0];
  const components = [1, 3, 5]
    .map((offset) => parseInt(accent.slice(offset, offset + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const luminance =
    components[0] * 0.2126 + components[1] * 0.7152 + components[2] * 0.0722;
  return {
    accent,
    actionInk: luminance > 0.179 ? "#1A1816" : "#FFFFFF",
    background:
      prefs.background[tone] ?? (tone === "dark" ? "#1A1816" : "#F9F7F4"),
    foreground:
      prefs.foreground[tone] ?? (tone === "dark" ? "#E8E6E3" : "#2A2826"),
  };
}
export const modes = [
  {
    id: "text",
    label: "文本翻译",
    short: "文本",
    icon: "pen",
    hint: "输入文字，静静等待理解发生。",
  },
  {
    id: "screenshot",
    label: "截图翻译",
    short: "截图",
    icon: "camera",
    hint: "框选一处，把画面里的文字带到这里。",
  },
  {
    id: "subtitle",
    label: "视频字幕",
    short: "字幕",
    icon: "film",
    hint: "让屏幕上的对白，成为读得懂的文字。",
  },
  {
    id: "audio",
    label: "音频翻译",
    short: "音频",
    icon: "mic",
    hint: "听见声音，也听懂声音。",
  },
] as const;
export const languages = [
  ["auto", "自动检测"],
  ["zh", "中文"],
  ["en", "English"],
  ["ja", "日本語"],
  ["ko", "한국어"],
  ["fr", "Français"],
  ["de", "Deutsch"],
  ["es", "Español"],
  ["ru", "Русский"],
  ["ar", "العربية"],
  ["pt", "Português"],
  ["it", "Italiano"],
  ["th", "ไทย"],
  ["vi", "Tiếng Việt"],
  ["sv", "Svenska"],
  ["hi", "हिन्दी"],
  ["tr", "Türkçe"],
  ["nl", "Nederlands"],
  ["pl", "Polski"],
] as const;
export const sampleSource =
  "The best way to predict the future is to invent it.\n\nSimplicity is the ultimate sophistication.\n\nDesign is not just what it looks like and feels like. Design is how it works.\n\nThis interface reimagines translation as a reading experience — like opening a beautifully bound book of poetry. The vertical document flow, serif typography, and paper-like texture create a sense of calm and focus.";
export const sampleResult =
  "预测未来的最好方法就是创造它。\n\n简约是极致的复杂。\n\n设计不仅仅是外观和感觉。设计是它如何工作。\n\n这个界面将翻译重新构想为一种阅读体验——就像打开一本装帧精美的诗集。垂直的文档流、衬线字体和纸质纹理营造出一种平静和专注的感觉。";
export type TaskState = {
  source: string;
  result: string;
  phase: Phase;
  running: boolean;
  region: boolean;
};
export type PreviewState = {
  mode: Mode;
  tasks: Record<Mode, TaskState>;
  src: string;
  tgt: string;
  audioSource: AudioSource;
  scenario: Scenario;
  model: string;
};
export const createTask = (source = "", result = ""): TaskState => ({
  source,
  result,
  phase: result ? "success" : "idle",
  running: false,
  region: false,
});

/** Explicit fixture correspondence only; paragraph counts are not an aligner. */
export function fixturePairs(task: TaskState) {
  if (task.phase !== "success") return null;
  const repeats =
    task.source === sampleSource
      ? 1
      : task.source === Array(12).fill(sampleSource).join("\n\n")
        ? 12
        : 0;
  if (
    !repeats ||
    task.result !== Array(repeats).fill(sampleResult).join("\n\n")
  )
    return null;
  const source = sampleSource.split("\n\n");
  const target = sampleResult.split("\n\n");
  if (source.length !== target.length) return null;
  return Array.from({ length: repeats }, (_, chapter) =>
    source.map((text, paragraph) => ({
      id: `${chapter}-${paragraph}`,
      source: text,
      target: target[paragraph],
    })),
  ).flat();
}
export function createPreviewState(): PreviewState {
  return {
    mode: "text",
    tasks: {
      text: createTask(sampleSource, sampleResult),
      screenshot: createTask(),
      subtitle: createTask(),
      audio: createTask(),
    },
    src: "auto",
    tgt: "zh",
    audioSource: "system",
    scenario: "sample",
    model: "HY-MT2 · 本地",
  };
}
export type PreviewAction =
  | { type: "mode"; mode: Mode }
  | { type: "edit"; text: string }
  | { type: "scenario"; scenario: Scenario }
  | { type: "task"; mode: Mode; patch: Partial<TaskState> }
  | { type: "language"; side: "src" | "tgt"; value: string }
  | { type: "swap" }
  | { type: "audio"; source: AudioSource }
  | { type: "model"; model: string };
export function previewReducer(
  state: PreviewState,
  action: PreviewAction,
): PreviewState {
  switch (action.type) {
    case "mode":
      return { ...state, mode: action.mode };
    case "edit":
      return {
        ...state,
        tasks: {
          ...state.tasks,
          text: {
            ...state.tasks.text,
            source: action.text,
            result: "",
            phase: "idle",
          },
        },
      };
    case "task":
      return {
        ...state,
        tasks: {
          ...state.tasks,
          [action.mode]: { ...state.tasks[action.mode], ...action.patch },
        },
      };
    case "language":
      return { ...state, [action.side]: action.value };
    case "swap":
      return state.src === "auto"
        ? state
        : { ...state, src: state.tgt, tgt: state.src };
    case "audio":
      return { ...state, audioSource: action.source };
    case "model":
      return { ...state, model: action.model };
    case "scenario": {
      const source =
        action.scenario === "empty"
          ? ""
          : action.scenario === "long"
            ? Array(12).fill(sampleSource).join("\n\n")
            : sampleSource;
      const result =
        action.scenario === "sample"
          ? sampleResult
          : action.scenario === "long"
            ? Array(12).fill(sampleResult).join("\n\n")
            : "";
      const phase: Phase =
        action.scenario === "loading"
          ? "loading"
          : action.scenario === "error"
            ? "error"
            : result
              ? "success"
              : "idle";
      return {
        ...state,
        scenario: action.scenario,
        tasks: {
          ...state.tasks,
          [state.mode]: {
            ...createTask(source, result),
            phase,
            region: state.mode === "subtitle" && action.scenario !== "empty",
            running: phase === "loading",
          },
        },
      };
    }
  }
}
export function clampPanel(
  x: number,
  y: number,
  width: number,
  height: number,
  bounds: { width: number; height: number },
) {
  return {
    x: Math.max(8, Math.min(x, bounds.width - width - 8)),
    y: Math.max(
      8,
      Math.min(y, bounds.height - Math.min(height, bounds.height - 16) - 8),
    ),
  };
}

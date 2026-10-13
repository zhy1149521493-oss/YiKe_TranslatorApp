import { useEffect, useRef, useState, useCallback, type CSSProperties } from "react";
import { invoke, Channel } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { currentMonitor } from "@tauri-apps/api/window";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { version as appVersion } from "../src-tauri/tauri.conf.json";
import { LatestTask, errorMessage } from "./latest-task";
import { detectLang, similarity } from "./text-tools";
import { boundedRequest } from "./request";
import { AudioTaskQueue, updateAudioLine, applyAudioResult } from "./audio-tasks";
import type { AudioLine, AudioJob } from "./audio-tasks";
type AudioEvent = { source: string; text: string; id: string; session: number };
type ScreenCapture = { b64: string; x: number; y: number };
import "./App.css";
import "./Studio.css";
import { ConnectedMain } from "./interface/ConnectedMain";
import type { InterfaceController, LanguagePair } from "./interface/controller";
import type { AudioChannel, MainStyle } from "./interface/model";
import { restoreDesign, restoreAudioLanguages } from "./interface/preferences";
import { useStyleWindowSize } from "./interface/useStyleWindowSize";
import { ConfigWriter } from "./config-writer";
import { useFrontendReady } from "./startup";
import { startupModels } from "./startup-models";
import { FloatingChrome, FloatingHint, FloatingOpacity } from "./interface/FloatingChrome";
import { useFloatingAppearance } from "./interface/useFloatingAppearance";
import { AudioSensitivityWriter } from "./audio-sensitivity";
import { normalizeFloatingAppearance, withFloatingOpacity, followFloatingTheme } from "./interface/floatingAppearance";

const appWindow = getCurrentWebviewWindow();

/* ============ Wave 9: 设置中心 / 外观 / 快捷键 ============ */
type SurfaceKey = "main" | "floating" | "audio" | "audioMic" | "subtitle";
type AppearanceItem = { bg: string; opacity: number; textColor: string; fontSize: number };
type ShortcutAction = "toggle-floating" | "screenshot" | "toggle-subtitle" | "toggle-audio-subtitle";

const SURFACE_LABELS: Record<SurfaceKey, string> = {
  main: "主窗口",
  floating: "翻译悬浮窗",
  audio: "电脑音频窗",
  audioMic: "麦克风窗",
  subtitle: "视频字幕窗",
};

const DEFAULT_APPEARANCE: Record<SurfaceKey, AppearanceItem> = {
  main: { bg: "", opacity: 100, textColor: "", fontSize: 15 },
  floating: { bg: "", opacity: 88, textColor: "", fontSize: 14 },
  audio: { bg: "", opacity: 88, textColor: "", fontSize: 14 },
  audioMic: { bg: "", opacity: 88, textColor: "", fontSize: 14 },
  subtitle: { bg: "", opacity: 88, textColor: "", fontSize: 14 },
};

const DEFAULT_SHORTCUTS: Record<ShortcutAction, string> = {
  "toggle-floating": "Ctrl+Shift+D",
  screenshot: "Ctrl+Shift+S",
  "toggle-subtitle": "Ctrl+Shift+U",
  "toggle-audio-subtitle": "",
};

const SHORTCUT_LABELS: Record<ShortcutAction, string> = {
  "toggle-floating": "划词翻译(悬浮窗开关)",
  screenshot: "截图翻译",
  "toggle-subtitle": "视频字幕",
  "toggle-audio-subtitle": "音频字幕",
};

/* 悬浮窗外观预览的示例句子:每次打开设置页随机取一对(第一行原文,第二行翻译) */
const FLOATING_SAMPLE_LINES: [string, string][] = [
  ["We are the ones who make a brighter day, so let's start giving.", "创造美好的未来要靠我们，所以，让我们开始奉献自己。"],
  ["To be, or not to be: that is the question.", "生存还是毁灭，这是一个问题。"],
  ["古池や 蛙飛びこむ 水の音", "古池——青蛙跳入，水声。"],
  ["Über allen Gipfeln ist Ruh.", "群山之巅，一片寂静。"],
  ["Caminante, no hay camino, se hace camino al andar.", "行路人，本没有路，路是走出来的。"],
  ["Если жизнь тебя обманет", "假如生活欺骗了你"],
  ["Ἄνδρα μοι ἔννεπε, Μοῦσα...", "请告诉我，那位英雄"],
  ["Nel mezzo del cammin di nostra vita", "在人生旅途的中途……"],
  ["Demain, dès l'aube, à l'heure où blanchit la campagne", "明天，黎明时分，当原野开始泛白"],
  ["落霞与孤鹜齐飞，秋水共长天一色", "The rainbow clouds with lonely bird together fly,The autumn water blends with the endless blue sky"],
];

const SETTINGS_NAV: [string, string][] = [
  ["general", "常规"],
  ["translate", "翻译"],
  ["audio", "音频"],
  ["subtitle", "视频字幕"],
  ["floating", "悬浮窗"],
  ["providers", "模型"],
  ["shortcuts", "快捷键"],
  ["about", "关于"],
];

/* 配置合并:旧配置缺失的项用默认值补齐 */
function mergeAppearance(
  base: Record<SurfaceKey, AppearanceItem>,
  patch?: Partial<Record<SurfaceKey, Partial<AppearanceItem>>>
): Record<SurfaceKey, AppearanceItem> {
  const out = {} as Record<SurfaceKey, AppearanceItem>;
  for (const k of Object.keys(base) as SurfaceKey[]) {
    out[k] = { ...base[k], ...(patch?.[k] ?? {}) };
  }
  return out;
}

function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return `rgba(255,255,255,${alpha})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/* 主题色(强调色)十六进制 → "r, g, b" 三元组(CSS rgba(var(--ios-accent-rgb), α) 用) */
function hexToRgbTriplet(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "0, 122, 255";
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

/* 把主题 + 某界面的外观应用到当前窗口(设置 <html data-theme> + CSS 变量)。
   bg/textColor 留空 = 跟随主题默认;字体大小/背景透明度即时生效;
   accent 留空 = 使用主题默认强调色,否则覆盖 --ios-blue / --ios-accent-rgb */
function applyWindowTheme(
  surface: SurfaceKey,
  theme: string,
  appearance: Record<SurfaceKey, AppearanceItem>,
  accent?: string
) {
  const resolved =
    theme === "system"
      ? window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme;
  document.documentElement.dataset.theme = resolved;
  const item = appearance[surface] ?? DEFAULT_APPEARANCE[surface];
  const st = document.documentElement.style;
  const acc = (accent ?? "").trim() || (resolved === "dark" ? "#D9987F" : "#C8886D");
  if (acc) {
    st.setProperty("--ios-blue", acc);
    st.setProperty("--ios-accent-rgb", hexToRgbTriplet(acc));
    const rgb = hexToRgbTriplet(acc).split(",").map(Number).map(channel => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    const luminance = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
    st.setProperty("--studio-on-accent", luminance > 0.179 ? "#000000" : "#ffffff");
  } else {
    st.removeProperty("--ios-blue");
    st.removeProperty("--ios-accent-rgb");
    st.removeProperty("--studio-on-accent");
  }
  if (item.textColor) st.setProperty("--ios-text", item.textColor);
  else st.removeProperty("--ios-text");
  if (item.fontSize) st.setProperty("--w-font", `${item.fontSize}px`);
  else st.removeProperty("--w-font");
  const alpha = Math.max(0, Math.min(1, item.opacity / 100));
  if (surface === "main") {
    if (item.bg) st.setProperty("--ios-bg", hexToRgba(item.bg, alpha));
    else st.removeProperty("--ios-bg");
  } else {
    const base = item.bg || (resolved === "dark" ? "#2c2c2e" : "#ffffff");
    st.setProperty("--floating-card-bg", hexToRgba(base, alpha));
  }
}

/* 快捷键录制:keydown → accelerator。
   仅支持 字母/数字/F1-F12/空格/方向键 + 至少一个修饰键(Ctrl/Alt/Shift);
   拒绝无修饰符裸键、单独左右键、Win 系与系统保留组合 */
function keyEventToAccelerator(e: KeyboardEvent): { ok: boolean; combo: string; reason?: string } {
  if (e.metaKey) return { ok: false, combo: "", reason: "不支持 Win 键组合(系统保留)" };
  const mods: string[] = [];
  if (e.ctrlKey) mods.push("Ctrl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  let key = "";
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (/^Digit[0-9]$/.test(e.code)) key = e.code.slice(5);
  else if (/^F([1-9]|1[0-2])$/.test(e.code)) key = e.code;
  else if (e.code === "Space") key = "Space";
  else if (e.code.startsWith("Arrow")) key = e.code.slice(5);
  else return { ok: false, combo: "", reason: "请使用字母 / 数字 / F1-F12 / 空格 / 方向键" };
  if (mods.length === 0) return { ok: false, combo: "", reason: "至少需要一个修饰键(Ctrl / Alt / Shift),防误触" };
  const combo = [...mods, key].join("+");
  const reserved = ["Alt+F4", "Ctrl+Alt+Del", "Ctrl+Shift+Esc", "Alt+Tab", "Ctrl+Esc", "Alt+Space", "Alt+F2", "Alt+F7", "Alt+F8", "Alt+F10", "Alt+F11", "Alt+F12"];
  if (reserved.includes(combo)) return { ok: false, combo: "", reason: "该组合为系统保留,换一个" };
  // 常用冲突拦截:单修饰键组合(如 Ctrl+C/V/X/A/S 等)全局注册会劫持系统/软件快捷键
  if (mods.length === 1) {
    if (mods[0] === "Ctrl") return { ok: false, combo: "", reason: `${combo} 是系统常用快捷键(复制/粘贴/全选等),全局注册会冲突,请改用 Ctrl+Shift+组合` };
    if (mods[0] === "Alt") return { ok: false, combo: "", reason: `${combo} 与系统/软件菜单快捷键冲突,请改用 Ctrl+Shift+组合` };
    if (mods[0] === "Shift") return { ok: false, combo: "", reason: `${combo} 会干扰正常打字,请改用 Ctrl+Shift+组合` };
  }
  if (mods.length === 2 && mods.includes("Ctrl") && mods.includes("Alt")) {
    return { ok: false, combo: "", reason: `${combo} 可能与系统组合冲突,请改用 Ctrl+Shift+组合` };
  }
  return { ok: true, combo };
}

/* ============ SVG 图标集(替代 emoji;手写 stroke 风格,可随 currentColor 变色) ============ */
type IconName =
  | "pen" | "mic" | "film" | "camera" | "clipboard" | "settings" | "globe" | "dot"
  | "clock" | "sparkle" | "search" | "flask" | "trash" | "plus" | "up" | "down"
  | "check" | "warn" | "error" | "minimize" | "maximize" | "restore" | "close"
  | "windows" | "target" | "volume" | "chevron" | "swap" | "play" | "stop"
  | "refresh" | "download" | "folder";

function Icon({ name, size = 16, className, style }: { name: IconName; size?: number; className?: string; style?: CSSProperties }) {
  const p: Record<IconName, React.ReactNode> = {
    pen: (<><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" /></>),
    mic: (<><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10a7 7 0 0 0 14 0" /><path d="M12 19v3" /></>),
    film: (<><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M7 5v14M17 5v14M2 9h5M2 15h5M17 9h5M17 15h5" /></>),
    camera: (<><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></>),
    clipboard: (<><rect x="8" y="2" width="8" height="4" rx="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /></>),
    settings: (<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></>),
    globe: (<><circle cx="12" cy="12" r="10" /><path d="M2 12h20" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></>),
    dot: (<circle cx="12" cy="12" r="6" fill="currentColor" stroke="none" />),
    clock: (<><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></>),
    sparkle: (<path d="M12 3l1.9 5.7L20 11l-6.1 2.3L12 19l-1.9-5.7L4 11l6.1-2.3L12 3z" />),
    search: (<><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></>),
    flask: (<><path d="M10 2v6L4.5 18a2 2 0 0 0 1.8 3h11.4a2 2 0 0 0 1.8-3L14 8V2" /><path d="M8.5 2h7" /><path d="M7 16h10" /></>),
    trash: (<><path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /></>),
    plus: (<path d="M12 5v14M5 12h14" />),
    up: (<path d="M12 19V5M5 12l7-7 7 7" />),
    down: (<path d="M12 5v14M19 12l-7 7-7-7" />),
    check: (<path d="M20 6L9 17l-5-5" />),
    warn: (<><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><path d="M12 9v4" /><path d="M12 17h.01" /></>),
    error: (<path d="M18 6L6 18M6 6l12 12" />),
    minimize: (<path d="M5 12h14" />),
    maximize: (<rect x="4" y="4" width="16" height="16" rx="1" />),
    restore: (<><rect x="4" y="4" width="12" height="12" rx="1" /><path d="M8 8h12v12" /></>),
    close: (<path d="M18 6L6 18M6 6l12 12" />),
    windows: (<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18" /></>),
    target: (<><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></>),
    volume: (<><path d="M11 5L6 9H2v6h4l5 4V5z" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /></>),
    chevron: (<path d="M6 9l6 6 6-6" />),
    swap: (<><path d="M7 4v13M3 13l4 4 4-4" /><path d="M17 20V7M13 11l4-4 4 4" /></>),
    play: (<path d="M6 4l14 8-14 8V4z" />),
    stop: (<rect x="5" y="5" width="14" height="14" rx="1" />),
    refresh: (<><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" /></>),
    download: (<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 10l5 5 5-5" /><path d="M12 15V3" /></>),
    folder: (<><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></>),
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} style={style} aria-hidden="true">
      {p[name]}
    </svg>
  );
}

/* ============ 常量 ============ */
const OLLAMA_BASE = "http://127.0.0.1:11434";
const OLLAMA_API = `${OLLAMA_BASE}/api/generate`;
const CTX_OPTIONS = [512, 1024, 2048, 4096];
const DEBOUNCE_MS = 600;

const LANGS = [
  { code: "auto", label: "自动检测" },
  { code: "zh", label: "中文" },
  { code: "en", label: "英语 (English)" },
  { code: "ja", label: "日语 (日本語)" },
  { code: "ko", label: "韩语 (한국어)" },
  { code: "fr", label: "法语 (Français)" },
  { code: "es", label: "西班牙语 (Español)" },
  { code: "de", label: "德语 (Deutsch)" },
  { code: "pt", label: "葡萄牙语 (Português)" },
  { code: "it", label: "意大利语 (Italiano)" },
  { code: "ru", label: "俄语 (Русский)" },
  { code: "ar", label: "阿拉伯语 (العربية)" },
  { code: "hi", label: "印地语 (हिन्दी)" },
  { code: "vi", label: "越南语 (Tiếng Việt)" },
  { code: "th", label: "泰语 (ภาษาไทย)" },
  { code: "tr", label: "土耳其语 (Türkçe)" },
  { code: "nl", label: "荷兰语 (Nederlands)" },
  { code: "pl", label: "波兰语 (Polski)" },
  { code: "sv", label: "瑞典语 (Svenska)" },
];

const LANG_MAP: Record<string, string> = {};
LANGS.forEach((l) => {
  if (l.code !== "auto") LANG_MAP[l.code] = l.label;
});
/* 音频识别(ASR)支持的语言:内嵌 sherpa-onnx 只接了 中/英/日/韩(auto=自动检测) */
const AUDIO_ASR_LANGS = ["auto", "zh", "en", "ja", "ko"];

/* ============ 工具 ============ */
function useWindowTheme(surface: SurfaceKey, theme: string, appearance: Record<SurfaceKey, AppearanceItem>, accent?: string) {
  useEffect(() => {
    const apply = () => applyWindowTheme(surface, theme, appearance, accent);
    apply();
    if (theme !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [surface, theme, appearance, accent]);
}

/* 本地模型大小显示:字节 → MB / GB */
function formatModelSize(bytes: number): string {
  if (!bytes || bytes <= 0) return "";
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) return `${Math.round(mb)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

/* 下载速度/剩余时间显示 */
function formatSpeed(bps: number): string {
  if (!bps || bps <= 0) return "";
  if (bps >= 1024 * 1024 * 1024) return `${(bps / (1024 ** 3)).toFixed(2)} GB/s`;
  if (bps >= 1024 * 1024) return `${(bps / (1024 ** 2)).toFixed(1)} MB/s`;
  if (bps >= 1024) return `${Math.round(bps / 1024)} KB/s`;
  return `${Math.round(bps)} B/s`;
}
function formatEta(sec: number): string {
  if (sec < 60) return `${Math.round(sec)} 秒`;
  if (sec < 3600) return `${Math.floor(sec / 60)} 分 ${Math.round(sec % 60)} 秒`;
  return `${Math.floor(sec / 3600)} 时 ${Math.floor((sec % 3600) / 60)} 分`;
}
const PULL_STATUS_TEXT: Record<string, string> = {
  "downloading": "下载中",
  "pulling manifest": "获取清单…",
  "verifying sha256 digest": "校验文件…",
  "writing manifest": "写入清单…",
  "removing any unused layers": "清理旧层…",
  "success": "完成",
};

function buildPrompt(
  source: string,
  target: string,
  text: string
): string {  const srcName = source === "auto" ? "its original language (detect it automatically)" : LANG_MAP[source] || source;
  const tgtName = LANG_MAP[target] || target;
  return `Translate the following text from ${srcName} to ${tgtName}. Only output the translated text, no explanations, no notes: ${text}`;
}

/* ============ Ollama 调用 ============ */
async function fetchOllamaStream(
  model: string,
  source: string,
  target: string,
  text: string,
  numCtx: number,
  onToken: (t: string) => void,
  signal?: AbortSignal
) {
  const resp = await fetch(OLLAMA_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      prompt: buildPrompt(source, target, text),
      stream: true,
      options: { temperature: 0.1, num_ctx: numCtx, enable_thinking: false },
    }),
    signal,
  });
  if (!resp.ok) throw new Error(`Ollama API ${resp.status}`);
  const reader = resp.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const data = JSON.parse(line);
        const token = data.response;
        if (token) onToken(token);
        if (data.done) return;
      } catch {
        /* skip */
      }
    }
  }
}

async function fetchOllamaFull(
  model: string,
  source: string,
  target: string,
  text: string,
  numCtx: number,
  signal?: AbortSignal
): Promise<string> {
  const resp = await fetch(OLLAMA_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      prompt: buildPrompt(source, target, text),
      stream: false,
      options: { temperature: 0.1, num_ctx: numCtx, enable_thinking: false },
    }),
    signal,
  });
  if (!resp.ok) throw new Error(`Ollama API ${resp.status}`);
  const data = await resp.json();
  return data.response?.trim() ?? "(空响应)";
}

/* ============ 外接 API(第 8 波:OpenAI 兼容翻译后端) ============ */
type LocalModelInfo = { name: string; size: number; modified_at: string };

type ProviderCfg = {
  id: string;
  alias: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  models: string[];
  temperature: string; // 留空=不发送(用模型默认);部分模型只接受特定值(如 Kimi 只允许 1)
  noThinking: string;  // "1"=发送 thinking:disabled(推理模型秒出译文,不支持该参数的供应商会报错)
};
type EngineMode = "local" | "api" | "auto";

/* 快捷预设:新建供应商时一键填 Base URL + 常见模型(仍可手改) */
const PROVIDER_PRESETS: { name: string; baseUrl: string; models: string[] }[] = [
  { name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", models: ["deepseek-chat", "deepseek-reasoner"] },
  { name: "通义千问", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", models: ["qwen-plus", "qwen-turbo", "qwen-max"] },
  { name: "Kimi/Moonshot", baseUrl: "https://api.moonshot.cn/v1", models: ["moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"] },
  { name: "智谱 GLM", baseUrl: "https://open.bigmodel.cn/api/paas/v4", models: ["glm-4-flash", "glm-4-plus", "glm-4-air"] },
  { name: "OpenAI", baseUrl: "https://api.openai.com/v1", models: ["gpt-4o-mini", "gpt-4o"] },
];

/* 当前引擎配置镜像:MainWindow 每次渲染同步,供模块级路由函数读取 */
let engineCfg: { mode: EngineMode; providers: ProviderCfg[]; activeProviderId: string } = {
  mode: "local",
  providers: [],
  activeProviderId: "",
};
/* 本地模型列表镜像:MainWindow 渲染时同步,供 translateStream/translateFull 做“未配置模型”守卫 */
let localModelStore: LocalModelInfo[] = [];
let localModelsReady = false;
let localModelDiscovery: Promise<void> = Promise.resolve();

function activeProvider(): ProviderCfg | null {
  return engineCfg.providers.find((p) => p.id === engineCfg.activeProviderId) ?? null;
}

/* 温度输入 → 数字或 null(留空则不发送该参数) */
function parseTemperature(p: ProviderCfg): number | null {
  const s = p.temperature?.trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/* API 调用超时竞速:invoke 无法中止,超时后先报错让管线继续(后台请求仍会自然结束) */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label}超时(${Math.round(ms / 1000)}s)`)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

/* 发起请求前选引擎:api=必须外接(未配置报错);auto=有有效外接配置用外接,否则本地。
   请求失败一律直接报错,绝不中途回退本地(避免朋友机器无模型/显卡内存爆掉) */
function resolveEngine(): { kind: "local" } | { kind: "api"; provider: ProviderCfg } {
  const provider = activeProvider();
  const valid = !!provider && !!provider.baseUrl.trim() && !!provider.apiKey.trim() && !!provider.model.trim();
  if (engineCfg.mode === "api") {
    if (!valid) throw new Error("外接 API 未配置完整,请填写 Base URL / API Key / 模型");
    return { kind: "api", provider: provider! };
  }
  if (engineCfg.mode === "auto" && valid) return { kind: "api", provider: provider! };
  return { kind: "local" };
}

/* OpenAI 兼容 /chat/completions 流式(SSE):走 Rust 代理。
   Rust 侧无 CORS 限制(支持 tokenhub 这类不做浏览器 CORS 的中转站),统一 60s 超时;
   invoke 无法中途中止,调用方需在 onToken 里自行丢弃过期流的 token */
async function fetchApiStream(
  provider: ProviderCfg,
  source: string,
  target: string,
  text: string,
  onToken: (t: string) => void,
  signal?: AbortSignal,
  onReasoning?: (r: string) => void
) {
  const ch = new Channel<string>();
  ch.onmessage = (t) => {
    if (signal?.aborted) return;
    try {
      const m = JSON.parse(t);
      if (m && typeof m.c === "string") onToken(m.c);
      else if (m && typeof m.r === "string") onReasoning?.(m.r);
    } catch {
      onToken(t); // 兼容纯文本帧
    }
  };
  await withTimeout(
    invoke<string>("api_chat", {
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      model: provider.model,
      messages: [{ role: "user", content: buildPrompt(source, target, text) }],
      temperature: parseTemperature(provider),
      noThinking: provider.noThinking === "1",
      stream: true,
      onToken: ch,
    }),
    65000,
    "外接 API 翻译"
  );
}

/* OpenAI 兼容 /chat/completions 一次性输出(走 Rust 代理;独立命令不带 Channel) */
async function fetchApiFull(provider: ProviderCfg, source: string, target: string, text: string): Promise<string> {
  const result = await withTimeout(
    invoke<string>("api_chat_full", {
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      model: provider.model,
      messages: [{ role: "user", content: buildPrompt(source, target, text) }],
      temperature: parseTemperature(provider),
      noThinking: provider.noThinking === "1",
    }),
    65000,
    "外接 API 翻译"
  );
  return result.trim() || "(空响应)";
}

/* 检测模型:GET {Base URL}/models → 模型 id 列表(走 Rust 代理,20s 超时) */
async function fetchApiModels(provider: ProviderCfg): Promise<string[]> {
  return withTimeout(
    invoke<string[]>("api_list_models", { baseUrl: provider.baseUrl, apiKey: provider.apiKey }),
    30000,
    "检测模型"
  );
}

/* ============ 统一翻译路由(本地 Ollama / 外接 API) ============ */
async function translateStream(
  model: string,
  source: string,
  target: string,
  text: string,
  numCtx: number,
  onToken: (t: string) => void,
  signal?: AbortSignal,
  onReasoning?: (r: string) => void
) {
  return boundedRequest(async (requestSignal) => {
  const eng = resolveEngine();
  if (eng.kind === "api") return fetchApiStream(eng.provider, source, target, text, onToken, requestSignal, onReasoning);
  await localModelDiscovery;
  if (requestSignal.aborted) throw new DOMException("Request cancelled", "AbortError");
  /* 无本地模型守卫:给友好提示而不是裸 API 报错(列表加载完才开始拦截,避免启动瞬间误报) */
  if (localModelsReady) {
    if (localModelStore.length === 0) {
      const hasApiModel = engineCfg.providers.some((p) => p.models.length > 0);
      throw new Error(hasApiModel
        ? "当前没有本地模型:请到「设置 → 模型」下载/导入,或点顶部模型下拉切换到已配置的外接 API 模型"
        : "还没有配置任何翻译模型:请到「设置 → 模型」下载本地模型(HY-MT2 / gemma3),或在「外接 API」配置云端模型后再翻译");
    }
    if (!model || !localModelStore.some((m) => m.name === model)) throw new Error(`本地模型「${model || "未选择"}」未安装:请到「设置 → 模型」下载/导入,或切换到外接 API 模型`);
  }
  return fetchOllamaStream(model, source, target, text, numCtx, onToken, requestSignal);
  }, signal);
}

async function translateFull(model: string, source: string, target: string, text: string, numCtx: number, signal?: AbortSignal): Promise<string> {
  return boundedRequest(async (requestSignal) => {
  const eng = resolveEngine();
  if (eng.kind === "api") return fetchApiFull(eng.provider, source, target, text);
  await localModelDiscovery;
  if (requestSignal.aborted) throw new DOMException("Request cancelled", "AbortError");
  if (localModelsReady) {
    if (localModelStore.length === 0) {
      const hasApiModel = engineCfg.providers.some((p) => p.models.length > 0);
      throw new Error(hasApiModel
        ? "当前没有本地模型:请到「设置 → 模型」下载/导入,或点顶部模型下拉切换到已配置的外接 API 模型"
        : "还没有配置任何翻译模型:请到「设置 → 模型」下载本地模型(HY-MT2 / gemma3),或在「外接 API」配置云端模型后再翻译");
    }
    if (!model || !localModelStore.some((m) => m.name === model)) throw new Error(`本地模型「${model || "未选择"}」未安装:请到「设置 → 模型」下载/导入,或切换到外接 API 模型`);
  }
  return fetchOllamaFull(model, source, target, text, numCtx, requestSignal);
  }, signal);
}

/* ============ 主窗口 ============ */
function MainWindow() {
  const [floatingOpen, setFloatingOpen] = useState(false);
  const [input, setInput] = useState("");
  const [sourceLang, setSourceLang] = useState("auto");
  const [targetLang, setTargetLang] = useState("zh");
  /* 各模式独立译文(文本/音频/视频/截图),显示在任务卡外的独立译文框 */
  const [modeOutput, setModeOutput] = useState<Record<"text" | "audio" | "subtitle" | "screenshot", string>>({ text: "", audio: "", subtitle: "", screenshot: "" });
  const [screenshotSrc, setScreenshotSrc] = useState(""); // 截图模式:截到的原文(灰框显示)
  const [translating, setTranslating] = useState(false);
  const [apiThinking, setApiThinking] = useState(false); // 外接推理模型"思考中"提示
  const [model, setModel] = useState("maternion/hy-mt2:1.8b");
  const [numCtx, setNumCtx] = useState(1024);
  const [streamOn, setStreamOn] = useState(true);
  const [conflict, setConflict] = useState(false);
  const [clipAuto, setClipAuto] = useState(false); // true=复制即开,false=仅悬浮窗打开时翻译

  /* ===== 翻译引擎(第 8 波:本地 Ollama / 外接 API / 自动) ===== */
  const [engineMode, setEngineMode] = useState<EngineMode>("local");
  const [providers, setProviders] = useState<ProviderCfg[]>([]);
  const [activeProviderId, setActiveProviderId] = useState("");
  const [engineStatus, setEngineStatus] = useState("");
  const [detectPicker, setDetectPicker] = useState<{ providerId: string; models: string[]; query: string } | null>(null);
  /* 外接 API 测试连接的就地反馈:providerId → 状态/消息(按钮旁边直接显示,不依赖页面顶部状态栏) */
  const [testStates, setTestStates] = useState<Record<string, { state: "testing" | "ok" | "err"; msg: string }>>({});
  /* Wave 10.5: 本地模型管理(模型页:列表/下载/删除/导入 GGUF) */
  const [localModels, setLocalModels] = useState<LocalModelInfo[]>([]);
  const [localModelsLoaded, setLocalModelsLoaded] = useState(false);
  const [pullJobs, setPullJobs] = useState<Record<string, { status: string; progress: number; total: number; speed?: number; layer?: string }>>({});
  /* 下载速度计算基准:按层记录 completed/时间戳,层切换时重置 */
  /* 下载速度/累计字节基准:completedLayers=已完成层字节和,lastKey=当前层标识 */
  const pullSpeedRef = useRef<Record<string, { completedLayers: number; lastKey: string; lastTotal: number; lastSpeed: number; lastTime: number; lastCompleted: number }>>({});
  /* Wave 10.6: 识别组件(OCR/ASR)按需下载 —— 纯文字版不内置,设置页可下载 */
  const [componentStatus, setComponentStatus] = useState<{ ocr: { installed: boolean }; asr: { multi: { installed: boolean }; ko: { installed: boolean } }; denoise: { installed: boolean } }>({
    ocr: { installed: false },
    asr: { multi: { installed: false }, ko: { installed: false } },
    denoise: { installed: false },
  });
  const [componentJobs, setComponentJobs] = useState<Record<string, { status: string; progress: number; total: number; speed?: number; phase?: string }>>({});
  const componentSpeedRef = useRef<Record<string, { lastTime: number; lastDownloaded: number; lastSpeed: number }>>({});
  const [confirmDeleteComponent, setConfirmDeleteComponent] = useState<"ocr" | "asr-multi" | "asr-ko" | "denoise" | null>(null);
  /* 降噪开关(设置 → 音频):识别前用 GTCRN 压掉喘气/底噪 */
  const [audioDenoise, setAudioDenoise] = useState(false);
  const [audioMode, setAudioMode] = useState<"system" | "mic" | "both">("system");
  const [importName, setImportName] = useState("");
  const [importPath, setImportPath] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [importStatus, setImportStatus] = useState("");
  const [importDragging, setImportDragging] = useState(false);
  const [confirmDeleteModel, setConfirmDeleteModel] = useState<string | null>(null);
  const [mainClose, setMainClose] = useState<"hide" | "quit">("hide"); // 主窗口 ✕ 行为(Wave 9 设置面板提供 UI,默认隐藏到托盘)
  const configLoadedRef = useRef(false);
  const [configWriter] = useState(() => new ConfigWriter(
    config => invoke("save_app_config", { config }),
    () => setActionNotice("设置未能保存，请检查程序目录是否可写，或重试刚才的修改"),
  ));
  const [sensitivityWriter] = useState(() => new AudioSensitivityWriter(invoke));
  /* ollama 实际推理后端(GPU/CPU):CPU 时提示本地翻译较慢(无 GPU 回退提示) */
  const [ollamaBackend, setOllamaBackend] = useState("");
  /* Wave 9: 设置中心 / 主题 / 外观 / 快捷键 */
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [uiLayout, setUiLayout] = useState<"poetry" | "studio" | "classic">("studio");
  const [navigation, setNavigation] = useState<"persistent" | "hover">("persistent");
  const [windowSizingReady, setWindowSizingReady] = useState(false);
  useFrontendReady(windowSizingReady, true);
  useStyleWindowSize(uiLayout === "studio" ? "workbench" : uiLayout, windowSizingReady);
  const [composing, setComposing] = useState(false);
  const [audioControlsBusy, setAudioControlsBusy] = useState(false);
  const audioControlsBusyRef = useRef(false);
  const [audioChannelLanguages, setAudioChannelLanguages] = useState<Record<AudioChannel, LanguagePair | null>>({ system: null, mic: null });
  const [screenshotWorking, setScreenshotWorking] = useState(false);
  const [actionNotice, setActionNotice] = useState("");
  const [configReadError, setConfigReadError] = useState("");
  useEffect(() => {
    document.documentElement.dataset.layout = uiLayout;
    return () => { delete document.documentElement.dataset.layout; };
  }, [uiLayout]);
  useEffect(() => {
    if (!actionNotice) return;
    const timer = setTimeout(() => setActionNotice(""), 3000);
    return () => clearTimeout(timer);
  }, [actionNotice]);
  const [settingsPage, setSettingsPage] = useState<string>("general");
  const [activeMode, setActiveMode] = useState<"text" | "audio" | "subtitle" | "screenshot">("text");
  useEffect(() => { setComposing(false); }, [uiLayout, activeMode, settingsOpen]);
  const [theme, setTheme] = useState<"light" | "dark" | "system">("light");
  const [accentColor, setAccentColor] = useState(""); // 主题色(强调色):留空=跟随主题默认
  const [appearance, setAppearance] = useState<Record<SurfaceKey, AppearanceItem>>(DEFAULT_APPEARANCE);
  /* 悬浮窗外观预览示例句(随机):第一行原文,第二行翻译 */
  const [floatingSample, setFloatingSample] = useState<[string, string]>(() => FLOATING_SAMPLE_LINES[Math.floor(Math.random() * FLOATING_SAMPLE_LINES.length)]);
  /* 每次打开「悬浮窗外观」设置页,预览句子随机换一对 */
  useEffect(() => {
    if (settingsPage === "floating") {
      setFloatingSample(FLOATING_SAMPLE_LINES[Math.floor(Math.random() * FLOATING_SAMPLE_LINES.length)]);
    }
  }, [settingsPage]);
  const [shortcuts, setShortcuts] = useState<Record<ShortcutAction, string>>(DEFAULT_SHORTCUTS);
  const [conflictHint, setConflictHint] = useState(true);
  const [recordingAction, setRecordingAction] = useState<ShortcutAction | null>(null);
  const [shortcutError, setShortcutError] = useState("");
  /* UI3: 各模式语言方向是否独立(默认不独立=跟随文本翻译)+ 各模式自己的语言 */
  const [independentLang, setIndependentLang] = useState(false);
  const [modeLangs, setModeLangs] = useState<Record<"audio" | "subtitle" | "screenshot", { src: string; tgt: string }>>({
    audio: { src: "auto", tgt: "zh" },
    subtitle: { src: "auto", tgt: "zh" },
    screenshot: { src: "auto", tgt: "zh" },
  });
  /* 某模式生效的语言:独立=用该模式自己的;否则跟随文本翻译 */
  const langFor = (mode: "audio" | "subtitle" | "screenshot") =>
    independentLang ? modeLangs[mode] : { src: sourceLang, tgt: targetLang };
  const audioLanguagesRef = useRef(audioChannelLanguages);
  audioLanguagesRef.current = audioChannelLanguages;
  const langForAudio = (source: string) => audioLanguagesRef.current[source === "mic" ? "mic" : "system"] ?? langFor("audio");
  const setModeLang = (mode: "audio" | "subtitle" | "screenshot", patch: { src?: string; tgt?: string }) => {
    if (!independentLang) {
      if (patch.src) setSourceLang(patch.src);
      if (patch.tgt) setTargetLang(patch.tgt);
      return;
    }
    setModeLangs((prev) => ({ ...prev, [mode]: { ...prev[mode], ...patch } }));
  };
  const swapModeLang = (mode: "audio" | "subtitle" | "screenshot") => {
    const l = langFor(mode);
    if (l.src === "auto") return;
    setModeLang(mode, { src: l.tgt, tgt: l.src });
  };
  const toggleIndependentLang = (v: boolean) => {
    if (v) {
      // 开启独立:先把各模式初始化为当前文本翻译设置
      setModeLangs({
        audio: { src: sourceLang, tgt: targetLang },
        subtitle: { src: sourceLang, tgt: targetLang },
        screenshot: { src: sourceLang, tgt: targetLang },
      });
    }
    setIndependentLang(v);
  };

  // Keep the shared inference router synchronized with the live UI selections.
  engineCfg = { mode: engineMode, providers, activeProviderId };
  localModelStore = localModels;
  localModelsReady = localModelsLoaded;

  /* 监听 ollama 实际推理后端(Rust 解析 serve 日志后广播):cpu → 显示"无 GPU"提示条 */
  useEffect(() => {
    const u = appWindow.listen<string>("ollama-backend", (e) => setOllamaBackend(e.payload));
    return () => { u.then((f) => f()); };
  }, []);

  /* 启动时加载配置(config.json,含引擎 + Wave 9 设置) */
  useEffect(() => {
    let cancelled = false;
    invoke<any>("load_app_config")
      .then((cfg) => {
        if (cancelled) return;
        configLoadedRef.current = true;
        configWriter.hydrate(cfg ?? {});
        if (!cfg) return;
        if (cfg.engineMode) setEngineMode(cfg.engineMode);
        if (cfg.mainClose === "quit") setMainClose("quit");
        const s = cfg.settings ?? {};
        const design = restoreDesign(s);
        setUiLayout(design.mainStyle === "workbench" ? "studio" : design.mainStyle);
        setNavigation(design.navigation);
        setAudioChannelLanguages(restoreAudioLanguages(s.audio?.channelLanguages));
        // Restore subtitle state after the asynchronous config request resolves.
        if (s.subtitle?.fps) setSubFps(Number(s.subtitle.fps));
        if (s.subtitle?.mode) setSubMode(s.subtitle.mode);
        if (s.subtitle?.engine) setSubEngine(s.subtitle.engine);
        const region = s.subtitle?.region;
        if (region && typeof region.x === "number" && typeof region.y === "number" && region.w > 0 && region.h > 0) {
          subRegionRef.current = { x: region.x, y: region.y, w: region.w, h: region.h };
          setSubRegion(subRegionRef.current);
        }
        setTheme(s.theme === "dark" || s.theme === "system" ? s.theme : "light");
        setAccentColor(typeof s.accentColor === "string" ? s.accentColor : "");
        setAppearance(normalizeFloatingAppearance(mergeAppearance(DEFAULT_APPEARANCE, s.appearance)));
        setShortcuts({ ...DEFAULT_SHORTCUTS, ...(s.shortcuts ?? {}) });
        setConflictHint(s.translate?.conflictHint !== false);
        if (s.translate) {
          if (typeof s.translate.model === "string" && s.translate.model.trim()) setModel(s.translate.model);
          if (s.translate.sourceLang) setSourceLang(s.translate.sourceLang);
          if (s.translate.targetLang) setTargetLang(s.translate.targetLang);
          if (typeof s.translate.streamOn === "boolean") setStreamOn(s.translate.streamOn);
          if (s.translate.numCtx) setNumCtx(Number(s.translate.numCtx));
          if (s.translate.independentLang === true) setIndependentLang(true);
          const ml = s.translate?.modeLangs ?? {};
          setModeLangs({
            audio: { src: ml.audio?.src ?? "auto", tgt: ml.audio?.tgt ?? "zh" },
            subtitle: { src: ml.subtitle?.src ?? "auto", tgt: ml.subtitle?.tgt ?? "zh" },
            screenshot: { src: ml.screenshot?.src ?? "auto", tgt: ml.screenshot?.tgt ?? "zh" },
          });
        }
        if (s.clipboard) setClipAuto(!!s.clipboard.auto);
        if (s.audio?.mode === "mic" || s.audio?.mode === "both") setAudioMode(s.audio.mode);
        /* 降噪开关:读配置 + 同步到 Rust(识别前是否先压噪) */
        if (s.audio && typeof s.audio.denoise === "boolean") {
          setAudioDenoise(s.audio.denoise);
          invoke("audio_set_denoise", { enabled: s.audio.denoise }).catch(() => {});
        }
        if (Array.isArray(cfg.providers)) {
          let list = cfg.providers
            .filter((p: ProviderCfg) => p && typeof p.id === "string")
            .map((p: ProviderCfg) => ({ ...p, temperature: p.temperature ?? "", noThinking: p.noThinking ?? "" }));
          // 迁移(一次):旧版把检测到的所有模型自动塞进列表(中转站可能上百个);
          // 新版语义=只保留用户明确添加/使用的模型。
          if (cfg.configVersion !== 3) {
            list = list.map((p: ProviderCfg) => ({ ...p, models: p.model && p.model.trim() ? [p.model] : [] }));
          }
          setProviders(list);
          if (cfg.activeProviderId && list.some((p: ProviderCfg) => p.id === cfg.activeProviderId)) {
            setActiveProviderId(cfg.activeProviderId);
          }
        }
      })
      .catch(error => {
        if (cancelled) return;
        configWriter.block(error);
        setConfigReadError("无法读取设置，已暂停自动保存以保护原文件。请检查配置文件或目录权限");
      })
      .finally(() => { if (!cancelled) setWindowSizingReady(true); });
    return () => { cancelled = true; };
  }, []);

  const [translationTask] = useState(() => new LatestTask<string>());
  const [screenshotTask] = useState(() => new LatestTask<{ source: string; b64?: string; x: number; y: number; w: number; h: number }>());
  const [clipboardTask] = useState(() => new LatestTask<string>());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef(input);
  inputRef.current = input;
  const textareaElRef = useRef<HTMLTextAreaElement>(null);
  /* 输入框随内容自动增高(上限约 38% 窗口高,超出后内部滚动) */
  useEffect(() => {
    const el = textareaElRef.current;
    if (!el) return;
    if (uiLayout === "studio") {
      el.style.removeProperty("height");
      el.style.removeProperty("overflow-y");
      return;
    }
    el.style.height = "auto";
    const max = Math.round(window.innerHeight * 0.38);
    const h = Math.min(Math.max(el.scrollHeight, 96), max);
    el.style.height = h + "px";
    el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
  }, [input, uiLayout, activeMode, settingsOpen]);

  const floatingRef = useRef(false);
  useEffect(() => { floatingRef.current = floatingOpen; }, [floatingOpen]);

  /* ===== 视频实时字幕(第 6 波 3.4/3.5) ===== */
  const [subtitleOn, setSubtitleOn] = useState(false);          // 字幕开关
  const subtitleOnRef = useRef(subtitleOn);
  subtitleOnRef.current = subtitleOn;
  const [subFps, setSubFps] = useState(2);                      // 截帧频率 1-5 次/秒
  const [subMode, setSubMode] = useState<"trans-first" | "ocr-first">("trans-first"); // 翻译优先/原文优先
  const [subEngine, setSubEngine] = useState<"win" | "rapid">("win"); // 字幕 OCR 引擎:win=系统OCR(快)/rapid=RapidOCR
  const [subStatus, setSubStatus] = useState("");               // 字幕状态提示
  const [subRegion, setSubRegion] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const subRegionRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);

  /* Persist only changed fields immediately; writes are serialized across React updates. */
  useEffect(() => {
    if (!windowSizingReady || !configLoadedRef.current) return;
    const settings = {
      theme, accentColor, appearance, shortcuts, uiLayout: uiLayout === "classic" ? "classic" : "studio",
      design: { mainStyle: uiLayout === "studio" ? "workbench" : uiLayout, navigation },
      translate: { model, sourceLang, targetLang, streamOn, numCtx, conflictHint, independentLang, modeLangs },
      subtitle: { fps: subFps, mode: subMode, engine: subEngine, region: subRegionRef.current },
      clipboard: { auto: clipAuto },
      audio: { mode: audioMode, denoise: audioDenoise, channelLanguages: audioChannelLanguages },
    };
    void configWriter.update({ configVersion: 3, mainClose, engineMode, activeProviderId, providers, settings }).catch(() => {});
  }, [configWriter, windowSizingReady, engineMode, activeProviderId, providers, mainClose, theme, uiLayout, accentColor, appearance, shortcuts, model, sourceLang, targetLang, streamOn, numCtx, conflictHint, independentLang, modeLangs, subFps, subMode, subEngine, subRegion, clipAuto, audioDenoise, audioMode, navigation, audioChannelLanguages]);

  useEffect(() => {
    if (!windowSizingReady) return;
    invoke("broadcast_settings", { settings: { theme, accentColor, appearance } }).catch(() => {});
  }, [windowSizingReady, theme, accentColor, appearance]);
  useEffect(() => {
    if (windowSizingReady) invoke("apply_shortcuts", { shortcuts }).catch(() => {});
  }, [windowSizingReady, shortcuts]);
  useEffect(() => {
    const flush = () => Promise.all([configWriter.flush(), sensitivityWriter.flush()]).then(() => {});
    (window as any).__flushAppConfig = flush;
    (window as any).__requestAppQuit = () => (configWriter.persistenceBlocked ? Promise.resolve() : flush()).then(() => invoke("quit_app"))
      .catch(error => {
        setActionNotice(`退出前保存失败：${errorMessage(error)}`);
        void appWindow.show().then(() => appWindow.setFocus()).catch(() => {});
      });
    return () => { delete (window as any).__flushAppConfig; delete (window as any).__requestAppQuit; };
  }, [configWriter, sensitivityWriter]);
  useEffect(() => {
    const listener = appWindow.listen<Partial<Record<SurfaceKey, AppearanceItem>>>("appearance-updated", ({ payload }) => {
      configWriter.acceptExternal({ settings: { appearance: payload } });
      setAppearance(previous => normalizeFloatingAppearance(mergeAppearance(previous, payload)));
    });
    return () => { void listener.then(unlisten => unlisten()); };
  }, [configWriter]);

  /* 主窗口应用主题 + 外观(CSS 变量即时生效) */
  useWindowTheme("main", theme, appearance, accentColor);
  const [subCurrent, setSubCurrent] = useState<{ text: string; result: string } | null>(null); // 当前字幕(主窗口显示)

  /* ===== 音频实时字幕(第 7 波:系统内部音频 → ASR → 翻译) ===== */
  const [audioSubOn, setAudioSubOn] = useState<Record<string, boolean>>({});       // 各来源开关
  const [audioStatus, setAudioStatus] = useState<Record<string, string>>({});      // 各来源状态
  const [, setAudioPartial] = useState<Record<string, string>>({});                 // 各来源增量文本(仅写入,显示改走 audioHist)
  const [audioLevel, setAudioLevel] = useState<Record<string, number>>({});        // 各来源实时音量(dB)
  const [sensitivities, setSensitivities] = useState<Record<string, number>>({}); // 各语言断句灵敏度(秒)
  /* 主窗口音频 hist:原文区/译文区四行显示(与语音窗一致,跨来源合并按时间推进) */
  const [audioHist, setAudioHist] = useState<AudioLine[]>([]);

  // 便捷访问:某来源是否运行 / 状态 / 增量文本
  const isSrcOn = (src: string) => !!audioSubOn[src];
  const srcStatus = (src: string) => {
    const status = audioStatus[src] ?? "";
    if (status === "loading") return "正在加载识别模型…";
    if (status === "ready") return "识别就绪";
    if (status === "stopped") return "已停止";
    if (status.startsWith("error:")) return `识别失败：${status.slice(6)}`;
    return status;
  };
  const srcLevel = (src: string) => audioLevel[src] ?? -100;

  /* 读取某语言灵敏度(懒加载:首次从 Rust 拉全部) */
  const sensitivityForLang = (lang: string): number | undefined => {
    if (Object.keys(sensitivities).length === 0) return undefined;
    return sensitivities[lang];
  };
  /* 设置某语言灵敏度:更新本地 + 写 Rust(Rust 广播到所有端,联动共享);松手时应用生效 */
  const sensitivityThrottleRef = useRef(0);
  const setSensitivityForLang = (lang: string, value: number) => {
    setSensitivities((prev) => ({ ...prev, [lang]: value }));
    const now = Date.now();
    if (now - sensitivityThrottleRef.current < 100) return;
    sensitivityThrottleRef.current = now;
    sensitivityWriter.update(lang, value, false).catch(error => setActionNotice(`断句设置未保存：${errorMessage(error)}`));
  };
  /* 滑块松手:应用灵敏度(重启识别器使端点生效,拖动过程不反复重启) */
  const applySensitivityForLang = (lang: string, value: number) => {
    setSensitivities((prev) => ({ ...prev, [lang]: value }));
    sensitivityWriter.update(lang, value, true).catch(error => setActionNotice(`断句设置未应用：${errorMessage(error)}`));
  };
  /* 启动时加载灵敏度配置 */
  useEffect(() => {
    invoke<Record<string, number>>("audio_get_sensitivities")
      .then((s) => setSensitivities(s))
      .catch(() => {});
  }, []);
  /* 监听 Rust 广播:其他端(悬浮窗/设置)改了灵敏度,这里跟随 */
  useEffect(() => {
    const handler = (e: { lang: string; value: number }) => {
      setSensitivities((prev) => ({ ...prev, [e.lang]: e.value }));
    };
    (window as any).__audioSensChanged = handler;
    return () => { delete (window as any).__audioSensChanged; };
  }, []);
  const [audioQueues] = useState<Record<string, AudioTaskQueue>>(() => ({ system: new AudioTaskQueue(), mic: new AudioTaskQueue() }));
  const audioDesiredRef = useRef<Record<string, boolean>>({});
  const audioSessionsRef = useRef<Record<string, number>>({});
  const audioAcceptRef = useRef<Record<string, boolean>>({});
  const invalidateAudio = useCallback((source: string, desired?: boolean) => {
    audioQueues[source]?.invalidate();
    audioAcceptRef.current[source] = false;
    if (desired !== undefined) audioDesiredRef.current[source] = desired;
  }, [audioQueues]);

  const subTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [subtitleTask] = useState(() => new LatestTask<string>());
  const lastSubOcrRef = useRef("");                             // 去重:上次 OCR 文本
  const lastSubTranslatedRef = useRef("");                      // 去重:上次已翻译文本
  const subModeRef = useRef(subMode);
  useEffect(() => { subModeRef.current = subMode; }, [subMode]);
  const subDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null); // 句子稳定延迟

  /* Default to the monitor containing the main window, in physical desktop coordinates. */
  const ensureSubRegion = async () => {
    if (subRegionRef.current) return;
    const monitor = await currentMonitor().catch(() => null);
    if (subRegionRef.current) return;
    const dpr = window.devicePixelRatio || 1;
    const width = monitor?.size.width ?? Math.round(window.screen.width * dpr);
    const height = monitor?.size.height ?? Math.round(window.screen.height * dpr);
    const region = {
      x: monitor?.position.x ?? 0, y: (monitor?.position.y ?? 0) + Math.round(height * 0.75),
      w: width, h: Math.floor(height * 0.25),
    };
    subRegionRef.current = region;
    setSubRegion(region);
  };

  /* 提交翻译(句子已稳定):流式输出译文,最多滞后一句 */
  const submitSubtitle = useCallback(async (text: string) => {
    await subtitleTask.submit(text, async (text, { signal, isCurrent }) => {
      try {
        await invoke("wait_floating_ready");
        if (!isCurrent()) return;
        let src = langFor("subtitle").src;
        let tgt = langFor("subtitle").tgt;
        if (src === "auto") src = detectLang(text);
        if (src === tgt) tgt = src === "zh" ? "en" : "zh";
        lastSubTranslatedRef.current = text;
        const publish = (result: string) => {
          if (!isCurrent()) return;
          appWindow.emitTo("floating", "subtitle-text", { text, result }).catch(() => {});
          setSubCurrent({ text, result });
          setModeOutput(prev => ({ ...prev, subtitle: result }));
        };
        if (subModeRef.current === "ocr-first") publish("");
        let result = "";
        await translateStream(model, src, tgt, text, numCtx, token => {
          result += token;
          publish(result);
        }, signal);
        publish(result.trim() || "(空响应)");
        if (isCurrent()) setSubStatus("");
      } catch (error) {
        if (isCurrent()) {
          setSubStatus(`翻译失败: ${errorMessage(error)}`);
          setModeOutput(prev => ({ ...prev, subtitle: `翻译失败: ${errorMessage(error)}` }));
          // A failed sentence can be retried if it remains on screen.
          lastSubOcrRef.current = "";
          lastSubTranslatedRef.current = "";
        }
      }
    });
  }, [subtitleTask, model, numCtx, independentLang, modeLangs, sourceLang, targetLang, engineMode, activeProviderId, providers]);

  /* 字幕 OCR 结果:去重 → 句子稳定(500ms 去抖)→ 提交翻译 */
  const handleSubtitleOcr = useCallback((text: string) => {
    if (!text.trim() || text.startsWith("ERROR:")) {
      if (text.startsWith("ERROR:")) setSubStatus(`字幕OCR: ${text.slice(7, 150)}`); // 错误可见,不再静默
      return;
    }
    if (similarity(text, lastSubOcrRef.current) >= 0.95) return;   // 同一句连续帧/OCR抖动,跳过(0.95 防闪烁)
    lastSubOcrRef.current = text;
    if (text === lastSubTranslatedRef.current) return;            // 已翻译过,跳过
    // 去抖:字幕逐字增长(Hello→Hello World→...),等句子稳定再翻,避免中间态反复翻译
    if (subDebounceRef.current) clearTimeout(subDebounceRef.current);
    subDebounceRef.current = setTimeout(() => {
      void submitSubtitle(text);
    }, 500);
  }, [submitSubtitle]);

  const subtitleOcrHandlerRef = useRef(handleSubtitleOcr);
  useEffect(() => { subtitleOcrHandlerRef.current = handleSubtitleOcr; }, [handleSubtitleOcr]);

  useEffect(() => {
    let cancelled = false;
    let busy = false;
    subtitleTask.invalidate();
    lastSubOcrRef.current = "";
    lastSubTranslatedRef.current = "";
    if (subDebounceRef.current) clearTimeout(subDebounceRef.current);
    if (subtitleOn) {
      void ensureSubRegion();
      subTimerRef.current = setInterval(() => {
        const region = subRegionRef.current;
        if (!region || busy) return;
        busy = true;
        invoke<string>("subtitle_frame", { ...region, engine: subEngine })
          .then(text => { if (!cancelled) subtitleOcrHandlerRef.current(text); })
          .catch(error => { if (!cancelled) setSubStatus(`字幕OCR: ${errorMessage(error)}`); })
          .finally(() => { busy = false; });
      }, 1000 / subFps);
    }
    return () => {
      cancelled = true;
      if (subTimerRef.current) clearInterval(subTimerRef.current);
      if (subDebounceRef.current) clearTimeout(subDebounceRef.current);
      subtitleTask.invalidate();
    };
  }, [subtitleOn, subFps, subEngine, subRegion, submitSubtitle, subtitleTask]);

  /* 音频字幕翻译(source: 来源):原文实时增长 + 译文完成后整体替换(保留旧译文,不闪)
     增量时 result="" 只更新原文;译文完成时 result 非空整体替换 */
  const submitAudioSubtitle = useCallback((job: AudioJob) => {
    if (!job.text.trim()) return;
    audioQueues[job.source]?.enqueue(job, async (job, { signal, isCurrent }) => {
      const current = () => isCurrent() && audioDesiredRef.current[job.source]
        && audioSessionsRef.current[job.source] === job.session;
      try {
        let src = langForAudio(job.source).src;
        let tgt = langForAudio(job.source).tgt;
        if (src === "auto") src = detectLang(job.text);
        if (src === tgt) tgt = src === "zh" ? "en" : "zh";
        const result = (await translateFull(model, src, tgt, job.text, numCtx, signal)).trim() || "(空响应)";
        if (!current()) return;
        setAudioHist(history => applyAudioResult(history, job, result));
        // Finalization happens on the recognition event, never when queued work starts.
        await invoke("audio_forward_to_floating", {
          source: job.source, text: job.text, src, tgt, result,
          role: job.isFinal ? "prev" : "cur", id: job.id, session: job.session,
        });
        if (!current()) return;
        setAudioStatus(prev => ({ ...prev, [job.source]: "" }));
      } catch (error) {
        if (current()) setAudioStatus(prev => ({ ...prev, [job.source]: `翻译失败: ${errorMessage(error)}` }));
      }
    });
  }, [audioQueues, model, numCtx, independentLang, modeLangs, sourceLang, targetLang, engineMode, activeProviderId, providers]);

  useEffect(() => {
    // Changing translation settings cancels old jobs without stopping capture.
    for (const queue of Object.values(audioQueues)) queue.invalidate();
    return () => { for (const queue of Object.values(audioQueues)) queue.invalidate(); };
  }, [audioQueues, submitAudioSubtitle]);

  /* 模式对应的来源列表 */
  const sourcesForMode = useCallback((mode: string): string[] => {
    if (mode === "both") return ["system", "mic"];
    return [mode];
  }, []);

  /* 音频字幕开关:按当前模式启动/停止对应来源(与视频字幕互斥) */
  const toggleAudioSubtitle = useCallback(async () => {
    if (audioControlsBusyRef.current) return;
    audioControlsBusyRef.current = true;
    setAudioControlsBusy(true);
    try {
    const anyOn = sourcesForMode(audioMode).some((s) => !!audioSubOn[s]);
    if (!anyOn) {
      // 启动当前模式的所有来源
      setSubtitleOn(false);
      setActiveMode("audio");
      appWindow.emitTo("floating", "subtitle-state", "off").catch(() => {});
      const requested = sourcesForMode(audioMode).map(source => langForAudio(source).src);
      if (requested.some(lang => !AUDIO_ASR_LANGS.includes(lang))) {
        for (const src of sourcesForMode(audioMode)) {
          setAudioStatus((prev) => ({ ...prev, [src]: "识别语言不支持(音频识别仅支持 中文/英语/日语/韩语),请先切换语言" }));
        }
        return;
      }
      /* 本地模型和 API 模型都没有 → 提前拦截,给清晰引导而不是识别完才报错 */
      if (localModels.length === 0 && !providers.some((p) => p.models.length > 0)) {
        for (const src of sourcesForMode(audioMode)) {
          setAudioStatus((prev) => ({ ...prev, [src]: "还没有配置任何翻译模型:请到 设置 → 模型 下载本地模型,或在「外接 API」配置云端模型后再试" }));
        }
        return;
      }
      /* ASR 组件未安装 → 引导去设置下载(纯文字版) */
      const missingLang = requested.find(lang => !(lang === "ko" ? componentStatus.asr.ko.installed : componentStatus.asr.multi.installed));
      const asrReady = missingLang === undefined;
      if (!asrReady) {
        for (const src of sourcesForMode(audioMode)) {
          setAudioStatus((prev) => ({ ...prev, [src]: missingLang === "ko" ? "ASR 韩语识别组件未安装(约399MB):请到 设置 → 模型 → 识别组件 下载后再试" : "ASR 语音识别组件未安装(约247MB):请到 设置 → 模型 → 识别组件 下载后再试" }));
        }
        return;
      }
      for (const src of sourcesForMode(audioMode)) {
        setAudioStatus((prev) => ({ ...prev, [src]: "正在加载 ASR 模型…" }));
        try {
          invalidateAudio(src, true);
          await invoke("audio_subtitle_start", { source: src, lang: langForAudio(src).src });
          setAudioSubOn((prev) => ({ ...prev, [src]: true }));
          await invoke("open_audio_floating_window", { source: src }).catch(() => {});
        } catch (e: any) {
          invalidateAudio(src, false);
          setAudioStatus((prev) => ({ ...prev, [src]: `启动失败: ${e}` }));
          setAudioSubOn((prev) => ({ ...prev, [src]: false }));
        }
      }
    } else {
      // 停止当前模式的所有来源
      for (const src of sourcesForMode(audioMode)) {
        invalidateAudio(src, false);
        try { await invoke("audio_subtitle_stop", { source: src }); } catch {}
        setAudioSubOn((prev) => ({ ...prev, [src]: false }));
        setAudioPartial((prev) => ({ ...prev, [src]: "" }));
        setAudioStatus((prev) => ({ ...prev, [src]: "已停止" }));
        await invoke("close_audio_floating_window", { source: src }).catch(() => {});
      }
    }
    } finally {
      audioControlsBusyRef.current = false;
      setAudioControlsBusy(false);
    }
  }, [audioMode, audioSubOn, sourceLang, sourcesForMode, independentLang, modeLangs, componentStatus, localModels, providers, invalidateAudio, audioChannelLanguages, targetLang]);

  /* 切换音频来源模式:运行中切换 = 自动关旧来源+启新来源(不停止);
     停止状态切换 = 仅改模式选择 */
  const changeAudioMode = useCallback(async (mode: "system" | "mic" | "both") => {
    if (audioControlsBusyRef.current) return;
    audioControlsBusyRef.current = true;
    setAudioControlsBusy(true);
    try {
    const oldOn = sourcesForMode(audioMode).some((s) => !!audioSubOn[s]);
    setAudioMode(mode);
    if (!oldOn) return; // 没在运行,只改选择
    // 运行中:先停不在新模式里的来源 + 关其窗
    const oldSrcs = sourcesForMode(audioMode);
    const newSrcs = sourcesForMode(mode);
    for (const src of oldSrcs) {
      if (!newSrcs.includes(src)) {
        invalidateAudio(src, false);
        try { await invoke("audio_subtitle_stop", { source: src }); } catch {}
        setAudioSubOn((prev) => ({ ...prev, [src]: false }));
        setAudioPartial((prev) => ({ ...prev, [src]: "" }));
        setAudioStatus((prev) => ({ ...prev, [src]: "已停止" }));
        await invoke("close_audio_floating_window", { source: src }).catch(() => {});
      }
    }
    // 再启动新模式里新增的来源 + 开其窗
    const requested = newSrcs.map(source => langForAudio(source).src);
    if (requested.some(lang => !AUDIO_ASR_LANGS.includes(lang))) {
      for (const src of newSrcs) {
        setAudioStatus((prev) => ({ ...prev, [src]: "识别语言不支持(音频识别仅支持 中文/英语/日语/韩语),请先切换语言" }));
        setAudioSubOn((prev) => ({ ...prev, [src]: false }));
      }
      return;
    }
    /* 本地模型和 API 模型都没有 → 提前拦截,给清晰引导而不是识别完才报错 */
    if (localModels.length === 0 && !providers.some((p) => p.models.length > 0)) {
      for (const src of newSrcs) {
        setAudioStatus((prev) => ({ ...prev, [src]: "还没有配置任何翻译模型:请到 设置 → 模型 下载本地模型,或在「外接 API」配置云端模型后再试" }));
        setAudioSubOn((prev) => ({ ...prev, [src]: false }));
      }
      return;
    }
    /* ASR 组件未安装 → 引导去设置下载(纯文字版) */
    const missingLang = requested.find(lang => !(lang === "ko" ? componentStatus.asr.ko.installed : componentStatus.asr.multi.installed));
      const asrReady = missingLang === undefined;
    if (!asrReady) {
      for (const src of newSrcs) {
        setAudioStatus((prev) => ({ ...prev, [src]: missingLang === "ko" ? "ASR 韩语识别组件未安装(约399MB):请到 设置 → 模型 → 识别组件 下载后再试" : "ASR 语音识别组件未安装(约247MB):请到 设置 → 模型 → 识别组件 下载后再试" }));
        setAudioSubOn((prev) => ({ ...prev, [src]: false }));
      }
      return;
    }
    for (const src of newSrcs) {
      if (!oldSrcs.includes(src)) {
        setAudioStatus((prev) => ({ ...prev, [src]: "正在加载 ASR 模型…" }));
        try {
          invalidateAudio(src, true);
          await invoke("audio_subtitle_start", { source: src, lang: langForAudio(src).src });
          setAudioSubOn((prev) => ({ ...prev, [src]: true }));
          await invoke("open_audio_floating_window", { source: src }).catch(() => {});
        } catch (e: any) {
          invalidateAudio(src, false);
          setAudioStatus((prev) => ({ ...prev, [src]: `启动失败: ${e}` }));
          setAudioSubOn((prev) => ({ ...prev, [src]: false }));
        }
      }
    }
    } finally {
      audioControlsBusyRef.current = false;
      setAudioControlsBusy(false);
    }
  }, [audioMode, audioSubOn, sourceLang, sourcesForMode, independentLang, modeLangs, componentStatus, localModels, providers, invalidateAudio, audioChannelLanguages, targetLang]);

  const submitAudioRef = useRef(submitAudioSubtitle);
  submitAudioRef.current = submitAudioSubtitle;

  /* Native IDs isolate sources, utterances and recognizer restart sessions. */
  useEffect(() => {
    const status = appWindow.listen<{ source: string; status: string; session: number }>("audio-status", ({ payload: event }) => {
      const { source, session } = event;
      if (!audioDesiredRef.current[source] || session < (audioSessionsRef.current[source] ?? 0)) return;
      if (event.status === "loading") {
        invalidateAudio(source);
        audioSessionsRef.current[source] = session;
        audioAcceptRef.current[source] = true;
        setAudioHist(history => history.filter(line => line.source !== source));
      }
      if (session !== audioSessionsRef.current[source]) return;
      setAudioStatus(prev => ({ ...prev, [source]: event.status }));
      if (event.status.startsWith("error") || event.status === "stopped") {
        invalidateAudio(source, event.status.startsWith("error") ? false : undefined);
        setAudioSubOn(prev => ({ ...prev, [source]: false }));
      }
      if (event.status === "ready") setAudioSubOn(prev => ({ ...prev, [source]: true }));
    });
    const receive = (event: AudioEvent, isFinal: boolean) => {
      if (!audioDesiredRef.current[event.source] || !audioAcceptRef.current[event.source]
        || event.session !== audioSessionsRef.current[event.source] || !event.text.trim()) return;
      const job = { ...event, text: event.text.trim(), isFinal };
      setAudioPartial(prev => ({ ...prev, [event.source]: job.text }));
      setAudioHist(history => updateAudioLine(history, job));
      submitAudioRef.current(job);
    };
    const partial = appWindow.listen<AudioEvent>("audio-partial", ({ payload }) => receive(payload, false));
    const final = appWindow.listen<AudioEvent>("audio-final", ({ payload }) => receive(payload, true));
    const level = appWindow.listen<{ source: string; level: number }>("audio-level", ({ payload }) => {
      if (audioDesiredRef.current[payload.source]) setAudioLevel(prev => ({ ...prev, [payload.source]: payload.level }));
    });
    const closed = appWindow.listen<{ source?: string }>("audio-floating-closed", ({ payload }) => {
      const source = payload?.source ?? "system";
      invalidateAudio(source, false);
      setAudioSubOn(prev => ({ ...prev, [source]: false }));
      setAudioPartial(prev => ({ ...prev, [source]: "" }));
      setAudioStatus(prev => ({ ...prev, [source]: "已停止(语音窗关闭)" }));
      invoke("audio_subtitle_stop", { source }).catch(() => {});
    });
    return () => { for (const listener of [status, partial, final, level, closed]) listener.then(unlisten => unlisten()); };
  }, [invalidateAudio]);

  const toggleAudioSubtitleRef = useRef(toggleAudioSubtitle);
  useEffect(() => { toggleAudioSubtitleRef.current = toggleAudioSubtitle; }, [toggleAudioSubtitle]);

  /* 切换字幕开关(Ctrl+Shift+U、主界面按钮、悬浮窗按钮共用);
     开启时自动弹出悬浮窗并同步状态,悬浮窗切到字幕页;与音频字幕互斥 */
  const stopAllAudio = useCallback(() => {
    invalidateAudio("system", false);
    invalidateAudio("mic", false);
    // 停所有来源音频字幕 + 关所有语音窗
    invoke("audio_subtitle_stop", { source: "system" }).catch(() => {});
    invoke("audio_subtitle_stop", { source: "mic" }).catch(() => {});
    invoke("close_audio_floating_window", { source: "system" }).catch(() => {});
    invoke("close_audio_floating_window", { source: "mic" }).catch(() => {});
    setAudioSubOn({});
    setAudioPartial({});
    setAudioStatus({});
  }, [invalidateAudio]);

  const toggleSubtitle = useCallback(() => {
    /* OCR 组件未安装且选的是 RapidOCR → 引导去设置下载(纯文字版) */
    if (subEngine === "rapid" && !componentStatus.ocr.installed) {
      setSubStatus("OCR 组件未安装(约30MB):请到 设置 → 模型 → 识别组件 下载后再试");
      return;
    }
    setSubtitleOn((on) => {
      const next = !on;
      if (next) {
        // 互斥:开视频字幕自动关音频字幕
        stopAllAudio();
        setActiveMode("subtitle");
        ensureSubRegion();
        invoke("open_floating_window").then(() => {
          appWindow.emitTo("floating", "subtitle-state", subtitleOnRef.current ? "on" : "off").catch(() => {});
        }).catch(error => setSubStatus(`悬浮窗准备失败：${errorMessage(error)}`));
        setFloatingOpen(true);
      } else {
        appWindow.emitTo("floating", "subtitle-state", "off").catch(() => {});
      }
      return next;
    });
  }, [stopAllAudio, subEngine, componentStatus]);

  const toggleSubtitleRef = useRef(toggleSubtitle);
  useEffect(() => { toggleSubtitleRef.current = toggleSubtitle; }, [toggleSubtitle]);

  /* 悬浮窗显式开始(幂等):开启字幕 + 弹悬浮窗 + 状态同步;与音频字幕互斥 */
  const startSubtitle = useCallback(() => {
    /* OCR 组件未安装且选的是 RapidOCR → 引导去设置下载(纯文字版) */
    if (subEngine === "rapid" && !componentStatus.ocr.installed) {
      setSubStatus("OCR 组件未安装(约30MB):请到 设置 → 模型 → 识别组件 下载后再试");
      return;
    }
    setSubtitleOn((on) => {
      if (on) return on;   // 已运行,幂等
      // 互斥:开视频字幕自动关音频字幕
      stopAllAudio();
      setActiveMode("subtitle");
      ensureSubRegion();
      invoke("open_floating_window").then(() => {
        appWindow.emitTo("floating", "subtitle-state", subtitleOnRef.current ? "on" : "off").catch(() => {});
      }).catch(error => setSubStatus(`悬浮窗准备失败：${errorMessage(error)}`));
      setFloatingOpen(true);
      return true;
    });
  }, [stopAllAudio, subEngine, componentStatus]);

  /* 悬浮窗显式停止(幂等) */
  const stopSubtitle = useCallback(() => {
    setSubtitleOn((on) => {
      if (!on) return on;
      appWindow.emitTo("floating", "subtitle-state", "off").catch(() => {});
      return false;
    });
  }, []);

  const startSubtitleRef = useRef(startSubtitle);
  useEffect(() => { startSubtitleRef.current = startSubtitle; }, [startSubtitle]);
  const stopSubtitleRef = useRef(stopSubtitle);
  useEffect(() => { stopSubtitleRef.current = stopSubtitle; }, [stopSubtitle]);

  /* Windows 系统 OCR PoC 测试:截全屏 → 系统 OCR → 显示结果 */
  const testWinOcr = async () => {
    setSubStatus("系统 OCR 测试中…");
    try {
      const capture = await invoke<ScreenCapture>("capture_fullscreen");
      const text = await invoke<string>("win_ocr_b64", { b64: capture.b64 });
      setSubStatus(`系统 OCR 成功: ${text.slice(0, 120) || "(无文字)"}`);
    } catch (e: any) {
      const msg = typeof e === "string" ? e : JSON.stringify(e);
      setSubStatus(`系统 OCR 失败: ${msg}`);
    }
  };

  /* ---- 悬浮窗 ---- */
  useEffect(() => {
    const u = appWindow.listen("floating-closed", () => { setFloatingOpen(false); clipboardTask.invalidate(); screenshotTask.invalidate(); });
    return () => { u.then((f) => f()); };
  }, [clipboardTask, screenshotTask]);

  const swapLangs = () => {
    if (sourceLang === "auto") return;
    const tmp = sourceLang;
    setSourceLang(targetLang);
    setTargetLang(tmp);
  };
  /* 悬浮窗开关:已开时再点关闭(修复"只能开不能关") */
  const toggleFloating = async () => {
    try {
      if (floatingOpen) {
        await invoke("close_floating_window");
        setFloatingOpen(false);
      } else {
        await invoke("open_floating_window");
        setFloatingOpen(true);
      }
    } catch (e) {
      console.error(e);
    }
  };
  /* 顶部引擎胶囊选择(本地模型 / 已配置 API 模型) */
  const selectHeaderEngine = (v: string) => {
    if (v.startsWith("api:")) {
      const parts = v.slice(4).split("::");
      if (parts.length >= 2 && parts[0] && parts[1]) {
        setActiveProviderId(parts[0]);
        updateProvider(parts[0], { model: parts[1] });
        setEngineMode("api");
      }
    } else {
      setModel(v);
      setEngineMode("local");
    }
  };
  /* 自绘标题栏:按住空白处拖动窗口(按钮/输入框不触发);双击最大化/还原 */
  const onHeaderMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button, select, input, label, .toolbar-right, .engine-menu-backdrop")) return;
    appWindow.startDragging().catch(() => {});
  };
  /* ---- 翻译核心 ---- */
  const runTranslation = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      await translationTask.submit(trimmed, async (text, { signal, isCurrent }) => {

      // 自动检测语言
      let src = sourceLang;
      let tgt = targetLang;
      let hasConflict = false;
      if (src === "auto") {
        const detected = detectLang(text);
        src = detected;
        if (tgt === "auto" || tgt === src) {
          tgt = detected === "zh" ? "en" : detected === "en" ? "zh" : "en";
        }
      } else {
        // 非自动:检测输入语言是否和目标语言相同 → 冲突
        const detected = detectLang(text);
        if (detected === tgt && detected !== src) {
          hasConflict = true;
        }
      }
      setConflict(hasConflict);

      setTranslating(true);
      setApiThinking(false);
      setModeOutput((prev) => ({ ...prev, text: streamOn ? "" : "翻译中..." }));
      try {
        if (streamOn) {
          await translateStream(model, src, tgt, text, numCtx, (token) => {
            if (!isCurrent()) return;
            setApiThinking(false);
            setModeOutput((prev) => ({ ...prev, text: prev.text + token }));
          },
            signal,
            () => { if (isCurrent()) setApiThinking(true); }
          );
        } else {
          const result = await translateFull(model, src, tgt, text, numCtx, signal);
          if (isCurrent()) setModeOutput((prev) => ({ ...prev, text: result }));
        }
      } catch (error: unknown) {
        if (isCurrent()) {
          setModeOutput((prev) => ({ ...prev, text: `翻译失败: ${errorMessage(error)}` }));
        }
      } finally {
        if (isCurrent()) {
          setApiThinking(false);
          setTranslating(false);
        }
      }
      });
    },
    [translationTask, model, sourceLang, targetLang, numCtx, streamOn, engineMode, activeProviderId, providers]
  );

  /* ---- 实时翻译 ---- */
  useEffect(() => {
    // Invalidate immediately, including during the debounce interval.
    translationTask.invalidate();
    setTranslating(false);
    setApiThinking(false);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!input.trim()) {
      setModeOutput((prev) => ({ ...prev, text: "" }));
      setConflict(false);
      return;
    }
    if (composing) return;
    timerRef.current = setTimeout(() => runTranslation(inputRef.current), DEBOUNCE_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      translationTask.invalidate();
    };
  }, [input, runTranslation, translationTask, composing]);

  /* ---- 全局快捷键事件(Rust 侧注册,统一投递到主窗口) ---- */
  useEffect(() => {
    const u = appWindow.listen<string>("global-shortcut", async (e) => {
      if (e.payload === "toggle-floating") {
        if (floatingRef.current) {
          await invoke("close_floating_window");
          setFloatingOpen(false);
        } else {
          await invoke("open_floating_window");
          setFloatingOpen(true);
        }
      } else if (e.payload === "screenshot") {
        try { await invoke("open_screenshot_overlay", { from: "main" }); } catch {}
      } else if (e.payload === "toggle-subtitle") {
        toggleSubtitleRef.current();
      } else if (e.payload === "toggle-audio-subtitle") {
        toggleAudioSubtitleRef.current();
      }
    });
    return () => { u.then((f) => f()); };
  }, []);

  useEffect(() => {
    const start = appWindow.listen("subtitle-start", () => startSubtitleRef.current());
    const stop = appWindow.listen("subtitle-stop", () => stopSubtitleRef.current());
    return () => { start.then(unlisten => unlisten()); stop.then(unlisten => unlisten()); };
  }, []);

  const startScreenshot = async () => {
    if (!componentStatus.ocr.installed) {
      setScreenshotSrc("OCR 组件未安装(约30MB):请到 设置 → 模型 → 识别组件 下载后再试");
      setModeOutput((prev) => ({ ...prev, screenshot: "" }));
      return;
    }
    try { await invoke("open_screenshot_overlay", { from: "main" }); } catch (e) { console.error(e); }
  };

  /* Each capture owns its OCR result and request lifecycle; no shared source slot. */
  useEffect(() => {
    setScreenshotWorking(false);
    const listener = appWindow.listen<{ x: number; y: number; w: number; h: number; source?: string; b64?: string }>("screenshot-done", ({ payload }) => {
      const source = payload.source ?? "main";
      if (source === "subtitle") {
        subtitleTask.invalidate();
        const region = { x: Math.round(payload.x), y: Math.round(payload.y), w: Math.round(payload.w), h: Math.round(payload.h) };
        subRegionRef.current = region;
        setSubRegion(region);
        setSubStatus(`字幕区域已更新 (${region.x},${region.y} ${region.w}x${region.h})`);
        return;
      }
      void screenshotTask.submit({ ...payload, source }, async (capture, { signal, isCurrent }) => {
        const showStatus = (message: string) => {
          if (!isCurrent()) return;
          if (source === "floating") appWindow.emitTo("floating", "screenshot-status", message).catch(() => {});
          else setScreenshotSrc(message);
        };
        setScreenshotWorking(source !== "floating");
        showStatus("正在 OCR 识别…");
        if (source !== "floating") setModeOutput(prev => ({ ...prev, screenshot: "" }));
        try {
          const text = await boundedRequest(() => capture.b64
            ? invoke<string>("ocr_image_b64", { b64: capture.b64 })
            : invoke<string>("screenshot_ocr", { x: Math.round(capture.x), y: Math.round(capture.y), w: Math.round(capture.w), h: Math.round(capture.h) }), signal);
          if (!isCurrent()) return;
          if (!text.trim() || text.startsWith("ERROR:")) { showStatus(text || "未识别到文字"); return; }
          let src = langFor("screenshot").src;
          let tgt = langFor("screenshot").tgt;
          if (src === "auto") src = detectLang(text);
          if (src === tgt) tgt = src === "zh" ? "en" : "zh";
          showStatus(source === "floating" ? "正在翻译…" : text);
          const result = await translateFull(model, src, tgt, text, numCtx, signal);
          if (!isCurrent()) return;
          if (source === "floating") await appWindow.emitTo("floating", "show-translation", { text, src, tgt, result });
          else setModeOutput(prev => ({ ...prev, screenshot: result }));
        } catch (error) {
          showStatus(`识别/翻译失败: ${errorMessage(error)}`);
        } finally {
          if (source !== "floating" && isCurrent()) setScreenshotWorking(false);
        }
      });
    });
    return () => { screenshotTask.invalidate(); listener.then(unlisten => unlisten()); };
  }, [screenshotTask, subtitleTask, model, numCtx, independentLang, modeLangs, sourceLang, targetLang, engineMode, activeProviderId, providers]);

  /* Polling keeps noticing new copies while the latest-task queue translates. */
  useEffect(() => {
    let lastText = "";
    let reading = false;
    let cancelled = false;
    const timer = setInterval(async () => {
      if (reading || (!clipAuto && !floatingRef.current)) return;
      reading = true;
      try {
        const text = await readText();
        if (cancelled || !text || text === lastText || text.length < 2) return;
        lastText = text;
        if (text.split(/\s+/).filter(word => word.length > 1).length > 50) return;
        void clipboardTask.submit(text, async (text, { signal, isCurrent }) => {
          try {
            let src = sourceLang;
            let tgt = targetLang;
            if (src === "auto") {
              src = detectLang(text);
              if (tgt === "auto" || tgt === src) tgt = src === "zh" ? "en" : "zh";
            }
            await invoke("open_floating_window");
            if (!isCurrent()) return;
            setFloatingOpen(true);
            const result = await translateFull(model, src, tgt, text, numCtx, signal);
            if (isCurrent()) await appWindow.emitTo("floating", "show-translation", { text, src, tgt, result });
          } catch (error) {
            if (isCurrent()) appWindow.emitTo("floating", "screenshot-status", `翻译失败: ${errorMessage(error)}`).catch(() => {});
          }
        });
      } catch { /* Clipboard can temporarily be locked by another process. */ }
      finally { reading = false; }
    }, 600);
    return () => { cancelled = true; clearInterval(timer); clipboardTask.invalidate(); };
  }, [clipboardTask, sourceLang, targetLang, model, numCtx, clipAuto, engineMode, activeProviderId, providers]);

  /* ---- 本地模型管理(Wave 10.5:模型页 列表/下载/删除/导入) ---- */
  const refreshLocalModels = async (silent = false): Promise<LocalModelInfo[]> => {
    try {
      const data = await boundedRequest(async signal => {
        const response = await fetch(`${OLLAMA_BASE}/api/tags`, { signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      }, undefined, 5000);
      const list: LocalModelInfo[] = Array.isArray(data.models) ? data.models : [];
      setLocalModels(list);
      setLocalModelsLoaded(true);
      return list;
    } catch (e: any) {
      setLocalModels([]);
      setLocalModelsLoaded(true);
      if (!silent) setEngineStatus("本地模型服务未连接：轻量版需先补充程序旁的 ollama 引擎目录，再下载本地模型；也可配置「外接 API」后切换引擎。");
      return [];
    }
  };
  /* First paint is independent of local inference; bounded retries cover cold service startup. */
  useEffect(() => {
    const controller = new AbortController();
    localModelDiscovery = invoke("wait_local_engine").catch(() => {}).then(async () => {
      const list = await startupModels<LocalModelInfo>(signal => boundedRequest(async requestSignal => {
        const response = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: requestSignal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        return Array.isArray(data.models) ? data.models : [];
      }, signal, 2000), controller.signal);
      if (!controller.signal.aborted) {
        // Publish to inference before resolving the shared readiness promise.
        localModelStore = list; localModelsReady = true;
        setLocalModels(list); setLocalModelsLoaded(true);
      }
    }).catch(() => {
      if (controller.signal.aborted) return;
      localModelStore = []; localModelsReady = true;
      setLocalModels([]); setLocalModelsLoaded(true);
      setEngineStatus("本地模型服务未连接：请到「设置 → 模型」检查本地服务，或配置「外接 API」");
    });
    return () => { controller.abort(); };
  }, []);
  /* 启动后检测识别组件(OCR/ASR)是否已安装 */
  useEffect(() => {
    refreshComponentStatus();
  }, []);

  /* 下载模型(POST /api/pull,流式 NDJSON 进度) */
  const downloadModel = async (name: string) => {
    if (pullJobs[name]) return;
    setPullJobs((prev) => ({ ...prev, [name]: { status: "准备下载…", progress: 0, total: 0 } }));
    setEngineStatus(`正在下载 ${name} …`);
    try {
      const resp = await fetch(`${OLLAMA_BASE}/api/pull`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, stream: true }),
      });
      if (!resp.ok) {
        const t = await resp.text().catch(() => "");
        throw new Error(`HTTP ${resp.status} ${t.slice(0, 120)}`);
      }
      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let lastPct = -1;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let d: any;
          try { d = JSON.parse(line); } catch { continue; }
          if (d.error) throw new Error(d.error);
          if (d.status === "success") {
            setPullJobs((prev) => ({ ...prev, [name]: { status: "success", progress: 1, total: 1 } }));
            setEngineStatus(`模型 ${name} 下载完成`);
          } else {
            const total = d.total || 0;
            const completed = d.completed || 0;
            /* Ollama 0.32.x 的 pull:进度通过 "pulling <短摘要>" 状态携带 total/completed 上报
               (缓存层直接 completed==total);"downloading" 是旧格式兼容。只要带 total 就当进度事件处理,
               否则下载期间进度会一直卡在 0%。 */
            if (total > 0 || d.status === "downloading") {
              /* 速度:同层内按 completed 增量/时间窗平滑计算;换层重置基准。
                 百分比用累计字节(已完成层字节和 + 当前层已下字节)/(已完成层字节和 + 当前层总字节),
                 换层时不会跳回 0%。 */
              const now = Date.now();
              const snap = pullSpeedRef.current[name];
              const layerKey = typeof d.digest === "string" && d.digest ? d.digest : `t:${total}`;
              let completedLayers = snap?.completedLayers ?? 0;
              let lastKey = snap?.lastKey ?? "";
              let lastTotal = snap?.lastTotal ?? 0;
              let lastSpeed = snap?.lastSpeed ?? 0;
              let lastCompleted = snap?.lastCompleted ?? 0;
              let speed = lastSpeed;
              if (layerKey !== lastKey) {
                /* 换层:上一层字节数计入已完成;速度归零重新测 */
                if (lastKey) completedLayers += lastTotal;
                lastKey = layerKey;
                lastTotal = total;
                lastCompleted = completed;
                speed = 0;
              } else {
                lastTotal = total;
                if (total > 0 && completed > lastCompleted) {
                  const dt = (now - (snap?.lastTime ?? now)) / 1000;
                  if (dt > 0) {
                    const inst = (completed - lastCompleted) / dt;
                    speed = lastSpeed > 0 ? lastSpeed * 0.7 + inst * 0.3 : inst;
                  }
                }
                lastCompleted = completed;
              }
              pullSpeedRef.current[name] = { completedLayers, lastKey, lastTotal, lastSpeed: speed, lastTime: now, lastCompleted };
              const doneBytes = completedLayers + completed;
              const totalBytes = completedLayers + total;
              const layer = layerKey.replace(/^sha256:/, "").slice(0, 12);
              setPullJobs((prev) => ({ ...prev, [name]: { status: "downloading", progress: doneBytes, total: totalBytes, speed, layer } }));
              if (totalBytes > 0) {
                const pct = Math.min(100, Math.round((doneBytes / totalBytes) * 100));
                if (pct !== lastPct) {
                  lastPct = pct;
                  setEngineStatus(`正在下载 ${name} … ${pct}%${speed > 0 ? `, ${formatSpeed(speed)}` : ""}`);
                }
              }
            } else {
              setPullJobs((prev) => ({ ...prev, [name]: { status: d.status, progress: prev[name]?.progress ?? 0, total: prev[name]?.total ?? 0 } }));
            }
          }
        }
      }
      await refreshLocalModels(true);
      if (!model) { setModel(name); setEngineMode("local"); }
    } catch (e: any) {
      setPullJobs((prev) => ({ ...prev, [name]: { status: `失败: ${e?.message ?? e}`, progress: 0, total: 0 } }));
      setEngineStatus(`下载 ${name} 失败: ${e?.message ?? e}`);
    } finally {
      delete pullSpeedRef.current[name];
      /* 下载完成后 6 秒自动收起进度条 */
      setTimeout(() => {
        setPullJobs((prev) => { const n = { ...prev }; delete n[name]; return n; });
      }, 6000);
    }
  };

  /* ---- 识别组件(OCR/ASR)安装状态 + 下载(Wave 10.6) ---- */
  const refreshComponentStatus = async () => {
    try {
      const st = await invoke<{ ocr: { installed: boolean }; asr: { multi: { installed: boolean }; ko: { installed: boolean } }; denoise: { installed: boolean } }>("component_status");
      setComponentStatus(st);
    } catch (e) {
      console.error("component_status:", e);
    }
  };
  /* 下载 OCR / ASR 组件:进度事件从 Rust Channel 推回,统一计算速度 */
  const downloadComponent = async (key: "ocr" | "asr-multi" | "asr-ko" | "denoise") => {
    if (componentJobs[key]) return;
    const label = key === "ocr" ? "OCR 文字识别" : key === "asr-multi" ? "ASR 语音识别(8语)" : key === "asr-ko" ? "ASR 语音识别(韩语)" : "降噪模型";
    setComponentJobs((prev) => ({ ...prev, [key]: { status: "准备下载…", progress: 0, total: 0 } }));
    setEngineStatus(`正在下载 ${label} …`);
    const ch = new Channel<any>();
    ch.onmessage = (m) => {
      if (!m || typeof m !== "object") return;
      const now = Date.now();
      if (m.type === "ocr") {
        if (m.status === "done") {
          setComponentJobs((prev) => ({ ...prev, [key]: { status: "success", progress: 1, total: 1 } }));
          setEngineStatus("OCR 文字识别组件下载完成");
        } else if (typeof m.downloaded === "number") {
          const snap = componentSpeedRef.current[key];
          const dt = (now - (snap?.lastTime ?? now)) / 1000;
          let speed = snap?.lastSpeed ?? 0;
          if (dt > 0) {
            const inst = (m.downloaded - (snap?.lastDownloaded ?? 0)) / dt;
            speed = speed > 0 ? speed * 0.7 + inst * 0.3 : inst;
          }
          componentSpeedRef.current[key] = { lastTime: now, lastDownloaded: m.downloaded, lastSpeed: speed };
          setComponentJobs((prev) => ({ ...prev, [key]: { status: "downloading", progress: m.downloaded, total: m.total || m.downloaded, speed, phase: m.file } }));
        }
      } else if (m.type === "asr") {
        if (m.status === "done") {
          setComponentJobs((prev) => ({ ...prev, [key]: { status: "success", progress: 1, total: 1 } }));
          setEngineStatus(`${label} 下载完成`);
        } else if (m.phase === "extract") {
          setComponentJobs((prev) => ({ ...prev, [key]: { status: "正在解压安装…", progress: prev[key]?.progress ?? 0, total: prev[key]?.total ?? 0, speed: prev[key]?.speed } }));
        } else if (typeof m.downloaded === "number") {
          const snap = componentSpeedRef.current[key];
          const dt = (now - (snap?.lastTime ?? now)) / 1000;
          let speed = snap?.lastSpeed ?? 0;
          if (dt > 0) {
            const inst = (m.downloaded - (snap?.lastDownloaded ?? 0)) / dt;
            speed = speed > 0 ? speed * 0.7 + inst * 0.3 : inst;
          }
          componentSpeedRef.current[key] = { lastTime: now, lastDownloaded: m.downloaded, lastSpeed: speed };
          setComponentJobs((prev) => ({ ...prev, [key]: { status: "downloading", progress: m.downloaded, total: m.total || m.downloaded, speed } }));
        }
      } else if (m.type === "denoise") {
        if (m.status === "done") {
          setComponentJobs((prev) => ({ ...prev, [key]: { status: "success", progress: 1, total: 1 } }));
          setEngineStatus("降噪模型下载完成");
        } else if (typeof m.downloaded === "number") {
          const snap = componentSpeedRef.current[key];
          const dt = (now - (snap?.lastTime ?? now)) / 1000;
          let speed = snap?.lastSpeed ?? 0;
          if (dt > 0) {
            const inst = (m.downloaded - (snap?.lastDownloaded ?? 0)) / dt;
            speed = speed > 0 ? speed * 0.7 + inst * 0.3 : inst;
          }
          componentSpeedRef.current[key] = { lastTime: now, lastDownloaded: m.downloaded, lastSpeed: speed };
          setComponentJobs((prev) => ({ ...prev, [key]: { status: "downloading", progress: m.downloaded, total: m.total || m.downloaded, speed } }));
        }
      }
    };
    try {
      if (key === "ocr") {
        await invoke("download_ocr_models", { onProgress: ch });
      } else if (key === "asr-multi" || key === "asr-ko") {
        await invoke("download_asr_model", { kind: key === "asr-multi" ? "multi" : "ko", onProgress: ch });
      } else {
        await invoke("download_denoise_model", { onProgress: ch });
      }
      await refreshComponentStatus();
    } catch (e: any) {
      setComponentJobs((prev) => ({ ...prev, [key]: { status: `失败: ${e?.message ?? e}`, progress: 0, total: 0 } }));
      setEngineStatus(`${label} 下载失败: ${e?.message ?? e}`);
    } finally {
      delete componentSpeedRef.current[key];
      setTimeout(() => {
        setComponentJobs((prev) => { const n = { ...prev }; delete n[key]; return n; });
      }, 6000);
    }
  };

  /* 卸载识别组件(OCR/ASR):释放磁盘空间;Rust 端会先停音频识别/清 OCR 缓存 */
  const uninstallComponent = async (key: "ocr" | "asr-multi" | "asr-ko" | "denoise") => {
    setConfirmDeleteComponent(null);
    const label = key === "ocr" ? "OCR 文字识别" : key === "asr-multi" ? "ASR 语音识别(8语)" : key === "asr-ko" ? "ASR 语音识别(韩语)" : "降噪模型";
    setEngineStatus(`正在卸载 ${label} …`);
    try {
      await invoke("uninstall_component", { kind: key });
      await refreshComponentStatus();
      if (key === "denoise") {
        setAudioDenoise(false);
        await invoke("audio_set_denoise", { enabled: false }).catch(() => {});
      }
      setEngineStatus(`${label} 已卸载,已释放磁盘空间`);
    } catch (e: any) {
      setEngineStatus(`卸载失败: ${e?.message ?? e}`);
    }
  };

  /* 降噪开关(设置 → 音频):模型未安装时引导去识别组件下载 */
  const toggleDenoise = async (on: boolean) => {
    if (on && !componentStatus.denoise.installed) {
      setEngineStatus("降噪模型未安装:请到 设置 → 模型 → 识别组件 下载「降噪模型」(约0.5MB)后再开启");
      return;
    }
    setAudioDenoise(on);
    try { await invoke("audio_set_denoise", { enabled: on }); } catch {}
    setEngineStatus(on ? "已开启降噪(正在重启识别器…)" : "已关闭降噪");
  };

  /* 删除本地模型(DELETE /api/delete);若删的是当前模型,自动切换到剩余模型 */
  const deleteLocalModel = async (name: string) => {
    setConfirmDeleteModel(null);
    setEngineStatus(`正在删除 ${name} …`);
    try {
      const resp = await fetch(`${OLLAMA_BASE}/api/delete`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!resp.ok) {
        const t = await resp.text().catch(() => "");
        throw new Error(`HTTP ${resp.status} ${t.slice(0, 120)}`);
      }
      const list = await refreshLocalModels(true);
      if (model === name) {
        const next = list.find((m) => m.name === "maternion/hy-mt2:1.8b")?.name
          ?? list.find((m) => m.name === "gemma3:4b")?.name
          ?? list[0]?.name
          ?? "";
        setModel(next);
        setEngineMode("local");
        setEngineStatus(next ? `已删除 ${name},当前模型切换为 ${next}` : `已删除 ${name},当前没有本地模型了,请下载或导入`);
      } else {
        setEngineStatus(`已删除 ${name}`);
      }
    } catch (e: any) {
      setEngineStatus(`删除失败: ${e?.message ?? e}`);
    }
  };

  /* 导入本地 GGUF(POST /api/create,Modelfile FROM 绝对路径,流式状态) */
  const importLocalModel = async () => {
    const name = importName.trim();
    const path = importPath.trim();
    if (!name || !path) { setEngineStatus("请填写模型名称和 GGUF 文件路径"); return; }
    if (/\s/.test(name) || !/^[A-Za-z0-9._:\/-]+$/.test(name)) { setEngineStatus("模型名称只能包含字母、数字、. _ : - /"); return; }
    setImportBusy(true);
    setImportStatus("准备导入…");
    setEngineStatus(`正在导入 ${name} …`);
    const ch = new Channel<string>();
    ch.onmessage = (s) => setImportStatus(s);
    try {
      /* 大文件上传/转换走 Rust 端(import_gguf_model:算 sha256 → 上传 blob → /api/create files) */
      await invoke<string>("import_gguf_model", { model: name, path, onStatus: ch });
      await refreshLocalModels(true);
      setModel(name);
      setEngineMode("local");
      setEngineStatus(`模型 ${name} 导入完成,已切换为当前模型`);
      setImportName("");
      setImportPath("");
    } catch (e: any) {
      setImportStatus("");
      setEngineStatus(`导入失败: ${e?.message ?? e}`);
    } finally {
      setImportBusy(false);
    }
  };

  /* 文件拖拽取路径(Tauri 拖拽事件自带真实路径,无需文件选择器依赖) */
  useEffect(() => {
    let un: (() => void) | undefined;
    getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type === "enter" || event.payload.type === "over") {
        setImportDragging(true);
      } else if (event.payload.type === "leave") {
        setImportDragging(false);
      } else if (event.payload.type === "drop") {
        setImportDragging(false);
        const p = event.payload.paths.find((x) => /\.gguf$/i.test(x)) ?? event.payload.paths[0];
        if (p) {
          setImportPath(p);
          setEngineStatus(`已选择文件: ${p}`);
        }
      }
    }).then((f) => { un = f; }).catch(() => {});
    return () => { un?.(); };
  }, []);

  /* ---- 外接 API 供应商管理(第 8 波) ---- */
  const activeProvider = providers.find((p) => p.id === activeProviderId) ?? null;
  /* 顶部模型下拉:本地模型 + 所有已配置供应商的全部 API 模型(直接选,自动切供应商/引擎) */
  const apiModelOptions: { providerId: string; model: string; label: string }[] = [];
  {
    const seen = new Set<string>();
    for (const p of providers) {
      if (!p.baseUrl.trim() || !p.apiKey.trim()) continue;
      const names = p.models.length ? [...p.models] : [];
      if (p.model && !names.includes(p.model)) names.push(p.model);
      for (const m of names) {
        if (!m.trim()) continue;
        const key = `${p.id}::${m}`;
        if (seen.has(key)) continue;
        seen.add(key);
        apiModelOptions.push({ providerId: p.id, model: m, label: `${p.alias || p.baseUrl} · ${m}` });
      }
    }
  }
  const activeApiModel = (engineMode === "api" || engineMode === "auto") && activeProvider && activeProvider.model.trim()
    ? { providerId: activeProvider.id, model: activeProvider.model }
    : null;
  /* 顶部菜单的本地模型顺序:HY-MT2 → gemma3 → 其他(按名称) */
  const menuLocalModels = [...localModels].sort((a, b) => {
    const rank = (n: string) => n === "maternion/hy-mt2:1.8b" ? 0 : n === "gemma3:4b" ? 1 : 2;
    return rank(a.name) - rank(b.name) || a.name.localeCompare(b.name);
  });
  const engineLabelText = (() => {
    if (activeApiModel && activeProvider) return `${activeProvider.alias || "API"} · ${activeApiModel.model}`;
    if (localModelsLoaded && localModels.length === 0) return "无本地模型";
    if (model === "maternion/hy-mt2:1.8b") return "HY-MT2 · 本地";
    if (model === "gemma3:4b") return "gemma3 · 本地";
    return `${model} · 本地`;
  })();
  const headerEngineValue = activeApiModel ? `api:${activeApiModel.providerId}::${activeApiModel.model}` : model;
  const addProvider = (presetIndex?: number) => {
    const preset = presetIndex !== undefined ? PROVIDER_PRESETS[presetIndex] : undefined;
    const p: ProviderCfg = {
      id: `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      alias: preset?.name ?? "新供应商",
      baseUrl: preset?.baseUrl ?? "",
      apiKey: "",
      model: preset?.models[0] ?? "",
      models: preset?.models ? [...preset.models] : [],
      temperature: "",
      noThinking: "",
    };
    setProviders((prev) => [...prev, p]);
    setActiveProviderId(p.id);
    setEngineStatus(preset ? `已按预设创建「${p.alias}」,请填写 API Key` : "");
  };
  const removeProvider = (id: string) => {
    setProviders((prev) => {
      const next = prev.filter((p) => p.id !== id);
      if (activeProviderId === id) setActiveProviderId(next[0]?.id ?? "");
      return next;
    });
  };
  const updateProvider = (id: string, patch: Partial<ProviderCfg>) => {
    setProviders((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  };
  /* 供应商排序:上移/下移(按钮方案,不用拖拽——WebView 拖拽易出问题) */
  const moveProvider = (id: string, dir: -1 | 1) => {
    setProviders((prev) => {
      const idx = prev.findIndex((p) => p.id === id);
      if (idx < 0) return prev;
      const to = idx + dir;
      if (to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[to]] = [next[to], next[idx]];
      return next;
    });
  };
  /* 移除供应商下的单个模型(删的是当前模型时,自动选剩余第一个) */
  const removeModel = (id: string, m: string) => {
    setProviders((prev) => prev.map((p) => {
      if (p.id !== id) return p;
      const models = p.models.filter((x) => x !== m);
      const model = p.model === m ? (models[0] ?? "") : p.model;
      return { ...p, models, model };
    }));
  };
  /* 检测模型:拉取供应商可用模型列表,打开"选择器"让用户点选要添加的(绝不自动全量导入) */
  const openModelPicker = async (id: string) => {
    const p = providers.find((x) => x.id === id);
    if (!p) return;
    if (!p.baseUrl.trim() || !p.apiKey.trim()) {
      setEngineStatus("请先填写 Base URL 和 API Key 再检测模型");
      return;
    }
    setEngineStatus("正在检测模型…");
    try {
      const models = await fetchApiModels(p);
      if (!models.length) throw new Error("模型列表为空(可手动输入模型名)");
      setDetectPicker({ providerId: id, models, query: "" });
      setEngineStatus(`已检测到 ${models.length} 个模型,点选要添加的(只添加你选的)`);
    } catch (e: any) {
      setEngineStatus(`检测失败: ${e?.message ?? e}`);
    }
  };
  /* 从选择器添加一个模型(仅这一个进入该供应商的模型列表并设为当前模型) */
  const pickModel = (id: string, m: string) => {
    const p = providers.find((x) => x.id === id);
    if (!p) return;
    const models = p.models.includes(m) ? p.models : [...p.models, m];
    updateProvider(id, { models, model: m });
    setEngineStatus(`已添加并选择: ${m}`);
  };
  const testProvider = async (id: string) => {
    const p = providers.find((x) => x.id === id);
    if (!p) return;
    if (!p.baseUrl.trim() || !p.apiKey.trim() || !p.model.trim()) {
      setTestStates((prev) => ({ ...prev, [id]: { state: "err", msg: "请先填写 Base URL / API Key / 模型" } }));
      setEngineStatus("请完整填写 Base URL / API Key / 模型");
      return;
    }
    setTestStates((prev) => ({ ...prev, [id]: { state: "testing", msg: "正在测试连接…" } }));
    setEngineStatus("正在测试连接…");
    try {
      const result = await fetchApiFull(p, "en", "zh", "hello");
      setTestStates((prev) => ({ ...prev, [id]: { state: "ok", msg: `连接成功: ${result.slice(0, 40)}` } }));
      setEngineStatus(`连接成功: ${result.slice(0, 60)}`);
    } catch (e: any) {
      setTestStates((prev) => ({ ...prev, [id]: { state: "err", msg: `${e?.message ?? e}` } }));
      setEngineStatus(`测试失败: ${e?.message ?? e}`);
    }
  };

  /* ---- 快捷键录制(Wave 9) ---- */
  const startRecording = (act: ShortcutAction) => { setShortcutError(""); setRecordingAction(act); };
  const stopRecording = () => setRecordingAction(null);
  useEffect(() => {
    if (!recordingAction) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Control" || e.key === "Alt" || e.key === "Shift") return; // 修饰键先按下,等待主键
      const r = keyEventToAccelerator(e);
      if (!r.ok) { setShortcutError(r.reason ?? "无效快捷键"); return; }
      const clash = (Object.keys(SHORTCUT_LABELS) as ShortcutAction[]).find((a) => a !== recordingAction && shortcuts[a] === r.combo);
      if (clash) { setShortcutError(`此快捷键已被「${SHORTCUT_LABELS[clash]}」使用`); return; }
      setShortcuts((prev) => ({ ...prev, [recordingAction]: r.combo }));
      setShortcutError(`已设置为 ${r.combo}`);
      setRecordingAction(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [recordingAction, shortcuts]);

  /* Presentation adapters share all existing business state. */
  const resolvedDark = theme === "dark" || (theme === "system" && typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const studioLanguages = activeMode === "text" ? { src: sourceLang, tgt: targetLang } : langFor(activeMode);
  const currentOutput = activeMode === "audio" ? audioHist.filter(x => x.result).slice(-2).map(x => x.result).join("\n") : modeOutput[activeMode];
  const manuallyTranslate = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    void runTranslation(input);
  };
  const pasteInput = async () => {
    const before = inputRef.current;
    try {
      const text = await readText();
      if (inputRef.current !== before) return;
      if (!text) { setActionNotice("剪贴板中没有文字"); return; }
      setInput(text);
      textareaElRef.current?.focus();
    } catch (error) { setActionNotice(`粘贴失败：${errorMessage(error)}`); }
  };
  const copyOutput = async () => {
    try { await writeText(currentOutput); setActionNotice("译文已复制"); }
    catch (error) { setActionNotice(`复制失败：${errorMessage(error)}`); }
  };
  const settingsView = (<main className="app-body settings-body">
          <div className="settings-center">
            <nav className="settings-nav">
              <div className="settings-nav-head"><Icon name="settings" size={14} /> 设置</div>
              {SETTINGS_NAV.map(([key, label]) => (
                <button key={key} className={`settings-nav-item${settingsPage === key ? " active" : ""}`} onClick={() => setSettingsPage(key)}>
                  {label}
                </button>
              ))}
              <button className="settings-nav-back" onClick={() => setSettingsOpen(false)}>← 返回翻译</button>
            </nav>
            <div className="settings-content">
              <div className="settings-fade" key={settingsPage}>
              {settingsPage === "general" && (
                <div className="settings-section">
                  <h2>常规</h2>
                  <div className="settings-row">
                    <span>界面布局</span>
                    <div className="seg">
                      <button className={`seg-item${uiLayout === "poetry" ? " active" : ""}`} onClick={() => setUiLayout("poetry")}>诗集</button>
                      <button className={`seg-item${uiLayout === "studio" ? " active" : ""}`} onClick={() => setUiLayout("studio")}>工作台</button>
                      <button className={`seg-item${uiLayout === "classic" ? " active" : ""}`} onClick={() => setUiLayout("classic")}>经典</button>
                    </div>
                    <span className="settings-note">随时切换，保留当前内容与设置</span>
                  </div>
                  <div className="settings-row">
                    <span>导航展开方式</span>
                    <div className="seg">
                      <button className={`seg-item${navigation === "persistent" ? " active" : ""}`} onClick={() => setNavigation("persistent")}>常驻导航</button>
                      <button className={`seg-item${navigation === "hover" ? " active" : ""}`} onClick={() => setNavigation("hover")}>悬停展开</button>
                    </div>
                    <span className="settings-note">工作区展开时导航保持展开；收起工作区不停止任务</span>
                  </div>
                  <div className="settings-row">
                    <span>主题</span>
                    <div className="seg">
                      {([["light", "浅色"], ["dark", "深色"], ["system", "跟随系统"]] as const).map(([v, label]) => (
                        <button key={v} className={`seg-item${theme === v ? " active" : ""}`} onClick={() => setTheme(v)}>{label}</button>
                      ))}
                    </div>
                  </div>
                  <div className="settings-row">
                    <span>主题颜色</span>
                    <input type="color" value={accentColor || (resolvedDark ? "#D9987F" : "#C8886D")} onChange={(e) => setAccentColor(e.target.value)} title="自定义强调色(按钮 / 选中高亮等)" />
                    <button className="btn-float" onClick={() => setAccentColor("")}>跟随默认</button>
                    <span className="settings-note">强调色用于按钮、选中高亮等,即时生效</span>
                  </div>
                  <div className="settings-row">
                    <span>主窗口关闭行为</span>
                    <div className="seg">
                      {([["hide", "隐藏到托盘"], ["quit", "直接退出"]] as const).map(([v, label]) => (
                        <button key={v} className={`seg-item${mainClose === v ? " active" : ""}`} onClick={() => setMainClose(v)}>{label}</button>
                      ))}
                    </div>
                  </div>
                  <label className="settings-check">
                    <input type="checkbox" checked={clipAuto} onChange={(e) => setClipAuto(e.target.checked)} />
                    复制即译(复制任意文字自动弹出翻译悬浮窗)
                  </label>
                  <label className="settings-check">
                    <input type="checkbox" checked={conflictHint} onChange={(e) => setConflictHint(e.target.checked)} />
                    检测到原文已是目标语言时提示交换方向
                  </label>
                  <p className="settings-note">常驻模式:关闭主窗口默认隐藏到托盘,真正退出走系统托盘菜单「退出」。</p>
                </div>
              )}
              {settingsPage === "translate" && (
                <div className="settings-section">
                  <h2>翻译</h2>
                  <div className="settings-row">
                    <span>默认源语言</span>
                    <select className="tool-select" value={sourceLang} onChange={(e) => setSourceLang(e.target.value)}>
                      {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
                    </select>
                  </div>
                  <div className="settings-row">
                    <span>默认目标语言</span>
                    <select className="tool-select" value={targetLang} onChange={(e) => setTargetLang(e.target.value)}>
                      {LANGS.filter((l) => l.code !== "auto").map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
                    </select>
                  </div>
                  <div className="settings-row">
                    <span>上下文窗口</span>
                    <select className="tool-select" value={numCtx} onChange={(e) => setNumCtx(Number(e.target.value))}>
                      {CTX_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </div>
                  <div className="settings-row">
                    <span>输出模式</span>
                    <div className="seg">
                      {([["stream", "流式输出"], ["full", "完整输出"]] as const).map(([v, label]) => (
                        <button key={v} className={`seg-item${(streamOn ? "stream" : "full") === v ? " active" : ""}`} onClick={() => setStreamOn(v === "stream")}>{label}</button>
                      ))}
                    </div>
                  </div>
                  <label className="settings-check">
                    <input type="checkbox" checked={independentLang} onChange={(e) => toggleIndependentLang(e.target.checked)} />
                    各模式语言方向相互独立(默认不独立=音频/视频/截图跟随文本翻译;开启后各自单独设置,改回不独立时回到跟随文本翻译)
                  </label>
                  <p className="settings-note">语言方向也会同步主界面顶部的快捷选择。单独设置过的电脑音频／麦克风语言优先；可在「音频」页恢复跟随默认。</p>
                </div>
              )}
              {settingsPage === "audio" && (
                <div className="settings-section">
                  <h2>音频</h2>
                  <p className="settings-note">主界面可分别设置电脑音频和麦克风语言；未单独修改的来源继续跟随音频默认语言。</p>
                  <button className="btn-float" disabled={audioControlsBusy || isSrcOn("system") || isSrcOn("mic")} onClick={() => setAudioChannelLanguages({ system: null, mic: null })}>两路语言恢复跟随默认（请先停止监听）</button>
                  <p className="settings-note">断句灵敏度 = 识别停顿多久算一句结束(秒),数值越小越敏感;按识别语言独立设置,主界面和语音窗同步。</p>
                  {[["auto", "自动"], ["zh", "中文"], ["en", "英语"], ["ja", "日语"], ["ko", "韩语"]].map(([code, name]) => (
                    <div className="settings-row" key={code}>
                      <span>{name}断句</span>
                      <input type="range" min="1" max="40" step="1"
                        value={Math.round((sensitivityForLang(code) ?? 0.6) * 10)}
                        onChange={(e) => setSensitivityForLang(code, Number(e.target.value) / 10)}
                        onPointerUp={(e) => applySensitivityForLang(code, Number(e.currentTarget.value) / 10)}
                        onKeyUp={(e) => { if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(e.key)) applySensitivityForLang(code, Number(e.currentTarget.value) / 10); }} />
                      <b>{(sensitivityForLang(code) ?? 0.6).toFixed(1)}s</b>
                    </div>
                  ))}
                  <div className="settings-row">
                    <span>降噪(去喘气/底噪)</span>
                    <label className="subtitle-mode" title="识别前先用 GTCRN 压掉喘气/底噪/部分回声,适合跑步、户外等嘈杂视频;需先下载降噪模型">
                      <input type="checkbox" checked={audioDenoise} onChange={(e) => toggleDenoise(e.target.checked)} />
                      开启
                    </label>
                    <span className="settings-note">{audioDenoise ? "已开启(重启识别后生效)" : componentStatus.denoise.installed ? "默认关(不增加CPU占用)" : "需先到「识别组件」下载降噪模型"}</span>
                  </div>
                </div>
              )}
              {settingsPage === "subtitle" && (
                <div className="settings-section">
                  <h2>视频字幕</h2>
                  <div className="settings-row">
                    <span>截帧频率</span>
                    <input type="range" min="1" max="5" value={subFps} onChange={(e) => setSubFps(Number(e.target.value))} />
                    <b>{subFps} 次/秒</b>
                  </div>
                  <div className="settings-row">
                    <span>显示策略</span>
                    <select className="tool-select" value={subMode} onChange={(e) => setSubMode(e.target.value as "trans-first" | "ocr-first")}>
                      <option value="trans-first">翻译优先</option>
                      <option value="ocr-first">原文优先</option>
                    </select>
                  </div>
                  <div className="settings-row">
                    <span>OCR 引擎</span>
                    <select className="tool-select" value={subEngine} onChange={(e) => setSubEngine(e.target.value as "win" | "rapid")}>
                      <option value="win">系统OCR(快)</option>
                      <option value="rapid">RapidOCR</option>
                    </select>
                  </div>
                </div>
              )}
              {settingsPage === "floating" && (
                <div className="settings-section">
                  <h2>悬浮窗外观</h2>
                  <p className="settings-note">改动即时生效、重启保留。翻译、字幕、电脑音频与麦克风悬浮窗共享透明度；背景、文字颜色和字号可分别调整。点「跟随主题」可恢复默认颜色。</p>
                  <div className="settings-row floating-open-actions">
                    <button className="btn-float" onClick={async () => {
                      try { await invoke("open_floating_window"); setFloatingOpen(true); }
                      catch (cause) { setActionNotice(`打开翻译悬浮窗失败：${errorMessage(cause)}`); }
                    }}><Icon name="windows" size={14} /> 打开翻译窗</button>
                    <button className="btn-float" onClick={async () => {
                      try { await invoke("open_audio_floating_window", { source: "system" }); }
                      catch (cause) { setActionNotice(`打开电脑音频窗失败：${errorMessage(cause)}`); }
                    }}><Icon name="volume" size={14} /> 打开电脑音频窗</button>
                    <button className="btn-float" onClick={async () => {
                      try { await invoke("open_audio_floating_window", { source: "mic" }); }
                      catch (cause) { setActionNotice(`打开麦克风窗失败：${errorMessage(cause)}`); }
                    }}><Icon name="mic" size={14} /> 打开麦克风窗</button>
                    <button className="btn-float" onClick={() => setAppearance(previous => followFloatingTheme(previous))}>统一跟随主题</button>
                  </div>
                  <p className="settings-note">仅打开悬浮窗，不启动音频识别。可拖动标题栏排列、拼接窗口。</p>
                  <div className="appearance-preview">
                    <div className="appearance-preview-card" style={{
                      background: hexToRgba(appearance.floating.bg || (resolvedDark ? "#282624" : "#F9F7F4"), appearance.floating.opacity / 100),
                      color: appearance.floating.textColor || "var(--ios-text)",
                      fontSize: `${appearance.floating.fontSize}px`,
                    }}>
                      <div style={{ opacity: 0.7, fontSize: "0.82em" }}>{floatingSample[0]}</div>
                      <div style={{ fontWeight: 600 }}>{floatingSample[1]}</div>
                    </div>
                  </div>
                  {(Object.keys(SURFACE_LABELS) as SurfaceKey[]).map((key) => {
                    const item = appearance[key];
                    const patch = (p: Partial<AppearanceItem>) => setAppearance((prev) => {
                      const next = { ...prev, [key]: { ...prev[key], ...p } };
                      return key !== "main" && typeof p.opacity === "number" ? withFloatingOpacity(next, p.opacity) : next;
                    });
                    return (
                      <div className="appearance-group" key={key}>
                        <h3>{SURFACE_LABELS[key]}</h3>
                        <div className="settings-row">
                          <span>背景颜色</span>
                          <input type="color" value={item.bg || (key === "main" ? "#f2f2f7" : "#ffffff")} onChange={(e) => patch({ bg: e.target.value })} />
                          <button className="btn-float" onClick={() => patch({ bg: "" })}>跟随主题</button>
                        </div>
                        <div className="settings-row">
                          <span>{key === "main" ? "背景透明度" : "共享透明度"}</span>
                          <input type="range" min="0" max="100" value={item.opacity} onChange={(e) => patch({ opacity: Number(e.target.value) })} />
                          <b>{item.opacity}%</b>
                        </div>
                        <div className="settings-row">
                          <span>文字颜色</span>
                          <input type="color" value={item.textColor || "#1c1c1e"} onChange={(e) => patch({ textColor: e.target.value })} />
                          <button className="btn-float" onClick={() => patch({ textColor: "" })}>跟随主题</button>
                        </div>
                        <div className="settings-row">
                          <span>字号</span>
                          <select className="tool-select" value={item.fontSize} onChange={(e) => patch({ fontSize: Number(e.target.value) })}>
                            {[12, 14, 15, 16, 18, 20, 24].map((n) => <option key={n} value={n}>{n}px</option>)}
                          </select>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {settingsPage === "providers" && (
                <div className="settings-section">
                  <h2>模型</h2>
                  <p className="settings-note">本地模型由随应用内置的 Ollama 管理;正式发布包不会内置模型,请下载 HY-MT2 / gemma3 或导入自己的 GGUF 文件。外接 API 即云端模型,配置后无需本地显卡。截图/音频等识别组件见下方「识别组件」按需下载。</p>
                  {engineStatus && <p className="settings-note">{engineStatus}</p>}

                  {/* 本地模型 */}
                  <div className="settings-block">
                    <div className="settings-block-head">
                      <h3>本地模型</h3>
                      <button className="btn-float" onClick={() => refreshLocalModels()} title="重新读取本地模型列表"><Icon name="refresh" size={13} /> 刷新列表</button>
                    </div>
                    <p className="settings-note">轻量版不附带 Ollama 引擎。使用本地翻译时，请保留旧版的 ollama 目录，或先补充完整的便携引擎，再下载模型；外接 API 不需要本地引擎。</p>
                    <div className="settings-row">
                      <span>下载</span>
                      <button className="btn-float" disabled={!!pullJobs["maternion/hy-mt2:1.8b"]} onClick={() => downloadModel("maternion/hy-mt2:1.8b")} title="Ollama 模型库 maternion/hy-mt2:1.8b(翻译专用小模型,约 1.1GB)">
                        <Icon name="download" size={13} /> HY-MT2 (1.8B · 推荐)
                      </button>
                      <button className="btn-float" disabled={!!pullJobs["gemma3:4b"]} onClick={() => downloadModel("gemma3:4b")} title="Ollama 模型库 gemma3:4b(通用模型,约 3.3GB)">
                        <Icon name="download" size={13} /> gemma3 (4B)
                      </button>
                    </div>
                    {/* 下载进度(独立于模型列表:首次下载的模型还没出现在列表里也能看到) */}
                    {Object.keys(pullJobs).length > 0 && (
                      <div className="pull-jobs">
                        {Object.entries(pullJobs).map(([name, job]) => {
                          const pct = job.total > 0 ? Math.min(100, Math.round((job.progress / job.total) * 100)) : 0;
                          const speedText = job.speed && job.speed > 0 ? formatSpeed(job.speed) : "";
                          const etaSec = job.speed && job.speed > 0 && job.total > job.progress ? Math.round((job.total - job.progress) / job.speed) : 0;
                          const displayName = name === "maternion/hy-mt2:1.8b" ? "HY-MT2 (1.8B)" : name === "gemma3:4b" ? "gemma3 (4B)" : name;
                          const statusText = job.status === "downloading"
                            ? `${pct}%${speedText ? ` · ${speedText}` : ""}${etaSec > 0 ? ` · 剩余 ${formatEta(etaSec)}` : ""}`
                            : (PULL_STATUS_TEXT[job.status] ?? job.status);
                          return (
                            <div className="pull-job" key={name}>
                              <div className="pull-job-head">
                                <span className="pull-job-name">{displayName}</span>
                                <span className="pull-job-meta">{statusText}</span>
                              </div>
                              {job.status === "downloading" && job.layer && <div className="pull-job-layer">数据层 {job.layer}</div>}
                              <div className="pull-progress-bar">
                                <span className="pull-progress-fill" style={{ width: `${pct}%` }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    <div className="local-model-list">
                      {localModels.length === 0 && (
                        <p className="settings-note">{localModelsLoaded ? "还没有本地模型:点上方按钮下载,或导入 GGUF 文件。" : "正在读取本地模型列表…"}</p>
                      )}
                      {localModels.map((m) => {
                        const isCurrent = model === m.name;
                        return (
                          <div className={`local-model-row${isCurrent ? " active" : ""}`} key={m.name}>
                            <span className="provider-name">
                              <Icon name="dot" size={12} style={{ color: isCurrent ? "#34c759" : "#c7c7cc" }} />
                              {m.name === "maternion/hy-mt2:1.8b" ? "HY-MT2-1.8B" : m.name === "gemma3:4b" ? "gemma3:4b" : m.name}
                            </span>
                            <span className="local-model-size">{formatModelSize(m.size)}</span>
                            <div className="provider-actions">
                              {isCurrent ? (
                                <span className="local-model-current">当前</span>
                              ) : (
                                <button className="btn-float" onClick={() => { setModel(m.name); setEngineMode("local"); setEngineStatus(`已切换本地模型: ${m.name}`); }} title="切换为当前模型">使用</button>
                              )}
                              <button className="btn-float" onClick={() => setConfirmDeleteModel(m.name)} title={`删除 ${m.name},释放磁盘空间`}><Icon name="trash" size={13} /> 删除</button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {confirmDeleteModel && (
                      <div className="confirm-delete">
                        <span>删除本地模型 <b>{confirmDeleteModel}</b>?该操作会释放磁盘空间,不可恢复。</span>
                        <button className="btn-float" onClick={() => setConfirmDeleteModel(null)}>取消</button>
                        <button className="btn-float danger" onClick={() => deleteLocalModel(confirmDeleteModel)}><Icon name="trash" size={13} /> 确认删除</button>
                      </div>
                    )}

                    {/* 导入 GGUF */}
                    <div className="provider-card import-card">
                      <div className="provider-card-head">
                        <span className="provider-name"><Icon name="folder" size={13} /> 导入本地 GGUF 模型</span>
                        <span className="settings-note">支持 HuggingFace / LM Studio 下载的 .gguf 文件</span>
                      </div>
                      <div className="provider-fields">
                        <input className="engine-input" placeholder="模型名称(如 my-model)" value={importName} onChange={(e) => setImportName(e.target.value)} spellCheck={false} />
                        <input className="engine-input" placeholder="GGUF 文件路径(可粘贴,或把文件拖到下方区域)" value={importPath} onChange={(e) => setImportPath(e.target.value)} spellCheck={false} />
                      </div>
                      <div className={`drop-zone${importDragging ? " dragging" : ""}`} onDragOver={(e) => { e.preventDefault(); setImportDragging(true); }} onDragLeave={() => setImportDragging(false)} onDrop={(e) => { e.preventDefault(); setImportDragging(false); }}>
                        把 .gguf 文件拖到这里,自动填入路径
                      </div>
                      {importStatus && <span className="settings-note">{importStatus}</span>}
                      <button className="btn-float" disabled={importBusy || !importName.trim() || !importPath.trim()} onClick={() => importLocalModel()}>
                        {importBusy ? "正在导入…" : <><Icon name="plus" size={13} /> 开始导入</>}
                      </button>
                    </div>
                  </div>

                  {/* 识别组件(OCR / ASR)按需下载:纯文字版不内置,下载后立即可用 */}
                  <div className="settings-block">
                    <div className="settings-block-head">
                      <h3>识别组件(按需下载)</h3>
                      <button className="btn-float" onClick={() => refreshComponentStatus()} title="重新检测 OCR / ASR 组件是否已安装"><Icon name="refresh" size={13} /> 刷新状态</button>
                    </div>
                    <p className="settings-note">纯文字版不内置识别模型,需要哪项点哪项下载:截图/视频字幕用 OCR(约 30MB),音频字幕用 ASR(8语约 247MB,韩语约 399MB)。下载完成后立即可用,不用时删掉对应文件夹即可释放空间。</p>
                    <div className="settings-row">
                      <span>OCR 文字识别</span>
                      <span className="settings-note">截图翻译 / 视频字幕</span>
                      <b className="local-model-size">{componentStatus.ocr.installed ? "已安装" : "约 30MB"}</b>
                      {componentStatus.ocr.installed ? (
                        <button className="btn-float danger" onClick={() => setConfirmDeleteComponent("ocr")} title="卸载 OCR 模型,释放约 30MB 磁盘空间"><Icon name="trash" size={13} /> 卸载</button>
                      ) : (
                        <button className="btn-float" disabled={!!componentJobs["ocr"]} onClick={() => downloadComponent("ocr")} title="下载 OCR 模型(PP-OCRv6,截图翻译与视频字幕需要)">
                          <Icon name="download" size={13} /> 下载
                        </button>
                      )}
                    </div>
                    <div className="settings-row">
                      <span>ASR 语音识别 · 8语</span>
                      <span className="settings-note">音频字幕(中/英/日 等)</span>
                      <b className="local-model-size">{componentStatus.asr.multi.installed ? "已安装" : "约 247MB"}</b>
                      {componentStatus.asr.multi.installed ? (
                        <button className="btn-float danger" onClick={() => setConfirmDeleteComponent("asr-multi")} title="卸载 ASR 8语模型,释放约 247MB 磁盘空间"><Icon name="trash" size={13} /> 卸载</button>
                      ) : (
                        <button className="btn-float" disabled={!!componentJobs["asr-multi"]} onClick={() => downloadComponent("asr-multi")} title="下载 8 语流式语音识别模型(中/英/日/阿/印尼/俄/泰/越)">
                          <Icon name="download" size={13} /> 下载
                        </button>
                      )}
                    </div>
                    <div className="settings-row">
                      <span>ASR 语音识别 · 韩语</span>
                      <span className="settings-note">音频字幕(韩语)</span>
                      <b className="local-model-size">{componentStatus.asr.ko.installed ? "已安装" : "约 399MB"}</b>
                      {componentStatus.asr.ko.installed ? (
                        <button className="btn-float danger" onClick={() => setConfirmDeleteComponent("asr-ko")} title="卸载 ASR 韩语模型,释放约 399MB 磁盘空间"><Icon name="trash" size={13} /> 卸载</button>
                      ) : (
                        <button className="btn-float" disabled={!!componentJobs["asr-ko"]} onClick={() => downloadComponent("asr-ko")} title="下载韩语流式语音识别模型">
                          <Icon name="download" size={13} /> 下载
                        </button>
                      )}
                    </div>
                    <div className="settings-row">
                      <span>降噪模型(GTCRN)</span>
                      <span className="settings-note">识别前压掉喘气/底噪</span>
                      <b className="local-model-size">{componentStatus.denoise.installed ? "已安装" : "约 0.5MB"}</b>
                      {componentStatus.denoise.installed ? (
                        <button className="btn-float danger" onClick={() => setConfirmDeleteComponent("denoise")} title="卸载降噪模型,释放磁盘空间(降噪开关将自动关闭)"><Icon name="trash" size={13} /> 卸载</button>
                      ) : (
                        <button className="btn-float" disabled={!!componentJobs["denoise"]} onClick={() => downloadComponent("denoise")} title="下载 GTCRN 降噪模型(设置 → 音频 里开启降噪后生效)">
                          <Icon name="download" size={13} /> 下载
                        </button>
                      )}
                    </div>
                    {confirmDeleteComponent && (
                      <div className="confirm-delete">
                        <span>卸载 {confirmDeleteComponent === "ocr" ? "OCR 文字识别" : confirmDeleteComponent === "asr-multi" ? "ASR 语音识别(8语)" : confirmDeleteComponent === "asr-ko" ? "ASR 语音识别(韩语)" : "降噪模型"}?该操作会释放磁盘空间,不可恢复。</span>
                        <button className="btn-float" onClick={() => setConfirmDeleteComponent(null)}>取消</button>
                        <button className="btn-float danger" onClick={() => uninstallComponent(confirmDeleteComponent)}><Icon name="trash" size={13} /> 确认卸载</button>
                      </div>
                    )}
                    {/* 组件下载进度(与本地模型下载样式一致) */}
                    {Object.keys(componentJobs).length > 0 && (
                      <div className="pull-jobs">
                        {Object.entries(componentJobs).map(([key, job]) => {
                          const pct = job.total > 0 ? Math.min(100, Math.round((job.progress / job.total) * 100)) : 0;
                          const speedText = job.speed && job.speed > 0 ? formatSpeed(job.speed) : "";
                          const etaSec = job.speed && job.speed > 0 && job.total > job.progress ? Math.round((job.total - job.progress) / job.speed) : 0;
                          const displayName = key === "ocr" ? "OCR 文字识别" : key === "asr-multi" ? "ASR 语音识别(8语)" : key === "asr-ko" ? "ASR 语音识别(韩语)" : "降噪模型";
                          const statusText = job.status === "downloading"
                            ? `${pct}%${speedText ? ` · ${speedText}` : ""}${etaSec > 0 ? ` · 剩余 ${formatEta(etaSec)}` : ""}${job.phase ? ` · ${job.phase}` : ""}`
                            : (PULL_STATUS_TEXT[job.status] ?? job.status);
                          return (
                            <div className="pull-job" key={key}>
                              <div className="pull-job-head">
                                <span className="pull-job-name">{displayName}</span>
                                <span className="pull-job-meta">{statusText}</span>
                              </div>
                              <div className="pull-progress-bar">
                                <span className="pull-progress-fill" style={{ width: `${pct}%` }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* 外接 API(云端模型) */}
                  <div className="settings-block">
                    <div className="settings-block-head">
                      <h3>外接 API(云端模型)</h3>
                    </div>
                    <p className="settings-note">供应商 = 外接 API 服务(Base URL + Key + 模型)。不配置时全部走本地模型;顶部模型下拉可直接切换本地/外接。</p>
                    <div className="settings-row">
                      <span>当前生效</span>
                      <select className="tool-select" value={activeProviderId} onChange={(e) => setActiveProviderId(e.target.value)}>
                        {providers.length === 0 && <option value="">未配置(本地模型)</option>}
                        {providers.map((p) => <option key={p.id} value={p.id}>{p.alias || p.baseUrl || "(未命名)"}{p.model ? ` · ${p.model}` : ""}</option>)}
                      </select>
                      <select className="tool-select" defaultValue="" onChange={(e) => { const v = e.target.value; e.target.value = ""; if (v !== "") addProvider(Number(v)); }} title="按预设新建供应商,自动填 Base URL 和常见模型">
                        <option value="">按预设新建…</option>
                        {PROVIDER_PRESETS.map((pr, i) => <option key={pr.name} value={i}>{pr.name}</option>)}
                      </select>
                      <button className="btn-float" onClick={() => addProvider()} title="手动新增空供应商"><Icon name="plus" size={13} /> 新增</button>
                    </div>
                    <div className="provider-list">
                      {providers.map((p, idx) => {
                        const isActive = p.id === activeProviderId;
                        return (
                          <div className={`provider-card${isActive ? " active" : ""}`} key={p.id}>
                            <div className="provider-card-head">
                              <span className="provider-name"><Icon name="dot" size={12} style={{ color: isActive ? "#34c759" : "#c7c7cc" }} /> {p.alias || p.baseUrl || "(未命名)"}</span>
                              <span className="provider-model">{p.model || "未选模型"}</span>
                              <div className="provider-actions">
                                <button className="btn-float" disabled={idx === 0} onClick={() => moveProvider(p.id, -1)} title="上移"><Icon name="up" size={13} /></button>
                                <button className="btn-float" disabled={idx === providers.length - 1} onClick={() => moveProvider(p.id, 1)} title="下移"><Icon name="down" size={13} /></button>
                                <button className={`btn-float${isActive ? " active" : ""}`} onClick={() => setActiveProviderId(p.id)} title="设为当前生效供应商">使用</button>
                                <button className="btn-float" onClick={() => removeProvider(p.id)} title="删除该供应商"><Icon name="trash" size={13} /></button>
                              </div>
                            </div>
                            <div className="provider-fields">
                              <input className="engine-input" placeholder="别名(如 DeepSeek)" value={p.alias} onChange={(e) => updateProvider(p.id, { alias: e.target.value })} />
                              <input className="engine-input" placeholder="Base URL(如 https://api.deepseek.com/v1)" value={p.baseUrl} onChange={(e) => updateProvider(p.id, { baseUrl: e.target.value })} spellCheck={false} />
                            </div>
                            <div className="provider-fields">
                              <input className="engine-input" type="password" placeholder="API Key" value={p.apiKey} onChange={(e) => updateProvider(p.id, { apiKey: e.target.value })} autoComplete="off" spellCheck={false} />
                              <input className="engine-input" style={{ maxWidth: 110 }} type="number" step="0.1" min="0" max="2" placeholder="温度(空=默认)" value={p.temperature} onChange={(e) => updateProvider(p.id, { temperature: e.target.value })} title="留空=不发送(用模型默认);Kimi 只允许 1,DeepSeek 建议 0.1" />
                              <label className="subtitle-mode" title="推理模型先输出思维链,首字很慢;勾选发送 thinking:disabled 跳过思考(不支持的供应商取消勾选)">
                                <input type="checkbox" checked={p.noThinking === "1"} onChange={(e) => updateProvider(p.id, { noThinking: e.target.checked ? "1" : "" })} />
                                禁用思考
                              </label>
                              <button className="btn-float" onClick={() => openModelPicker(p.id)} title="GET /models 拉取模型列表,点选要添加的(只添加你选的)"><Icon name="search" size={13} /> 检测/选择模型</button>
                              <button className="btn-float" disabled={testStates[p.id]?.state === "testing"} onClick={() => testProvider(p.id)} title="发一个小翻译请求验证连通性"><Icon name="flask" size={13} /> {testStates[p.id]?.state === "testing" ? "测试中…" : "测试连接"}</button>
                            </div>
                            {testStates[p.id] && testStates[p.id].state !== "testing" && (
                              <div className={`provider-test ${testStates[p.id].state}`}>
                                {testStates[p.id].state === "ok" ? "✓ 连接成功" : `测试失败: ${testStates[p.id].msg}`}
                              </div>
                            )}
                            <div className="provider-models">
                              <span className="settings-note">已添加模型(点 × 移除):</span>
                              {p.models.length === 0 && <span className="settings-note">(空,点「检测/选择模型」添加)</span>}
                              {p.models.map((m) => (
                                <span key={m} className={`model-chip${p.model === m ? " selected" : ""}`}>
                                  {m}
                                  <button className="model-chip-x" title="移除该模型" onClick={() => removeModel(p.id, m)}>×</button>
                                </span>
                              ))}
                            </div>
                            {detectPicker && detectPicker.providerId === p.id && (
                              <div className="detect-picker">
                                <div className="detect-picker-head">
                                  <b>选择要添加的模型(共 {detectPicker.models.length} 个,只添加你点的)</b>
                                  <input className="engine-input" placeholder="搜索模型名..." value={detectPicker.query} onChange={(e) => setDetectPicker({ ...detectPicker, query: e.target.value })} autoFocus spellCheck={false} />
                                  <button className="btn-float" onClick={() => setDetectPicker(null)} title="关闭选择器">完成</button>
                                </div>
                                <div className="detect-picker-list">
                                  {detectPicker.models.filter((m) => m.toLowerCase().includes(detectPicker.query.trim().toLowerCase())).map((m) => (
                                    <button key={m} className={`detect-picker-item${p.models.includes(m) ? " added" : ""}`} onClick={() => pickModel(p.id, m)} title={p.models.includes(m) ? "已添加,点击切换为该模型" : "点击添加该模型并选中"}>
                                  {p.models.includes(m) ? <Icon name="check" size={13} /> : <Icon name="plus" size={13} />} {m}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {providers.length === 0 && <p className="settings-note">还没有供应商:用上方「按预设新建」或「新增」添加。</p>}
                    </div>
                  </div>
                </div>
              )}
              {settingsPage === "shortcuts" && (
                <div className="settings-section">
                  <h2>快捷键</h2>
                  <p className="settings-note">点击组合键进入录制,按下新组合保存;点「无快捷键」可禁用该项。为避免全局冲突,仅支持 Ctrl+Shift / Alt+Shift / Ctrl+Alt+Shift + 字母/数字/F键/空格/方向键;Ctrl+C 这类常用快捷键和系统保留组合不可设置(录制时会提示原因)。</p>
                  <div className="shortcut-list">
                    {(Object.keys(SHORTCUT_LABELS) as ShortcutAction[]).map((act) => {
                      const recording = recordingAction === act;
                      return (
                        <div className={`shortcut-row${recording ? " recording" : ""}`} key={act}>
                          <span className="shortcut-label">{SHORTCUT_LABELS[act]}</span>
                          {recording ? (
                            <span className="shortcut-recording">
                              请按下新的快捷键… (Esc 取消)
                              <button className="btn-float" onClick={stopRecording}>取消</button>
                            </span>
                          ) : (
                            <>
                              <button className="shortcut-combo" onClick={() => startRecording(act)} title="点击改键">{shortcuts[act] || "未设置"}</button>
                              <button className="btn-float" onClick={() => { setShortcutError(""); setShortcuts((prev) => ({ ...prev, [act]: "" })); }}>无快捷键</button>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {shortcutError && <p className={`settings-note${shortcutError.startsWith("已设置") ? "" : " shortcut-error"}`}>{shortcutError}</p>}
                </div>
              )}
              {settingsPage === "about" && (
                <div className="settings-section">
                  <h2>关于</h2>
                  <p>译刻 v{appVersion}</p>
                  <p className="settings-note">Copyright © 2026 谨语</p>
                  <p>本地优先的桌面实时翻译工作台:文本 / 划词 / 截图 / 视频字幕 / 音频字幕,支持本地 Ollama 与外接 API 双引擎。</p>
                  <p>杀软(如火绒)可能拦截未签名程序:请加入白名单或信任后再使用;个别老式程序(如 DirectUI、游戏内文本)划词捕获不到。</p>
                </div>
              )}
              </div>
            </div>
          </div>
        </main>);
  const classicTask = <div className="classic-preserved">
    <div className="task-text">
              <div className="lang-center">
                <select className="lang-sel" value={sourceLang} onChange={(e) => setSourceLang(e.target.value)} title="源语言(自动检测=自动识别输入语言)">
                  {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
                </select>
                <button className="lang-swap" onClick={swapLangs} title="交换语言方向"><Icon name="swap" size={15} /></button>
                <select className="lang-sel" value={targetLang} onChange={(e) => setTargetLang(e.target.value)} title="目标语言">
                  {LANGS.filter((l) => l.code !== "auto").map((l) => (
                    <option key={l.code} value={l.code}>{l.label}</option>
                  ))}
                </select>
                <button className="btn-primary" onClick={manuallyTranslate} disabled={translating || !input.trim()} title="强制手动重译">
                  重译
                </button>
              </div>
              <textarea
                ref={textareaElRef}
                className="trans-input"
                placeholder="输入文字,自动翻译..."
                aria-label="待翻译原文"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)}
                onKeyDown={e => { if (e.ctrlKey && e.key === "Enter" && !e.nativeEvent.isComposing && !translating && input.trim()) { e.preventDefault(); manuallyTranslate(); } }}
                rows={1}
              />
              {<div className="source-actions">
                <button className="studio-text-btn" onClick={pasteInput}><Icon name="clipboard" size={14} /> 粘贴</button>
                <button className="studio-text-btn" disabled={!input} onClick={() => { setInput(""); textareaElRef.current?.focus(); }} title="清空原文和译文"><Icon name="trash" size={14} /> 清空</button>
                <span className="character-count">{Array.from(input).length.toLocaleString()} 字符</span>
              </div>}
              {conflictHint && conflict && !translating && modeOutput.text && (
                <div className="conflict-bar">
                  <span>检测到原文已是目标语言,需要交换翻译方向吗?</span>
                  <button className="btn-conflict" onClick={() => { setConflict(false); swapLangs(); }}>交换</button>
                  <button className="btn-conflict-dismiss" onClick={() => setConflict(false)}>忽略</button>
                </div>
              )}
              </div>
    <div className="trans-output trans-output-standalone">
      <div className="output-label">译文 {translating && <span role="status">{apiThinking ? "模型思考中…" : "翻译中…"}</span>}</div>
      <div className="output-text" dir="auto">{modeOutput.text || "输入后自动翻译…"}</div>
      <button className="btn-float" disabled={!modeOutput.text} onClick={copyOutput}>复制译文</button>
    </div>
  </div>;
  const tasks: InterfaceController["state"]["tasks"] = {
    text: { source: input, result: translating && !streamOn ? "" : modeOutput.text, phase: translating ? "loading" : modeOutput.text.startsWith("翻译失败:") ? "error" : modeOutput.text ? "success" : "idle", running: translating, region: false, status: apiThinking ? "模型思考中…" : translating ? "正在翻译" : undefined },
    screenshot: { source: screenshotSrc, result: modeOutput.screenshot, phase: screenshotWorking ? "loading" : /失败|未安装|^ERROR:/.test(screenshotSrc) ? "error" : modeOutput.screenshot ? "success" : "idle", running: screenshotWorking, region: !!screenshotSrc, status: screenshotWorking ? "正在识别或翻译" : screenshotSrc, error: screenshotSrc },
    subtitle: { source: subCurrent?.text || "", result: subCurrent?.result || "", phase: /失败|未安装|错误|ERROR:/.test(subStatus) ? "error" : subCurrent?.result ? "success" : "idle", running: subtitleOn, region: !!subRegion, status: subStatus || (subtitleOn ? "字幕识别中" : "未开始"), error: subStatus },
    audio: { source: "", result: "", phase: "idle", running: sourcesForMode(audioMode).some(isSrcOn), region: false },
  };
  const audioChannels = Object.fromEntries((["system", "mic"] as const).map(source => {
    const lines = audioHist.filter(line => line.source === source && line.text).slice(-2);
    const status = srcStatus(source);
    const result = lines.map(line => line.result).filter(Boolean).join("\n\n");
    return [source, { source: lines.map(line => line.text).join("\n\n"), result, phase: /失败|未安装|错误/.test(status) ? "error" : result ? "success" : "idle", running: isSrcOn(source), region: false, status, error: status, level: srcLevel(source), ...langForAudio(source) }];
  })) as InterfaceController["state"]["audioChannels"];
  const models = [
    ...menuLocalModels.map(m => ({ value: m.name, label: `${m.name === "maternion/hy-mt2:1.8b" ? "HY-MT2" : m.name} · 本地` })),
    ...apiModelOptions.map(o => ({ value: `api:${o.providerId}::${o.model}`, label: o.label })),
  ];
  if (!models.some(option => option.value === headerEngineValue)) models.unshift({ value: headerEngineValue, label: engineLabelText });
  const controller: InterfaceController = {
    audioControlsBusy,
    state: { mode: activeMode, ...studioLanguages, model: headerEngineValue, audioSource: audioMode, tasks, audioChannels }, models,
    dispatch(action) {
      if (action.type === "model") selectHeaderEngine(action.model);
      else if (action.type === "swap") activeMode === "text" ? swapLangs() : swapModeLang(activeMode);
      else if (action.type === "audio-language") {
        if (action.side === "src" && (isSrcOn(action.channel) || audioControlsBusy)) return;
        audioQueues[action.channel].invalidate();
        setAudioChannelLanguages(previous => ({ ...previous, [action.channel]: { ...langForAudio(action.channel), [action.side]: action.value } }));
      } else if (action.type === "language") {
        if (activeMode === "text") action.side === "src" ? setSourceLang(action.value) : setTargetLang(action.value);
        else setModeLang(activeMode, { [action.side]: action.value });
      }
    },
    edit: setInput, composing, setComposing,
    run(mode) {
      if (mode === "text") manuallyTranslate();
      else if (mode === "screenshot") void startScreenshot();
      else if (mode === "subtitle") startSubtitle();
      else if (!sourcesForMode(audioMode).some(isSrcOn)) void toggleAudioSubtitle();
    },
    stop(mode) {
      if (mode === "text") { if (timerRef.current) clearTimeout(timerRef.current); translationTask.invalidate(); setTranslating(false); setApiThinking(false); }
      else if (mode === "audio") { if (sourcesForMode(audioMode).some(isSrcOn)) void toggleAudioSubtitle(); }
      else if (mode === "subtitle") stopSubtitle();
      else { screenshotTask.invalidate(); setScreenshotWorking(false); }
    },
    copy: async text => { try { await writeText(text); setActionNotice("译文已复制"); } catch (error) { setActionNotice(`复制失败：${errorMessage(error)}`); } },
    paste: pasteInput, selectAudioSource: value => { void changeAudioMode(value); },
    subtitleFps: subFps, setSubtitleFps: setSubFps, testOcr: testWinOcr,
    extra: <>
      {ollamaBackend === "cpu" && <div className="gpu-hint"><Icon name="warn" size={13} />本地翻译正在使用 CPU</div>}
      {uiLayout !== "classic" && !settingsOpen && activeMode === "text" && conflictHint && conflict && !translating && modeOutput.text && <div className="conflict-bar"><span>检测到原文已是目标语言，需要交换方向吗？</span><button className="btn-conflict" onClick={() => { setConflict(false); swapLangs(); }}>交换</button><button className="btn-conflict-dismiss" onClick={() => setConflict(false)}>忽略</button></div>}
    </>,
  };
  return <ConnectedMain style={(uiLayout === "studio" ? "workbench" : uiLayout) as MainStyle}
    navigation={navigation} theme={theme} accent={accentColor}
    background={appearance.main.bg} opacity={appearance.main.opacity} foreground={appearance.main.textColor} fontSize={appearance.main.fontSize}
    controller={controller} settings={settingsView} settingsOpen={settingsOpen}
    onSettings={() => setSettingsOpen(true)} onBack={() => setSettingsOpen(false)}
    onMode={mode => { setActiveMode(mode); setSettingsOpen(false); }}
    onTheme={() => setTheme(resolvedDark ? "light" : "dark")}
    onFloating={() => { void toggleFloating(); }} floatingOpen={floatingOpen}
    onCapture={mode => { if (mode === "screenshot") void startScreenshot(); else invoke("open_screenshot_overlay", { from: "subtitle" }).catch(error => setSubStatus(`选区失败: ${errorMessage(error)}`)); }}
    onMinimize={() => { invoke("minimize_main_window").catch(error => setActionNotice(`最小化失败：${errorMessage(error)}`)); }}
    onMaximize={() => { invoke("toggle_maximize_main_window").catch(error => setActionNotice(`窗口操作失败：${errorMessage(error)}`)); }}
    onClose={() => { (configWriter.persistenceBlocked ? Promise.resolve() : Promise.all([configWriter.flush(), sensitivityWriter.flush()])).then(() => appWindow.close()).catch(error => setActionNotice(`关闭失败：${errorMessage(error)}`)); }} onDrag={onHeaderMouseDown}
    notice={configReadError || actionNotice} classicTask={classicTask} ignoreEscape={!!recordingAction} />;

}

/* ============ 悬浮窗 ============ */
function FloatingWindow() {
  const [listenersReady, setListenersReady] = useState(false);
  const [trans, setTrans] = useState<{ text: string; src: string; tgt: string; result: string } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [mode, setMode] = useState<"trans" | "subtitle">("trans");   // 翻译页 / 字幕页
  const [subtitle, setSubtitle] = useState<{ text: string; result: string } | null>(null); // 视频字幕
  const [subStatus, setSubStatus] = useState<string | null>(null);   // 字幕状态提示
  const [subRunning, setSubRunning] = useState(false);               // 字幕是否运行中(主窗口同步)

  /* Per-mode typography/colors; all auxiliary windows share opacity and chrome. */
  const surfaceKey: SurfaceKey = mode === "subtitle" ? "subtitle" : "floating";
  const appearance = useFloatingAppearance(surfaceKey, DEFAULT_APPEARANCE, listenersReady);

  useEffect(() => {
    let active = true;
    const u = appWindow.listen<{ text: string; src: string; tgt: string; result: string; role?: string }>(
      "show-translation",
      (e) => { setTrans(e.payload); setStatus(null); setMode("trans"); }
    );
    const s = appWindow.listen<string>(
      "screenshot-status",
      (e) => setStatus(e.payload)
    );
    const c = appWindow.listen("close-me", () => closeFloating());
    // 视频字幕事件:收到字幕自动切到字幕页显示
    const st = appWindow.listen<{ text: string; result: string }>(
      "subtitle-text",
      (e) => { setSubtitle(e.payload); setMode("subtitle"); setStatus(null); }
    );
    const ss = appWindow.listen<string>(
      "subtitle-status",
      (e) => setSubStatus(e.payload)
    );
    // 主窗口字幕运行状态同步
    const sr = appWindow.listen<string>(
      "subtitle-state",
      (e) => {
        const on = e.payload === "on";
        setSubRunning(on);
        if (on) setMode("subtitle");
      }
    );
    Promise.all([u, s, c, st, ss, sr]).then(() => { if (active) setListenersReady(true); }).catch(error => console.error("Floating listeners could not initialize", error));
    return () => { active = false; u.then((f) => f()); s.then((f) => f()); c.then((f) => f()); st.then((f) => f()); ss.then((f) => f()); sr.then((f) => f()); };
  }, []);

  const closeFloating = async () => {
    setTrans(null);
    await appWindow.emitTo("main", "floating-closed");
    await appWindow.hide();
  };

  return (
    <FloatingChrome title={mode === "subtitle" ? "视频字幕" : "翻译"} icon={mode === "subtitle" ? "film" : "globe"}
      surface="floating" {...appearance} onClose={closeFloating} closeLabel="关闭翻译悬浮窗"
      actions={<>
            <button className={`floating-btn${subRunning ? " active" : ""}`} title={subRunning ? "停止视频字幕" : "开始视频字幕"} onMouseDown={(e) => e.stopPropagation()}
              onClick={() => {
                if (subRunning) {
                  setMode("trans");
                  appWindow.emitTo("main", "subtitle-stop").catch(() => {});   // 显式停止,不误关
                } else {
                  setMode("subtitle");
                  appWindow.emitTo("main", "subtitle-start").catch(() => {});  // 显式开始
                }
              }}>
              <Icon name="film" size={15} />
            </button>
            <button className="floating-btn" title="调整字幕区域" onMouseDown={(e) => e.stopPropagation()}
              onClick={() => { invoke("open_screenshot_overlay", { from: "subtitle" }).catch(() => {}); }}>
              <Icon name="target" size={15} />
            </button>
            <button className="floating-btn" title="截图翻译" onMouseDown={(e) => e.stopPropagation()}
              onClick={async () => { try { await invoke("open_screenshot_overlay", { from: "floating" }); } catch {} }}>
              <Icon name="camera" size={15} />
            </button>
            <button
              className="floating-btn"
              title="设置"
              aria-label="悬浮窗设置"
              aria-expanded={showSettings}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => setShowSettings(!showSettings)}
            >
              <Icon name="settings" size={15} />
            </button>
      </>}
      settings={showSettings && <FloatingOpacity value={appearance.opacity} onChange={appearance.setOpacity} />}>
          {mode === "subtitle" ? (
            subStatus ? (
              <div className="floating-status">{subStatus}</div>
            ) : subtitle ? (
              <div className="floating-trans floating-subtitle">
                <div className="voice-section-label">原文</div>
                <div className="floating-src">{subtitle.text}</div>
                {subtitle.result && (<><div className="floating-divider" /><div className="voice-section-label">译文</div><div className="floating-result">{subtitle.result}</div></>)}
              </div>
            ) : (
              <FloatingHint icon="film" title="视频字幕">在主窗口选择字幕区域，开始字幕识别</FloatingHint>
            )
          ) : status ? (
            <div className="floating-status">{status}</div>
          ) : trans ? (
            <div className="floating-trans">
              <div className="voice-section-label">原文</div>
              <div className="floating-src">{trans.text}</div>
              <div className="floating-divider" />
              <div className="voice-section-label">译文</div>
              <div className="floating-result">{trans.result}</div>
            </div>
          ) : (
            <FloatingHint icon="globe" title="复制即译">复制文字，或使用顶部按钮截图翻译</FloatingHint>
          )}
    </FloatingChrome>
  );
}

/* ============ 音频字幕独立语音窗(第7波) ============ */
/* 与视频字幕窗分开:单独窗口,透明/置顶/可拖动,专显示音频识别原文+译文 */
/* 电脑音频窗(label=audio-floating)与麦克风窗(label=audio-floating-mic)共用本组件 */
function AudioFloatingWindow() {
  const [listenersReady, setListenersReady] = useState(false);
  const [sensitivityError, setSensitivityError] = useState("");
  const [sensitivityWriter] = useState(() => new AudioSensitivityWriter(invoke));
  useEffect(() => {
    const target = window as unknown as { __flushAudioSettings?: () => Promise<void> };
    const flush = () => sensitivityWriter.flush();
    target.__flushAudioSettings = flush;
    return () => { if (target.__flushAudioSettings === flush) delete target.__flushAudioSettings; };
  }, [sensitivityWriter]);
  const source = appWindow.label === "audio-floating-mic" ? "mic" : "system";
  const isMic = source === "mic";
  /* 两句显示:hist 保留最近几句(最后一项=当前句,可能为空)。
     译文异步到达时按 text 匹配历史中的句子补上,避免"滚动后句子被覆盖导致译文丢失"。 */
  const [hist, setHist] = useState<AudioLine[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  // 断句灵敏度(共享):语言 → 秒
  const [sens, setSens] = useState<Record<string, number>>({});

  const surfaceKey: SurfaceKey = isMic ? "audioMic" : "audio";
  const appearance = useFloatingAppearance(surfaceKey, DEFAULT_APPEARANCE, listenersReady);

  useEffect(() => {
    invoke<Record<string, number>>("audio_get_sensitivities").then((s) => setSens(s)).catch(() => {});
  }, []);

  /* 监听 Rust 广播:主界面/设置改了灵敏度,这里跟随 */
  useEffect(() => {
    const handler = (e: { lang: string; value: number }) => {
      setSens((prev) => ({ ...prev, [e.lang]: e.value }));
    };
    (window as any).__audioSensChanged = handler;
    return () => { delete (window as any).__audioSensChanged; };
  }, []);

  /* 修改灵敏度:写 Rust(广播到所有端);松手时应用生效。
     节流 100ms:拖动滑块会高频触发 onChange,每次都 invoke+eval 广播会让 WebView 忙。 */
  const sensThrottleRef = useRef(0);
  const changeSens = (lang: string, v: number) => {
    setSens((prev) => ({ ...prev, [lang]: v }));
    const now = Date.now();
    if (now - sensThrottleRef.current < 100) return;
    sensThrottleRef.current = now;
    sensitivityWriter.update(lang, v, false).catch(cause => setSensitivityError(`断句设置未保存：${errorMessage(cause)}`));
  };
  const applySens = (lang: string, value: number) => {
    setSens((prev) => ({ ...prev, [lang]: value }));
    setSensitivityError("");
    sensitivityWriter.update(lang, value, true).catch(cause => {
      setSensitivityError(`断句设置未应用：${cause instanceof Error ? cause.message : String(cause)}`);
    });
  };

  useEffect(() => {
    let active = true;
    let session = 0;
    const accept = (event: AudioEvent) => {
      if (event.session < session) return false;
      if (event.session > session) { session = event.session; setHist([]); }
      return true;
    };
    const show = (event: AudioEvent & { src: string; tgt: string; result: string; role?: string }) => {
      if (!event.text) { setHist([]); setStatus(null); return; }
      if (!accept(event)) return;
      const job = { ...event, isFinal: event.role === "prev" };
      // Do not create/roll a line from a late translation; recognition owns the history.
      if (event.result) setHist(history => applyAudioResult(history, job, event.result));
      setStatus(null);
    };
    (window as any).__audioShow = show;
    (window as any).__audioPartial = (event: AudioEvent) => {
      if (accept(event)) setHist(history => updateAudioLine(history, { ...event, isFinal: false }));
      setStatus(null);
    };
    (window as any).__audioFinal = (event: AudioEvent) => {
      if (accept(event)) setHist(history => updateAudioLine(history, { ...event, isFinal: true }));
      setStatus(null);
    };
    const u = appWindow.listen<AudioEvent & { src: string; tgt: string; result: string }>("audio-show-translation", ({ payload }) => show(payload));
    const s = appWindow.listen<string>(
      "audio-floating-status",
      (e) => setStatus(e.payload)
    );
    const c = appWindow.listen("audio-close-me", () => {
      setHist([]);
      closeAndStop();
    });
    Promise.all([u, s, c]).then(() => { if (active) setListenersReady(true); }).catch(error => console.error("Audio floating listeners could not initialize", error));
    return () => {
      active = false;
      u.then((f) => f()); s.then((f) => f()); c.then((f) => f());
      delete (window as any).__audioShow;
      delete (window as any).__audioPartial;
      delete (window as any).__audioFinal;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* 关闭语音窗并同步停止音频字幕 */
  const closeAndStop = () => {
    setHist([]);
    // 通知主窗口更新状态(音频字幕已关)
    appWindow.emitTo("main", "audio-floating-closed", { source }).catch(() => {});
    invoke("close_audio_floating_window", { source }).catch(() => {});
    invoke("audio_subtitle_stop", { source }).catch(() => {});
  };

  return (
    <FloatingChrome title={isMic ? "麦克风" : "电脑音频"} icon={isMic ? "mic" : "monitor"}
      surface={isMic ? "audioMic" : "audio"} {...appearance} onClose={closeAndStop}
      error={sensitivityError || appearance.error}
      closeLabel={`关闭${isMic ? "麦克风" : "电脑音频"}并停止此音源`}
      actions={
            <button
              className="floating-btn"
              title="设置"
              aria-label="悬浮窗设置"
              aria-expanded={showSettings}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => setShowSettings(!showSettings)}
            >
              <Icon name="settings" size={15} />
            </button>
      }
      settings={showSettings && <>
            <FloatingOpacity value={appearance.opacity} onChange={appearance.setOpacity} />
            {/* 断句灵敏度:按语言独立,与主界面共享 */}
            {[
              ["auto", "自动"], ["zh", "中文"], ["en", "英语"], ["ja", "日语"], ["ko", "韩语"],
            ].map(([code, name]) => (
              <label key={code} style={{ fontSize: 11 }}>
                {name}断句
                <input
                  type="range" min="1" max="40" step="1"
                  value={Math.round((sens[code] ?? 1.2) * 10)}
                  onChange={(e) => changeSens(code, Number(e.target.value) / 10)}
                  onPointerUp={event => applySens(code, Number(event.currentTarget.value) / 10)}
                  onKeyUp={event => {
                    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)) applySens(code, Number(event.currentTarget.value) / 10);
                  }}
                  onBlur={event => applySens(code, Number(event.currentTarget.value) / 10)}
                  title="停顿多久算一句结束(秒):数值越小越敏感"
                />
                <b>{(sens[code] ?? 1.2).toFixed(1)}s</b>
              </label>
            ))}
      </>}>
          {status ? (
            <div className="floating-status">{status}</div>
          ) : !hist.some(line => line.text) ? (
            <FloatingHint icon={isMic ? "mic" : "monitor"} title={isMic ? "麦克风识别" : "电脑音频识别"}>在主窗口点击「音频翻译」开始监听此音源</FloatingHint>
          ) : (
            <>
              {/* 原文区:上一句(已说过) + 当前句(正在说);key 变化时上一句播放上滚动画 */}
              <div className="voice-section voice-src-section">
                <div className="voice-section-label">原文</div>
              {hist.length >= 2 && hist[hist.length - 2].text && (
                <div key={`src-prev-${hist[hist.length - 2].text}`} className="voice-line voice-line-prev">
                  {hist[hist.length - 2].text}
                </div>
              )}
                {hist[hist.length - 1]?.text && (
                  <div className="voice-line voice-line-cur">
                    {hist[hist.length - 1]?.text}
                  </div>
                )}
              </div>
              <div className="voice-divider" />
              {/* 译文区:上一句(已说过) + 当前句(正在说);key 变化时上一句播放上滚动画 */}
              <div className="voice-section voice-result-section">
                <div className="voice-section-label">译文</div>
                {hist.length >= 2 && hist[hist.length - 2].result && (
                  <div key={`res-prev-${hist[hist.length - 2].result}`} className="voice-line voice-line-prev voice-line-result">
                    {hist[hist.length - 2].result}
                  </div>
                )}
                {hist[hist.length - 1]?.result && (
                  <div className="voice-line voice-line-cur voice-line-result">
                    {hist[hist.length - 1]?.result}
                  </div>
                )}
              </div>
            </>
          )}
    </FloatingChrome>
  );
}

/* ============ 截图覆盖层 ============ */
function ScreenshotOverlay() {
  const [listenersReady, setListenersReady] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rect = useRef({ sx: 0, sy: 0, ex: 0, ey: 0 });   // 鼠标坐标(CSS 像素)
  const drawing = useRef(false);
  const sourceRef = useRef<string>("main");
  const loadTokenRef = useRef(0);                          // 防旧请求异步返回覆盖新图
  const bgImageRef = useRef<HTMLImageElement | null>(null); // 缓存背景图 img(裁剪选区用,不二次截屏)
  const bgPhysRef = useRef({ w: 1, h: 1 });                // 背景图物理尺寸(坐标换算用)
  const [bgUrl, setBgUrl] = useState<string>("");          // 背景图 data URL(div 背景,CSS 拉伸铺满)

  /* 窗口已改不透明:body 兜底纯黑,防 canvas 边缘露白/透光 */
  useEffect(() => {
    const prev = document.body.style.background;
    document.body.style.background = "#000";
    return () => { document.body.style.background = prev; };
  }, []);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    let W = window.innerWidth, H = window.innerHeight;
    let origin = { x: 0, y: 0 };

    /* 重绘:全屏半透明遮罩 → 选区 clearRect 挖空(露出 CSS 背景图,不透明不重影) */
    const drawScene = () => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(0, 0, W, H);
      if (drawing.current) {
        const rx = Math.min(rect.current.sx, rect.current.ex);
        const ry = Math.min(rect.current.sy, rect.current.ey);
        const rw = Math.abs(rect.current.ex - rect.current.sx);
        const rh = Math.abs(rect.current.ey - rect.current.sy);
        ctx.clearRect(rx, ry, rw, rh);   // 挖空选区 → 透出下方 CSS 背景图
        ctx.strokeStyle = "#007aff";
        ctx.lineWidth = 2;
        ctx.strokeRect(rx, ry, rw, rh);
      }
    };

    /* CSS 坐标 → 物理坐标(背景图物理尺寸 / 窗口 CSS 尺寸,实测比) */
    const toPhys = (v: number, vertical = false) => Math.round(v * (vertical ? bgPhysRef.current.h / H : bgPhysRef.current.w / W));

    /* 收到 overlay-start 时初始化;from 由 Rust 事件传入 */
    const start = async (payload: string) => {
      W = window.innerWidth; H = window.innerHeight;
      sourceRef.current = payload || "main";
      setBgUrl("");                       // 清空旧背景,避免第二次显示第一次画面
      const token = ++loadTokenRef.current;
      drawing.current = false;
      rect.current = { sx: 0, sy: 0, ex: 0, ey: 0 };
      c.width = W;
      c.height = H;
      /* 窗口已改不透明:截图前必须先隐藏,否则会截到自己的窗口 */
      try { await appWindow.hide(); } catch {}
      await new Promise((r) => setTimeout(r, 60)); // 给 DWM 一帧刷新时间
      drawScene();                        // 遮罩先画(窗口未显示,无妨)
      /* 静态截图当背景:div CSS 拉伸铺满窗口,与窗口严丝合缝,不依赖任何 DPR 计算 */
      invoke<ScreenCapture>("capture_fullscreen")
        .then(({ b64, x, y }) => {
          origin = { x, y };
          if (loadTokenRef.current !== token) return;
          const img = new Image();
          img.onload = () => {
            if (loadTokenRef.current !== token) return;
            W = window.innerWidth; H = window.innerHeight;
            c.width = W; c.height = H;
            drawScene();
            bgImageRef.current = img;                       // 缓存 img,框选后从它裁剪(不二次截屏)
            bgPhysRef.current = { w: img.naturalWidth, h: img.naturalHeight };
            setBgUrl("data:image/png;base64," + b64); // div 背景异步解码,解码完成自动显示
            appWindow.show().catch(() => {});
            appWindow.setFocus().catch(() => {});
          };
          img.src = "data:image/png;base64," + b64;
        })
        .catch(() => { appWindow.show().catch(() => {}); });
    };
    const u = appWindow.listen<string>("overlay-start", (e) => start(e.payload));
    let alive = true;
    void u.then(() => { if (alive) setListenersReady(true); });

    /* 隐藏而非关闭:窗口启动时已预建,保留复用 */
    const hide = () => { appWindow.hide(); };
    const cancel = () => { loadTokenRef.current++; hide(); };

    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      rect.current = { sx: e.clientX, sy: e.clientY, ex: e.clientX, ey: e.clientY };
      drawing.current = true;
      drawScene();
    };
    const onMove = (e: MouseEvent) => {
      if (!(e.buttons & 1)) { onUp(); return; }
      if (!drawing.current) return;
      rect.current.ex = e.clientX;
      rect.current.ey = e.clientY;
      drawScene();
    };
    const onUp = () => {
      if (!drawing.current) return;
      drawing.current = false;
      const { sx, sy, ex, ey } = rect.current;
      const x = toPhys(Math.min(sx, ex));
      const y = toPhys(Math.min(sy, ey), true);
      const w = toPhys(Math.abs(ex - sx));
      const h = toPhys(Math.abs(ey - sy), true);
      if (w < 10 || h < 10) { hide(); return; }
      /* 从启动时缓存的背景图裁剪选区(不二次截屏,避免框选完成瞬间混入 overlay 残影) */
      let b64 = "";
      const bg = bgImageRef.current;
      if (bg) {
        const off = document.createElement("canvas");
        off.width = w;
        off.height = h;
        const octx = off.getContext("2d");
        if (octx) {
          octx.imageSmoothingEnabled = false;
          octx.drawImage(bg, x, y, w, h, 0, 0, w, h);
          b64 = off.toDataURL("image/png").split(",")[1] || "";
        }
      }
      appWindow.emitTo("main", "screenshot-done", { x: x + origin.x, y: y + origin.y, w, h, source: sourceRef.current, b64 });
      hide();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") cancel(); };
    const onCtx = (e: MouseEvent) => { e.preventDefault(); cancel(); };

    /* mouseup 同时绑 canvas + window,防事件丢失 */
    c.addEventListener("mousedown", onDown);
    c.addEventListener("mousemove", onMove);
    c.addEventListener("mouseup", onUp);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("keydown", onKey);
    c.addEventListener("contextmenu", onCtx);
    return () => {
      alive = false;
      u.then((f) => f());
      c.removeEventListener("mousedown", onDown);
      c.removeEventListener("mousemove", onMove);
      c.removeEventListener("mouseup", onUp);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("keydown", onKey);
      c.removeEventListener("contextmenu", onCtx);
    };
  }, []);

  useFrontendReady(listenersReady);

  return (
    <div style={{
      position: "fixed", inset: 0,
      backgroundColor: "#000",
      backgroundImage: bgUrl ? `url(${bgUrl})` : "none",
      backgroundSize: "100% 100%",
      backgroundRepeat: "no-repeat",
      backgroundPosition: "center",
    }}>
      <canvas ref={canvasRef} style={{ width: "100vw", height: "100vh", display: "block", cursor: "crosshair" }} />
    </div>
  );
}

/* ============ 应用路由 ============ */
export default function App() {
  // The native label is already available before the first render.
  const label = appWindow.label;

  if (label === "floating") return <FloatingWindow />;
  if (label === "audio-floating" || label === "audio-floating-mic") return <AudioFloatingWindow />;
  if (label === "screenshot-overlay") return <ScreenshotOverlay />;
  return <MainWindow />;
}

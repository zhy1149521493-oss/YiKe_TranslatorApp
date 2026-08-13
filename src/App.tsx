import { useEffect, useRef, useState, useCallback, type CSSProperties } from "react";
import { invoke, Channel } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import "./App.css";

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
  const acc = (accent ?? "").trim();
  if (acc) {
    st.setProperty("--ios-blue", acc);
    st.setProperty("--ios-accent-rgb", hexToRgbTriplet(acc));
  } else {
    st.removeProperty("--ios-blue");
    st.removeProperty("--ios-accent-rgb");
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
function detectLang(text: string): string {
  if (/[\u3040-\u309f\u30a0-\u30ff]/.test(text)) return "ja"; // 日文假名优先
  if (/[\u4e00-\u9fff\u3400-\u4dbf]/.test(text)) return "zh";
  if (/[a-zA-Z]{3,}/.test(text)) return "en";
  if (/[\uac00-\ud7af]/.test(text)) return "ko";
  if (/[À-ÿ]/.test(text)) return "fr";
  if (/[\u0400-\u04ff]/.test(text)) return "ru";
  if (/[\u0600-\u06ff]/.test(text)) return "ar";
  return "en";
}

/* 字符级 Jaccard 相似度:用于视频字幕去重(同一句被连续截到多次时跳过) */
function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const sa = new Set(a.replace(/\s+/g, ""));
  const sb = new Set(b.replace(/\s+/g, ""));
  let inter = 0;
  for (const ch of sa) if (sb.has(ch)) inter++;
  return inter / Math.max(sa.size, sb.size);
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
): string {  const srcName = LANG_MAP[source] || source;
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
  numCtx: number
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
  _signal?: AbortSignal,
  onReasoning?: (r: string) => void
) {
  const ch = new Channel<string>();
  ch.onmessage = (t) => {
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
  const eng = resolveEngine();
  if (eng.kind === "api") return fetchApiStream(eng.provider, source, target, text, onToken, signal, onReasoning);
  /* 无本地模型守卫:给友好提示而不是裸 API 报错(列表加载完才开始拦截,避免启动瞬间误报) */
  if (localModelsReady) {
    if (localModelStore.length === 0) throw new Error("尚未配置本地模型:请到「设置 → 模型」下载/导入,或在「外接 API」配置云端模型后再翻译");
    if (!model || !localModelStore.some((m) => m.name === model)) throw new Error(`本地模型「${model || "未选择"}」未安装:请到「设置 → 模型」下载/导入,或切换到外接 API 模型`);
  }
  return fetchOllamaStream(model, source, target, text, numCtx, onToken, signal);
}

async function translateFull(model: string, source: string, target: string, text: string, numCtx: number): Promise<string> {
  const eng = resolveEngine();
  if (eng.kind === "api") return fetchApiFull(eng.provider, source, target, text);
  if (localModelsReady) {
    if (localModelStore.length === 0) throw new Error("尚未配置本地模型:请到「设置 → 模型」下载/导入,或在「外接 API」配置云端模型后再翻译");
    if (!model || !localModelStore.some((m) => m.name === model)) throw new Error(`本地模型「${model || "未选择"}」未安装:请到「设置 → 模型」下载/导入,或切换到外接 API 模型`);
  }
  return fetchOllamaFull(model, source, target, text, numCtx);
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
  const [importName, setImportName] = useState("");
  const [importPath, setImportPath] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [importStatus, setImportStatus] = useState("");
  const [importDragging, setImportDragging] = useState(false);
  const [confirmDeleteModel, setConfirmDeleteModel] = useState<string | null>(null);
  const [mainClose, setMainClose] = useState<"hide" | "quit">("hide"); // 主窗口 ✕ 行为(Wave 9 设置面板提供 UI,默认隐藏到托盘)
  const configLoadedRef = useRef(false);
  const loadedCfgRef = useRef<any>(null);
  /* ollama 实际推理后端(GPU/CPU):CPU 时提示本地翻译较慢(无 GPU 回退提示) */
  const [ollamaBackend, setOllamaBackend] = useState("");
  /* Wave 9: 设置中心 / 主题 / 外观 / 快捷键 */
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsPage, setSettingsPage] = useState<string>("general");
  const [activeMode, setActiveMode] = useState<"text" | "audio" | "subtitle" | "screenshot">("text");
  const [engineMenuOpen, setEngineMenuOpen] = useState(false);
  const [maximized, setMaximized] = useState(false);
  /* 跟踪最大化状态(标题栏 □/❐ 按钮图标切换) */
  useEffect(() => {
    let un: (() => void) | undefined;
    appWindow.isMaximized().then((m) => setMaximized(m)).catch(() => {});
    appWindow.onResized(() => {
      appWindow.isMaximized().then((m) => setMaximized(m)).catch(() => {});
    }).then((f) => { un = f; }).catch(() => {});
    return () => { un?.(); };
  }, []);
  /* 引擎下拉:点击任意位置关闭(用 document 监听而非 fixed 遮罩——
     header 的 backdrop-filter 会让遮罩的包含块变成顶栏,导致只盖住顶栏) */
  useEffect(() => {
    if (!engineMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest(".engine-menu-wrap")) setEngineMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setEngineMenuOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [engineMenuOpen]);
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
  const renderLangBar = (mode: "audio" | "subtitle" | "screenshot") => {
    const l = langFor(mode);
    const asrUnsupported = mode === "audio" && !AUDIO_ASR_LANGS.includes(l.src);
    return (
      <div className="lang-bar lang-center">
        <select className="lang-sel" value={l.src} onChange={(e) => setModeLang(mode, { src: e.target.value })} title="源语言(自动检测=自动识别输入语言)">
          {LANGS.map((x) => <option key={x.code} value={x.code}>{x.label}</option>)}
        </select>
        <button className="lang-swap" onClick={() => swapModeLang(mode)} title="交换语言方向"><Icon name="swap" size={15} /></button>
        <select className="lang-sel" value={l.tgt} onChange={(e) => setModeLang(mode, { tgt: e.target.value })} title="目标语言">
          {LANGS.filter((x) => x.code !== "auto").map((x) => <option key={x.code} value={x.code}>{x.label}</option>)}
        </select>
        {asrUnsupported && (
          <span className="lang-warn"><Icon name="warn" size={13} /> 音频识别暂不支持{LANGS.find((x) => x.code === l.src)?.label ?? l.src}(仅支持 中文/英语/日语/韩语),开始识别会失败</span>
        )}
      </div>
    );
  };
  // 渲染时同步模块级镜像,供 translateStream/translateFull 路由读取
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
    invoke<any>("load_app_config")
      .then((cfg) => {
        configLoadedRef.current = true;
        if (!cfg) return;
        loadedCfgRef.current = cfg;
        if (cfg.engineMode) setEngineMode(cfg.engineMode);
        if (cfg.mainClose === "quit") setMainClose("quit");
        const s = cfg.settings ?? {};
        setTheme(s.theme === "dark" || s.theme === "system" ? s.theme : "light");
        setAccentColor(typeof s.accentColor === "string" ? s.accentColor : "");
        setAppearance(mergeAppearance(DEFAULT_APPEARANCE, s.appearance));
        setShortcuts({ ...DEFAULT_SHORTCUTS, ...(s.shortcuts ?? {}) });
        setConflictHint(s.translate?.conflictHint !== false);
        if (s.translate) {
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
        if (Array.isArray(cfg.providers)) {
          let list = cfg.providers
            .filter((p: ProviderCfg) => p && typeof p.id === "string")
            .map((p: ProviderCfg) => ({ ...p, temperature: p.temperature ?? "", noThinking: p.noThinking ?? "" }));
          // 迁移(一次):旧版把检测到的所有模型自动塞进列表(中转站可能上百个);
          // 新版语义=只保留用户明确添加/使用的模型。
          if (cfg.configVersion !== 3) {
            list = list.map((p: ProviderCfg) => ({ ...p, models: p.model && p.model.trim() ? [p.model] : [] }));
            invoke("save_app_config", {
              config: {
                configVersion: 3,
                mainClose: cfg.mainClose ?? "hide",
                engineMode: cfg.engineMode,
                activeProviderId: cfg.activeProviderId,
                providers: list,
                settings: {
                  theme: s.theme === "dark" || s.theme === "system" ? s.theme : "light",
                  accentColor: typeof s.accentColor === "string" ? s.accentColor : "",
                  appearance: mergeAppearance(DEFAULT_APPEARANCE, s.appearance),
                  shortcuts: { ...DEFAULT_SHORTCUTS, ...(s.shortcuts ?? {}) },
                  translate: {
                    sourceLang: s.translate?.sourceLang ?? "auto",
                    targetLang: s.translate?.targetLang ?? "zh",
                    streamOn: s.translate?.streamOn ?? true,
                    numCtx: s.translate?.numCtx ?? 1024,
                    conflictHint: s.translate?.conflictHint !== false,
                    independentLang: s.translate?.independentLang === true,
                  },
                  subtitle: { fps: s.subtitle?.fps ?? 2, mode: s.subtitle?.mode ?? "trans-first", engine: s.subtitle?.engine ?? "win" },
                  clipboard: { auto: s.clipboard?.auto ?? false },
                },
              },
            }).catch(() => {});
          }
          setProviders(list);
          if (cfg.activeProviderId && list.some((p: ProviderCfg) => p.id === cfg.activeProviderId)) {
            setActiveProviderId(cfg.activeProviderId);
          }
        }
      })
      .catch(() => { configLoadedRef.current = true; });
  }, []);

  const abortRef = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const screenshotSource = useRef<string>("main"); // 截图发起方: main=桌面端 / floating=悬浮窗
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef(input);
  inputRef.current = input;
  const textareaElRef = useRef<HTMLTextAreaElement>(null);
  /* 输入框随内容自动增高(上限约 38% 窗口高,超出后内部滚动) */
  useEffect(() => {
    const el = textareaElRef.current;
    if (!el) return;
    el.style.height = "auto";
    const max = Math.round(window.innerHeight * 0.38);
    const h = Math.min(Math.max(el.scrollHeight, 96), max);
    el.style.height = h + "px";
    el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
  }, [input]);

  const floatingRef = useRef(false);
  useEffect(() => { floatingRef.current = floatingOpen; }, [floatingOpen]);

  /* ===== 视频实时字幕(第 6 波 3.4/3.5) ===== */
  const [subtitleOn, setSubtitleOn] = useState(false);          // 字幕开关
  const [subFps, setSubFps] = useState(2);                      // 截帧频率 1-5 次/秒
  const [subMode, setSubMode] = useState<"trans-first" | "ocr-first">("trans-first"); // 翻译优先/原文优先
  const [subEngine, setSubEngine] = useState<"win" | "rapid">("win"); // 字幕 OCR 引擎:win=系统OCR(快)/rapid=RapidOCR
  const [subStatus, setSubStatus] = useState("");               // 字幕状态提示
  const [subRegion, setSubRegion] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const subRegionRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);

  /* 从配置恢复字幕参数(须在 subFps/subMode/subEngine 声明之后执行) */
  useEffect(() => {
    const s = loadedCfgRef.current?.settings ?? {};
    if (s.subtitle?.fps) setSubFps(Number(s.subtitle.fps));
    if (s.subtitle?.mode) setSubMode(s.subtitle.mode);
    if (s.subtitle?.engine) setSubEngine(s.subtitle.engine);
    // 字幕区域持久化:重启后恢复上次框选的区域(否则回到默认底部 1/4,可能对不上视频)
    const r = s.subtitle?.region;
    if (r && typeof r.x === "number" && typeof r.y === "number" && r.w > 0 && r.h > 0) {
      subRegionRef.current = { x: r.x, y: r.y, w: r.w, h: r.h };
      setSubRegion({ x: r.x, y: r.y, w: r.w, h: r.h });
    }
  }, []);

  /* mainClose 立即落盘:用户可能马上点 ✕(Rust 直接从文件读,不能等 400ms 防抖) */
  useEffect(() => {
    if (!configLoadedRef.current) return;
    invoke("save_app_config", {
      config: {
        configVersion: 3, mainClose, engineMode, activeProviderId, providers,
        settings: {
          theme, accentColor, appearance, shortcuts,
          translate: { sourceLang, targetLang, streamOn, numCtx, conflictHint, independentLang, modeLangs },
          subtitle: { fps: subFps, mode: subMode, engine: subEngine, region: subRegionRef.current },
          clipboard: { auto: clipAuto },
        },
      },
    }).catch((e) => console.error("保存配置失败", e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainClose]);

  /* 配置变更防抖保存(400ms)+ 广播外观到其他窗口 + 重注册快捷键(须在相关 state 声明之后) */
  useEffect(() => {
    if (!configLoadedRef.current) return;
    const t = setTimeout(() => {
      const settings = {
        theme,
        accentColor,
        appearance,
        shortcuts,
        translate: { sourceLang, targetLang, streamOn, numCtx, conflictHint, independentLang, modeLangs },
        subtitle: { fps: subFps, mode: subMode, engine: subEngine, region: subRegionRef.current },
        clipboard: { auto: clipAuto },
      };
      invoke("save_app_config", { config: { configVersion: 3, mainClose, engineMode, activeProviderId, providers, settings } }).catch((e) => console.error("保存配置失败", e));
      invoke("broadcast_settings", { settings }).catch(() => {});
      invoke("apply_shortcuts", { shortcuts }).catch(() => {});
    }, 400);
    return () => clearTimeout(t);
  }, [engineMode, activeProviderId, providers, mainClose, theme, accentColor, appearance, shortcuts, sourceLang, targetLang, streamOn, numCtx, conflictHint, independentLang, modeLangs, subFps, subMode, subEngine, subRegion, clipAuto]);

  /* 主窗口应用主题 + 外观(CSS 变量即时生效) */
  useEffect(() => { applyWindowTheme("main", theme, appearance, accentColor); }, [theme, appearance, accentColor]);
  const [subCurrent, setSubCurrent] = useState<{ text: string; result: string } | null>(null); // 当前字幕(主窗口显示)

  /* ===== 音频实时字幕(第 7 波:系统内部音频 → ASR → 翻译) ===== */
  const [audioMode, setAudioMode] = useState<"system" | "mic" | "both">("system"); // 音频来源模式
  const [audioSubOn, setAudioSubOn] = useState<Record<string, boolean>>({});       // 各来源开关
  const [audioStatus, setAudioStatus] = useState<Record<string, string>>({});      // 各来源状态
  const [, setAudioPartial] = useState<Record<string, string>>({});                 // 各来源增量文本(仅写入,显示改走 audioHist)
  const [audioLevel, setAudioLevel] = useState<Record<string, number>>({});        // 各来源实时音量(dB)
  const [sensitivities, setSensitivities] = useState<Record<string, number>>({}); // 各语言断句灵敏度(秒)
  /* 主窗口音频 hist:原文区/译文区四行显示(与语音窗一致,跨来源合并按时间推进) */
  const [audioHist, setAudioHist] = useState<{ text: string; result: string }[]>([{ text: "", result: "" }]);

  // 便捷访问:某来源是否运行 / 状态 / 增量文本
  const isSrcOn = (src: string) => !!audioSubOn[src];
  const srcStatus = (src: string) => audioStatus[src] ?? "";
  const srcLevel = (src: string) => audioLevel[src] ?? -100;

  /* 读取某语言灵敏度(懒加载:首次从 Rust 拉全部) */
  const sensitivityForLang = (lang: string): number | undefined => {
    if (Object.keys(sensitivities).length === 0) return undefined;
    return sensitivities[lang];
  };
  /* 设置某语言灵敏度:更新本地 + 写 Rust(Rust 广播到所有端,联动共享);松手时应用生效 */
  const setSensitivityForLang = (lang: string, value: number) => {
    setSensitivities((prev) => ({ ...prev, [lang]: value }));
    invoke("audio_set_sensitivity", { lang, value }).catch(() => {});
  };
  /* 滑块松手:应用灵敏度(重启识别器使端点生效,拖动过程不反复重启) */
  const applySensitivityForLang = (lang: string) => {
    invoke("audio_apply_sensitivity", { lang }).catch(() => {});
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
  const audioTranslatingRef = useRef<Record<string, boolean>>({});  // 各来源翻译串行标志
  const audioPendingRef = useRef<Record<string, string>>({});       // 各来源待翻译的最新文本
  const audioTranslateStartRef = useRef<Record<string, number>>({}); // 各来源当前翻译开始时间(看门狗)
  const audioFinalRef = useRef<Record<string, string>>({});         // 各来源当前定稿句
  const lastAudioTranslatedRef = useRef<Record<string, string>>({}); // 各来源去重

  const subTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ocrInFlightRef = useRef(false);                         // 上一帧 OCR 未返回则跳过
  const subTranslatingRef = useRef(false);                      // 翻译串行:翻译中跳过新帧
  const lastSubOcrRef = useRef("");                             // 去重:上次 OCR 文本
  const lastSubTranslatedRef = useRef("");                      // 去重:上次已翻译文本
  const subModeRef = useRef(subMode);
  useEffect(() => { subModeRef.current = subMode; }, [subMode]);
  const subPendingRef = useRef("");                             // 待翻译的最新文本(去抖用)
  const subDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null); // 句子稳定延迟
  const subDirtyRef = useRef(false);                            // 翻译期间来了新句子

  /* 默认字幕区域:画面底部 1/4(物理像素) */
  const ensureSubRegion = () => {
    if (subRegionRef.current) return;
    const dpr = window.devicePixelRatio || 1;
    const W = Math.round(window.screen.width * dpr);
    const H = Math.round(window.screen.height * dpr);
    const region = { x: 0, y: Math.round(H * 0.75), w: W, h: Math.round(H * 0.25) };
    subRegionRef.current = region;
    setSubRegion(region);
  };

  /* 字幕引擎:定时截帧 → subtitle_frame(Rust OCR)→ subtitle-ocr 事件回调 */
  useEffect(() => {
    if (!subtitleOn) return;
    ensureSubRegion();
    setSubStatus("字幕运行中,区域: " + (subRegionRef.current ? `(${subRegionRef.current.x},${subRegionRef.current.y} ${subRegionRef.current.w}x${subRegionRef.current.h})` : "未设置"));
    subTimerRef.current = setInterval(() => {
      const r = subRegionRef.current;
      if (!r || ocrInFlightRef.current) return;
      ocrInFlightRef.current = true;
      invoke("subtitle_frame", { x: r.x, y: r.y, w: r.w, h: r.h, engine: subEngine }).catch(() => { ocrInFlightRef.current = false; });
    }, 1000 / subFps);
    return () => { if (subTimerRef.current) clearInterval(subTimerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subtitleOn, subFps, subEngine]);

  /* 提交翻译(句子已稳定):流式输出译文,最多滞后一句 */
  const submitSubtitle = useCallback(async (text: string) => {
    if (subTranslatingRef.current) { subDirtyRef.current = true; return; }
    subTranslatingRef.current = true;
    subDirtyRef.current = false;
    try {
      let src = langFor("subtitle").src;
      let tgt = langFor("subtitle").tgt;
      if (src === "auto") src = detectLang(text);
      if (src === tgt) tgt = src === "zh" ? "en" : "zh";
      lastSubTranslatedRef.current = text;
      // 原文优先:先显示原文,译文流式替换
      if (subModeRef.current === "ocr-first") {
        const first = { text, result: "" };
        appWindow.emitTo("floating", "subtitle-text", first).catch(() => {});
        setSubCurrent(first);
      }
      let result = "";
      await translateStream(model, src, tgt, text, numCtx, (tok) => {
        result += tok;
        const p = { text, result };
        appWindow.emitTo("floating", "subtitle-text", p).catch(() => {});
        setSubCurrent(p);
        setModeOutput((prev) => ({ ...prev, subtitle: result }));
      });
      if (!result.trim()) result = "(空响应)";
      const p = { text, result };
      await appWindow.emitTo("floating", "subtitle-text", p).catch(() => {});
      setSubCurrent(p);
      setModeOutput((prev) => ({ ...prev, subtitle: result }));
      setSubStatus("");
    } catch (e: any) {
      setSubStatus(`翻译失败: ${e}`);
      setModeOutput((prev) => ({ ...prev, subtitle: `翻译失败: ${e}` }));
    } finally {
      subTranslatingRef.current = false;
      // 翻译期间来了新句子:翻译最新的(跳过中间态)
      if (subDirtyRef.current && subPendingRef.current) {
        const t = subPendingRef.current;
        subPendingRef.current = "";
        submitSubtitle(t);
      }
    }
    // 依赖必须包含 sourceLang/targetLang:independentLang=false 时语言方向取自它们,
    // 否则闭包捕获旧值,用户改语言方向后字幕/音频/截图翻译仍走旧方向(修复 2026-08-13)
  }, [model, numCtx, independentLang, modeLangs, sourceLang, targetLang]);

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
    subPendingRef.current = text;
    subDebounceRef.current = setTimeout(() => {
      const t = subPendingRef.current;
      if (!t) return;
      submitSubtitle(t);
    }, 500);
  }, [submitSubtitle]);

  const subtitleOcrHandlerRef = useRef(handleSubtitleOcr);
  useEffect(() => { subtitleOcrHandlerRef.current = handleSubtitleOcr; }, [handleSubtitleOcr]);

  /* 音频字幕翻译(source: 来源):原文实时增长 + 译文完成后整体替换(保留旧译文,不闪)
     增量时 result="" 只更新原文;译文完成时 result 非空整体替换 */
  const submitAudioSubtitle = useCallback(async (source: string, text: string, isFinal = false) => {
    if (!text.trim()) return;
    if (audioTranslatingRef.current[source]) {
      // 看门狗:同一句翻译超过 65s 未完成 → 强制放锁,让后续句子继续(防外接 API 卡住后"无响应")
      const started = audioTranslateStartRef.current[source] ?? 0;
      if (Date.now() - started > 65000) {
        audioTranslatingRef.current[source] = false;
        audioTranslateStartRef.current[source] = 0;
        setAudioStatus((prev) => ({ ...prev, [source]: "上句翻译超时,已跳过" }));
      } else {
        audioPendingRef.current[source] = text;
        return;
      }
    }
    audioTranslatingRef.current[source] = true;
    audioTranslateStartRef.current[source] = Date.now();
    try {
      let src = langFor("audio").src;
      let tgt = langFor("audio").tgt;
      if (src === "auto") src = detectLang(text);
      if (src === tgt) tgt = src === "zh" ? "en" : "zh";
      lastAudioTranslatedRef.current[source] = text;
      // 只更新原文(保留旧译文),译文完成后再整体替换
      const role = isFinal ? "prev" : "cur"; // prev=定稿句(滚为上一句), cur=当前句(增量)
      const send = (result: string) =>
        invoke("audio_forward_to_floating", { source, text, src, tgt, result, role }).catch((e) => {
          setAudioStatus((prev) => ({ ...prev, [source]: `转发失败: ${JSON.stringify(e)}` }));
        });
      // 仅定稿(final)才向语音窗滚动(压入上一句):partial 的原文已由 __audioPartial 实时更新,
      // 若每次增量都 send("") 会让语音窗每识别一个新词就滚动一次(第一句第二句重复/乱窜)。
      if (isFinal) await send("");
      let result = await translateFull(model, src, tgt, text, numCtx);
      if (!result.trim()) result = "(空响应)";
      // partial/final 都向语音窗发译文:partial = 当前句边说边出, final = 定稿句(已滚为上一句)。
      await send(result);
      // 主窗口 hist:译文按角色直接更新(不依赖 text 匹配——识别增量变化快,匹配会导致译文丢失/滞后)
      setAudioHist((h) => {
        if (isFinal) {
          if (h.length < 2) return h;
          const i = h.length - 2; // 上一句(定稿句)
          return h.map((x, j) => (j === i ? { ...x, result } : x));
        }
        const i = h.length - 1; // 当前句
        if (!h[i].text) return h; // 当前句为空(刚定稿滚动)时丢弃 partial 译文,等 final 翻译补
        return h.map((x, j) => (j === i ? { ...x, result } : x));
      });
      setModeOutput((prev) => ({ ...prev, audio: result }));
      setAudioStatus((prev) => ({ ...prev, [source]: "" }));
    } catch (e: any) {
      setAudioStatus((prev) => ({ ...prev, [source]: `翻译失败: ${e}` }));
      setModeOutput((prev) => ({ ...prev, audio: `翻译失败: ${e}` }));
    } finally {
      audioTranslatingRef.current[source] = false;
      audioTranslateStartRef.current[source] = 0;
      // 翻译期间来了新字:立刻翻译最新的(最新优先,跳过中间态)
      if (audioPendingRef.current[source]) {
        const t = audioPendingRef.current[source];
        audioPendingRef.current[source] = "";
        submitAudioSubtitle(source, t);
      }
    }
    // 依赖必须包含 sourceLang/targetLang:independentLang=false 时语言方向取自它们,
    // 否则闭包捕获旧值,用户改语言方向后仍走旧方向(修复 2026-08-13)
  }, [model, numCtx, independentLang, modeLangs, sourceLang, targetLang]);

  /* 模式对应的来源列表 */
  const sourcesForMode = useCallback((mode: string): string[] => {
    if (mode === "both") return ["system", "mic"];
    return [mode];
  }, []);

  /* 音频字幕开关:按当前模式启动/停止对应来源(与视频字幕互斥) */
  const toggleAudioSubtitle = useCallback(async () => {
    const anyOn = sourcesForMode(audioMode).some((s) => !!audioSubOn[s]);
    if (!anyOn) {
      // 启动当前模式的所有来源
      setSubtitleOn(false);
      setActiveMode("audio");
      appWindow.emitTo("floating", "subtitle-state", "off").catch(() => {});
      const asrLang = langFor("audio").src === "auto" ? "auto" : langFor("audio").src;
      if (!AUDIO_ASR_LANGS.includes(asrLang)) {
        for (const src of sourcesForMode(audioMode)) {
          setAudioStatus((prev) => ({ ...prev, [src]: "识别语言不支持(音频识别仅支持 中文/英语/日语/韩语),请先切换语言" }));
        }
        return;
      }
      for (const src of sourcesForMode(audioMode)) {
        setAudioStatus((prev) => ({ ...prev, [src]: "正在加载 ASR 模型…" }));
        try {
          await invoke("audio_subtitle_start", { source: src, lang: asrLang });
          setAudioSubOn((prev) => ({ ...prev, [src]: true }));
          await invoke("open_audio_floating_window", { source: src }).catch(() => {});
        } catch (e: any) {
          setAudioStatus((prev) => ({ ...prev, [src]: `启动失败: ${e}` }));
          setAudioSubOn((prev) => ({ ...prev, [src]: false }));
        }
      }
    } else {
      // 停止当前模式的所有来源
      for (const src of sourcesForMode(audioMode)) {
        try { await invoke("audio_subtitle_stop", { source: src }); } catch {}
        setAudioSubOn((prev) => ({ ...prev, [src]: false }));
        setAudioPartial((prev) => ({ ...prev, [src]: "" }));
        audioFinalRef.current[src] = "";
        setAudioStatus((prev) => ({ ...prev, [src]: "已停止" }));
        await invoke("close_audio_floating_window", { source: src }).catch(() => {});
      }
    }
  }, [audioMode, audioSubOn, sourceLang, sourcesForMode, independentLang, modeLangs]);

  /* 切换音频来源模式:运行中切换 = 自动关旧来源+启新来源(不停止);
     停止状态切换 = 仅改模式选择 */
  const changeAudioMode = useCallback(async (mode: "system" | "mic" | "both") => {
    const oldOn = sourcesForMode(audioMode).some((s) => !!audioSubOn[s]);
    setAudioMode(mode);
    if (!oldOn) return; // 没在运行,只改选择
    // 运行中:先停不在新模式里的来源 + 关其窗
    const oldSrcs = sourcesForMode(audioMode);
    const newSrcs = sourcesForMode(mode);
    for (const src of oldSrcs) {
      if (!newSrcs.includes(src)) {
        try { await invoke("audio_subtitle_stop", { source: src }); } catch {}
        setAudioSubOn((prev) => ({ ...prev, [src]: false }));
        setAudioPartial((prev) => ({ ...prev, [src]: "" }));
        audioFinalRef.current[src] = "";
        setAudioStatus((prev) => ({ ...prev, [src]: "已停止" }));
        await invoke("close_audio_floating_window", { source: src }).catch(() => {});
      }
    }
    // 再启动新模式里新增的来源 + 开其窗
    const asrLang = langFor("audio").src === "auto" ? "auto" : langFor("audio").src;
    if (!AUDIO_ASR_LANGS.includes(asrLang)) {
      for (const src of newSrcs) {
        setAudioStatus((prev) => ({ ...prev, [src]: "识别语言不支持(音频识别仅支持 中文/英语/日语/韩语),请先切换语言" }));
        setAudioSubOn((prev) => ({ ...prev, [src]: false }));
      }
      return;
    }
    for (const src of newSrcs) {
      if (!oldSrcs.includes(src)) {
        setAudioStatus((prev) => ({ ...prev, [src]: "正在加载 ASR 模型…" }));
        try {
          await invoke("audio_subtitle_start", { source: src, lang: asrLang });
          setAudioSubOn((prev) => ({ ...prev, [src]: true }));
          await invoke("open_audio_floating_window", { source: src }).catch(() => {});
        } catch (e: any) {
          setAudioStatus((prev) => ({ ...prev, [src]: `启动失败: ${e}` }));
          setAudioSubOn((prev) => ({ ...prev, [src]: false }));
        }
      }
    }
  }, [audioMode, audioSubOn, sourceLang, sourcesForMode, independentLang, modeLangs]);

  /* 监听音频字幕事件(带 source):status/partial/final */
  useEffect(() => {
    const s = appWindow.listen<{ source: string; status: string }>("audio-status", (e) => {
      const { source, status } = e.payload;
      setAudioStatus((prev) => ({ ...prev, [source]: status }));
      if (status.startsWith("error")) setAudioSubOn((prev) => ({ ...prev, [source]: false }));
      if (status === "stopped") { setAudioSubOn((prev) => ({ ...prev, [source]: false })); setAudioPartial((prev) => ({ ...prev, [source]: "" })); }
      // apply 灵敏度重启识别器后会再发 ready,恢复运行状态(不误显示"已停止")
      if (status === "ready") { setAudioSubOn((prev) => ({ ...prev, [source]: true })); }
    });
    const p = appWindow.listen<{ source: string; text: string }>("audio-partial", (e) => {
      const { source, text } = e.payload;
      const trimmed = text.trim();
      setAudioPartial((prev) => ({ ...prev, [source]: trimmed }));
      if (!trimmed) return;
      // 主窗口 hist:当前句原文实时更新
      setAudioHist((h) => {
        if (h.length === 0) return [{ text: trimmed, result: "" }];
        const last = h[h.length - 1];
        return [...h.slice(0, -1), { ...last, text: trimmed }];
      });
      // 与当前定稿句不同才触发累积翻译(同一句内增量变化都要翻,译文跟着增长)
      if (trimmed !== audioFinalRef.current[source]) {
        submitAudioSubtitle(source, trimmed, false);
      }
    });
    const f = appWindow.listen<{ source: string; text: string }>("audio-final", (e) => {
      const { source, text } = e.payload;
      const trimmed = text.trim();
      if (!trimmed) return;
      audioFinalRef.current[source] = trimmed;
      // 立即定稿滚动(不依赖翻译完成):当前句(用 final 完整文本)滚为上一句,压入空当前句。
      // 译文完成后由 submitAudioSubtitle 按 text 匹配补回,保证上一句译文可靠显示。
      setAudioHist((h) => {
        const rest = h.slice(0, -1);
        const cur = h[h.length - 1];
        const finalized = { text: trimmed, result: cur && cur.text === trimmed ? cur.result : "" };
        return [...rest, finalized, { text: "", result: "" }].slice(-3);
      });
      submitAudioSubtitle(source, trimmed, true);
      // 保留最后一句显示(暂停/停顿不清空),新句子到来时自动替换
      setAudioPartial((prev) => ({ ...prev, [source]: trimmed }));
    });
    // 实时音量事件(辅助调试麦克风/电脑音频是否有声音)
    const lv = appWindow.listen<{ source: string; level: number }>("audio-level", (e) => {
      setAudioLevel((prev) => ({ ...prev, [e.payload.source]: e.payload.level }));
    });
    // 语音窗关闭:同步停止该来源
    const closed = appWindow.listen<{ source?: string }>("audio-floating-closed", (e) => {
      const src = e.payload?.source ?? "system";
      setAudioSubOn((prev) => ({ ...prev, [src]: false }));
      setAudioPartial((prev) => ({ ...prev, [src]: "" }));
      audioFinalRef.current[src] = "";
      setAudioStatus((prev) => ({ ...prev, [src]: "已停止(语音窗关闭)" }));
      invoke("audio_subtitle_stop", { source: src }).catch(() => {});
    });
    return () => {
      s.then((fn) => fn()); p.then((fn) => fn()); f.then((fn) => fn()); closed.then((fn) => fn()); lv.then((fn) => fn());
    };
  }, [submitAudioSubtitle]);

  const toggleAudioSubtitleRef = useRef(toggleAudioSubtitle);
  useEffect(() => { toggleAudioSubtitleRef.current = toggleAudioSubtitle; }, [toggleAudioSubtitle]);

  /* 切换字幕开关(Ctrl+Shift+U、主界面按钮、悬浮窗按钮共用);
     开启时自动弹出悬浮窗并同步状态,悬浮窗切到字幕页;与音频字幕互斥 */
  const stopAllAudio = useCallback(() => {
    // 停所有来源音频字幕 + 关所有语音窗
    invoke("audio_subtitle_stop", { source: "system" }).catch(() => {});
    invoke("audio_subtitle_stop", { source: "mic" }).catch(() => {});
    invoke("close_audio_floating_window", { source: "system" }).catch(() => {});
    invoke("close_audio_floating_window", { source: "mic" }).catch(() => {});
    setAudioSubOn({});
    setAudioPartial({});
    setAudioStatus({});
  }, []);

  const toggleSubtitle = useCallback(() => {
    setSubtitleOn((on) => {
      const next = !on;
      if (next) {
        // 互斥:开视频字幕自动关音频字幕
        stopAllAudio();
        setActiveMode("subtitle");
        ensureSubRegion();
        invoke("open_floating_window").catch(() => {});
        setFloatingOpen(true);
        appWindow.emitTo("floating", "subtitle-state", "on").catch(() => {});
      } else {
        appWindow.emitTo("floating", "subtitle-state", "off").catch(() => {});
      }
      return next;
    });
  }, [stopAllAudio]);

  const toggleSubtitleRef = useRef(toggleSubtitle);
  useEffect(() => { toggleSubtitleRef.current = toggleSubtitle; }, [toggleSubtitle]);

  /* 悬浮窗显式开始(幂等):开启字幕 + 弹悬浮窗 + 状态同步;与音频字幕互斥 */
  const startSubtitle = useCallback(() => {
    setSubtitleOn((on) => {
      if (on) return on;   // 已运行,幂等
      // 互斥:开视频字幕自动关音频字幕
      stopAllAudio();
      setActiveMode("subtitle");
      ensureSubRegion();
      invoke("open_floating_window").catch(() => {});
      setFloatingOpen(true);
      appWindow.emitTo("floating", "subtitle-state", "on").catch(() => {});
      return true;
    });
  }, [stopAllAudio]);

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
      const b64 = await invoke<string>("capture_fullscreen");
      const text = await invoke<string>("win_ocr_b64", { b64 });
      setSubStatus(`系统 OCR 成功: ${text.slice(0, 120) || "(无文字)"}`);
    } catch (e: any) {
      const msg = typeof e === "string" ? e : JSON.stringify(e);
      setSubStatus(`系统 OCR 失败: ${msg}`);
    }
  };

  /* ---- 悬浮窗 ---- */
  useEffect(() => {
    const u = appWindow.listen("floating-closed", () => { setFloatingOpen(false); });
    return () => { u.then((f) => f()); };
  }, []);

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
    setEngineMenuOpen(false);
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
  const onHeaderDoubleClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button, select, input, label")) return;
    invoke("toggle_maximize_main_window").catch(() => {});
    setTimeout(() => { appWindow.isMaximized().then((m) => setMaximized(m)).catch(() => {}); }, 300);
  };

  /* ---- 翻译核心 ---- */
  const pendingTextRef = useRef("");
  const runTranslation = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) { setModeOutput((prev) => ({ ...prev, text: "" })); return; }
      // 单飞 + 排队:上一轮还没结束就来新输入 → 记住最新文本,结束后立刻翻
      if (busyRef.current) { pendingTextRef.current = trimmed; return; }
      busyRef.current = true;
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;

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
      if (streamOn) {
        setModeOutput((prev) => ({ ...prev, text: "" }));
        try {
          await translateStream(model, src, tgt, text, numCtx, (token) => {
            // 外接 API 走 Rust invoke 无法中途中止:过期流的 token 直接丢弃
            if (ctrl.signal.aborted) return;
            setApiThinking(false);
            setModeOutput((prev) => ({ ...prev, text: prev.text + token }));
          },
            ctrl.signal,
            () => { if (!ctrl.signal.aborted) setApiThinking(true); } // 推理帧 → "思考中"提示
          );
        } catch (e: any) {
          if (e.name !== "AbortError")
            setModeOutput((prev) => ({ ...prev, text: prev.text + "\n\n" + e.message }));
        } finally {
          setApiThinking(false);
          busyRef.current = false;
          setTranslating(false);
          if (pendingTextRef.current) {
            const t = pendingTextRef.current;
            pendingTextRef.current = "";
            runTranslation(t);
          }
        }
      } else {
        setModeOutput((prev) => ({ ...prev, text: "翻译中..." }));
        try {
          const result = await translateFull(model, src, tgt, text, numCtx);
          if (!ctrl.signal.aborted) setModeOutput((prev) => ({ ...prev, text: result }));
        } catch (e: any) {
          setModeOutput((prev) => ({ ...prev, text: "翻译失败:" + e.message }));
        } finally {
          setApiThinking(false);
          busyRef.current = false;
          setTranslating(false);
          if (pendingTextRef.current) {
            const t = pendingTextRef.current;
            pendingTextRef.current = "";
            runTranslation(t);
          }
        }
      }
    },
    [model, sourceLang, targetLang, numCtx, streamOn]
  );

  /* ---- 实时翻译 ---- */
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => runTranslation(inputRef.current), DEBOUNCE_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [input, runTranslation]);

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

  /* ---- 字幕 OCR 结果事件 ---- */
  useEffect(() => {
    const u = appWindow.listen<string>("subtitle-ocr", (e) => {
      ocrInFlightRef.current = false;   // 允许下一帧
      subtitleOcrHandlerRef.current(e.payload);
    });
    const t = appWindow.listen("subtitle-start", () => { startSubtitleRef.current(); }); // 悬浮窗 🎬 开始
    const p = appWindow.listen("subtitle-stop", () => { stopSubtitleRef.current(); });   // 悬浮窗 🎬 停止
    return () => { u.then((f) => f()); t.then((f) => f()); p.then((f) => f()); };
  }, []);

  /* ---- 截图 ---- */
  const startScreenshot = async () => {
    try { await invoke("open_screenshot_overlay", { from: "main" }); } catch (e) { console.error(e); }
  };

  /* ---- 截图结果监听:主窗口接收坐标 → OCR(后台) → 按来源路由显示 ---- */
  useEffect(() => {
    const u = appWindow.listen<{ x: number; y: number; w: number; h: number; source?: string; b64?: string }>(
      "screenshot-done",
      (e) => {
        const source = e.payload.source || "main";
        screenshotSource.current = source;
        // 字幕区域选择:框选结果存为字幕区域,不触发截图翻译
        if (source === "subtitle") {
          const region = {
            x: Math.round(e.payload.x), y: Math.round(e.payload.y),
            w: Math.round(e.payload.w), h: Math.round(e.payload.h),
          };
          subRegionRef.current = region;
          setSubRegion(region);
          setSubStatus(`字幕区域已更新 (${region.x},${region.y} ${region.w}x${region.h})`);
          return;
        }
        // 状态提示按来源路由:悬浮窗截图 → 悬浮窗显示;桌面端截图 → 主窗口显示
        if (source === "floating") {
          appWindow.emitTo("floating", "screenshot-status", "正在 OCR 识别…").catch(() => {});
        } else {
          setScreenshotSrc("正在 OCR 识别…");
          setModeOutput((prev) => ({ ...prev, screenshot: "" }));
        }
        // 优先用 overlay 从缓存背景图裁剪的选区(b64,不二次截屏,避免残影);否则回退截屏
        if (e.payload.b64) {
          invoke<string>("ocr_image_b64", { b64: e.payload.b64 })
            .then((text) => { handleOcrResult(source, text); })   // 直接接返回值(同步 command)
            .catch((err: any) => {
              const msg = typeof err === "string" ? err : JSON.stringify(err);
              console.error("ocr_image_b64 失败:", err);
              if (source === "floating") {
                appWindow.emitTo("floating", "screenshot-status", `OCR 失败: ${msg}`).catch(() => {});
              } else {
                setScreenshotSrc(`OCR 失败: ${msg}`);
                setModeOutput((prev) => ({ ...prev, screenshot: "" }));
              }
            });
        } else {
          invoke("screenshot_ocr", { x: Math.round(e.payload.x), y: Math.round(e.payload.y), w: Math.round(e.payload.w), h: Math.round(e.payload.h) }).catch(() => {});
        }
      }
    );
    /* OCR 结果统一处理:识别文本 → 语言检测 → 翻译 → 按来源路由显示 */
    const handleOcrResult = async (source: string, ocrText: string) => {
      // 按来源显示状态/结果:floating → 悬浮窗事件;main → 主窗口输出区
      const showStatus = (msg: string) => {
        if (source === "floating") {
          appWindow.emitTo("floating", "screenshot-status", msg).catch(() => {});
        } else {
          setScreenshotSrc(msg);
        }
      };
      if (!ocrText || ocrText.startsWith("ERROR:")) {
        showStatus(ocrText || "未识别到文字");
        return;
      }
      if (!ocrText.trim()) { showStatus("未识别到文字"); return; }
      let src = langFor("screenshot").src;
      let tgt = langFor("screenshot").tgt;
      if (src === "auto") { src = detectLang(ocrText); }
      if (src === tgt) tgt = src === "zh" ? "en" : "zh";
      if (source === "floating") {
        appWindow.emitTo("floating", "screenshot-status", "正在翻译…").catch(() => {});
      } else {
        setScreenshotSrc(ocrText); // 灰框固定显示截到的原文,翻译中不覆盖
      }
      try {
        const result = await translateFull(model, src, tgt, ocrText, numCtx);
        if (source === "floating") {
          await appWindow.emitTo("floating", "show-translation", { text: ocrText, src, tgt, result }).catch(() => {});
        } else {
          setModeOutput((prev) => ({ ...prev, screenshot: result }));
        }
      } catch (e: any) {
        if (source === "floating") {
          appWindow.emitTo("floating", "screenshot-status", `翻译失败: ${e}`).catch(() => {});
        } else {
          setScreenshotSrc(`翻译失败: ${e}`);
          setModeOutput((prev) => ({ ...prev, screenshot: "" }));
        }
      }
    };
    const o = appWindow.listen<string>(
      "ocr-done",
      (e) => { handleOcrResult(screenshotSource.current, e.payload); }
    );
    return () => { u.then((f) => f()); o.then((f) => f()); };
    // 依赖必须包含 sourceLang/targetLang:independentLang=false 时语言方向取自它们,
    // 否则闭包捕获旧值,用户改语言方向后截图翻译仍走旧方向(修复 2026-08-13)
  }, [model, numCtx, independentLang, modeLangs, sourceLang, targetLang]);

  /* ---- 剪贴板监听:复制即译 ---- */
  useEffect(() => {
    let lastText = "";
    let busy = false;
    const timer = setInterval(async () => {
      if (busy) return;
      try {
        const text = await readText();
        if (!text || text === lastText || text.length < 2) return;
        lastText = text;
        const words = text.split(/\s+/).filter((w) => w.length > 1);
        if (words.length > 50) return;
        busy = true;
        // 跟随主窗口语言设置 + 模型
        let src = sourceLang;
        let tgt = targetLang;
        if (src === "auto") {
          src = detectLang(text);
          // 只有在目标也是 auto 时才自动决定,否则保留用户选择
          if (tgt === "auto" || tgt === src) {
            tgt = src === "zh" ? "en" : src === "en" ? "zh" : "en";
          }
        }
        // 模式检查:手动模式下悬浮窗未开则跳过
        if (!clipAuto && !floatingRef.current) return;
        try { await invoke("open_floating_window"); setFloatingOpen(true); } catch { /* ok */ }
        const result = await translateFull(model, src, tgt, text, 1024);
        await appWindow.emitTo("floating", "show-translation", { text, src, tgt, result });
      } catch {
        /* ignore */
      } finally {
        busy = false;
      }
    }, 600);
    return () => clearInterval(timer);
  }, [sourceLang, targetLang, model, clipAuto]);

  /* ---- 本地模型管理(Wave 10.5:模型页 列表/下载/删除/导入) ---- */
  const refreshLocalModels = async (silent = false): Promise<LocalModelInfo[]> => {
    try {
      const resp = await fetch(`${OLLAMA_BASE}/api/tags`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      const list: LocalModelInfo[] = Array.isArray(data.models) ? data.models : [];
      setLocalModels(list);
      setLocalModelsLoaded(true);
      return list;
    } catch (e: any) {
      setLocalModels([]);
      setLocalModelsLoaded(true);
      if (!silent) setEngineStatus(`读取本地模型失败: ${e?.message ?? e}`);
      return [];
    }
  };
  /* 启动后拉取本地模型;若失败(serve 可能还在启动)3 秒后静默重试一次 */
  useEffect(() => {
    let alive = true;
    let t: ReturnType<typeof setTimeout> | undefined;
    refreshLocalModels().then((list) => {
      if (!alive || list.length) return;
      t = setTimeout(() => { refreshLocalModels(true); }, 3000);
    });
    return () => { alive = false; if (t) clearTimeout(t); };
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

  /* 工作台:当前任务标题 + 统一状态胶囊 */
  const taskTitle = (() => {
    switch (activeMode) {
      case "audio": return "音频翻译";
      case "subtitle": return "视频字幕";
      case "screenshot": return "截图翻译";
      default: return "文本翻译";
    }
  })();
  const taskIcon: IconName = activeMode === "audio" ? "mic" : activeMode === "subtitle" ? "film" : activeMode === "screenshot" ? "camera" : "pen";
  const statusInfo = (() => {
    if (sourcesForMode(audioMode).some((s) => isSrcOn(s))) {
      const st = sourcesForMode(audioMode).map((s) => srcStatus(s)).filter(Boolean)[0] ?? "";
      return { text: "正在监听" + (st ? " · " + st : ""), tone: "live", icon: "dot" as IconName };
    }
    if (subtitleOn) return { text: "字幕运行中", tone: "live", icon: "dot" as IconName };
    if (translating) return { text: apiThinking ? "模型思考中…" : "翻译中…", tone: "work", icon: (apiThinking ? "sparkle" : "clock") as IconName };
    return { text: "就绪", tone: "idle", icon: "dot" as IconName };
  })();

  /* ---- UI ---- */
  return (
    <div className="app-main">
      <header className="app-header" onMouseDown={onHeaderMouseDown} onDoubleClick={onHeaderDoubleClick}>
        <div className="app-brand">
          <h1>翻译助手</h1>
          <div className="engine-menu-wrap">
            <button className="engine-pill" onClick={() => setEngineMenuOpen(!engineMenuOpen)} title="切换翻译引擎 / 模型">
              <Icon name={activeApiModel ? "globe" : "dot"} size={13} /> {engineLabelText} <Icon name="chevron" size={11} className="engine-pill-caret" />
            </button>
            {engineMenuOpen && (
              <>
                <div className="engine-menu">
                  <div className="engine-menu-title">翻译引擎</div>
                  {localModelsLoaded && menuLocalModels.length === 0 && (
                    <div className="engine-menu-empty">还没有本地模型:到 设置 → 模型 下载/导入,或配置外接 API</div>
                  )}
                  {menuLocalModels.map((m) => {
                    const mn = m.name;
                    const label = mn === "maternion/hy-mt2:1.8b" ? "HY-MT2-1.8B (本地 · 推荐)" : mn === "gemma3:4b" ? "gemma3:4b (本地)" : `${mn} (本地)`;
                    return (
                      <button key={mn} className={`engine-menu-item${headerEngineValue === mn ? " active" : ""}`} onClick={() => selectHeaderEngine(mn)}>
                        {headerEngineValue === mn ? <Icon name="check" size={13} /> : <Icon name="dot" size={13} />} {label}
                      </button>
                    );
                  })}
                  {(localModels.length > 0 || !localModelsLoaded) && apiModelOptions.length > 0 && <div className="engine-menu-divider" />}
                  {apiModelOptions.map((o) => (
                    <button key={`${o.providerId}::${o.model}`} className={`engine-menu-item${headerEngineValue === `api:${o.providerId}::${o.model}` ? " active" : ""}`} onClick={() => selectHeaderEngine(`api:${o.providerId}::${o.model}`)}>
                      {headerEngineValue === `api:${o.providerId}::${o.model}` ? <Icon name="check" size={13} /> : <Icon name="globe" size={13} />} {o.label}
                    </button>
                  ))}
                  <div className="engine-menu-divider" />
                  <button className="engine-menu-item manage" onClick={() => { setEngineMenuOpen(false); setSettingsOpen(true); setSettingsPage("providers"); }}>
                    <Icon name="settings" size={13} /> 管理模型
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
        <div className="toolbar-right">
          <button className={`icon-btn${settingsOpen ? " active" : ""}`} onClick={() => setSettingsOpen(!settingsOpen)} title="设置中心">
            <Icon name="settings" size={16} />
          </button>
          <span className="win-divider" />
          <button className="icon-btn win-btn" title="最小化" onMouseDown={(e) => e.stopPropagation()} onClick={() => { appWindow.minimize().catch(() => {}); invoke("minimize_main_window").catch(() => {}); }}><Icon name="minimize" size={14} /></button>
          <button className="icon-btn win-btn" title={maximized ? "还原" : "最大化"} onMouseDown={(e) => e.stopPropagation()} onClick={() => { invoke("toggle_maximize_main_window").catch(() => {}); setTimeout(() => { appWindow.isMaximized().then((m) => setMaximized(m)).catch(() => {}); }, 300); }}><Icon name={maximized ? "restore" : "maximize"} size={13} /></button>
          <button className="icon-btn win-btn win-close" title="关闭(行为见 设置-常规)" onMouseDown={(e) => e.stopPropagation()} onClick={() => { appWindow.close().catch(() => {}); }}><Icon name="close" size={13} /></button>
        </div>
      </header>

      {ollamaBackend === "cpu" && (
        <div className="gpu-hint">
          <Icon name="warn" size={13} /> 未检测到可用 GPU，本地翻译将使用 CPU 模式（速度较慢）
        </div>
      )}

      {settingsOpen ? (
        <main className="app-body settings-body">
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
                    <span>主题</span>
                    <div className="seg">
                      {([["light", "浅色"], ["dark", "深色"], ["system", "跟随系统"]] as const).map(([v, label]) => (
                        <button key={v} className={`seg-item${theme === v ? " active" : ""}`} onClick={() => setTheme(v)}>{label}</button>
                      ))}
                    </div>
                  </div>
                  <div className="settings-row">
                    <span>主题颜色</span>
                    <input type="color" value={accentColor || (theme === "dark" ? "#0a84ff" : "#007aff")} onChange={(e) => setAccentColor(e.target.value)} title="自定义强调色(按钮 / 选中高亮等)" />
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
                  <p className="settings-note">语言方向也会同步主界面顶部的快捷选择。</p>
                </div>
              )}
              {settingsPage === "audio" && (
                <div className="settings-section">
                  <h2>音频</h2>
                  <p className="settings-note">断句灵敏度 = 识别停顿多久算一句结束(秒),数值越小越敏感;按识别语言独立设置,主界面和语音窗同步。</p>
                  {[["auto", "自动"], ["zh", "中文"], ["en", "英语"], ["ja", "日语"], ["ko", "韩语"]].map(([code, name]) => (
                    <div className="settings-row" key={code}>
                      <span>{name}断句</span>
                      <input type="range" min="1" max="40" step="1"
                        value={Math.round((sensitivityForLang(code) ?? 1.2) * 10)}
                        onChange={(e) => setSensitivityForLang(code, Number(e.target.value) / 10)}
                        onPointerUp={() => applySensitivityForLang(code)} />
                      <b>{(sensitivityForLang(code) ?? 1.2).toFixed(1)}s</b>
                    </div>
                  ))}
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
                  <p className="settings-note">改动即时生效、重启保留;背景/文字颜色点「跟随主题」可恢复默认。圆角/边距/毛玻璃强度等不做(选项太多反而难用)。</p>
                  <div className="appearance-preview">
                    <div className="appearance-preview-card" style={{
                      background: hexToRgba(appearance.floating.bg || "#ffffff", appearance.floating.opacity / 100),
                      color: appearance.floating.textColor || "var(--ios-text)",
                      fontSize: `${appearance.floating.fontSize}px`,
                    }}>
                      <div style={{ opacity: 0.7, fontSize: "0.82em" }}>{floatingSample[0]}</div>
                      <div style={{ fontWeight: 600 }}>{floatingSample[1]}</div>
                    </div>
                  </div>
                  {(Object.keys(SURFACE_LABELS) as SurfaceKey[]).map((key) => {
                    const item = appearance[key];
                    const patch = (p: Partial<AppearanceItem>) => setAppearance((prev) => ({ ...prev, [key]: { ...prev[key], ...p } }));
                    return (
                      <div className="appearance-group" key={key}>
                        <h3>{SURFACE_LABELS[key]}</h3>
                        <div className="settings-row">
                          <span>背景颜色</span>
                          <input type="color" value={item.bg || (key === "main" ? "#f2f2f7" : "#ffffff")} onChange={(e) => patch({ bg: e.target.value })} />
                          <button className="btn-float" onClick={() => patch({ bg: "" })}>跟随主题</button>
                        </div>
                        <div className="settings-row">
                          <span>背景透明度</span>
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
                  <p className="settings-note">本地模型由随应用内置的 Ollama 管理;正式发布包不会内置模型,请下载 HY-MT2 / gemma3 或导入自己的 GGUF 文件。外接 API 即云端模型,配置后无需本地显卡。</p>
                  {engineStatus && <p className="settings-note">{engineStatus}</p>}

                  {/* 本地模型 */}
                  <div className="settings-block">
                    <div className="settings-block-head">
                      <h3>本地模型</h3>
                      <button className="btn-float" onClick={() => refreshLocalModels()} title="重新读取本地模型列表"><Icon name="refresh" size={13} /> 刷新列表</button>
                    </div>
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
                  <p>翻译助手 v0.1.0(Wave 9 设置中心)</p>
                  <p>本地优先的桌面实时翻译工作台:文本 / 划词 / 截图 / 视频字幕 / 音频字幕,支持本地 Ollama 与外接 API 双引擎。</p>
                  <p>杀软(如火绒)可能拦截未签名程序:请加入白名单或信任后再使用;个别老式程序(如 DirectUI、游戏内文本)划词捕获不到。</p>
                </div>
              )}
              </div>
            </div>
          </div>
        </main>
      ) : (
      <main className="app-body workbench">
        {/* 悬浮窗:细长圆角按钮,单独放在模式卡片上方 */}
        <button className={`float-toggle${floatingOpen ? " active" : ""}`} onClick={toggleFloating} title={floatingOpen ? "关闭翻译悬浮窗" : "打开翻译悬浮窗(Ctrl+Shift+D)"}>
          <Icon name="windows" size={14} /> {floatingOpen ? "关闭悬浮窗" : "打开悬浮窗"}
        </button>

        {/* 翻译方式(工作台模式卡片) */}
        <div className="mode-grid">
          <button className={`mode-card${activeMode === "text" ? " active" : ""}`} onClick={() => setActiveMode("text")}>
            <span className="mode-icon"><Icon name="pen" size={22} /></span>
            <b>文本翻译</b>
            <span className="mode-desc">输入文字,自动实时翻译</span>
          </button>
          <button className={`mode-card${activeMode === "audio" ? " active" : ""}`} onClick={() => setActiveMode("audio")}>
            <span className="mode-icon"><Icon name="mic" size={22} /></span>
            <b>音频翻译</b>
            <span className="mode-desc">识别电脑声音 / 麦克风并实时翻译</span>
          </button>
          <button className={`mode-card${activeMode === "subtitle" ? " active" : ""}`} onClick={() => setActiveMode("subtitle")}>
            <span className="mode-icon"><Icon name="film" size={22} /></span>
            <b>视频字幕</b>
            <span className="mode-desc">识别屏幕区域字幕并实时翻译</span>
          </button>
          <button className={`mode-card${activeMode === "screenshot" ? " active" : ""}`} onClick={() => setActiveMode("screenshot")} title="进入截图翻译:框选屏幕区域,OCR 翻译">
            <span className="mode-icon"><Icon name="camera" size={22} /></span>
            <b>截图翻译</b>
            <span className="mode-desc">框选屏幕区域,OCR 翻译</span>
          </button>
        </div>

        {/* 当前任务卡 */}
        <div className="task-card">
          <div className="task-switch" key={activeMode}>
            <div className="task-head">
              <span className="task-title"><Icon name={taskIcon} size={18} /> {taskTitle}</span>
              <span className={`status-pill ${statusInfo.tone}`}><Icon name={statusInfo.icon} size={11} /> {statusInfo.text}</span>
            </div>

            {/* 文本翻译(默认模式) */}
            {activeMode === "text" && (
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
                <button className="btn-primary" onClick={() => runTranslation(input)} disabled={translating || !input.trim()} title="强制手动重译">
                  重译
                </button>
              </div>
              <textarea
                ref={textareaElRef}
                className="trans-input"
                placeholder="输入文字,自动翻译..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                rows={1}
              />
              {conflictHint && conflict && !translating && modeOutput.text && (
                <div className="conflict-bar">
                  <span>检测到原文已是目标语言,需要交换翻译方向吗?</span>
                  <button className="btn-conflict" onClick={() => { setConflict(false); swapLangs(); }}>交换</button>
                  <button className="btn-conflict-dismiss" onClick={() => setConflict(false)}>忽略</button>
                </div>
              )}
              </div>
            )}

            {/* 音频翻译模式 */}
            {activeMode === "audio" && (
              <div className="task-mode-panel">
              {renderLangBar("audio")}
              <button className={`mode-start${sourcesForMode(audioMode).some((s) => isSrcOn(s)) ? " active" : ""}`} onClick={toggleAudioSubtitle} title="开关音频实时识别(识别→翻译→独立语音窗显示;与视频字幕互斥)">
                <Icon name={sourcesForMode(audioMode).some((s) => isSrcOn(s)) ? "stop" : "play"} size={15} /> {sourcesForMode(audioMode).some((s) => isSrcOn(s)) ? "停止音频翻译" : "开始音频翻译"}
              </button>
              <div className="subtitle-panel-row">
                <span className={`subtitle-status${sourcesForMode(audioMode).some((s) => isSrcOn(s)) ? " live" : ""}`}>
                  {sourcesForMode(audioMode).some((s) => isSrcOn(s)) ? <Icon name="dot" size={10} style={{ color: "#34c759" }} /> : <Icon name="dot" size={10} style={{ color: "#c7c7cc" }} />} {sourcesForMode(audioMode).some((s) => isSrcOn(s)) ? "运行中" : "已停止"}
                  {sourcesForMode(audioMode).map((s) => srcStatus(s)).filter(Boolean).map((st, i) => <em key={i} className="subtitle-msg">· {st}</em>)}
                </span>
                <label className="subtitle-mode">
                  <span>音频来源</span>
                  <select value={audioMode} onChange={(e) => changeAudioMode(e.target.value as "system" | "mic" | "both")} title="电脑音频=抓系统播放的声音;麦克风=抓麦克风;同时=两个都抓。运行中切换自动换来源,不停止">
                    <option value="system">电脑音频</option>
                    <option value="mic">麦克风</option>
                    <option value="both">电脑音频+麦克风</option>
                  </select>
                </label>
                <span className="subtitle-region">识别语言:{LANGS.find((l) => l.code === langFor("audio").src)?.label ?? langFor("audio").src}{independentLang ? "(音频独立)" : "(跟随文本翻译)"};断句灵敏度在 设置-音频{!AUDIO_ASR_LANGS.includes(langFor("audio").src) && <span className="lang-warn-inline"> · 该语言不支持音频识别</span>}</span>
              </div>
              {sourcesForMode(audioMode).filter((s) => isSrcOn(s)).map((s) => (
                <div key={`lvl-${s}`} className="subtitle-panel-row" style={{ alignItems: "center", gap: 8 }}>
                  <span className="subtitle-label" style={{ fontSize: 11 }}><Icon name={s === "mic" ? "mic" : "volume"} size={13} /> 音量</span>
                  <div style={{ flex: 1, height: 8, background: "var(--ios-separator)", borderRadius: 4, overflow: "hidden" }}>
                    <div style={{
                      height: "100%", width: `${Math.max(0, Math.min(100, ((srcLevel(s) + 100) / 100) * 100))}%`,
                      background: srcLevel(s) > -40 ? "var(--ios-blue)" : "var(--ios-green)",
                      transition: "width 80ms linear",
                    }} />
                  </div>
                  <b style={{ fontSize: 11, minWidth: 44 }}>{srcLevel(s).toFixed(1)}dB</b>
                </div>
              ))}
              {/* 主窗口音频:只显示原文区(上一句+当前句),不要译文内容(译文在独立译文框) */}
              {audioHist.some((x) => x.text) && (
              <div className="voice-panel-main">
                <div className="voice-section voice-src-section">
                  <div className="voice-section-label">原文</div>
                  {audioHist.length >= 2 && audioHist[audioHist.length - 2].text && (
                    <div key={`msrc-${audioHist[audioHist.length - 2].text}`} className="voice-line voice-line-prev">
                      {audioHist[audioHist.length - 2].text}
                    </div>
                  )}
                  {audioHist[audioHist.length - 1].text && (
                    <div className="voice-line voice-line-cur">{audioHist[audioHist.length - 1].text}</div>
                  )}
                </div>
              </div>
              )}
              </div>
            )}

            {/* 视频字幕模式 */}
            {activeMode === "subtitle" && (
              <div className="task-mode-panel">
              {renderLangBar("subtitle")}
              <button className={`mode-start${subtitleOn ? " active" : ""}`} onClick={toggleSubtitle} title="开关视频字幕 (Ctrl+Shift+U)">
                <Icon name={subtitleOn ? "stop" : "play"} size={15} /> {subtitleOn ? "停止视频字幕" : "开始视频字幕"}
              </button>
              <div className="mode-start-sub">
                <button className="mode-start-half" onClick={() => invoke("open_screenshot_overlay", { from: "subtitle" }).catch(() => {})} title="框选字幕识别区域(默认屏幕底部 1/4)">
                  <Icon name="target" size={13} /> 调整区域
                </button>
                <button className="mode-start-half" onClick={testWinOcr} title="测试 Windows 系统 OCR(独立引擎,不影响 RapidOCR)">
                  <Icon name="flask" size={13} /> 系统OCR测试
                </button>
              </div>
              <div className="subtitle-panel-row">
                <span className={`subtitle-status${subtitleOn ? " live" : ""}`}>
                  {subtitleOn ? <Icon name="dot" size={10} style={{ color: "#34c759" }} /> : <Icon name="dot" size={10} style={{ color: "#c7c7cc" }} />} {subtitleOn ? "运行中" : "已停止"} {subStatus && <em className="subtitle-msg">· {subStatus}</em>}
                </span>
              </div>
              {subRegion && <div className="subtitle-panel-row"><span className="subtitle-region">字幕区域: ({subRegion.x},{subRegion.y} {subRegion.w}×{subRegion.h});截帧频率/显示策略/OCR 引擎在 ⚙ 设置-视频字幕</span></div>}
              {subCurrent && (
                <div className="subtitle-current">
                  <div className="subtitle-current-src">{subCurrent.text}</div>
                </div>
              )}
              </div>
            )}

            {/* 截图模式:截图键 + 原文灰框 */}
            {activeMode === "screenshot" && (
              <div className="task-mode-panel">
              {renderLangBar("screenshot")}
              <button className="mode-start" onClick={startScreenshot} title="框选屏幕区域,OCR 翻译(ESC/右键取消)">
                <Icon name="camera" size={15} /> 截图翻译
              </button>
              <div className="subtitle-current">
                <div className="subtitle-current-src">{screenshotSrc || "点击上方「截图翻译」框选屏幕区域,这里显示截到的原文"}</div>
              </div>
              </div>
            )}
          </div>
        </div>

        {/* 译文输出:独立于任务卡,每种模式各自一份互不影响 */}
        <div className="trans-output trans-output-standalone">
          <div className="output-label">译文 {translating && activeMode === "text" && <span className="pulse"><Icon name="dot" size={10} /></span>}{apiThinking && activeMode === "text" && <span className="thinking-hint"><Icon name="sparkle" size={11} /> 模型思考中…</span>}</div>
          {activeMode === "audio" ? (
            /* 音频模式:译文区显示两句(译文第一句已说过 + 译文第二句正在说),与语音窗一致 */
            <div className="output-text output-voice">
              {audioHist.length >= 2 && audioHist[audioHist.length - 2].result && (
                <div key={`ores-${audioHist[audioHist.length - 2].result}`} className="voice-line voice-line-prev voice-line-result">
                  {audioHist[audioHist.length - 2].result}
                </div>
              )}
              {audioHist[audioHist.length - 1].result && (
                <div className="voice-line voice-line-cur voice-line-result">{audioHist[audioHist.length - 1].result}</div>
              )}
              {!audioHist.some((x) => x.result) && <span className="output-empty-hint">暂无译文</span>}
            </div>
          ) : (
            <div className="output-text">{modeOutput[activeMode] || (activeMode === "text" ? (translating ? "" : "输入后自动翻译...") : "暂无译文")}</div>
          )}
        </div>
      </main>
      )}
    </div>
  );
}

/* ============ 悬浮窗 ============ */
function FloatingWindow() {
  const [trans, setTrans] = useState<{ text: string; src: string; tgt: string; result: string } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [mode, setMode] = useState<"trans" | "subtitle">("trans");   // 翻译页 / 字幕页
  const [subtitle, setSubtitle] = useState<{ text: string; result: string } | null>(null); // 视频字幕
  const [subStatus, setSubStatus] = useState<string | null>(null);   // 字幕状态提示
  const [subRunning, setSubRunning] = useState(false);               // 字幕是否运行中(主窗口同步)

  /* Wave 9 外观:翻译页用 floating 外观,字幕页用 subtitle 外观 */
  const [appr, setAppr] = useState<{ theme: string; accent: string; appearance: Record<SurfaceKey, AppearanceItem> } | null>(null);
  const surfaceKey: SurfaceKey = mode === "subtitle" ? "subtitle" : "floating";
  const surfaceKeyRef = useRef<SurfaceKey>(surfaceKey);
  surfaceKeyRef.current = surfaceKey;
  const currentAppr = appr?.appearance[surfaceKey] ?? DEFAULT_APPEARANCE[surfaceKey];
  const setSurfaceOpacity = (v: number) => {
    const base = appr ?? { theme: "light", accent: "", appearance: DEFAULT_APPEARANCE };
    const next = { theme: base.theme, accent: base.accent ?? "", appearance: { ...base.appearance, [surfaceKey]: { ...base.appearance[surfaceKey], opacity: v } } };
    setAppr(next);
    applyWindowTheme(surfaceKey, next.theme, next.appearance, next.accent);
    invoke("update_appearance", { surface: surfaceKey, patch: { opacity: v } }).catch(() => {});
  };

  /* 加载配置应用本窗外观;接收设置中心广播即时更新 */
  useEffect(() => {
    invoke<any>("load_app_config").then((cfg) => {
      const s = cfg?.settings ?? {};
      const st = { theme: s.theme === "dark" || s.theme === "system" ? s.theme : "light", accent: typeof s.accentColor === "string" ? s.accentColor : "", appearance: mergeAppearance(DEFAULT_APPEARANCE, s.appearance) };
      setAppr(st);
      applyWindowTheme(surfaceKeyRef.current, st.theme, st.appearance, st.accent);
    }).catch(() => {});
    (window as any).__applyAppSettings = (s: any) => {
      const st = { theme: s?.theme === "dark" || s?.theme === "system" ? s.theme : "light", accent: typeof s?.accentColor === "string" ? s.accentColor : "", appearance: mergeAppearance(DEFAULT_APPEARANCE, s?.appearance) };
      setAppr(st);
      applyWindowTheme(surfaceKeyRef.current, st.theme, st.appearance, st.accent);
    };
    return () => { delete (window as any).__applyAppSettings; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /* 翻译页/字幕页切换时按当前界面重新应用外观 */
  useEffect(() => {
    if (appr) applyWindowTheme(surfaceKey, appr.theme, appr.appearance, appr.accent);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, appr]);

  useEffect(() => {
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
    return () => { u.then((f) => f()); s.then((f) => f()); c.then((f) => f()); st.then((f) => f()); ss.then((f) => f()); sr.then((f) => f()); };
  }, []);

  const closeFloating = async () => {
    setTrans(null);
    await appWindow.emitTo("main", "floating-closed");
    await appWindow.hide();
  };

  return (
    <div className="floating-root">
      <div className="floating-card">
        <div className="floating-bar" onMouseDown={() => appWindow.startDragging()}>
          <span className="floating-title">{mode === "subtitle" ? "字幕" : "翻译"}</span>
          <div className="floating-actions">
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
              <Icon name="film" size={13} />
            </button>
            <button className="floating-btn" title="调整字幕区域" onMouseDown={(e) => e.stopPropagation()}
              onClick={() => { invoke("open_screenshot_overlay", { from: "subtitle" }).catch(() => {}); }}>
              <Icon name="target" size={13} />
            </button>
            <button className="floating-btn" title="截图翻译" onMouseDown={(e) => e.stopPropagation()}
              onClick={async () => { try { await invoke("open_screenshot_overlay", { from: "floating" }); } catch {} }}>
              <Icon name="camera" size={13} />
            </button>
            <button
              className="floating-btn"
              title="设置"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => setShowSettings(!showSettings)}
            >
              <Icon name="settings" size={13} />
            </button>
            <button className="floating-close" title="关闭" onMouseDown={(e) => e.stopPropagation()} onClick={closeFloating}><Icon name="close" size={12} /></button>
          </div>
        </div>

        {showSettings && (
          <div className="floating-settings">
            <label>
              透明度
              <input type="range" min="0" max="100" value={Math.round(currentAppr.opacity)} onChange={(e) => setSurfaceOpacity(Number(e.target.value))} />
            </label>
          </div>
        )}

        <div className="floating-body">
          {mode === "subtitle" ? (
            subStatus ? (
              <div className="floating-status">{subStatus}</div>
            ) : subtitle ? (
              <div className="floating-trans floating-subtitle">
                <div className="floating-src">{subtitle.text}</div>
                {subtitle.result && (<><div className="floating-divider" /><div className="floating-result">{subtitle.result}</div></>)}
              </div>
            ) : (
              <div className="floating-hint">
                <p>视频字幕</p>
                <span>在主窗口点击「视频字幕」开始字幕识别</span>
              </div>
            )
          ) : status ? (
            <div className="floating-status">{status}</div>
          ) : trans ? (
            <div className="floating-trans">
              <div className="floating-src">{trans.text}</div>
              <div className="floating-divider" />
              <div className="floating-result">{trans.result}</div>
            </div>
          ) : (
            <div className="floating-hint">
              <p>复制即译</p>
              <span>复制任意文字,自动翻译</span>
            </div>
          )}
        </div>
        <div className="floating-resize-zone" onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); invoke("floating_resize_begin", { kind: "floating" }).catch(() => {}); }} title="拖动右下角调整窗口大小" />
      </div>
    </div>
  );
}

/* ============ 音频字幕独立语音窗(第7波) ============ */
/* 与视频字幕窗分开:单独窗口,透明/置顶/可拖动,专显示音频识别原文+译文 */
/* 电脑音频窗(label=audio-floating)与麦克风窗(label=audio-floating-mic)共用本组件 */
function AudioFloatingWindow() {
  const source = appWindow.label === "audio-floating-mic" ? "mic" : "system";
  const isMic = source === "mic";
  /* 两句显示:hist 保留最近几句(最后一项=当前句,可能为空)。
     译文异步到达时按 text 匹配历史中的句子补上,避免"滚动后句子被覆盖导致译文丢失"。 */
  const [hist, setHist] = useState<{ text: string; result: string }[]>([{ text: "", result: "" }]);
  const [status, setStatus] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  // 断句灵敏度(共享):语言 → 秒
  const [sens, setSens] = useState<Record<string, number>>({});

  /* Wave 9 外观:电脑音频窗用 audio 外观,麦克风窗用 audioMic 外观 */
  const [appr, setAppr] = useState<{ theme: string; accent: string; appearance: Record<SurfaceKey, AppearanceItem> } | null>(null);
  const surfaceKey: SurfaceKey = isMic ? "audioMic" : "audio";
  const currentAppr = appr?.appearance[surfaceKey] ?? DEFAULT_APPEARANCE[surfaceKey];
  const setSurfaceOpacity = (v: number) => {
    const base = appr ?? { theme: "light", accent: "", appearance: DEFAULT_APPEARANCE };
    const next = { theme: base.theme, accent: base.accent ?? "", appearance: { ...base.appearance, [surfaceKey]: { ...base.appearance[surfaceKey], opacity: v } } };
    setAppr(next);
    applyWindowTheme(surfaceKey, next.theme, next.appearance, next.accent);
    invoke("update_appearance", { surface: surfaceKey, patch: { opacity: v } }).catch(() => {});
  };

  /* 加载配置应用本窗外观;接收设置中心广播即时更新 */
  useEffect(() => {
    invoke<any>("load_app_config").then((cfg) => {
      const s = cfg?.settings ?? {};
      const st = { theme: s.theme === "dark" || s.theme === "system" ? s.theme : "light", accent: typeof s.accentColor === "string" ? s.accentColor : "", appearance: mergeAppearance(DEFAULT_APPEARANCE, s.appearance) };
      setAppr(st);
      applyWindowTheme(surfaceKey, st.theme, st.appearance, st.accent);
    }).catch(() => {});
    (window as any).__applyAppSettings = (s: any) => {
      const st = { theme: s?.theme === "dark" || s?.theme === "system" ? s.theme : "light", accent: typeof s?.accentColor === "string" ? s.accentColor : "", appearance: mergeAppearance(DEFAULT_APPEARANCE, s?.appearance) };
      setAppr(st);
      applyWindowTheme(surfaceKey, st.theme, st.appearance, st.accent);
    };
    return () => { delete (window as any).__applyAppSettings; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (appr) applyWindowTheme(surfaceKey, appr.theme, appr.appearance, appr.accent);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appr]);

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
    const now = Date.now();
    if (now - sensThrottleRef.current < 100) return;
    sensThrottleRef.current = now;
    setSens((prev) => ({ ...prev, [lang]: v }));
    invoke("audio_set_sensitivity", { lang, value: v }).catch(() => {});
  };
  const applySens = (lang: string) => {
    invoke("audio_apply_sensitivity", { lang }).catch(() => {});
  };

  useEffect(() => {
    // Rust 侧通过 eval 调用 window.__audioShow(payload) 注入定稿/译文数据:
    //   result 为空 = 一句定稿开始翻译 → 当前句滚入历史(成为上一句),追加空的当前句;
    //   result 非空 = 译文完成 → 按 text 匹配历史中的句子补上译文(即使期间又滚动了也不丢)。
    const show = (p: { text: string; src: string; tgt: string; result: string; role?: string }) => {
      if (!p.text) { setHist([{ text: "", result: "" }]); setStatus(null); return; } // 空 payload = 清空,准备下一句
      if (!p.result) {
        // 定稿:当前句(用 final 完整文本)滚为上一句,追加空的当前句;
        // 不能压入 {text:p.text} 副本——那会让"第一句=第二句"重复。
        setHist((h) => {
          const rest = h.slice(0, -1);
          const cur = h[h.length - 1];
          const finalized = { text: p.text, result: cur && cur.text === p.text ? cur.result : "" };
          return [...rest, finalized, { text: "", result: "" }].slice(-3);
        });
      } else {
        // 译文完成:按角色直接更新(不依赖 text 匹配——识别增量变化快,匹配会导致译文丢失/滞后)
        if (p.role === "prev") {
          setHist((h) => {
            if (h.length < 2) return h;
            const i = h.length - 2; // 上一句(定稿句)
            return h.map((x, j) => (j === i ? { ...x, result: p.result } : x));
          });
        } else {
          setHist((h) => {
            const i = h.length - 1; // 当前句
            if (!h[i].text) return h; // 当前句为空(刚定稿滚动)时丢弃 partial 译文,等 final 翻译补
            return h.map((x, j) => (j === i ? { ...x, result: p.result } : x));
          });
        }
      }
      setStatus(null);
    };
    (window as any).__audioShow = show;
    // Rust 实时转发 partial:正在识别的一句原文实时增长
    (window as any).__audioPartial = (text: string) => {
      // 更新最后一项(当前句)的原文
      setHist((h) => {
        if (h.length === 0) return [{ text, result: "" }];
        const last = h[h.length - 1];
        return [...h.slice(0, -1), { ...last, text }];
      });
      setStatus(null);
    };
    const u = appWindow.listen<{ text: string; src: string; tgt: string; result: string }>(
      "audio-show-translation",
      (e) => show(e.payload)
    );
    const s = appWindow.listen<string>(
      "audio-floating-status",
      (e) => setStatus(e.payload)
    );
    const c = appWindow.listen("audio-close-me", () => {
      setHist([{ text: "", result: "" }]);
      closeAndStop();
    });
    return () => {
      u.then((f) => f()); s.then((f) => f()); c.then((f) => f());
      delete (window as any).__audioShow;
      delete (window as any).__audioPartial;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* 关闭语音窗并同步停止音频字幕 */
  const closeAndStop = () => {
    setHist([{ text: "", result: "" }]);
    // 通知主窗口更新状态(音频字幕已关)
    appWindow.emitTo("main", "audio-floating-closed", { source }).catch(() => {});
    invoke("close_audio_floating_window", { source }).catch(() => {});
    invoke("audio_subtitle_stop", { source }).catch(() => {});
  };

  /* 拖动:调用 Rust GetCursorPos 增量轮询(系统层,跟手;startDragging 对本窗口无效) */

  return (
    <div className="floating-root">
      <div className="floating-card">
        <div className="floating-bar" onMouseDown={(e) => { if (!(e.target as HTMLElement).closest(".floating-actions")) { e.preventDefault(); invoke("audio_floating_drag_begin", { source }).catch(() => {}); } }}>
          <span className="floating-title"><Icon name="mic" size={13} /> {isMic ? "麦克风" : "电脑音频"}</span>
          <div className="floating-actions">
            <button
              className="floating-btn"
              title="设置"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => setShowSettings(!showSettings)}
            >
              <Icon name="settings" size={13} />
            </button>
            <button className="floating-close" title="关闭" onMouseDown={(e) => e.stopPropagation()}
              onClick={closeAndStop}><Icon name="close" size={12} /></button>
          </div>
        </div>

        {showSettings && (
          <div className="floating-settings">
            <label>
              透明度
              <input type="range" min="0" max="100" value={Math.round(currentAppr.opacity)} onChange={(e) => setSurfaceOpacity(Number(e.target.value))} />
            </label>
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
                  onPointerUp={() => applySens(code)}
                  title="停顿多久算一句结束(秒):数值越小越敏感"
                />
                <b>{(sens[code] ?? 1.2).toFixed(1)}s</b>
              </label>
            ))}
          </div>
        )}

        <div className="floating-body">
          {status ? (
            <div className="floating-status">{status}</div>
          ) : hist.length === 1 && !hist[0].text ? (
            <div className="floating-hint">
              <p><Icon name="mic" size={18} /> 音频识别</p>
              <span>在主窗口点击「音频翻译」开始音频字幕</span>
            </div>
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
                {hist[hist.length - 1].text && (
                  <div className="voice-line voice-line-cur">
                    {hist[hist.length - 1].text}
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
                {hist[hist.length - 1].result && (
                  <div className="voice-line voice-line-cur voice-line-result">
                    {hist[hist.length - 1].result}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
        <div className="floating-resize-zone" onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); invoke("floating_resize_begin", { kind: isMic ? "audioMic" : "audio" }).catch(() => {}); }} title="拖动右下角调整窗口大小" />
      </div>
    </div>
  );
}

/* ============ 截图覆盖层 ============ */
function ScreenshotOverlay() {
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
    const W = window.innerWidth, H = window.innerHeight;

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
    const toPhys = (v: number) => Math.round(v * (bgPhysRef.current.w / W));

    /* 收到 overlay-start 时初始化;from 由 Rust 事件传入 */
    const start = async (payload: string) => {
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
      invoke<string>("capture_fullscreen")
        .then((b64) => {
          if (loadTokenRef.current !== token) return;
          const img = new Image();
          img.onload = () => {
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

    /* 隐藏而非关闭:窗口启动时已预建,保留复用 */
    const hide = () => { appWindow.hide(); };
    const cancel = () => hide();

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
      const y = toPhys(Math.min(sy, ey));
      const w = toPhys(Math.abs(ex - sx));
      const h = toPhys(Math.abs(ey - sy));
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
      appWindow.emitTo("main", "screenshot-done", { x, y, w, h, source: sourceRef.current, b64 });
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
      u.then((f) => f());
      c.removeEventListener("mousedown", onDown);
      c.removeEventListener("mousemove", onMove);
      c.removeEventListener("mouseup", onUp);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("keydown", onKey);
      c.removeEventListener("contextmenu", onCtx);
    };
  }, []);

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
  const [label, setLabel] = useState<string>("main");
  useEffect(() => { setLabel(appWindow.label); }, []);

  if (label === "floating") return <FloatingWindow />;
  if (label === "audio-floating" || label === "audio-floating-mic") return <AudioFloatingWindow />;
  if (label === "screenshot-overlay") return <ScreenshotOverlay />;
  return <MainWindow />;
}

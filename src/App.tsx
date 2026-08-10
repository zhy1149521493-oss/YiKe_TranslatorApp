import { useEffect, useRef, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { register } from "@tauri-apps/plugin-global-shortcut";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import "./App.css";

const appWindow = getCurrentWebviewWindow();

/* ============ 常量 ============ */
const OLLAMA_API = "http://127.0.0.1:11434/api/generate";
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

function buildPrompt(
  source: string,
  target: string,
  text: string
): string {
  const srcName = LANG_MAP[source] || source;
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

/* ============ 主窗口 ============ */
function MainWindow() {
  const [floatingOpen, setFloatingOpen] = useState(false);
  const [input, setInput] = useState("");
  const [sourceLang, setSourceLang] = useState("auto");
  const [targetLang, setTargetLang] = useState("en");
  const [output, setOutput] = useState("");
  const [translating, setTranslating] = useState(false);
  const [model, setModel] = useState("maternion/hy-mt2:1.8b");
  const [numCtx, setNumCtx] = useState(1024);
  const [streamOn, setStreamOn] = useState(true);
  const [conflict, setConflict] = useState(false);
  const [clipAuto, setClipAuto] = useState(true); // true=复制即开,false=仅悬浮窗打开时翻译

  const abortRef = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef(input);
  inputRef.current = input;

  const floatingRef = useRef(false);
  useEffect(() => { floatingRef.current = floatingOpen; }, [floatingOpen]);

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
  const openFloating = async () => {
    try {
      await invoke("open_floating_window");
      setFloatingOpen(true);
    } catch (e) {
      console.error(e);
    }
  };

  /* ---- 翻译核心 ---- */
  const runTranslation = useCallback(
    async (text: string) => {
      if (!text.trim() || busyRef.current) {
        if (!text.trim()) setOutput("");
        return;
      }
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
        setOutput("");
        try {
          await fetchOllamaStream(model, src, tgt, text, numCtx, (token) =>
            setOutput((prev) => prev + token),
            ctrl.signal
          );
        } catch (e: any) {
          if (e.name !== "AbortError")
            setOutput((prev) => prev + "\n\n❌ " + e.message);
        } finally {
          busyRef.current = false;
          setTranslating(false);
        }
      } else {
        setOutput("⏳ 翻译中...");
        try {
          const result = await fetchOllamaFull(model, src, tgt, text, numCtx);
          if (!ctrl.signal.aborted) setOutput(result);
        } catch (e: any) {
          setOutput("❌ 翻译失败:" + e.message);
        } finally {
          busyRef.current = false;
          setTranslating(false);
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

  /* ---- 划词快捷键:开关悬浮窗 ---- */
  useEffect(() => {
    let unreg: (() => void) | null = null;
    register("CommandOrControl+Shift+D", async (e) => {
      if (e.state !== "Pressed") return;
      if (floatingRef.current) {
        await invoke("close_floating_window");
        setFloatingOpen(false);
      } else {
        await invoke("open_floating_window");
        setFloatingOpen(true);
      }
    }).then((fn) => { unreg = fn; });
    return () => { unreg?.(); };
  }, []);

  /* ---- 截图快捷键 ---- */
  useEffect(() => {
    let unreg: (() => void) | null = null;
    register("CommandOrControl+Shift+S", async (e) => {
      if (e.state !== "Pressed") return;
      try { await invoke("open_screenshot_overlay"); } catch {}
    }).then((fn) => { unreg = fn; });
    return () => { unreg?.(); };
  }, []);

  /* ---- 截图 ---- */
  const startScreenshot = async () => {
    try { await invoke("open_screenshot_overlay"); } catch (e) { console.error(e); }
  };

  /* ---- 截图结果监听:主窗口接收坐标 → OCR → 翻译 → 发悬浮窗 ---- */
  useEffect(() => {
    const u = appWindow.listen<{ x: number; y: number; w: number; h: number }>(
      "screenshot-done",
      async (e) => {
        try {
          const { x, y, w, h } = e.payload;
          const ocrText = await invoke<string>("screenshot_ocr", { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) });
          if (!ocrText.trim()) {
            try { await appWindow.emitTo("floating", "show-translation", { text: "", src: "", tgt: "", result: "⚠️ 未识别到文字" }); } catch {}
            return;
          }
          let src = sourceLang;
          let tgt = targetLang;
          if (src === "auto") { src = detectLang(ocrText); }
          if (src === tgt) tgt = src === "zh" ? "en" : "zh";
          const result = await fetchOllamaFull(model, src, tgt, ocrText, numCtx);
          setOutput(`[OCR]\n${ocrText}\n\n[翻译]\n${result}`);
          try { await invoke("open_floating_window"); setFloatingOpen(true); } catch {}
          await appWindow.emitTo("floating", "show-translation", { text: ocrText, src, tgt, result });
        } catch (e: any) {
          setOutput(`❌ 截图翻译失败: ${e}`);
          try { await appWindow.emitTo("floating", "show-translation", { text: "", src: "", tgt: "", result: `❌ 截图翻译失败: ${e}` }); } catch {}
        }
      }
    );
    return () => { u.then((f) => f()); };
  }, [model, sourceLang, targetLang, numCtx]);

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
        const result = await fetchOllamaFull(model, src, tgt, text, 1024);
        await appWindow.emitTo("floating", "show-translation", { text, src, tgt, result });
      } catch {
        /* ignore */
      } finally {
        busy = false;
      }
    }, 600);
    return () => clearInterval(timer);
  }, [sourceLang, targetLang, model, clipAuto]);

  /* ---- UI ---- */
  return (
    <div className="app-main">
      <header className="app-header">
        <h1>本地翻译助手</h1>
        <div className="toolbar-right">
          <select className="tool-select" value={model} onChange={(e) => setModel(e.target.value)} title="选择翻译模型">
            <option value="maternion/hy-mt2:1.8b">HY-MT2-1.8B (翻译专用)</option>
            <option value="gemma3:4b">gemma3:4b (本地)</option>
            <option value="qwen3:4b">qwen3:4b (本地)</option>
          </select>
          <select className="tool-select" value={numCtx} onChange={(e) => setNumCtx(Number(e.target.value))} title="上下文窗口">
            {CTX_OPTIONS.map((n) => <option key={n} value={n}>上下文 {n}</option>)}
          </select>
          <select className="tool-select" value={streamOn ? "stream" : "full"} onChange={(e) => setStreamOn(e.target.value === "stream")} title="输出模式">
            <option value="stream">流式输出</option>
            <option value="full">完整输出</option>
          </select>
          <button className="btn-float" onClick={() => setClipAuto(!clipAuto)} title={clipAuto ? "复制即开(点击切换为手动)" : "手动模式(点击切换为自动)"}>
            {clipAuto ? "📋 自动" : "📋 手动"}
          </button>
          <button className="btn-float" onClick={startScreenshot} title="截图翻译">
            📷
          </button>
          <button className="btn-float" onClick={openFloating} title="打开翻译悬浮窗">
            {floatingOpen ? "📍 已开" : "🔲 悬浮窗"}
          </button>
        </div>
      </header>

      <main className="app-body">
        {/* 语言选择: 源 → 目标 */}
        <div className="lang-bar">
          <select className="lang-sel" value={sourceLang} onChange={(e) => setSourceLang(e.target.value)}>
            {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
          <span className="lang-arrow" onClick={swapLangs} title="交换语言方向">⇄</span>
          <select className="lang-sel" value={targetLang} onChange={(e) => setTargetLang(e.target.value)}>
            {LANGS.filter((l) => l.code !== "auto").map((l) => (
              <option key={l.code} value={l.code}>{l.label}</option>
            ))}
          </select>
          <span className="realtime-hint">{translating ? "⏳" : "✓"} 实时翻译</span>
          <button className="btn-primary" onClick={() => runTranslation(input)} disabled={translating || !input.trim()} title="强制手动重译">
            重译
          </button>
        </div>

        <textarea
          className="trans-input"
          placeholder="输入文字,自动翻译..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={5}
        />

        {conflict && !translating && output && (
          <div className="conflict-bar">
            <span>检测到原文已是目标语言,需要交换翻译方向吗?</span>
            <button className="btn-conflict" onClick={() => { setConflict(false); swapLangs(); }}>交换</button>
            <button className="btn-conflict-dismiss" onClick={() => setConflict(false)}>忽略</button>
          </div>
        )}
        <div className="trans-output">
          <div className="output-label">译文 {translating && <span className="pulse">●</span>}</div>
          <div className="output-text">{output || (translating ? "" : "输入后自动翻译...")}</div>
        </div>
      </main>
    </div>
  );
}

/* ============ 悬浮窗 ============ */
function FloatingWindow() {
  const [trans, setTrans] = useState<{ text: string; src: string; tgt: string; result: string } | null>(null);
  const [opacity, setOpacity] = useState(0.88);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    const u = appWindow.listen<{ text: string; src: string; tgt: string; result: string }>(
      "show-translation",
      (e) => setTrans(e.payload)
    );
    const c = appWindow.listen("close-me", () => closeFloating());
    return () => { u.then((f) => f()); c.then((f) => f()); };
  }, []);

  const closeFloating = async () => {
    setTrans(null);
    await appWindow.emit("floating-closed");
    await appWindow.close();
  };

  return (
    <div className="floating-root">
      <div className="floating-card" style={{ opacity }}>
        <div className="floating-bar" onMouseDown={() => appWindow.startDragging()}>
          <span className="floating-title">翻译</span>
          <div className="floating-actions">
            <button className="floating-btn" title="截图翻译" onMouseDown={(e) => e.stopPropagation()}
              onClick={async () => { try { await invoke("open_screenshot_overlay"); } catch {} }}>
              📷
            </button>
            <button
              className="floating-btn"
              title="设置"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => setShowSettings(!showSettings)}
            >
              ⚙
            </button>
            <button className="floating-close" title="关闭" onMouseDown={(e) => e.stopPropagation()} onClick={closeFloating}>✕</button>
          </div>
        </div>

        {showSettings && (
          <div className="floating-settings">
            <label>
              透明度
              <input type="range" min="30" max="100" value={Math.round(opacity * 100)} onChange={(e) => setOpacity(Number(e.target.value) / 100)} />
            </label>
          </div>
        )}

        <div className="floating-body">
          {trans ? (
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
      </div>
    </div>
  );
}

/* ============ 截图覆盖层 ============ */
function ScreenshotOverlay() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rect = useRef({ sx: 0, sy: 0, ex: 0, ey: 0 });
  const drawing = useRef(false);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    c.width = window.innerWidth;
    c.height = window.innerHeight;

    /* 初始遮罩 */
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(0, 0, c.width, c.height);

    const cancel = () => appWindow.close();

    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      rect.current = { sx: e.clientX, sy: e.clientY, ex: e.clientX, ey: e.clientY };
      drawing.current = true;
    };
    const onMove = (e: MouseEvent) => {
      if (!(e.buttons & 1)) { onUp(); return; }
      if (!drawing.current) return;
      rect.current.ex = e.clientX;
      rect.current.ey = e.clientY;
      /* 每帧先清空再重绘,避免叠加变黑 */
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(0, 0, c.width, c.height);
      const rx = Math.min(rect.current.sx, rect.current.ex);
      const ry = Math.min(rect.current.sy, rect.current.ey);
      const rw = Math.abs(rect.current.ex - rect.current.sx);
      const rh = Math.abs(rect.current.ey - rect.current.sy);
      ctx.clearRect(rx, ry, rw, rh);
      ctx.strokeStyle = "#007aff";
      ctx.lineWidth = 2;
      ctx.strokeRect(rx, ry, rw, rh);
    };
    const onUp = () => {
      if (!drawing.current) return;
      drawing.current = false;
      const { sx, sy, ex, ey } = rect.current;
      const dpr = window.devicePixelRatio || 1;
      const x = Math.min(sx, ex) * dpr;
      const y = Math.min(sy, ey) * dpr;
      const w = Math.abs(ex - sx) * dpr;
      const h = Math.abs(ey - sy) * dpr;
      if (w < 10 || h < 10) { appWindow.close(); return; }
      appWindow.emitTo("main", "screenshot-done", { x, y, w, h });
      appWindow.close();
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
      c.removeEventListener("mousedown", onDown);
      c.removeEventListener("mousemove", onMove);
      c.removeEventListener("mouseup", onUp);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("keydown", onKey);
      c.removeEventListener("contextmenu", onCtx);
    };
  }, []);

  return <canvas ref={canvasRef} style={{ width: "100vw", height: "100vh", display: "block", cursor: "crosshair" }} />;
}

/* ============ 应用路由 ============ */
export default function App() {
  const [label, setLabel] = useState<string>("main");
  useEffect(() => { setLabel(appWindow.label); }, []);

  if (label === "floating") return <FloatingWindow />;
  if (label === "screenshot-overlay") return <ScreenshotOverlay />;
  return <MainWindow />;
}


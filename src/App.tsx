import { useEffect, useRef, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
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

/* 字符级 Jaccard 相似度:用于视频字幕去重(同一句被连续截到多次时跳过) */
function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const sa = new Set(a.replace(/\s+/g, ""));
  const sb = new Set(b.replace(/\s+/g, ""));
  let inter = 0;
  for (const ch of sa) if (sb.has(ch)) inter++;
  return inter / Math.max(sa.size, sb.size);
}

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
  const [clipAuto, setClipAuto] = useState(false); // true=复制即开,false=仅悬浮窗打开时翻译

  const abortRef = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const screenshotSource = useRef<string>("main"); // 截图发起方: main=桌面端 / floating=悬浮窗
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef(input);
  inputRef.current = input;

  const floatingRef = useRef(false);
  useEffect(() => { floatingRef.current = floatingOpen; }, [floatingOpen]);

  /* ===== 视频实时字幕(第 6 波 3.4/3.5) ===== */
  const [subtitleOn, setSubtitleOn] = useState(false);          // 字幕开关
  const [subFps, setSubFps] = useState(2);                      // 截帧频率 1-5 次/秒
  const [subMode, setSubMode] = useState<"trans-first" | "ocr-first">("trans-first"); // 翻译优先/原文优先
  const [subEngine, setSubEngine] = useState<"win" | "rapid">("win"); // 字幕 OCR 引擎:win=系统OCR(快)/rapid=RapidOCR
  const [subStatus, setSubStatus] = useState("");               // 字幕状态提示
  const [subRegion, setSubRegion] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [subCurrent, setSubCurrent] = useState<{ text: string; result: string } | null>(null); // 当前字幕(主窗口显示)

  const subRegionRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
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
    setSubStatus("🟢 字幕运行中,区域: " + (subRegionRef.current ? `(${subRegionRef.current.x},${subRegionRef.current.y} ${subRegionRef.current.w}x${subRegionRef.current.h})` : "未设置"));
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
      let src = sourceLang;
      let tgt = targetLang;
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
      await fetchOllamaStream(model, src, tgt, text, numCtx, (tok) => {
        result += tok;
        const p = { text, result };
        appWindow.emitTo("floating", "subtitle-text", p).catch(() => {});
        setSubCurrent(p);
      });
      if (!result.trim()) result = "(空响应)";
      const p = { text, result };
      await appWindow.emitTo("floating", "subtitle-text", p).catch(() => {});
      setSubCurrent(p);
      setSubStatus("");
    } catch (e: any) {
      setSubStatus(`❌ 翻译失败: ${e}`);
    } finally {
      subTranslatingRef.current = false;
      // 翻译期间来了新句子:翻译最新的(跳过中间态)
      if (subDirtyRef.current && subPendingRef.current) {
        const t = subPendingRef.current;
        subPendingRef.current = "";
        submitSubtitle(t);
      }
    }
  }, [model, sourceLang, targetLang, numCtx]);

  /* 字幕 OCR 结果:去重 → 句子稳定(300ms 去抖)→ 提交翻译 */
  const handleSubtitleOcr = useCallback((text: string) => {
    if (!text.trim() || text.startsWith("ERROR:")) {
      if (text.startsWith("ERROR:")) setSubStatus(`⚠️ 字幕OCR: ${text.slice(7, 150)}`); // 错误可见,不再静默
      return;
    }
    if (similarity(text, lastSubOcrRef.current) >= 0.9) return;   // 同一句连续帧,跳过
    lastSubOcrRef.current = text;
    if (text === lastSubTranslatedRef.current) return;            // 已翻译过,跳过
    // 去抖:字幕逐字增长(Hello→Hello World→...),等句子稳定再翻,避免中间态反复翻译
    if (subDebounceRef.current) clearTimeout(subDebounceRef.current);
    subPendingRef.current = text;
    subDebounceRef.current = setTimeout(() => {
      const t = subPendingRef.current;
      if (!t) return;
      submitSubtitle(t);
    }, 300);
  }, [submitSubtitle]);

  const subtitleOcrHandlerRef = useRef(handleSubtitleOcr);
  useEffect(() => { subtitleOcrHandlerRef.current = handleSubtitleOcr; }, [handleSubtitleOcr]);

  /* 切换字幕开关(Ctrl+Shift+U、主界面按钮、悬浮窗按钮共用);
     开启时自动弹出悬浮窗并同步状态,悬浮窗切到字幕页 */
  const toggleSubtitle = useCallback(() => {
    setSubtitleOn((on) => {
      const next = !on;
      if (next) {
        ensureSubRegion();
        invoke("open_floating_window").catch(() => {});
        setFloatingOpen(true);
        appWindow.emitTo("floating", "subtitle-state", "on").catch(() => {});
      } else {
        appWindow.emitTo("floating", "subtitle-state", "off").catch(() => {});
      }
      return next;
    });
  }, []);

  const toggleSubtitleRef = useRef(toggleSubtitle);
  useEffect(() => { toggleSubtitleRef.current = toggleSubtitle; }, [toggleSubtitle]);

  /* Windows 系统 OCR PoC 测试:截全屏 → 系统 OCR → 显示结果 */
  const testWinOcr = async () => {
    setSubStatus("⏳ 系统 OCR 测试中…");
    try {
      const b64 = await invoke<string>("capture_fullscreen");
      const text = await invoke<string>("win_ocr_b64", { b64 });
      setSubStatus(`🧪 系统 OCR 成功: ${text.slice(0, 120) || "(无文字)"}`);
    } catch (e: any) {
      const msg = typeof e === "string" ? e : JSON.stringify(e);
      setSubStatus(`🧪 系统 OCR 失败: ${msg}`);
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
    const t = appWindow.listen("subtitle-toggle", () => { toggleSubtitleRef.current(); }); // 悬浮窗 🎬 按钮
    return () => { u.then((f) => f()); t.then((f) => f()); };
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
          setSubStatus(`🎯 字幕区域已更新 (${region.x},${region.y} ${region.w}x${region.h})`);
          return;
        }
        // 状态提示按来源路由:悬浮窗截图 → 悬浮窗显示;桌面端截图 → 主窗口显示
        if (source === "floating") {
          appWindow.emitTo("floating", "screenshot-status", "⏳ 正在 OCR 识别…").catch(() => {});
        } else {
          setOutput("⏳ 正在 OCR 识别…");
        }
        // 优先用 overlay 从缓存背景图裁剪的选区(b64,不二次截屏,避免残影);否则回退截屏
        if (e.payload.b64) {
          invoke<string>("ocr_image_b64", { b64: e.payload.b64 })
            .then((text) => { handleOcrResult(source, text); })   // 直接接返回值(同步 command)
            .catch((err: any) => {
              const msg = typeof err === "string" ? err : JSON.stringify(err);
              console.error("ocr_image_b64 失败:", err);
              if (source === "floating") {
                appWindow.emitTo("floating", "screenshot-status", `❌ OCR 失败: ${msg}`).catch(() => {});
              } else {
                setOutput(`❌ OCR 失败: ${msg}`);
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
          setOutput(msg);
        }
      };
      if (!ocrText || ocrText.startsWith("ERROR:")) {
        showStatus("⚠️ " + (ocrText || "未识别到文字"));
        return;
      }
      if (!ocrText.trim()) { showStatus("⚠️ 未识别到文字"); return; }
      let src = sourceLang;
      let tgt = targetLang;
      if (src === "auto") { src = detectLang(ocrText); }
      if (src === tgt) tgt = src === "zh" ? "en" : "zh";
      showStatus("⏳ 正在翻译…");
      try {
        const result = await fetchOllamaFull(model, src, tgt, ocrText, numCtx);
        if (source === "floating") {
          await appWindow.emitTo("floating", "show-translation", { text: ocrText, src, tgt, result }).catch(() => {});
        } else {
          setOutput(`[OCR]\n${ocrText}\n\n[翻译]\n${result}`);
        }
      } catch (e: any) {
        showStatus(`❌ 翻译失败: ${e}`);
      }
    };
    const o = appWindow.listen<string>(
      "ocr-done",
      (e) => { handleOcrResult(screenshotSource.current, e.payload); }
    );
    return () => { u.then((f) => f()); o.then((f) => f()); };
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
          <button className={`btn-float${subtitleOn ? " active" : ""}`} onClick={toggleSubtitle} title="视频实时字幕 (Ctrl+Shift+U)">
            {subtitleOn ? "🎬 字幕开" : "🎬 字幕"}
          </button>
          <button className="btn-float" onClick={openFloating} title="打开翻译悬浮窗">
            {floatingOpen ? "📍 已开" : "🔲 悬浮窗"}
          </button>
        </div>
      </header>

      <main className="app-body">
        {/* 视频实时字幕控制面板 */}
        <div className={`subtitle-panel${subtitleOn ? " on" : ""}`}>
          <div className="subtitle-panel-row">
            <span className="subtitle-label">🎬 视频字幕</span>
            <span className={`subtitle-status${subtitleOn ? " live" : ""}`}>
              {subtitleOn ? "● 运行中" : "○ 已停止"} {subStatus && <em className="subtitle-msg">· {subStatus}</em>}
            </span>
            <button className="btn-float" onClick={toggleSubtitle} title="开关视频字幕 (Ctrl+Shift+U)">
              {subtitleOn ? "停止" : "开始"}
            </button>
            <button className="btn-float" onClick={() => invoke("open_screenshot_overlay", { from: "subtitle" }).catch(() => {})} title="框选字幕识别区域(默认屏幕底部 1/4)">
              🎯 调整区域
            </button>
            <button className="btn-float" onClick={testWinOcr} title="测试 Windows 系统 OCR(独立引擎,不影响 RapidOCR)">
              🧪 系统OCR测试
            </button>
          </div>
          <div className="subtitle-panel-row">
            <label className="subtitle-fps">
              截帧频率
              <input type="range" min="1" max="5" value={subFps} onChange={(e) => setSubFps(Number(e.target.value))} />
              <b>{subFps} 次/秒</b>
            </label>
            <label className="subtitle-mode">
              显示策略
              <select value={subMode} onChange={(e) => setSubMode(e.target.value as "trans-first" | "ocr-first")} title="翻译优先=只显示译文;原文优先=先显示原文,译文好了替换">
                <option value="trans-first">翻译优先</option>
                <option value="ocr-first">原文优先</option>
              </select>
            </label>
            <label className="subtitle-mode">
              OCR引擎
              <select value={subEngine} onChange={(e) => setSubEngine(e.target.value as "win" | "rapid")} title="win=Windows系统OCR(快,需系统语言包);rapid=RapidOCR(离线模型)">
                <option value="win">系统OCR(快)</option>
                <option value="rapid">RapidOCR</option>
              </select>
            </label>
            {subRegion && <span className="subtitle-region">区域: ({subRegion.x},{subRegion.y} {subRegion.w}×{subRegion.h})</span>}
          </div>
          {subCurrent && (
            <div className="subtitle-current">
              <div className="subtitle-current-src">{subCurrent.text}</div>
              {subCurrent.result && <div className="subtitle-current-result">{subCurrent.result}</div>}
            </div>
          )}
        </div>

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
  const [status, setStatus] = useState<string | null>(null);
  const [opacity, setOpacity] = useState(0.88);
  const [showSettings, setShowSettings] = useState(false);
  const [mode, setMode] = useState<"trans" | "subtitle">("trans");   // 翻译页 / 字幕页
  const [subtitle, setSubtitle] = useState<{ text: string; result: string } | null>(null); // 视频字幕
  const [subStatus, setSubStatus] = useState<string | null>(null);   // 字幕状态提示
  const [subRunning, setSubRunning] = useState(false);               // 字幕是否运行中(主窗口同步)

  useEffect(() => {
    const u = appWindow.listen<{ text: string; src: string; tgt: string; result: string }>(
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
      <div className="floating-card" style={{ opacity }}>
        <div className="floating-bar" onMouseDown={() => appWindow.startDragging()}>
          <span className="floating-title">{mode === "subtitle" ? "字幕" : "翻译"}</span>
          <div className="floating-actions">
            <button className={`floating-btn${subRunning ? " active" : ""}`} title={subRunning ? "停止视频字幕" : "开始视频字幕"} onMouseDown={(e) => e.stopPropagation()}
              onClick={() => {
                if (subRunning) { setMode("trans"); } else { setMode("subtitle"); }
                appWindow.emitTo("main", "subtitle-toggle").catch(() => {}); // 通知主窗口开始/停止
              }}>
              🎬
            </button>
            <button className="floating-btn" title="调整字幕区域" onMouseDown={(e) => e.stopPropagation()}
              onClick={() => { invoke("open_screenshot_overlay", { from: "subtitle" }).catch(() => {}); }}>
              🎯
            </button>
            <button className="floating-btn" title="截图翻译" onMouseDown={(e) => e.stopPropagation()}
              onClick={async () => { try { await invoke("open_screenshot_overlay", { from: "floating" }); } catch {} }}>
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
                <span>在主窗口点击 🎬 开始字幕识别</span>
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
  if (label === "screenshot-overlay") return <ScreenshotOverlay />;
  return <MainWindow />;
}


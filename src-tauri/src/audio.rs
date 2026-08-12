//! 第7波:电脑内部音频实时翻译 —— WASAPI loopback 捕获 + sherpa-onnx 流式 ASR
//!
//! 架构:
//! - 捕获线程:WASAPI loopback(系统播放的音频)→ 样本解析(f32/16bit,多声道→单声道)
//!   → LinearResampler(48k/44.1k → 16k)→ 喂给 OnlineStream
//! - 识别线程:accept_waveform + decode + get_result,增量文本变化 emit "audio-partial";
//!   is_endpoint 时 emit "audio-final"(整句定稿)并 reset
//! - 模型:按语言选目录(8语模型管中/英/日,韩语单配),首次运行自动下载
//!
//! 事件(emit 到 main):
//!   audio-status:   "loading" | "ready" | "error:xxx" | "stopped"
//!   audio-partial:  { text: String }  边说边出的增量识别文本
//!   audio-final:    { text: String }  端点检测定稿的一句(触发前端翻译)

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use sherpa_onnx::{LinearResampler, OnlineRecognizer, OnlineRecognizerConfig};
use tauri::{AppHandle, Emitter, Manager};

use windows::core::GUID;
use windows::Win32::Media::Audio::{
    eConsole, eRender, AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK, IAudioCaptureClient,
    IAudioClient, IMMDeviceEnumerator, WAVEFORMATEX, WAVEFORMATEXTENSIBLE,
};
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED};

/// 诊断日志:同时输出到 stderr 与 E:\TranslatorApp\audio_diag.log
/// (GUI 运行时没有控制台,文件日志是采集 stderr 的替代通道;排查完 ENG 问题后应移除)
static DIAG_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn diag_log(msg: &str) {
    eprintln!("{msg}");
    let _g = DIAG_LOCK.lock().unwrap();
    use std::io::Write;
    let p = std::path::Path::new("E:\\TranslatorApp\\audio_diag.log");
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(p) {
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs_f64())
            .unwrap_or(0.0);
        let _ = writeln!(f, "[{ts:.3}] {msg}");
    }
}

/// 全局音频引擎状态:按来源存(电脑音频 / 麦克风),None = 未启动
static AUDIO_ENGINE: std::sync::OnceLock<Mutex<std::collections::HashMap<AudioSource, Arc<AudioEngineInner>>>> =
    std::sync::OnceLock::new();

fn engine() -> std::sync::MutexGuard<'static, std::collections::HashMap<AudioSource, Arc<AudioEngineInner>>> {
    AUDIO_ENGINE
        .get_or_init(|| Mutex::new(std::collections::HashMap::new()))
        .lock()
        .unwrap()
}

/// 音频来源
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum AudioSource {
    /// 电脑内部音频(WASAPI loopback)
    System,
    /// 麦克风(捕获端点)
    Mic,
}

impl AudioSource {
    pub fn as_str(&self) -> &'static str {
        match self {
            AudioSource::System => "system",
            AudioSource::Mic => "mic",
        }
    }

    pub fn from_str(s: &str) -> AudioSource {
        match s {
            "mic" => AudioSource::Mic,
            _ => AudioSource::System,
        }
    }
}

/// 该来源对应的语音窗 label
pub fn window_label(source: AudioSource) -> &'static str {
    match source {
        AudioSource::System => "audio-floating",
        AudioSource::Mic => "audio-floating-mic",
    }
}

/// 断句灵敏度(端点检测):每个语言独立数值(秒),主界面/悬浮窗/设置面板共享
/// 默认:英语语速快用 0.3s,其余 1.2s
static SENSITIVITY: std::sync::OnceLock<Mutex<std::collections::HashMap<String, f32>>> =
    std::sync::OnceLock::new();

fn sensitivity_map() -> std::sync::MutexGuard<'static, std::collections::HashMap<String, f32>> {
    SENSITIVITY
        .get_or_init(|| {
            let mut m = std::collections::HashMap::new();
            m.insert("auto".to_string(), 1.2);
            m.insert("zh".to_string(), 1.2);
            m.insert("en".to_string(), 0.3);
            m.insert("ja".to_string(), 1.2);
            m.insert("ko".to_string(), 1.2);
            Mutex::new(m)
        })
        .lock()
        .unwrap()
}

/// 读取某语言的断句灵敏度(秒)
pub fn get_sensitivity(lang: &str) -> f32 {
    sensitivity_map().get(lang).copied().unwrap_or(1.2)
}

/// 设置某语言的断句灵敏度(秒):存值并广播到主界面/语音窗(联动)
/// 不重启识别器(避免滑块拖动时反复停止);真正生效由 audio_apply_sensitivity 触发
pub fn set_sensitivity(lang: &str, value: f32, app: &AppHandle) {
    let clamped = if value.is_finite() { value.clamp(0.1, 5.0) } else { 1.2 };
    sensitivity_map().insert(lang.to_string(), clamped);
    // 广播到主界面与所有语音窗(用 eval,跨窗口事件不可靠);广播 clamp 后的值,保证两端一致
    let payload = serde_json::json!({ "lang": lang, "value": clamped }).to_string();
    for win in ["main", "audio-floating", "audio-floating-mic"] {
        if let Some(w) = app.get_webview_window(win) {
            let _ = w.eval(&format!("window.__audioSensChanged && window.__audioSensChanged({payload})"));
        }
    }
    eprintln!("[audio] sensitivity {lang}={clamped} stored + broadcast");
}

/// 应用某语言的灵敏度(重启识别器使端点参数生效);由滑块松手时调用,避免拖动过程反复重启
pub fn apply_sensitivity(lang: &str, app: &AppHandle) {
    // 所有运行中的引擎,若其语言匹配则重启
    for (source, e) in engine().clone() {
        let running = e.running.load(Ordering::SeqCst);
        let cur_lang = e.lang.lock().unwrap().clone();
        eprintln!("[audio] apply_sensitivity source={:?} lang={lang} running={running} cur_lang={cur_lang}", source);
        if running && cur_lang == lang {
            eprintln!("[audio] sensitivity applied, restarting recognizer (source={:?} lang={lang})", source);
            stop(source);
            let _ = start(source, &lang, app.clone());
        }
    }
}

/// 获取所有语言的断句灵敏度
pub fn all_sensitivities() -> std::collections::HashMap<String, f32> {
    sensitivity_map().clone()
}

/// ASR 模型目录(E:\TranslatorApp\asr\)
fn asr_base_dir() -> PathBuf {
    PathBuf::from("E:\\TranslatorApp\\asr")
}

/// 语言 → 模型子目录名
/// - 中/英/日 → 8语流式模型(ar/en/id/ja/ru/th/vi/zh)
/// - 韩语 → 单语流式模型
pub fn model_dir_for_lang(lang: &str) -> Option<PathBuf> {
    let base = asr_base_dir();
    match lang {
        "zh" | "en" | "ja" | "auto" => Some(base.join("sherpa-onnx-streaming-zipformer-ar_en_id_ja_ru_th_vi_zh-2025-02-10")),
        "ko" => Some(base.join("sherpa-onnx-streaming-zipformer-korean-2024-06-16")),
        // 其他语言暂不支持音频识别(翻译侧 19 语种不受影响)
        _ => None,
    }
}

/// 从模型目录扫描 encoder/decoder/joiner/tokens 文件(文件名可能带 int8 等后缀)
fn scan_model_files(dir: &std::path::Path) -> Result<(String, String, String, String), String> {
    let mut encoder: Option<PathBuf> = None;
    let mut decoder: Option<PathBuf> = None;
    let mut joiner: Option<PathBuf> = None;
    let mut tokens: Option<PathBuf> = None;
    let entries = std::fs::read_dir(dir)
        .map_err(|e| format!("读取模型目录失败 {}: {e}", dir.display()))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("读取目录项失败: {e}"))?;
        let name = entry.file_name().to_string_lossy().to_string();
        if !entry.path().is_file() {
            continue;
        }
        if name == "tokens.txt" {
            tokens = Some(entry.path());
        } else if name.starts_with("encoder") && name.ends_with(".onnx") {
            // 优先 int8(小且快);非 int8 仅在无候选时兜底
            let is_int8 = name.contains("int8");
            let better = match &encoder {
                Some(e) => {
                    let e = e.to_string_lossy().to_string();
                    is_int8 && !e.contains("int8")
                }
                None => true,
            };
            if better {
                encoder = Some(entry.path());
            }
        } else if name.starts_with("decoder") && name.ends_with(".onnx") {
            let is_int8 = name.contains("int8");
            let better = match &decoder {
                Some(d) => {
                    let d = d.to_string_lossy().to_string();
                    is_int8 && !d.contains("int8")
                }
                None => true,
            };
            if better {
                decoder = Some(entry.path());
            }
        } else if name.starts_with("joiner") && name.ends_with(".onnx") {
            let is_int8 = name.contains("int8");
            let better = match &joiner {
                Some(j) => {
                    let j = j.to_string_lossy().to_string();
                    is_int8 && !j.contains("int8")
                }
                None => true,
            };
            if better {
                joiner = Some(entry.path());
            }
        }
    }
    match (encoder, decoder, joiner, tokens) {
        (Some(e), Some(d), Some(j), Some(t)) => Ok((
            e.to_string_lossy().to_string(),
            d.to_string_lossy().to_string(),
            j.to_string_lossy().to_string(),
            t.to_string_lossy().to_string(),
        )),
        _ => Err(format!(
            "模型文件不完整(需要 encoder/decoder/joiner .onnx + tokens.txt),目录: {}",
            dir.display()
        )),
    }
}

struct AudioEngineInner {
    running: AtomicBool,
    handle: Mutex<Option<std::thread::JoinHandle<()>>>,
    lang: Mutex<String>,
}

impl AudioEngineInner {
    fn new(lang: String) -> Self {
        Self {
            running: AtomicBool::new(false),
            handle: Mutex::new(None),
            lang: Mutex::new(lang),
        }
    }
}

/// 启动音频实时识别
/// - source: 音频来源(System=电脑内部音频 / Mic=麦克风)
/// - lang: "zh" | "en" | "ja" | "ko" | "auto"
/// 模型加载在后台线程执行(避免同步 command 阻塞 UI / C 库崩溃拖垮主进程);
/// 加载结果通过 audio-status 事件上报({source, status}:"loading"→"ready"/"error:xxx")
pub fn start(source: AudioSource, lang: &str, app: AppHandle) -> Result<(), String> {
    // 已运行则先停掉(同来源)
    stop(source);

    let lang = lang.to_string();
    let model_dir = model_dir_for_lang(&lang)
        .ok_or_else(|| format!("语言 {lang} 暂不支持音频识别(目前支持 中/英/日/韩)"))?;

    let inner = Arc::new(AudioEngineInner::new(lang.clone()));
    inner.running.store(true, Ordering::SeqCst);

    let run_app = app.clone();
    let inner2 = inner.clone();
    let handle = std::thread::spawn(move || {
        diag_log(&format!("[audio] thread start source={:?}, emitting loading...", source));
        let _ = run_app.emit_to("main", "audio-status", serde_json::json!({ "source": source.as_str(), "status": "loading" }));
        // 后台线程:扫描模型 + 加载识别器
        let loaded = (|| -> Result<OnlineRecognizer, String> {
            diag_log("[audio] scanning model files...");
            let (encoder, decoder, joiner, tokens) = scan_model_files(&model_dir)?;
            diag_log(&format!(
                "[audio] model source={:?} lang={} dir={}",
                source,
                lang,
                model_dir.display()
            ));
            diag_log(&format!(
                "[audio] selected model files: encoder={encoder} | decoder={decoder} | joiner={joiner} | tokens={tokens}"
            ));
            // tokens.txt 分析:确认 "ENG" 是否就是词表里的一个 token(如语言标签)
            match std::fs::read_to_string(&tokens) {
                Ok(txt) => {
                    let lines: Vec<&str> = txt.lines().collect();
                    let n = lines.len();
                    let eng_entries: Vec<&str> =
                        lines.iter().filter(|t| t.contains("ENG")).take(10).cloned().collect();
                    let langtags: Vec<&str> = lines
                        .iter()
                        .filter(|t| t.trim().starts_with('<') && t.trim().ends_with('>'))
                        .take(20)
                        .cloned()
                        .collect();
                    let head: Vec<&str> = lines.iter().take(10).cloned().collect();
                    let tail: Vec<&str> = lines.iter().rev().take(5).cloned().collect();
                    diag_log(&format!(
                        "[audio] tokens.txt lines={n} ENG_entries={eng_entries:?} langtag_entries={langtags:?} head={head:?} tail={tail:?}"
                    ));
                }
                Err(e) => diag_log(&format!("[audio] WARN: read tokens.txt failed: {e}")),
            }
            let mut cfg = OnlineRecognizerConfig::default();
            cfg.model_config.transducer.encoder = Some(encoder);
            cfg.model_config.transducer.decoder = Some(decoder);
            cfg.model_config.transducer.joiner = Some(joiner);
            cfg.model_config.tokens = Some(tokens);
            cfg.model_config.num_threads = 4;
            cfg.model_config.provider = Some("cpu".to_string());
            cfg.decoding_method = Some("greedy_search".to_string());
            cfg.enable_endpoint = true;
            // 端点检测(断句):灵敏度按语言独立配置(用户可调,默认英语短停顿)
            cfg.rule1_min_trailing_silence = 2.4;   // 长停顿必断
            cfg.rule2_min_trailing_silence = get_sensitivity(&lang); // 断句灵敏度(用户可调)
            cfg.rule3_min_utterance_length = 0.0;
            diag_log("[audio] creating OnlineRecognizer (loading model)...");
            let r = OnlineRecognizer::create(&cfg);
            diag_log("[audio] OnlineRecognizer::create returned");
            r.ok_or_else(|| "初始化流式识别器失败(模型加载失败)".to_string())
        })();

        let recognizer = match loaded {
            Ok(r) => r,
            Err(e) => {
                diag_log(&format!("[audio] model load error: {e}"));
                inner2.running.store(false, Ordering::SeqCst);
                let _ = run_app.emit_to("main", "audio-status", serde_json::json!({ "source": source.as_str(), "status": format!("error:{e}") }));
                return;
            }
        };
        diag_log(&format!("[audio] source={:?} recognizer READY", source));
        let _ = run_app.emit_to("main", "audio-status", serde_json::json!({ "source": source.as_str(), "status": "ready" }));
        // 捕获循环(内部含 ASR 喂数据)
        let result = capture_loop(source, &inner2, &recognizer, &run_app);
        inner2.running.store(false, Ordering::SeqCst);
        match result {
            Ok(()) => {
                diag_log(&format!("[audio] source={:?} capture loop ended (stopped)", source));
                let _ = run_app.emit_to("main", "audio-status", serde_json::json!({ "source": source.as_str(), "status": "stopped" }));
            }
            Err(e) => {
                diag_log(&format!("[audio] capture error: {e}"));
                let _ = run_app.emit_to("main", "audio-status", serde_json::json!({ "source": source.as_str(), "status": format!("error:{e}") }));
            }
        }
    });

    *inner.handle.lock().unwrap() = Some(handle);
    engine().insert(source, inner);
    Ok(())
}

/// 停止指定来源的音频识别
pub fn stop(source: AudioSource) {
    let mut guard = engine();
    if let Some(inner) = guard.remove(&source) {
        inner.running.store(false, Ordering::SeqCst);
        if let Some(h) = inner.handle.lock().unwrap().take() {
            let _ = h.join();
        }
    }
}

/// 停止所有来源的音频识别
pub fn stop_all() {
    let sources: Vec<AudioSource> = engine().keys().copied().collect();
    for s in sources {
        stop(s);
    }
}

/// 查询指定来源是否在运行
pub fn is_running(source: AudioSource) -> bool {
    engine().get(&source).map(|e| e.running.load(Ordering::SeqCst)).unwrap_or(false)
}

// ============ WASAPI loopback 捕获 ============

/// 解析 WAVEFORMATEX:返回 (channels, sample_rate, bits_per_sample, is_float)
unsafe fn parse_format(pwf: *const WAVEFORMATEX) -> (u16, u32, u16, bool) {
    let wf = &*pwf;
    // WAVE_FORMAT_EXTENSIBLE = 65534
    if wf.wFormatTag == 65534 {
        let ext = &*(pwf as *const WAVEFORMATEXTENSIBLE);
        let sub = ext.SubFormat;
        // KSDATAFORMAT_SUBTYPE_IEEE_FLOAT = {00000003-0000-0010-8000-00aa00389b71}
        let ieee_float =
            GUID::from_u128(0x00000003_0000_0010_8000_00aa00389b71);
        let is_float = sub == ieee_float;
        (wf.nChannels, wf.nSamplesPerSec, wf.wBitsPerSample, is_float)
    } else {
        // WAVE_FORMAT_IEEE_FLOAT = 3
        let is_float = wf.wFormatTag == 3;
        (wf.nChannels, wf.nSamplesPerSec, wf.wBitsPerSample, is_float)
    }
}

/// 写 44 字节标准 PCM WAV 头(mono 16kHz 16-bit);data_len 为样本数据字节数
/// 用于麦克风信号诊断转储(与 ASR 实际输入一致)
fn wav_write_header(f: &mut std::fs::File, data_len: u32) -> std::io::Result<()> {
    use std::io::{Seek, Write};
    f.seek(std::io::SeekFrom::Start(0))?;
    f.write_all(b"RIFF")?;
    f.write_all(&(36u32 + data_len).to_le_bytes())?;
    f.write_all(b"WAVE")?;
    f.write_all(b"fmt ")?;
    f.write_all(&16u32.to_le_bytes())?;
    f.write_all(&1u16.to_le_bytes())?; // PCM
    f.write_all(&1u16.to_le_bytes())?; // mono
    f.write_all(&16000u32.to_le_bytes())?;
    f.write_all(&32000u32.to_le_bytes())?; // byte rate = 16000 * 2
    f.write_all(&2u16.to_le_bytes())?; // block align
    f.write_all(&16u16.to_le_bytes())?; // bits per sample
    f.write_all(b"data")?;
    f.write_all(&data_len.to_le_bytes())?;
    f.flush()
}

/// 打印 WAVEFORMATEX 细节(含 EXTENSIBLE 的有效位深),用于诊断设备返回格式与数据是否一致
unsafe fn log_format_details(pwf: *const WAVEFORMATEX, source: AudioSource) {
    let wf = &*pwf;
    // packed 结构:字段必须复制到局部变量再使用,不能取引用(否则 E0793 unaligned)
    let tag = wf.wFormatTag;
    let channels = wf.nChannels;
    let rate = wf.nSamplesPerSec;
    let bits = wf.wBitsPerSample;
    let align = wf.nBlockAlign;
    if tag == 65534 {
        let ext = &*(pwf as *const WAVEFORMATEXTENSIBLE);
        let valid_bits = ext.Samples.wValidBitsPerSample;
        let mask = ext.dwChannelMask;
        let sub = ext.SubFormat;
        diag_log(&format!(
            "[audio] fmt details({:?}): EXTENSIBLE valid_bits={} channels={} rate={} bits={} block_align={} mask=0x{:08X} sub={:?}",
            source,
            valid_bits,
            channels,
            rate,
            bits,
            align,
            mask,
            sub,
        ));
    } else {
        diag_log(&format!(
            "[audio] fmt details({:?}): tag={} channels={} rate={} bits={} block_align={}",
            source, tag, channels, rate, bits, align,
        ));
    }
}

/// 鲁棒归一化:估计直流偏置并减去;若去直流后峰值显著超过 float 归一化范围则整体缩放。
/// 部分设备(尤其 Realtek/虚拟声卡)返回未归一化或带直流偏置的 float32 样本,
/// 直接喂 ASR 会得到畸形特征(表现为稳定输出 "ENG" 等退化结果)。
/// 返回 (直流偏置, 去直流后峰值, 是否触发了缩放)
fn normalize_mono(mono: &mut [f32]) -> (f32, f32, bool) {
    let n = mono.len();
    if n == 0 {
        return (0.0, 0.0, false);
    }
    let dc = mono.iter().sum::<f32>() / n as f32;
    if dc.abs() > 1e-4 {
        for s in mono.iter_mut() {
            *s -= dc;
        }
    }
    let mut peak = 0.0f32;
    for &s in mono.iter() {
        let a = s.abs();
        if a > peak {
            peak = a;
        }
    }
    if peak > 1.2 {
        let gain = 1.0 / peak;
        for s in mono.iter_mut() {
            *s *= gain;
        }
        (dc, peak, true)
    } else {
        (dc, peak, false)
    }
}

/// WASAPI 捕获循环(电脑内部音频 loopback / 麦克风)→ 喂给识别器
fn capture_loop(
    source: AudioSource,
    inner: &AudioEngineInner,
    recognizer: &OnlineRecognizer,
    app: &AppHandle,
) -> Result<(), String> {
    unsafe {
        eprintln!("[audio] capture_loop: CoInitializeEx...");
        CoInitializeEx(None, COINIT_MULTITHREADED)
            .ok()
            .map_err(|e| format!("CoInitializeEx 失败: {e}"))?;
        eprintln!("[audio] capture_loop: CoInitializeEx done");

        // 创建设备枚举器
        let enumerator: IMMDeviceEnumerator = CoCreateInstance(
            &windows::Win32::Media::Audio::MMDeviceEnumerator,
            None,
            CLSCTX_ALL,
        )
        .map_err(|e| format!("CoCreateInstance(MMDeviceEnumerator) 失败: {e}"))?;
        eprintln!("[audio] capture_loop: enumerator OK");

        // 端点:电脑音频=默认渲染端点(loopback);麦克风=默认捕获端点
        let (dataflow, role) = match source {
            AudioSource::System => (eRender, eConsole),
            AudioSource::Mic => (windows::Win32::Media::Audio::eCapture, eConsole),
        };
        let device = enumerator
            .GetDefaultAudioEndpoint(dataflow, role)
            .map_err(|e| format!("GetDefaultAudioEndpoint 失败: {e}"))?;
        eprintln!("[audio] capture_loop: device OK (source={:?})", source);

        // 激活 IAudioClient
        let audio_client: IAudioClient = device
            .Activate(CLSCTX_ALL, None)
            .map_err(|e| format!("Activate(IAudioClient) 失败: {e}"))?;
        eprintln!("[audio] capture_loop: audio_client OK");

        // 混合格式(通常 48kHz)
        let mix_format = audio_client
            .GetMixFormat()
            .map_err(|e| format!("GetMixFormat 失败: {e}"))?;
        let (channels, sample_rate, bits, is_float) = parse_format(mix_format);
        diag_log(&format!(
            "[audio] mix format: {channels}ch {sample_rate}Hz {bits}bit float={is_float} (source={:?})",
            source
        ));
        log_format_details(mix_format, source);

        // 初始化共享模式:电脑音频带 LOOPBACK 回录标志;麦克风普通捕获
        let stream_flags = match source {
            AudioSource::System => AUDCLNT_STREAMFLAGS_LOOPBACK,
            AudioSource::Mic => 0,
        };
        audio_client
            .Initialize(
                AUDCLNT_SHAREMODE_SHARED,
                stream_flags,
                200_0000, // 200ms 缓冲(100ns 单位)
                0,
                mix_format,
                None,
            )
            .map_err(|e| format!("Initialize 失败: {e}"))?;

        // 获取捕获客户端
        let capture: IAudioCaptureClient = audio_client
            .GetService()
            .map_err(|e| format!("GetService(IAudioCaptureClient) 失败: {e}"))?;

        // 重采样器:设备采样率 → 16k
        let resampler = LinearResampler::create(sample_rate as i32, 16000)
            .ok_or_else(|| format!("创建重采样器失败 ({sample_rate}→16000)"))?;

        let stream = recognizer.create_stream();
        let mut partial_last: String = String::new();
        let mut last_emit = Instant::now();
        let mut last_level = Instant::now();   // 音量事件节流

        audio_client.Start().map_err(|e| format!("Start 失败: {e}"))?;
        diag_log(&format!("[audio] capture started (source={:?})", source));

        let block_align = (bits / 8) as usize * channels as usize;

        // 麦克风诊断:把重采样后(16k 单声道)前 10 秒写入 WAV,便于离线分析信号质量
        // (与 ASR 实际输入一致;文件在 E:\TranslatorApp\mic_diag.wav,每次启动覆盖)
        let mut wav: Option<(std::fs::File, u32)> = if source == AudioSource::Mic {
            match std::fs::File::create("E:\\TranslatorApp\\mic_diag.wav") {
                Ok(mut f) => {
                    if wav_write_header(&mut f, 0).is_err() {
                        diag_log("[audio] WARN: mic_diag.wav header write failed");
                    }
                    Some((f, 0))
                }
                Err(e) => {
                    diag_log(&format!("[audio] WARN: mic_diag.wav create failed: {e}"));
                    None
                }
            }
        } else {
            None
        };

        let mut diag_frames: u64 = 0;   // 诊断:累计捕获帧数
        let mut diag_last = Instant::now();
        let mut sample_diag_last = Instant::now(); // 样本诊断计时(所有来源)
        let mut normalize_diag_last = Instant::now(); // 归一化日志节流(5s)

        while inner.running.load(Ordering::SeqCst) {
            let mut data_ptr: *mut u8 = std::ptr::null_mut();
            let mut num_frames: u32 = 0;
            let mut flags: u32 = 0;
            let hr = capture.GetBuffer(
                &mut data_ptr,
                &mut num_frames,
                &mut flags,
                None,
                None,
            );
            if hr.is_err() {
                // 无数据等待
                if diag_last.elapsed() >= Duration::from_secs(1) {
                    eprintln!("[audio] diag: GetBuffer err {:?} (1s, frames={diag_frames})", hr);
                    diag_last = Instant::now();
                }
                std::thread::sleep(Duration::from_millis(5));
                continue;
            }
            if num_frames == 0 {
                capture.ReleaseBuffer(num_frames).ok();
                std::thread::sleep(Duration::from_millis(5));
                continue;
            }
            diag_frames += num_frames as u64;
            if diag_last.elapsed() >= Duration::from_secs(1) {
                eprintln!("[audio] diag: got {num_frames} frames (total ~{diag_frames}/s)");
                diag_last = Instant::now();
            }

            // 解析样本 → f32 单声道
            let mut mono: Vec<f32> = Vec::with_capacity(num_frames as usize);
            let raw = std::slice::from_raw_parts(data_ptr, num_frames as usize * block_align);
            if is_float {
                // float32 (4 字节)或 float64?按 bits 判断
                if bits == 32 {
                    for frame in raw.chunks_exact(block_align) {
                        let mut sum = 0.0f32;
                        for ch in 0..channels as usize {
                            let off = ch * 4;
                            let v = f32::from_le_bytes([
                                frame[off],
                                frame[off + 1],
                                frame[off + 2],
                                frame[off + 3],
                            ]);
                            sum += v;
                        }
                        mono.push(sum / channels as f32);
                    }
                } else if bits == 64 {
                    for frame in raw.chunks_exact(block_align) {
                        let mut sum = 0.0f64;
                        for ch in 0..channels as usize {
                            let off = ch * 8;
                            let mut b = [0u8; 8];
                            b.copy_from_slice(&frame[off..off + 8]);
                            sum += f64::from_le_bytes(b);
                        }
                        mono.push((sum / channels as f64) as f32);
                    }
                } else {
                    capture.ReleaseBuffer(num_frames).ok();
                    return Err(format!("不支持的 float 位深: {bits}"));
                }
            } else if bits == 16 {
                // int16 PCM
                for frame in raw.chunks_exact(block_align) {
                    let mut sum = 0.0f32;
                    for ch in 0..channels as usize {
                        let off = ch * 2;
                        let v = i16::from_le_bytes([frame[off], frame[off + 1]]) as f32 / 32768.0;
                        sum += v;
                    }
                    mono.push(sum / channels as f32);
                }
            } else {
                capture.ReleaseBuffer(num_frames).ok();
                return Err(format!("不支持的 PCM 位深: {bits}"));
            }

            capture.ReleaseBuffer(num_frames).ok();

            // 原始样本统计(所有来源,节流 1s):判断是静音/直流/正常语音/超范围
            if sample_diag_last.elapsed() >= Duration::from_secs(1) {
                sample_diag_last = Instant::now();
                let mut min_s = f32::MAX;
                let mut max_s = f32::MIN;
                let mut mean_s = 0.0f32;
                for &s in &mono {
                    if s < min_s { min_s = s; }
                    if s > max_s { max_s = s; }
                    mean_s += s;
                }
                mean_s /= mono.len().max(1) as f32;
                diag_log(&format!(
                    "[audio] raw({:?}): min={min_s:.4} max={max_s:.4} mean={mean_s:.4} n={}",
                    source,
                    mono.len()
                ));
            }

            // 鲁棒归一化:去直流 + 峰值缩放(修复设备返回未归一化/带直流偏置的样本)
            let (dc, peak, scaled) = normalize_mono(&mut mono);
            if scaled && normalize_diag_last.elapsed() >= Duration::from_secs(5) {
                normalize_diag_last = Instant::now();
                diag_log(&format!(
                    "[audio] normalize({:?}): dc={dc:.3} peak={peak:.3} -> scaled to [-1,1]",
                    source
                ));
            }

            // 计算帧能量(RMS):用于音量显示(所有来源,基于归一化后信号)
            let energy: f32 = mono.iter().map(|s| s * s).sum::<f32>() / mono.len().max(1) as f32;
            let level_db = (energy + 1e-10).log10() * 10.0; // dB 尺度,静音约 -100dB
            // 音量事件:节流 ~100ms,供前端显示实时音量条(方便调试/确认有声音进来)
            if last_level.elapsed() >= Duration::from_millis(100) {
                last_level = Instant::now();
                let _ = app.emit_to("main", "audio-level", serde_json::json!({ "source": source.as_str(), "level": level_db }));
            }
            // 注:不做 VAD 跳帧——跳过静音帧会把音频切成碎片,破坏流式 ASR 连续性
            // (麦克风曾因此识别出乱码碎片)。静音断句交给端点检测(rule2)处理。

            // 重采样到 16k(flush=false,还有后续)
            let resampled = resampler.resample(&mono, false);
            if resampled.is_empty() {
                continue;
            }

            // WAV 诊断:写前 10 秒(重采样后,即 ASR 实际输入)
            if let Some((f, n)) = wav.as_mut() {
                use std::io::Write;
                const MAX_SAMPLES: u32 = 16000 * 10;
                let remaining = MAX_SAMPLES.saturating_sub(*n);
                if remaining > 0 {
                    let take = (resampled.len() as u32).min(remaining);
                    let mut buf = Vec::with_capacity(take as usize * 2);
                    for &s in resampled.iter().take(take as usize) {
                        let v = (s.clamp(-1.0, 1.0) * 32767.0) as i16;
                        buf.extend_from_slice(&v.to_le_bytes());
                    }
                    if let Err(e) = f.write_all(&buf) {
                        diag_log(&format!("[audio] WARN: mic_diag.wav write failed: {e}"));
                        wav = None;
                    } else {
                        *n += take;
                    }
                }
            }

            stream.accept_waveform(16000, &resampled);

            // 增量解码
            while recognizer.is_ready(&stream) {
                recognizer.decode(&stream);
                if let Some(result) = recognizer.get_result(&stream) {
                    let text = result.text.trim().to_string();
                    // 增量文本变化(且足够新)才 emit,避免刷屏
                    if !text.is_empty()
                        && text != partial_last
                        && last_emit.elapsed() >= Duration::from_millis(250)
                    {
                        partial_last = text.clone();
                        last_emit = Instant::now();
                        diag_log(&format!(
                            "[audio] partial({}) text={text:?} tokens={:?}",
                            source.as_str(),
                            result.tokens
                        ));
                        let r = app.emit_to("main", "audio-partial", serde_json::json!({ "source": source.as_str(), "text": text }));
                        if let Err(e) = &r { diag_log(&format!("[audio] emit audio-partial FAILED: {e}")); }
                    }
                    if recognizer.is_endpoint(&stream) {
                        // 端点:定稿整句
                        let final_text = result.text.trim().to_string();
                        if !final_text.is_empty() {
                            diag_log(&format!(
                                "[audio] final({}) text={final_text:?} tokens={:?}",
                                source.as_str(),
                                result.tokens
                            ));
                            let r = app.emit_to(
                                "main",
                                "audio-final",
                                serde_json::json!({ "source": source.as_str(), "text": final_text }),
                            );
                            if let Err(e) = &r { diag_log(&format!("[audio] emit audio-final FAILED: {e}")); }
                        }
                        recognizer.reset(&stream);
                        partial_last.clear();
                    }
                }
            }
        }

        // 收尾:补全 WAV 头中的样本数
        if let Some((mut f, n)) = wav {
            let _ = wav_write_header(&mut f, n * 2);
            diag_log(&format!(
                "[audio] mic_diag.wav done: {n} samples ({:.1}s @16k mono)",
                n as f32 / 16000.0
            ));
        }

        let _ = audio_client.Stop();
        diag_log(&format!("[audio] capture loop stopped (source={:?})", source));
    }
    Ok(())
}

/// 结束时会话状态(Drop 时停线程)
impl Drop for AudioEngineInner {
    fn drop(&mut self) {
        self.running.store(false, Ordering::SeqCst);
    }
}

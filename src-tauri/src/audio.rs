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

/// 全局音频引擎状态:None = 未启动
static AUDIO_ENGINE: std::sync::OnceLock<Mutex<Option<Arc<AudioEngineInner>>>> =
    std::sync::OnceLock::new();

fn engine() -> std::sync::MutexGuard<'static, Option<Arc<AudioEngineInner>>> {
    AUDIO_ENGINE
        .get_or_init(|| Mutex::new(None))
        .lock()
        .unwrap()
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
    // 广播到主界面与语音窗(用 eval,跨窗口事件不可靠);广播 clamp 后的值,保证两端一致
    let payload = serde_json::json!({ "lang": lang, "value": clamped }).to_string();
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.eval(&format!("window.__audioSensChanged && window.__audioSensChanged({payload})"));
    }
    if let Some(w) = app.get_webview_window("audio-floating") {
        let _ = w.eval(&format!("window.__audioSensChanged && window.__audioSensChanged({payload})"));
    }
    eprintln!("[audio] sensitivity {lang}={clamped} stored + broadcast");
}

/// 应用某语言的灵敏度(重启识别器使端点参数生效);由滑块松手时调用,避免拖动过程反复重启
pub fn apply_sensitivity(lang: &str, app: &AppHandle) {
    let running = engine().as_ref().map(|e| e.running.load(Ordering::SeqCst)).unwrap_or(false);
    eprintln!("[audio] apply_sensitivity lang={lang} running={running}");
    if !running {
        return;
    }
    // 仅当正在识别的就是该语言才重启
    let cur_lang = current_lang();
    eprintln!("[audio] apply_sensitivity cur_lang={cur_lang}");
    if cur_lang != lang {
        return;
    }
    eprintln!("[audio] sensitivity applied, restarting recognizer (lang={lang})");
    stop();
    let _ = start(&lang, app.clone());
}

/// 当前正在识别的语言
fn current_lang() -> String {
    // 引擎不记录语言,通过模型目录推断
    let cur = engine().clone();
    if let Some(e) = cur {
        // 简化:从 AudioEngineInner 读取(由 start 写入)
        e.lang.lock().unwrap().clone()
    } else {
        String::new()
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
/// - lang: "zh" | "en" | "ja" | "ko" | "auto"
/// 模型加载在后台线程执行(避免同步 command 阻塞 UI / C 库崩溃拖垮主进程);
/// 加载结果通过 audio-status 事件上报("loading"→"ready"/"error:xxx")
pub fn start(lang: &str, app: AppHandle) -> Result<(), String> {
    // 已运行则先停掉
    stop();

    let lang = lang.to_string();
    let model_dir = model_dir_for_lang(&lang)
        .ok_or_else(|| format!("语言 {lang} 暂不支持音频识别(目前支持 中/英/日/韩)"))?;

    let inner = Arc::new(AudioEngineInner::new(lang.clone()));
    inner.running.store(true, Ordering::SeqCst);

    let run_app = app.clone();
    let inner2 = inner.clone();
    let handle = std::thread::spawn(move || {
        eprintln!("[audio] thread start, emitting loading...");
        let _ = run_app.emit_to("main", "audio-status", "loading");
        eprintln!("[audio] emitting loading done");
        // 后台线程:扫描模型 + 加载识别器
        let loaded = (|| -> Result<OnlineRecognizer, String> {
            eprintln!("[audio] scanning model files...");
            let (encoder, decoder, joiner, tokens) = scan_model_files(&model_dir)?;
            eprintln!("[audio] model files OK");
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
            eprintln!("[audio] creating OnlineRecognizer (loading model)...");
            let r = OnlineRecognizer::create(&cfg);
            eprintln!("[audio] OnlineRecognizer::create returned");
            r.ok_or_else(|| "初始化流式识别器失败(模型加载失败)".to_string())
        })();

        let recognizer = match loaded {
            Ok(r) => r,
            Err(e) => {
                eprintln!("[audio] model load error: {e}");
                inner2.running.store(false, Ordering::SeqCst);
                let _ = run_app.emit_to("main", "audio-status", format!("error:{e}"));
                return;
            }
        };
        let _ = run_app.emit_to("main", "audio-status", "ready");
        // 捕获循环(内部含 ASR 喂数据)
        let result = capture_loop(&inner2, &recognizer, &run_app);
        inner2.running.store(false, Ordering::SeqCst);
        match result {
            Ok(()) => {
                let _ = run_app.emit_to("main", "audio-status", "stopped");
            }
            Err(e) => {
                eprintln!("[audio] capture error: {e}");
                let _ = run_app.emit_to("main", "audio-status", format!("error:{e}"));
            }
        }
    });

    *inner.handle.lock().unwrap() = Some(handle);
    *engine() = Some(inner);
    let _ = app.emit_to("main", "audio-status", "ready");
    Ok(())
}

/// 停止音频识别
pub fn stop() {
    let mut guard = engine();
    if let Some(inner) = guard.take() {
        inner.running.store(false, Ordering::SeqCst);
        if let Some(h) = inner.handle.lock().unwrap().take() {
            let _ = h.join();
        }
    }
}

/// 查询是否在运行
pub fn is_running() -> bool {
    engine().as_ref().map(|e| e.running.load(Ordering::SeqCst)).unwrap_or(false)
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

/// WASAPI loopback 捕获循环(系统播放的音频)→ 喂给识别器
fn capture_loop(
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

        // 默认渲染端点(系统正在播放的设备)
        let device = enumerator
            .GetDefaultAudioEndpoint(eRender, eConsole)
            .map_err(|e| format!("GetDefaultAudioEndpoint 失败: {e}"))?;
        eprintln!("[audio] capture_loop: device OK");

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
        eprintln!(
            "[audio] mix format: {channels}ch {sample_rate}Hz {bits}bit float={is_float}"
        );

        // 初始化共享模式 loopback
        audio_client
            .Initialize(
                AUDCLNT_SHAREMODE_SHARED,
                AUDCLNT_STREAMFLAGS_LOOPBACK,
                200_0000, // 200ms 缓冲(100ns 单位)
                0,
                mix_format,
                None,
            )
            .map_err(|e| format!("Initialize(LOOPBACK) 失败: {e}"))?;

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

        audio_client.Start().map_err(|e| format!("Start 失败: {e}"))?;
        eprintln!("[audio] loopback capture started");

        let block_align = (bits / 8) as usize * channels as usize;

        let mut diag_frames: u64 = 0;   // 诊断:累计捕获帧数
        let mut diag_last = Instant::now();

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

            // 重采样到 16k(flush=false,还有后续)
            let resampled = resampler.resample(&mono, false);
            if resampled.is_empty() {
                continue;
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
                        eprintln!("[audio] partial: {text}");
                        let r = app.emit_to("main", "audio-partial", serde_json::json!({ "text": text }));
                        if let Err(e) = &r { eprintln!("[audio] emit audio-partial FAILED: {e}"); }
                    }
                    if recognizer.is_endpoint(&stream) {
                        // 端点:定稿整句
                        let final_text = result.text.trim().to_string();
                        if !final_text.is_empty() {
                            eprintln!("[audio] final: {final_text}");
                            let r = app.emit_to(
                                "main",
                                "audio-final",
                                serde_json::json!({ "text": final_text }),
                            );
                            if let Err(e) = &r { eprintln!("[audio] emit audio-final FAILED: {e}"); }
                        }
                        recognizer.reset(&stream);
                        partial_last.clear();
                    }
                }
            }
        }

        let _ = audio_client.Stop();
        eprintln!("[audio] capture loop stopped");
    }
    Ok(())
}

/// 结束时会话状态(Drop 时停线程)
impl Drop for AudioEngineInner {
    fn drop(&mut self) {
        self.running.store(false, Ordering::SeqCst);
    }
}

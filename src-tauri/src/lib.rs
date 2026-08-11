// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use tauri::Emitter;
use tauri::Manager;
use std::os::windows::process::CommandExt;
use std::process::{Command as StdCommand, Child, Stdio};
use std::sync::Mutex;
use rapidocr_core::RapidOcr;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

mod audio;

/// 管理 Ollama serve 子进程的生命周期:应用启动时 spawn,退出时杀进程树
struct OllamaManager {
    child: Mutex<Option<Child>>,
}

impl OllamaManager {
    fn new() -> Self {
        Self { child: Mutex::new(None) }
    }

    fn start(&self, ollama_exe: &str, models_dir: &str) -> Result<(), String> {
        // ollama.exe 必须在它所在的目录运行(依赖 ./lib/ollama/*.dll)
        let ollama_dir = std::path::Path::new(ollama_exe)
            .parent()
            .unwrap_or(std::path::Path::new("."));
        let child = StdCommand::new(ollama_exe)
            .arg("serve")
            .current_dir(ollama_dir)
            .env("OLLAMA_MODELS", models_dir)
            .env("OLLAMA_HOST", "127.0.0.1:11434")
            .env("OLLAMA_ORIGINS", "*") // 允许 tauri:// 页面(null Origin)访问,否则 release 版 fetch 被 403
            .env("OLLAMA_NOHISTORY", "1")
            .stdout(Stdio::null())
            .stderr(Stdio::inherit())
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .spawn()
            .map_err(|e| format!("启动 Ollama 失败: {e}"))?;
        eprintln!("[ollama] serve started (pid={})", child.id());
        *self.child.lock().unwrap() = Some(child);
        Ok(())
    }
}

impl Drop for OllamaManager {
    fn drop(&mut self) {
        if let Some(ref mut child) = *self.child.lock().unwrap() {
            let pid = child.id();
            eprintln!("[ollama] stopping serve (pid={pid})...");
            let _ = child.kill();
            let _ = StdCommand::new("taskkill")
                .args(["/pid", &pid.to_string(), "/t", "/f"])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .creation_flags(0x08000000)
                .spawn();
            let _ = child.wait();
            eprintln!("[ollama] serve stopped");
        }
    }
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/// 诊断用:验证 invoke 链路是否畅通
#[tauri::command]
fn ping() -> String {
    eprintln!("[ping] invoked");
    "pong".to_string()
}

// ============ 第7波:音频实时翻译 commands ============

/// 启动系统内部音频实时识别(lang: zh/en/ja/ko/auto)
#[tauri::command]
fn audio_subtitle_start(lang: String, app: tauri::AppHandle) -> Result<(), String> {
    audio::start(&lang, app)
}

/// 停止音频实时识别
#[tauri::command]
fn audio_subtitle_stop() {
    audio::stop();
}

/// 查询音频识别是否运行中
#[tauri::command]
fn audio_subtitle_running() -> bool {
    audio::is_running()
}

/// 全局缓存的 RapidOcr 实例:模型只加载一次,避免每次截图重复初始化(截图慢的主因)
static OCR_CACHE: std::sync::OnceLock<std::sync::Mutex<Option<RapidOcr>>> = std::sync::OnceLock::new();

fn ocr_instance() -> Result<std::sync::MutexGuard<'static, Option<RapidOcr>>, String> {
    use rapidocr_core::{
        config::{InferenceOptions, PipelineConfig},
        model::{model_set_by_name, ModelCache, ModelDownloadMode},
    };
    let lock = OCR_CACHE.get_or_init(|| std::sync::Mutex::new(None));
    let mut guard = lock.lock().map_err(|_| "OCR 锁获取失败".to_string())?;
    if guard.is_none() {
        let model_set = model_set_by_name("ppocrv6-small").ok_or_else(|| "模型集不存在".to_string())?;
        let cache = ModelCache::new(r"E:\TranslatorApp\ocr");
        cache.ensure_model_set_for_pipeline(model_set, PipelineConfig::without_cls(), ModelDownloadMode::Missing).map_err(|e| format!("模型: {e}"))?;
        let cfg = cache.config_for(model_set).with_pipeline(PipelineConfig::without_cls()).with_inference_options(InferenceOptions::default());
        let ocr = RapidOcr::from_config(cfg).map_err(|e| format!("OCR初始化: {e}"))?;
        eprintln!("[screenshot] OCR 引擎初始化完成(首次)");
        *guard = Some(ocr);
    }
    Ok(guard)
}

/// 从 base64 PNG 裁剪图做 OCR:截图翻译的最终结果不再二次截屏,
/// 而是由 overlay 从启动时缓存的全屏图裁剪选区 → 这里直接 OCR。
/// 消除"框选完成瞬间二次截屏混入 overlay 残影"的问题。
#[tauri::command]
fn ocr_image_b64(b64: String) -> Result<String, String> {
    use base64::{Engine as _, engine::general_purpose::STANDARD};
    let r = (|| -> Result<String, String> {
        let bytes = STANDARD.decode(b64.trim()).map_err(|e| format!("解码: {e}"))?;
        let img = image::load_from_memory(&bytes).map_err(|e| format!("图片: {e}"))?;
        let mut guard = ocr_instance()?;
        let ocr = guard.as_mut().ok_or("OCR 引擎不可用")?;
        let output = ocr.run_image(&img.to_rgb8()).map_err(|e| format!("OCR: {e}"))?; // 内存推理,免临时文件
        let texts: Vec<String> = output.lines.into_iter().map(|l| l.text).collect();
        Ok(texts.join("\n"))
    })();
    r
}

/// Windows 系统 OCR(Windows.Media.Ocr):
/// unpackaged Tauri 应用可调用(已 PoC 验证);速度远超 RapidOCR,中文需系统语言包。
/// 独立引擎,不影响截图翻译的 RapidOCR。async 版本(在 Tauri 异步运行时执行,Poc 已验证可行)。
async fn win_ocr_bytes(bytes: &[u8]) -> Result<String, String> {
    use windows::{
        Graphics::Imaging::BitmapDecoder,
        Media::Ocr::OcrEngine,
        Storage::Streams::{DataWriter, InMemoryRandomAccessStream},
    };

    // 用户配置语言创建引擎(中文系统自带中文语言包)
    let engine = OcrEngine::TryCreateFromUserProfileLanguages()
        .map_err(|e| format!("创建 OCR 引擎失败(可能需 package identity): {e}"))?;

    // 内存流 → 解码器 → SoftwareBitmap
    let stream = InMemoryRandomAccessStream::new().map_err(|e| format!("建流: {e}"))?;
    {
        let writer = DataWriter::CreateDataWriter(&stream).map_err(|e| format!("写器: {e}"))?;
        writer.WriteBytes(bytes).map_err(|e| format!("写字节: {e}"))?;
        writer.StoreAsync().map_err(|e| format!("store: {e}"))?.await.map_err(|e| format!("store await: {e}"))?;
        writer.DetachStream().map_err(|e| format!("detach: {e}"))?;
    }
    let decoder = BitmapDecoder::CreateAsync(&stream).map_err(|e| format!("解码器: {e}"))?.await.map_err(|e| format!("解码 await: {e}"))?;
    let bitmap = decoder.GetSoftwareBitmapAsync().map_err(|e| format!("位图: {e}"))?.await.map_err(|e| format!("位图 await: {e}"))?;

    // 识别
    let result = engine.RecognizeAsync(&bitmap).map_err(|e| format!("识别: {e}"))?.await.map_err(|e| format!("识别 await: {e}"))?;

    let mut texts: Vec<String> = Vec::new();
    let lines = result.Lines().map_err(|e| format!("lines: {e}"))?;
    for line in lines.into_iter() {
        let t = line.Text().map_err(|e| format!("text: {e}"))?;
        texts.push(t.to_string_lossy().to_string());
    }
    Ok(texts.join("\n"))
}

/// 系统 OCR:从 base64 PNG 识别(PoC 测试入口 + 兼容)
#[tauri::command]
async fn win_ocr_b64(b64: String) -> Result<String, String> {
    use base64::{Engine as _, engine::general_purpose::STANDARD};
    let bytes = STANDARD.decode(b64.trim()).map_err(|e| format!("解码: {e}"))?;
    win_ocr_bytes(&bytes).await
}

/// 系统 OCR:从内存图像识别(字幕帧用,编码 PNG → win_ocr_bytes)
async fn win_ocr_from_image(img: &image::RgbaImage) -> Result<String, String> {
    let mut buf = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageRgba8(img.clone())
        .write_to(&mut buf, image::ImageFormat::Png)
        .map_err(|e| format!("编码: {e}"))?;
    win_ocr_bytes(buf.get_ref()).await
}

/// 截全屏并编码为 base64 PNG:供截图 overlay 作为背景预览。
/// 不透明窗口 + 静态截图背景方案:框选层显示位图,不依赖透明窗口透出真实屏幕
/// (透明窗口叠加硬件视频会显示黑屏),框选时能看到画面内容。
#[tauri::command]
fn capture_fullscreen() -> Result<String, String> {
    use base64::{Engine as _, engine::general_purpose::STANDARD};
    let monitors = xcap::Monitor::all().map_err(|e| format!("获取显示器: {e}"))?;
    let primary = monitors.into_iter().next().ok_or("未找到显示器")?;
    let img = primary.capture_image().map_err(|e| format!("截屏: {e}"))?;
    let mut buf = std::io::Cursor::new(Vec::new());
    img.write_to(&mut buf, image::ImageFormat::Png).map_err(|e| format!("编码: {e}"))?;
    Ok(STANDARD.encode(buf.get_ref()))
}

/// 截图 + OCR: xcap 截全屏 → 裁剪到区域 → 保存 png → OCR → 返回文本
#[tauri::command]
fn screenshot_ocr(x: i32, y: i32, w: i32, h: i32, app: tauri::AppHandle) -> Result<String, String> {
    use tauri::Emitter;
    let app2 = app.clone();
    std::thread::spawn(move || {
        eprintln!("[screenshot] ocr start coords=({x},{y},{w},{h})");
        let result: String = (|| {
            let cropped = capture_region(x, y, w, h)?;
            let _ = cropped.save(r"E:\TranslatorApp\last_screenshot.png");
            ocr_image(&cropped)
        })().unwrap_or_else(|e| format!("ERROR: {e}"));
        let preview: String = result.chars().take(120).collect();
        eprintln!("[screenshot] ocr result: {}", preview);
        let emit_ok = app2.emit_to("main", "ocr-done", result);
        eprintln!("[screenshot] emit ocr-done: {:?}", emit_ok.map(|_| "ok"));
    });
    Ok("processing".into())
}

/// 视频实时字幕:连续截帧 + OCR。
/// engine: "win"=Windows 系统 OCR(快),默认/其他=RapidOCR。与截图翻译隔离(事件 subtitle-ocr)。
/// async:系统 OCR 需在 Tauri 异步运行时执行(PoC 验证可行),裸线程 + block_on 会卡死。
#[tauri::command]
async fn subtitle_frame(x: i32, y: i32, w: i32, h: i32, engine: Option<String>, app: tauri::AppHandle) -> Result<String, String> {
    use tauri::Emitter;
    let use_win = engine.as_deref() == Some("win");
    let result: String = match capture_region(x, y, w, h) {
        Ok(cropped) => {
            let r = if use_win {
                win_ocr_from_image(&cropped).await
            } else {
                ocr_image(&cropped)
            };
            r.unwrap_or_else(|e| format!("ERROR: {e}"))
        }
        Err(e) => format!("ERROR: {e}"),
    };
    let preview: String = result.chars().take(120).collect();
    eprintln!("[subtitle] frame ocr({}): {}", if use_win { "win" } else { "rapid" }, preview);
    let _ = app.emit_to("main", "subtitle-ocr", result);
    Ok("processing".into())
}

/// 截取屏幕指定区域(物理像素),返回裁剪后的图像
fn capture_region(x: i32, y: i32, w: i32, h: i32) -> Result<image::RgbaImage, String> {
    use image::GenericImageView;
    let monitors = xcap::Monitor::all().map_err(|e| format!("获取显示器: {e}"))?;
    let primary = monitors.into_iter().next().ok_or("未找到显示器")?;
    let img = primary.capture_image().map_err(|e| format!("截屏: {e}"))?;
    let cropped = img.view(x as u32, y as u32, w as u32, h as u32).to_image();
    Ok(cropped)
}

/// 对裁剪图像做 OCR(共享全局缓存引擎;内存推理,免临时文件 I/O)
fn ocr_image(cropped: &image::RgbaImage) -> Result<String, String> {
    let mut guard = ocr_instance()?;
    let ocr = guard.as_mut().ok_or("OCR 引擎不可用")?;
    let output = ocr.run_image(&image::DynamicImage::ImageRgba8(cropped.clone()).to_rgb8())
        .map_err(|e| format!("OCR: {e}"))?;
    let texts: Vec<String> = output.lines.into_iter().map(|l| l.text).collect();
    Ok(texts.join("\n"))
}



/// 关闭悬浮窗
#[tauri::command]
fn close_floating_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("floating") {
        // 隐藏而非销毁:窗口启动时已预建,避免运行时重建触发 Tauri <=2.11 缺陷
        let _ = w.hide();
        eprintln!("[floating] hidden via command");
        let _ = app.emit_to("main", "floating-closed", ());
    }
    Ok(())
}

/// 打开截图覆盖层窗口(全屏 Canvas,用于框选区域)
/// 窗口在 setup 时已预建隐藏;这里只通知来源,不 show —— 由前端截图完成后自己 show
/// (窗口已改不透明:若先 show 再截图,会把自己的黑窗口截进去;前端先隐藏→截屏→绘制→显示)
/// from: 发起入口("main"=桌面端 / "floating"=悬浮窗),决定截图结果显示在哪
#[tauri::command]
fn open_screenshot_overlay(from: Option<String>, app: tauri::AppHandle) -> Result<(), String> {
    use tauri::{Emitter, WebviewUrl, WebviewWindowBuilder};
    let from = from.unwrap_or_else(|| "main".to_string());
    eprintln!("[screenshot] overlay opened from={from}");
    // 预建窗口存在 → 只通知来源(不 show,前端截完图再显示)
    if let Some(w) = app.get_webview_window("screenshot-overlay") {
        let _ = w.hide(); // 确保处于隐藏状态,截图不包含自身
        let _ = app.emit_to("screenshot-overlay", "overlay-start", from.clone());
        return Ok(());
    }
    // 兜底:预建失败时后台线程创建
    let (w, h) = if let Ok(Some(m)) = app.primary_monitor() {
        let size = m.size();       // xcap 返回物理像素
        let sf = m.scale_factor(); // DPI 缩放
        // inner_size(f64) 是逻辑尺寸:物理/缩放 → 窗口物理 = 逻辑×dpr = 物理,与截图严格一致
        (size.width as f64 / sf, size.height as f64 / sf)
    } else {
        (1920.0, 1080.0)
    };
    let app2 = app.clone();
    std::thread::spawn(move || {
        if let Ok(w) = WebviewWindowBuilder::new(&app2, "screenshot-overlay", WebviewUrl::App("index.html".into()))
            .title("截图")
            .inner_size(w, h)
            .position(0.0, 0.0)
            .decorations(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .resizable(false)
            .shadow(false)
            .build()
        {
            let _ = app2.emit_to("screenshot-overlay", "overlay-start", from.clone());
            let _ = w.show();
            let _ = w.set_focus();
        }
    });
    Ok(())
}
/// 注意:窗口创建必须在后台线程执行,直接 invoke 里同步调 build 会死锁
#[tauri::command]
fn open_floating_window(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::{Emitter as _, WebviewUrl, WebviewWindowBuilder};

    eprintln!("[floating] open_floating_window called");

    // 已存在则聚焦
    if let Some(w) = app.get_webview_window("floating") {
        eprintln!("[floating] window exists, showing");
        let _ = w.show();
        let _ = w.set_focus();
        return Ok(());
    }

    eprintln!("[floating] spawning background thread for creation");
    let app2 = app.clone();
    std::thread::spawn(move || {
        match WebviewWindowBuilder::new(&app2, "floating", WebviewUrl::App("index.html".into()))
            .title("翻译悬浮窗")
            .inner_size(380.0, 220.0)
            .min_inner_size(280.0, 160.0)
            .resizable(false)
            .decorations(false)
            .transparent(true)
            .always_on_top(true)
            .skip_taskbar(true)
            .shadow(false)
            .build()
        {
            Ok(w) => {
                // 放到主屏右下角
                if let Ok(Some(m)) = app2.primary_monitor() {
                    let size = m.size();
                    let sf = m.scale_factor();
                    let x = (size.width as f64 - 380.0 * sf - 40.0).max(0.0) as i32;
                    let y = (size.height as f64 - 220.0 * sf - 40.0).max(0.0) as i32;
                    eprintln!("[floating] placing at ({x}, {y}), screen={size:?}, scale={sf}");
                    let _ = w.set_position(tauri::PhysicalPosition::new(x, y));
                }
                let _ = w.show();
                let _ = w.set_focus();
                eprintln!("[floating] created OK");
                let _ = app2.emit("floating-opened", ());
            }
            Err(e) => {
                eprintln!("[floating] create FAILED: {e}");
                let _ = app2.emit("floating-error", e.to_string());
            }
        }
    });

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![greet, ping, capture_fullscreen, ocr_image_b64, win_ocr_b64, screenshot_ocr, subtitle_frame, open_screenshot_overlay, open_floating_window, close_floating_window, audio_subtitle_start, audio_subtitle_stop, audio_subtitle_running])
        .setup(|app| {
            // 清理可能残留的旧 ollama 进程,避免端口冲突
            eprintln!("[ollama] cleaning up old processes...");
            let _ = StdCommand::new("taskkill")
                .args(["/f", "/t", "/im", "ollama.exe"])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .creation_flags(0x08000000)
                .output(); // 同步等待完成
            let _ = StdCommand::new("taskkill")
                .args(["/f", "/t", "/im", "llama-server.exe"])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .creation_flags(0x08000000)
                .output();
            std::thread::sleep(std::time::Duration::from_secs(2));

            eprintln!("[ollama] starting serve...");
            let mgr = OllamaManager::new();
            if let Err(e) = mgr.start(
                "E:\\TranslatorApp\\ollama\\ollama.exe",
                "E:\\TranslatorApp\\models",
            ) {
                eprintln!("[ollama] start failed: {e}");
                // 不阻塞应用,翻译功能暂时不可用
            } else {
                eprintln!("[ollama] serve started OK");
            }
            app.manage(mgr);

            // 【预建隐藏窗口】floating + screenshot-overlay 在启动时建好(与主窗口同路径,可靠),
            // 运行时只 show/hide —— 避免运行时建窗触发 Tauri <=2.11 的 asset 协议加载缺陷
            {
                use tauri::{WebviewUrl, WebviewWindowBuilder};
                let handle = app.handle();
                // 悬浮窗(右下角,透明置顶)
                let _ = WebviewWindowBuilder::new(handle, "floating", WebviewUrl::App("index.html".into()))
                    .title("翻译悬浮窗")
                    .inner_size(380.0, 220.0)
                    .min_inner_size(280.0, 160.0)
                    .resizable(false)
                    .decorations(false)
                    .transparent(true)
                    .always_on_top(true)
                    .skip_taskbar(true)
                    .shadow(false)
                    .visible(false)
                    .build();
                // 截图覆盖层(全屏,不透明置顶;前端截图背景铺满,不透出底层)
                let (w, h) = if let Ok(Some(m)) = handle.primary_monitor() {
                    let size = m.size();       // xcap 返回物理像素
                    let sf = m.scale_factor(); // DPI 缩放
                    // inner_size(f64) 是逻辑尺寸:物理/缩放 → 窗口物理 = 逻辑×dpr = 物理,与截图严格一致
                    (size.width as f64 / sf, size.height as f64 / sf)
                } else {
                    (1920.0, 1080.0)
                };
                let _ = WebviewWindowBuilder::new(handle, "screenshot-overlay", WebviewUrl::App("index.html".into()))
                    .title("截图")
                    .inner_size(w, h)
                    .position(0.0, 0.0)
                    .decorations(false)
                    .always_on_top(true)
                    .skip_taskbar(true)
                    .resizable(false)
                    .shadow(false)
                    .visible(false)
                    .build();
                eprintln!("[setup] 预建隐藏窗口完成(floating / screenshot-overlay)");
            }

            // 【全局快捷键:Rust 侧注册】
            // 不能在前端 register:release 版预建了 main/floating/overlay 三个窗口,
            // 都加载 index.html 都会执行 register。Windows RegisterHotKey 对同一组合键
            // 重复注册返回 ERROR_HOTKEY_ALREADY_REGISTERED,插件 store 按 hotkey id 只保留
            // 一个 handler —— 先注册成功的窗口独占事件(可能是隐藏的 floating/overlay),
            // 主窗口收不到(dev 版只有主窗口注册,所以正常)。
            // 这里只注册一次,事件统一 emit 到主窗口,由前端监听处理。
            {
                let _ = app.global_shortcut().on_shortcut("CommandOrControl+Shift+D", |app, _s, e| {
                    if e.state == ShortcutState::Pressed {
                        let _ = app.emit_to("main", "global-shortcut", "toggle-floating");
                    }
                });
                let _ = app.global_shortcut().on_shortcut("CommandOrControl+Shift+S", |app, _s, e| {
                    if e.state == ShortcutState::Pressed {
                        let _ = app.emit_to("main", "global-shortcut", "screenshot");
                    }
                });
                let _ = app.global_shortcut().on_shortcut("CommandOrControl+Shift+U", |app, _s, e| {
                    if e.state == ShortcutState::Pressed {
                        let _ = app.emit_to("main", "global-shortcut", "toggle-subtitle");
                    }
                });
                eprintln!("[shortcut] Rust 侧注册 Ctrl+Shift+D/S/U 完成");
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            match event {
                tauri::WindowEvent::CloseRequested { .. } => eprintln!("[win] {} CloseRequested", window.label()),
                tauri::WindowEvent::Destroyed => eprintln!("[win] {} Destroyed", window.label()),
                _ => {}
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

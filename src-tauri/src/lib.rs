// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use tauri::Emitter;
use tauri::Manager;
use std::os::windows::process::CommandExt;
use std::process::{Command as StdCommand, Child, Stdio};
use std::sync::Mutex;
use rapidocr_core::RapidOcr;

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

/// 截图 + OCR: xcap 截全屏 → 裁剪到区域 → 保存 png → OCR → 返回文本
#[tauri::command]
fn screenshot_ocr(x: i32, y: i32, w: i32, h: i32, app: tauri::AppHandle) -> Result<String, String> {
    use tauri::Emitter;
    let app2 = app.clone();
    std::thread::spawn(move || {
        eprintln!("[screenshot] ocr start coords=({x},{y},{w},{h})");
        let result: String = (|| -> Result<String, String> {
            use image::GenericImageView;
            let monitors = xcap::Monitor::all().map_err(|e| format!("获取显示器: {e}"))?;
            let primary = monitors.into_iter().next().ok_or("未找到显示器")?;
            let img = primary.capture_image().map_err(|e| format!("截屏: {e}"))?;
            let cropped = img.view(x as u32, y as u32, w as u32, h as u32).to_image();
            let tmp_path = std::env::temp_dir().join(format!("transmate-ocr-{}.png", std::process::id()));
            cropped.save(&tmp_path).map_err(|e| format!("保存: {e}"))?;
            let _ = cropped.save(r"E:\TranslatorApp\last_screenshot.png");
            eprintln!("[screenshot] cropped {}x{} saved to {:?}", cropped.width(), cropped.height(), tmp_path);
            let mut guard = ocr_instance()?;
            let ocr = guard.as_mut().ok_or("OCR 引擎不可用")?;
            let output = ocr.run_path(&tmp_path).map_err(|e| format!("OCR: {e}"))?;
            let texts: Vec<String> = output.lines.into_iter().map(|l| l.text).collect();
            Ok(texts.join("\n"))
        })().unwrap_or_else(|e| format!("ERROR: {e}"));
        let preview: String = result.chars().take(120).collect();
        eprintln!("[screenshot] ocr result: {}", preview);
        let emit_ok = app2.emit_to("main", "ocr-done", result);
        eprintln!("[screenshot] emit ocr-done: {:?}", emit_ok.map(|_| "ok"));
    });
    Ok("processing".into())
}



/// 关闭悬浮窗
#[tauri::command]
fn close_floating_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("floating") {
        let _ = w.close();
        eprintln!("[floating] closed via command");
        let _ = app.emit_to("main", "floating-closed", ());
    }
    Ok(())
}

/// 打开截图覆盖层窗口(全屏 Canvas,用于框选区域)
/// 必须用后台线程创建,避免同步 build 死锁
/// from: 发起入口("main"=桌面端 / "floating"=悬浮窗),决定截图结果显示在哪
#[tauri::command]
fn open_screenshot_overlay(from: Option<String>, app: tauri::AppHandle) -> Result<(), String> {
    use tauri::{WebviewUrl, WebviewWindowBuilder};
    let from = from.unwrap_or_else(|| "main".to_string());
    eprintln!("[screenshot] overlay opened from={from}");
    // 先关掉旧的
    if let Some(w) = app.get_webview_window("screenshot-overlay") {
        let _ = w.close();
    }
    let (w, h) = if let Ok(Some(m)) = app.primary_monitor() {
        let size = m.size();
        (size.width as f64, size.height as f64)
    } else {
        (1920.0, 1080.0)
    };

    let app2 = app.clone();
    std::thread::spawn(move || {
        let _ = WebviewWindowBuilder::new(
            &app2,
            "screenshot-overlay",
            WebviewUrl::App(format!("index.html?from={from}").into()),
        )
        .title("截图")
        .inner_size(w, h)
        .position(0.0, 0.0)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .shadow(false)
        .build();
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
        .invoke_handler(tauri::generate_handler![greet, ping, screenshot_ocr, open_screenshot_overlay, open_floating_window, close_floating_window])
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
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

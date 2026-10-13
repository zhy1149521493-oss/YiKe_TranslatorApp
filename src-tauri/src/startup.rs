//! Keep engine discovery and hidden WebView preparation off the first-frame path.
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

const AUXILIARY: [&str; 4] = ["floating", "audio-floating", "audio-floating-mic", "screenshot-overlay"];

#[derive(Default)]
struct Readiness {
    main_painted: bool,
    engine_finished: bool,
    windows: HashMap<String, Result<bool, String>>,
}

pub struct Startup {
    state: Mutex<Readiness>,
    changed: Condvar,
    started: Instant,
    stopping: AtomicBool,
}

impl Startup {
    fn new() -> Self {
        Self { state: Mutex::new(Readiness::default()), changed: Condvar::new(), started: Instant::now(), stopping: AtomicBool::new(false) }
    }

    fn mark_ready(&self, label: &str) {
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        if self.stopping.load(Ordering::SeqCst) { return; }
        if label == "main" { state.main_painted = true; }
        else if AUXILIARY.contains(&label) { state.windows.insert(label.to_string(), Ok(true)); }
        else { return; }
        eprintln!("[startup] frontend ready label={label} elapsed_ms={}", self.started.elapsed().as_millis());
        self.changed.notify_all();
    }

    fn window_failed(&self, label: &str, error: String) {
        self.state.lock().unwrap_or_else(|error| error.into_inner()).windows.insert(label.to_string(), Err(error));
        self.changed.notify_all();
    }

    fn wait_for_window(&self, label: &str, timeout: Duration) -> Result<(), String> {
        let state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        let (state, _) = self.changed.wait_timeout_while(state, timeout, |state| {
            !self.stopping.load(Ordering::SeqCst) && !matches!(state.windows.get(label), Some(Ok(true) | Err(_)))
        }).unwrap_or_else(|error| error.into_inner());
        if self.stopping.load(Ordering::SeqCst) { return Err("应用正在退出".to_string()); }
        match state.windows.get(label) {
            Some(Ok(true)) => Ok(()),
            Some(Err(error)) => Err(format!("准备窗口 {label} 失败: {error}")),
            _ => Err(format!("窗口 {label} 仍在初始化，请稍后重试")),
        }
    }
}

/// Call only after preference flushes complete, before taking the teardown snapshot.
pub fn begin_shutdown(app: &AppHandle) {
    if let Some(startup) = app.try_state::<Arc<Startup>>() {
        // Keep the condition-variable notification synchronized with its waiters.
        let _state = startup.state.lock().unwrap_or_else(|error| error.into_inner());
        startup.stopping.store(true, Ordering::SeqCst);
        startup.changed.notify_all();
    }
}

/// The caller identity comes from Tauri, never a frontend-supplied label.
#[tauri::command]
pub fn frontend_ready(window: WebviewWindow, app: AppHandle) {
    if let Some(startup) = app.try_state::<Arc<Startup>>() { startup.mark_ready(window.label()); }
}

#[tauri::command]
pub async fn wait_local_engine(app: AppHandle) -> Result<bool, String> {
    let startup = app.state::<Arc<Startup>>().inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = startup.state.lock().unwrap_or_else(|error| error.into_inner());
        let (state, _) = startup.changed.wait_timeout_while(state, Duration::from_secs(30), |state| !state.engine_finished && !startup.stopping.load(Ordering::SeqCst))
            .unwrap_or_else(|error| error.into_inner());
        state.engine_finished
    }).await.map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn wait_floating_ready(app: AppHandle) -> Result<(), String> {
    auxiliary_window(&app, "floating").await.map(|_| ())
}

/// An early click waits for mounted JS listeners; it cannot silently lose its first event.
pub async fn auxiliary_window(app: &AppHandle, label: &str) -> Result<WebviewWindow, String> {
    if !AUXILIARY.contains(&label) { return Err("未知的辅助窗口".to_string()); }
    let startup = app.state::<Arc<Startup>>().inner().clone();
    let label_owned = label.to_string();
    tauri::async_runtime::spawn_blocking(move || startup.wait_for_window(&label_owned, Duration::from_secs(30)))
        .await.map_err(|error| error.to_string())??;
    app.get_webview_window(label).ok_or_else(|| format!("窗口 {label} 不存在"))
}

pub fn schedule(app: &AppHandle) {
    let startup = Arc::new(Startup::new());
    app.manage(startup.clone());
    app.manage(super::OllamaManager::new());

    let engine_app = app.clone();
    let engine_state = startup.clone();
    std::thread::spawn(move || {
        initialize_ollama(&engine_app, &engine_state.stopping);
        engine_state.state.lock().unwrap_or_else(|error| error.into_inner()).engine_finished = true;
        engine_state.changed.notify_all();
        eprintln!("[startup] engine initialization finished elapsed_ms={}", engine_state.started.elapsed().as_millis());
    });

    let window_app = app.clone();
    std::thread::spawn(move || {
        let state = startup.state.lock().unwrap_or_else(|error| error.into_inner());
        // The timeout also prepares windows if a main frontend fails before its handshake.
        drop(startup.changed.wait_timeout_while(state, Duration::from_secs(2), |state| !state.main_painted && !startup.stopping.load(Ordering::SeqCst))
            .unwrap_or_else(|error| error.into_inner()));
        for label in AUXILIARY {
            if startup.stopping.load(Ordering::SeqCst) { break; }
            let started = Instant::now();
            let result = create_auxiliary(&window_app, label);
            if startup.stopping.load(Ordering::SeqCst) {
                if let Some(window) = window_app.get_webview_window(label) { let _ = window.destroy(); }
                break;
            }
            if let Err(error) = result {
                eprintln!("[startup] hidden window failed label={label}: {error}");
                startup.window_failed(label, error);
            } else {
                eprintln!("[startup] hidden window created label={label} build_ms={}", started.elapsed().as_millis());
            }
        }
    });
}

fn initialize_ollama(app: &AppHandle, stopping: &AtomicBool) {
    if stopping.load(Ordering::SeqCst) { return; }
    // Cleanup remains path-scoped; wait for port release only if a leftover was killed.
    if super::kill_leftover_bundled_ollama() { std::thread::sleep(Duration::from_millis(300)); }
    let address = std::net::SocketAddr::from(([127, 0, 0, 1], 11434));
    let port_busy = std::net::TcpStream::connect_timeout(&address, Duration::from_millis(250)).is_ok();
    if stopping.load(Ordering::SeqCst) { return; }
    if port_busy {
        eprintln!("[ollama] port 11434 already in use — skipping bundled ollama");
        // A modal warning must not hold the engine-readiness barrier until dismissed.
        std::thread::spawn(|| {
            use windows::core::HSTRING;
            use windows::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONWARNING, MB_OK};
            let text = HSTRING::from("检测到 11434 端口已被占用(可能已有 Ollama 正在运行)。\n\n请先关闭已有的 Ollama,再重新打开本应用。\n否则本地翻译不可用。");
            let title = HSTRING::from("译刻");
            let _ = unsafe { MessageBoxW(None, &text, &title, MB_OK | MB_ICONWARNING) };
        });
        return;
    }
    let base = super::app_dir();
    let executable = base.join("ollama").join("ollama.exe");
    let models = base.join("models");
    if let Err(error) = app.state::<super::OllamaManager>().start(app.clone(), &executable.to_string_lossy(), &models.to_string_lossy()) {
        eprintln!("[ollama] start failed: {error}");
    } else {
        super::MANAGED_OLLAMA.store(true, std::sync::atomic::Ordering::SeqCst);
    }
}

fn create_auxiliary(app: &AppHandle, label: &str) -> Result<(), String> {
    let builder = WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html".into()))
        .decorations(false).always_on_top(true).skip_taskbar(true).shadow(false).visible(false);
    if label == "screenshot-overlay" {
        let (width, height) = if let Ok(Some(monitor)) = app.primary_monitor() {
            let size = monitor.size();
            (size.width as f64 / monitor.scale_factor(), size.height as f64 / monitor.scale_factor())
        } else { (1920.0, 1080.0) };
        builder.title("截图").inner_size(width, height).position(0.0, 0.0).resizable(false).build()
            .map_err(|error| error.to_string())?;
    } else {
        let title = match label { "audio-floating" => "语音窗", "audio-floating-mic" => "麦克风语音窗", _ => "翻译悬浮窗" };
        builder.title(title).inner_size(380.0, 220.0).min_inner_size(280.0, 160.0)
            .resizable(true).transparent(true).build().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn readiness_handles_early_clicks_failure_and_timeout() {
        let startup = Arc::new(Startup::new());
        let waiter = startup.clone();
        let thread = std::thread::spawn(move || waiter.wait_for_window("floating", Duration::from_secs(1)));
        startup.mark_ready("main");
        startup.mark_ready("floating");
        assert!(thread.join().unwrap().is_ok());
        startup.window_failed("audio-floating", "fixture".into());
        assert!(startup.wait_for_window("audio-floating", Duration::ZERO).unwrap_err().contains("fixture"));
        assert!(startup.wait_for_window("screenshot-overlay", Duration::ZERO).is_err());
    }

    #[test]
    fn unknown_frontend_cannot_ready_an_auxiliary_window() {
        let startup = Startup::new();
        startup.mark_ready("unexpected");
        let state = startup.state.lock().unwrap();
        assert!(!state.main_painted);
        assert!(state.windows.is_empty());
    }

    #[test]
    fn shutdown_wakes_early_window_requests_without_marking_them_ready() {
        let startup = Arc::new(Startup::new());
        let waiter = startup.clone();
        let thread = std::thread::spawn(move || waiter.wait_for_window("floating", Duration::from_secs(30)));
        {
            let _state = startup.state.lock().unwrap();
            startup.stopping.store(true, Ordering::SeqCst);
            startup.changed.notify_all();
        }
        assert_eq!(thread.join().unwrap().unwrap_err(), "应用正在退出");
        startup.mark_ready("floating");
        assert!(startup.state.lock().unwrap().windows.is_empty());
    }
}

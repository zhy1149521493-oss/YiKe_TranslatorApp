// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use tauri::Manager;

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

/// 创建(或聚焦已存在的)翻译悬浮窗:透明、无边框、置顶、跳过任务栏
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
        .invoke_handler(tauri::generate_handler![greet, ping, open_floating_window])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

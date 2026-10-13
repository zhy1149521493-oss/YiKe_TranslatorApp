//! Change only the main window's Z order, retaining its clipped desktop surface.
//!
//! Tao's generic topmost setter also reapplies cached window styles and refreshes
//! the nonclient frame. Our borderless drawer needs neither operation: changing
//! pinning must preserve its placement, maximized state and native region.

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Manager;

static DESIRED_PIN: AtomicBool = AtomicBool::new(false);

fn require_main(label: &str) -> Result<(), String> {
    if label == "main" {
        Ok(())
    } else {
        Err("Main window required".into())
    }
}

/// Read the real native bit rather than Tao's cached window flags.
#[tauri::command]
pub fn get_main_pinned(window: tauri::WebviewWindow) -> Result<bool, String> {
    require_main(window.label())?;
    native_pinned(&window)
}

#[tauri::command]
pub async fn set_main_pinned(window: tauri::WebviewWindow, pinned: bool) -> Result<bool, String> {
    require_main(window.label())?;
    let app = window.app_handle().clone();
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    app.run_on_main_thread(move || {
        let result = (|| {
            let previous = native_pinned(&window)?;
            let previous_desired = DESIRED_PIN.load(Ordering::SeqCst);
            let actual = apply_main_pin(&window, pinned)?;
            if let Err(error) = crate::save_app_config(serde_json::json!({
                "settings": { "design": { "alwaysOnTop": actual } }
            })) {
                // A failed save must not pretend the user's persistent change
                // succeeded. Restore the previous native and desired states.
                let rollback = apply_main_pin(&window, previous);
                DESIRED_PIN.store(previous_desired, Ordering::SeqCst);
                return Err(match rollback {
                    Ok(_) => error,
                    Err(rollback_error) => {
                        format!("{error}; pin rollback failed: {rollback_error}")
                    }
                });
            }
            Ok(actual)
        })();
        let _ = sender.send(result);
    })
    .map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        receiver
            .recv_timeout(std::time::Duration::from_secs(3))
            .map_err(|error| error.to_string())?
    })
    .await
    .map_err(|error| error.to_string())?
}

fn saved_pin(config: &serde_json::Value) -> bool {
    config
        .pointer("/settings/design/alwaysOnTop")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false)
}

/// Restore the persisted preference once the main HWND has been created.
pub fn restore_main_pin(window: &tauri::WebviewWindow) -> Result<bool, String> {
    require_main(window.label())?;
    let config = crate::load_app_config().unwrap_or_else(|_| serde_json::json!({}));
    let pinned = saved_pin(&config);
    DESIRED_PIN.store(pinned, Ordering::SeqCst);
    apply_main_pin(window, pinned)
}

/// Repair a generic Tao show/style operation that reapplied its cached flags.
/// Skipping an already correct bit also prevents event-driven update loops.
pub fn reapply_main_pin(window: &tauri::WebviewWindow) -> Result<bool, String> {
    require_main(window.label())?;
    let desired = DESIRED_PIN.load(Ordering::SeqCst);
    if native_pinned(window)? == desired {
        Ok(desired)
    } else {
        apply_main_pin(window, desired)
    }
}

/// Apply a restored preference on the main thread during application setup.
///
/// Only Z order changes. In particular, do not reconstruct GWL_STYLE or
/// GWL_EXSTYLE, call ShowWindow, resize, center, or remove SetWindowRgn clipping.
pub fn apply_main_pin(window: &tauri::WebviewWindow, pinned: bool) -> Result<bool, String> {
    use windows::Win32::{
        Foundation::HWND,
        UI::WindowsAndMessaging::{
            SetWindowPos, HWND_NOTOPMOST, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
        },
    };
    require_main(window.label())?;
    let raw = window.hwnd().map_err(|error| error.to_string())?;
    let hwnd = HWND(raw.0 as *mut core::ffi::c_void);
    unsafe {
        SetWindowPos(
            hwnd,
            Some(if pinned { HWND_TOPMOST } else { HWND_NOTOPMOST }),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
        )
        .map_err(|error| format!("Unable to change main-window pinning: {error}"))?;
    }
    let actual = native_pinned(window)?;
    if actual != pinned {
        return Err("Unable to verify main-window pinning".into());
    }
    DESIRED_PIN.store(pinned, Ordering::SeqCst);
    Ok(actual)
}

fn native_pinned(window: &tauri::WebviewWindow) -> Result<bool, String> {
    use windows::Win32::{
        Foundation::HWND,
        UI::WindowsAndMessaging::{GetWindowLongPtrW, GWL_EXSTYLE, WS_EX_TOPMOST},
    };
    let raw = window.hwnd().map_err(|error| error.to_string())?;
    let hwnd = HWND(raw.0 as *mut core::ffi::c_void);
    Ok(unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) } & WS_EX_TOPMOST.0 as isize != 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auxiliary_windows_cannot_change_main_pinning() {
        assert!(require_main("main").is_ok());
        for label in [
            "floating",
            "audio-floating",
            "audio-floating-mic",
            "screenshot-overlay",
            "",
        ] {
            assert!(
                require_main(label).is_err(),
                "unexpected pin access for {label}"
            );
        }
    }

    #[test]
    fn pin_preference_defaults_off_and_accepts_only_boolean_values() {
        use serde_json::json;
        assert!(!saved_pin(&json!({})));
        assert!(!saved_pin(
            &json!({"settings":{"design":{"alwaysOnTop":null}}})
        ));
        assert!(!saved_pin(
            &json!({"settings":{"design":{"alwaysOnTop":"true"}}})
        ));
        assert!(!saved_pin(
            &json!({"settings":{"design":{"alwaysOnTop":false}}})
        ));
        assert!(saved_pin(
            &json!({"settings":{"design":{"alwaysOnTop":true}}})
        ));
    }
}

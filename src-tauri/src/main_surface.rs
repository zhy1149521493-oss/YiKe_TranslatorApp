//! Main-window visibility and hit-testing; auxiliary floating windows are untouched.
use serde::Deserialize;
use tauri::Manager;

#[derive(Clone, Copy, Debug, Deserialize)]
pub struct SurfaceRect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    radius: f64,
}

impl SurfaceRect {
    fn physical(self, scale: f64, offset: (i32, i32)) -> Result<[i32; 6], String> {
        let values = [self.x, self.y, self.width, self.height, self.radius, scale];
        if values.iter().any(|v| !v.is_finite()) || self.width < 1.0 || self.height < 1.0
            || self.radius < 0.0 || scale <= 0.0
            || values.iter().any(|v| v.abs() > 100_000.0) {
            return Err("Invalid main-window surface".into());
        }
        let left = (self.x * scale).floor() as i32 + offset.0;
        let top = (self.y * scale).floor() as i32 + offset.1;
        let right = ((self.x + self.width) * scale).ceil() as i32 + offset.0;
        let bottom = ((self.y + self.height) * scale).ceil() as i32 + offset.1;
        let diameter = (self.radius.min(self.width / 2.0).min(self.height / 2.0) * 2.0 * scale).round() as i32;
        Ok([left, top, right, bottom, diameter, diameter])
    }
}

#[tauri::command]
pub async fn set_main_surface(window: tauri::WebviewWindow, bounds: Option<SurfaceRect>, popup: Option<SurfaceRect>) -> Result<(), String> {
    // This command can only shape its invoking main window, never an overlay.
    if window.label() != "main" { return Err("Main window required".into()); }
    let app = window.app_handle().clone();
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    app.run_on_main_thread(move || {
        let result = apply_surface(&window, bounds, popup);
        let _ = sender.send(result);
    }).map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        receiver.recv_timeout(std::time::Duration::from_secs(3))
            .map_err(|e| e.to_string())?
    }).await.map_err(|e| e.to_string())?
}

fn apply_surface(window: &tauri::WebviewWindow, bounds: Option<SurfaceRect>, popup: Option<SurfaceRect>) -> Result<(), String> {
    use windows::Win32::{
        Foundation::{HWND, POINT, RECT},
        Graphics::Gdi::{ClientToScreen, CombineRgn, CreateRoundRectRgn, DeleteObject, HGDIOBJ, RGN_OR, SetWindowRgn},
        UI::WindowsAndMessaging::GetWindowRect,
    };
    let raw = window.hwnd().map_err(|e| e.to_string())?;
    let hwnd = HWND(raw.0 as *mut core::ffi::c_void);
    unsafe {
        let Some(bounds) = bounds else {
            if SetWindowRgn(hwnd, None, true) == 0 { return Err("Unable to restore main-window surface".into()); }
            return Ok(());
        };
        // Regions use window coordinates; DOM rectangles use client coordinates.
        // Preserve invisible Windows frame offsets, including maximized/DPI-scaled windows.
        let mut origin = POINT::default();
        ClientToScreen(hwnd, &mut origin).ok().map_err(|e| e.to_string())?;
        let mut outer = RECT::default();
        GetWindowRect(hwnd, &mut outer).map_err(|e| e.to_string())?;
        let scale = window.scale_factor().map_err(|e| e.to_string())?;
        let offset = (origin.x - outer.left, origin.y - outer.top);
        let rect = bounds.physical(scale, offset)?;
        // Validate both rectangles before allocating GDI handles.
        let popup_rect = popup.map(|p| p.physical(scale, offset)).transpose()?;
        let region = CreateRoundRectRgn(rect[0], rect[1], rect[2], rect[3], rect[4], rect[5]);
        if region.0.is_null() { return Err("Unable to create main-window surface".into()); }
        if let Some(p) = popup_rect {
            let menu_region = CreateRoundRectRgn(p[0], p[1], p[2], p[3], p[4], p[5]);
            if menu_region.0.is_null() {
                let _ = DeleteObject(HGDIOBJ(region.0));
                return Err("Unable to create menu surface".into());
            }
            let combined = CombineRgn(Some(region), Some(region), Some(menu_region), RGN_OR);
            let _ = DeleteObject(HGDIOBJ(menu_region.0));
            if combined.0 == 0 {
                let _ = DeleteObject(HGDIOBJ(region.0));
                return Err("Unable to combine menu surface".into());
            }
        }
        if SetWindowRgn(hwnd, Some(region), true) == 0 {
            // On success Windows owns the region. Only free it after failure.
            let _ = DeleteObject(HGDIOBJ(region.0));
            return Err("Unable to apply main-window surface".into());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn scales_bounds_and_accounts_for_invisible_frame() {
        let rect = SurfaceRect { x: 0.0, y: 0.0, width: 198.0, height: 640.0, radius: 10.0 };
        assert_eq!(rect.physical(1.25, (8, 8)).unwrap(), [8, 8, 256, 808, 25, 25]);
    }
    #[test]
    fn rejects_invalid_and_clamps_corner_radius() {
        let mut rect = SurfaceRect { x: 50.2, y: 24.0, width: 42.0, height: 42.0, radius: 100.0 };
        assert_eq!(rect.physical(1.0, (0, 0)).unwrap(), [50, 24, 93, 66, 42, 42]);
        rect.width = f64::NAN;
        assert!(rect.physical(1.0, (0, 0)).is_err());
        rect.width = 0.0;
        assert!(rect.physical(1.0, (0, 0)).is_err());
        rect.width = 42.0;
        assert!(rect.physical(0.0, (0, 0)).is_err());
    }
}

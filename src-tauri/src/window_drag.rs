//! Native dragging for transparent/clipped windows and flush auxiliary docking.
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Manager;
use windows::Win32::{
    Foundation::{HWND, POINT, RECT},
    Graphics::Gdi::{ClientToScreen, CreateRectRgn, DeleteObject, HGDIOBJ, SetWindowRgn},
    UI::{Input::KeyboardAndMouse::GetAsyncKeyState, WindowsAndMessaging::{
        GetCursorPos, GetWindowRect, IsWindow, IsZoomed, SetWindowPos,
        SWP_NOACTIVATE, SWP_NOSIZE, SWP_NOZORDER,
    }},
};
use crate::floating_dock::{snap, Rect};

const FLOATS: [&str; 3] = ["floating", "audio-floating", "audio-floating-mic"];
static DRAGGING: AtomicBool = AtomicBool::new(false);
struct DragGuard;
impl Drop for DragGuard { fn drop(&mut self) { DRAGGING.store(false, Ordering::SeqCst); } }

fn rect(hwnd: HWND) -> Option<Rect> {
    let mut value = RECT::default();
    unsafe { GetWindowRect(hwnd, &mut value).ok()?; }
    Some(Rect { x: value.left, y: value.top, width: value.right - value.left, height: value.bottom - value.top })
}
fn peers(window: &tauri::WebviewWindow) -> Vec<Rect> {
    FLOATS.iter().filter(|&&label| label != window.label()).filter_map(|label| {
        let other = window.app_handle().get_webview_window(label)?;
        if !other.is_visible().ok()? || other.is_minimized().ok()? { return None; }
        rect(HWND(other.hwnd().ok()?.0 as *mut core::ffi::c_void))
    }).collect()
}

fn region_sizes() -> &'static std::sync::Mutex<std::collections::HashMap<usize, (i32, i32)>> {
    static SIZES: std::sync::OnceLock<std::sync::Mutex<std::collections::HashMap<usize, (i32, i32)>>> = std::sync::OnceLock::new();
    SIZES.get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()))
}

/// Forget a destroyed HWND so a future reused handle receives its own region.
pub fn forget_rectangular_region(window: &tauri::Window) {
    if !FLOATS.contains(&window.label()) { return; }
    if let Ok(raw) = window.hwnd() {
        region_sizes().lock().unwrap_or_else(|error| error.into_inner()).remove(&(raw.0 as usize));
    }
}

/// Full rectangular regions also disable Windows' automatic rounded silhouette.
pub fn rectangularize(window: &tauri::Window) {
    if !FLOATS.contains(&window.label()) { return; }
    let Ok(raw) = window.hwnd() else { return; };
    let hwnd = HWND(raw.0 as *mut core::ffi::c_void);
    let Some(size) = rect(hwnd) else { return; };
    let key = raw.0 as usize;
    let dimensions = (size.width, size.height);
    {
        let mut sizes = region_sizes().lock().unwrap_or_else(|error| error.into_inner());
        if sizes.get(&key) == Some(&dimensions) { return; }
        // Record before SetWindowRgn, which may synchronously send another
        // window-position/resize notification. Never hold this lock over Win32.
        sizes.insert(key, dimensions);
    }
    let applied = unsafe {
        let region = CreateRectRgn(0, 0, size.width, size.height);
        if region.0.is_null() { false }
        else if SetWindowRgn(hwnd, Some(region), true) == 0 {
            let _ = DeleteObject(HGDIOBJ(region.0));
            false
        } else { true }
    };
    if !applied {
        region_sizes().lock().unwrap_or_else(|error| error.into_inner()).remove(&key);
    }
}

#[tauri::command]
pub fn start_window_drag(window: tauri::WebviewWindow, client_x: Option<f64>, client_y: Option<f64>) -> Result<(), String> {
    begin_at(window, client_x, client_y)
}

pub fn begin(window: tauri::WebviewWindow) -> Result<(), String> {
    begin_at(window, None, None)
}

pub(crate) fn physical_press(origin: (i32, i32), scale: f64, client_x: f64, client_y: f64) -> Result<(i32, i32), String> {
    if !scale.is_finite() || scale <= 0.0 || !client_x.is_finite() || !client_y.is_finite() {
        return Err("Invalid drag press coordinates".into());
    }
    let x = f64::from(origin.0) + (client_x * scale).round();
    let y = f64::from(origin.1) + (client_y * scale).round();
    if !x.is_finite() || !y.is_finite()
        || x < f64::from(i32::MIN) || x > f64::from(i32::MAX)
        || y < f64::from(i32::MIN) || y > f64::from(i32::MAX) {
        return Err("Drag press coordinates exceed the desktop range".into());
    }
    Ok((x as i32, y as i32))
}

pub(crate) fn resize_dimensions(initial: (u32, u32), cursor: (i32, i32), start: (i32, i32), minimum: (i32, i32)) -> (i32, i32) {
    let size = |initial: u32, current: i32, pressed: i32, minimum: i32| {
        (i64::from(initial) + i64::from(current) - i64::from(pressed))
            .clamp(i64::from(minimum), i64::from(i32::MAX)) as i32
    };
    (size(initial.0, cursor.0, start.0, minimum.0), size(initial.1, cursor.1, start.1, minimum.1))
}

fn drag_position(initial: Rect, cursor: (i32, i32), start: (i32, i32)) -> Rect {
    let coordinate = |initial: i32, current: i32, pressed: i32| {
        (i64::from(initial) + i64::from(current) - i64::from(pressed))
            .clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32
    };
    Rect { x: coordinate(initial.x, cursor.0, start.0), y: coordinate(initial.y, cursor.1, start.1), ..initial }
}

pub fn begin_at(window: tauri::WebviewWindow, client_x: Option<f64>, client_y: Option<f64>) -> Result<(), String> {
    let floating = FLOATS.contains(&window.label());
    if !floating && window.label() != "main" { return Err("Unsupported drag window".into()); }
    let raw = window.hwnd().map_err(|e| e.to_string())?.0 as usize;
    // Windows' caption move restores a maximized page under the pointer and
    // retains native snap/restore behavior. Never move its monitor-sized rect
    // with NOSIZE: that would leave an off-screen window marked maximized.
    if !floating && unsafe { IsZoomed(HWND(raw as *mut core::ffi::c_void)).as_bool() } {
        return window.start_dragging().map_err(|error| error.to_string());
    }
    let initial = rect(HWND(raw as *mut core::ffi::c_void)).ok_or("Unable to read window geometry")?;
    let scale = window.scale_factor().unwrap_or(1.0);
    let threshold = (12.0 * scale).round() as i32;
    let start = match (client_x, client_y) {
        (Some(x), Some(y)) => {
            let mut origin = POINT::default();
            unsafe { ClientToScreen(HWND(raw as *mut core::ffi::c_void), &mut origin).ok().map_err(|e| e.to_string())?; }
            physical_press((origin.x, origin.y), scale, x, y)?
        }
        (None, None) => {
            let mut cursor = POINT::default();
            unsafe { GetCursorPos(&mut cursor).map_err(|e| e.to_string())?; }
            (cursor.x, cursor.y)
        }
        _ => return Err("Both drag press coordinates are required".into()),
    };
    if DRAGGING.swap(true, Ordering::SeqCst) { return Ok(()); }
    std::thread::spawn(move || {
        let _guard = DragGuard;
        let hwnd = HWND(raw as *mut core::ffi::c_void);
        let mut last = (initial.x, initial.y);
        loop {
            let mut cursor = POINT::default();
            unsafe {
                if !IsWindow(Some(hwnd)).as_bool() || GetCursorPos(&mut cursor).is_err() { break; }
                let held = GetAsyncKeyState(0x01) & i16::MIN != 0;
                // Absolute displacement avoids accumulating snap offsets: pulling away detaches.
                // The press may predate this IPC by the entire mouse gesture.
                // Still apply its final displacement when the button is released.
                let desired = drag_position(initial, (cursor.x, cursor.y), start);
                let target = if floating { snap(desired, &peers(&window), threshold).map(|p| p.rect).unwrap_or(desired) } else { desired };
                if last != (target.x, target.y) {
                    let _ = SetWindowPos(hwnd, None, target.x, target.y, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
                    last = (target.x, target.y);
                }
                if !held { break; }
            }
            std::thread::sleep(std::time::Duration::from_millis(8));
        }
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_late_resize_retains_the_released_delta_and_minimum_size() {
        let press = physical_press((38, 38), 1.5, 374.0, 214.0).unwrap();
        let released = physical_press((38, 38), 1.5, 324.0, 174.0).unwrap();
        assert_eq!(resize_dimensions((570, 330), released, press, (420, 240)), (495, 270));
        assert_eq!(resize_dimensions((570, 330), (-1000, -1000), press, (420, 240)), (420, 240));
    }

    #[test]
    fn resizing_clamps_extreme_desktop_displacements_without_overflow() {
        assert_eq!(resize_dimensions((570, 330), (i32::MAX, i32::MAX), (i32::MIN, i32::MIN), (420, 240)), (i32::MAX, i32::MAX));
    }

    #[test]
    fn press_coordinates_use_client_origin_and_fractional_monitor_scale() {
        assert_eq!(physical_press((569, 225), 1.25, 188.0, 56.0).unwrap(), (804, 295));
        assert_eq!(physical_press((-1920, -200), 1.5, 100.0, 42.0).unwrap(), (-1770, -137));
    }

    #[test]
    fn a_late_drag_command_retains_the_complete_released_displacement() {
        let initial = Rect { x: 569, y: 225, width: 640, height: 860 };
        let press = physical_press((569, 225), 1.0, 188.0, 56.0).unwrap();
        let released = physical_press((569, 225), 1.0, 288.0, 110.0).unwrap();
        assert_eq!(drag_position(initial, released, press), Rect { x: 669, y: 279, ..initial });
    }

    #[test]
    fn invalid_and_overflowing_press_coordinates_are_rejected() {
        assert!(physical_press((0, 0), 0.0, 10.0, 10.0).is_err());
        assert!(physical_press((0, 0), 1.0, f64::NAN, 10.0).is_err());
        assert!(physical_press((i32::MAX, 0), 1.0, 1.0, 0.0).is_err());
    }
}

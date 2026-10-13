//! A normal exit waits for every mounted auxiliary settings writer.
use std::collections::HashSet;
use std::sync::{Arc, Condvar, Mutex, OnceLock};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Manager, WebviewWindow};

const FLOATS: [&str; 3] = ["floating", "audio-floating", "audio-floating-mic"];
static QUITTING: AtomicBool = AtomicBool::new(false);
static NEXT_TICKET: AtomicU64 = AtomicU64::new(1);

#[derive(Default)]
struct Batch { ticket: u64, pending: HashSet<String>, error: Option<String> }
#[derive(Default)]
struct Barrier { batch: Mutex<Batch>, changed: Condvar }

impl Barrier {
    fn begin(&self, ticket: u64, labels: impl IntoIterator<Item = String>) {
        *self.batch.lock().unwrap_or_else(|error| error.into_inner()) = Batch { ticket, pending: labels.into_iter().collect(), error: None };
    }
    fn acknowledge(&self, ticket: u64, label: &str, error: Option<String>) {
        let mut batch = self.batch.lock().unwrap_or_else(|error| error.into_inner());
        // The caller's native label must belong to this exact exit attempt.
        if batch.ticket != ticket || !batch.pending.remove(label) { return; }
        if let Some(error) = error { batch.error.get_or_insert(format!("{label}: {error}")); }
        self.changed.notify_all();
    }
    fn wait(&self, timeout: Duration) -> Result<(), String> {
        let batch = self.batch.lock().unwrap_or_else(|error| error.into_inner());
        let (batch, _) = self.changed.wait_timeout_while(batch, timeout, |batch| !batch.pending.is_empty())
            .unwrap_or_else(|error| error.into_inner());
        if !batch.pending.is_empty() { return Err("悬浮窗设置仍在保存，请稍后重试退出".into()); }
        if let Some(error) = &batch.error { return Err(format!("设置未保存，已取消退出：{error}")); }
        Ok(())
    }
}

fn barrier() -> &'static Arc<Barrier> {
    static BARRIER: OnceLock<Arc<Barrier>> = OnceLock::new();
    BARRIER.get_or_init(|| Arc::new(Barrier::default()))
}

#[tauri::command]
pub fn settings_flush_finished(window: WebviewWindow, ticket: u64, error: Option<String>) {
    barrier().acknowledge(ticket, window.label(), error);
}

struct QuitGuard;
impl Drop for QuitGuard { fn drop(&mut self) { QUITTING.store(false, Ordering::SeqCst); } }

pub async fn quit(app: AppHandle) -> Result<(), String> {
    if QUITTING.swap(true, Ordering::SeqCst) { return Ok(()); }
    let guard = QuitGuard;
    let ticket = NEXT_TICKET.fetch_add(1, Ordering::SeqCst);
    let windows: Vec<_> = FLOATS.iter().filter_map(|label| app.get_webview_window(label)).collect();
    barrier().begin(ticket, windows.iter().map(|window| window.label().to_string()));
    for window in windows {
        let js = format!(r#"Promise.resolve().then(()=>window.__flushFloatingSettings?.()).then(
            ()=>window.__TAURI_INTERNALS__.invoke('settings_flush_finished',{{ticket:{ticket},error:null}}),
            error=>window.__TAURI_INTERNALS__.invoke('settings_flush_finished',{{ticket:{ticket},error:String(error)}})
        )"#);
        if let Err(error) = window.eval(&js) { barrier().acknowledge(ticket, window.label(), Some(error.to_string())); }
    }
    let pending = barrier().clone();
    tauri::async_runtime::spawn_blocking(move || pending.wait(Duration::from_secs(6)))
        .await.map_err(|error| error.to_string())??;
    super::startup::begin_shutdown(&app);
    // Destroy on a worker so WebView2 can complete native teardown on the UI loop.
    std::thread::spawn(move || {
        let _guard = guard;
        let mut windows: Vec<_> = app.webview_windows().into_values().collect();
        windows.sort_by_key(|window| window.label() == "main");
        for window in windows { if let Err(error) = window.destroy() { eprintln!("[exit] destroy {} failed: {error}", window.label()); } }
        app.exit(0);
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn stale_unknown_and_duplicate_acks_cannot_complete_an_exit() {
        let barrier = Barrier::default();
        barrier.begin(8, ["floating".into(), "audio-floating".into()]);
        barrier.acknowledge(7, "floating", None);
        barrier.acknowledge(8, "main", None);
        assert!(barrier.wait(Duration::ZERO).is_err());
        barrier.acknowledge(8, "floating", None);
        barrier.acknowledge(8, "floating", None);
        assert!(barrier.wait(Duration::ZERO).is_err());
        barrier.acknowledge(8, "audio-floating", None);
        assert!(barrier.wait(Duration::ZERO).is_ok());
    }
    #[test]
    fn a_save_failure_cancels_exit_and_a_new_attempt_can_succeed() {
        let barrier = Barrier::default();
        barrier.begin(1, ["floating".into()]);
        barrier.acknowledge(1, "floating", Some("disk failure".into()));
        assert!(barrier.wait(Duration::ZERO).unwrap_err().contains("disk failure"));
        barrier.begin(2, Vec::new());
        assert!(barrier.wait(Duration::ZERO).is_ok());
    }
    #[test]
    fn waiting_finishes_only_after_the_real_writer_ack() {
        let barrier = Arc::new(Barrier::default());
        barrier.begin(3, ["floating".into()]);
        let waiter = barrier.clone();
        let thread = std::thread::spawn(move || waiter.wait(Duration::from_secs(1)));
        barrier.acknowledge(3, "floating", None);
        assert!(thread.join().unwrap().is_ok());
    }
}

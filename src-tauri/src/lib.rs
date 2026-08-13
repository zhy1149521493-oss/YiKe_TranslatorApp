// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use tauri::Emitter;
use tauri::Manager;
use std::os::windows::process::CommandExt;
use std::process::{Command as StdCommand, Child, Stdio};
use std::sync::Mutex;
use rapidocr_core::RapidOcr;
use tauri_plugin_global_shortcut::ShortcutState;

mod audio;

/// Job Object 句柄包装:HANDLE(*mut c_void) 本身不是 Send/Sync,
/// 但内核句柄是进程级资源,跨线程移动/共享安全,显式标记以便放入 managed state。
struct JobHandle(windows::Win32::Foundation::HANDLE);
unsafe impl Send for JobHandle {}
unsafe impl Sync for JobHandle {}

/// 是否为"本应用自带的 Ollama"在提供服务(true=blob 存储就在本目录 models/blobs,可直拷;
/// false=外部 Ollama 占用了 11434,blob 位置未知,只能走 HTTP 上传)。
static MANAGED_OLLAMA: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// 管理 Ollama serve 子进程的生命周期:应用启动时 spawn,退出时杀进程树。
/// 用 Windows Job Object(KILL_ON_JOB_CLOSE)托管:应用进程退出时 Job 句柄被内核自动关闭,
/// 系统随即终止整个 Job 内的进程树(ollama + 它拉起的 llama-server),不依赖析构是否执行。
struct OllamaManager {
    child: Mutex<Option<Child>>,
    job: Mutex<Option<JobHandle>>,
}

impl OllamaManager {
    fn new() -> Self {
        Self { child: Mutex::new(None), job: Mutex::new(None) }
    }

    fn start(&self, app: tauri::AppHandle, ollama_exe: &str, models_dir: &str) -> Result<(), String> {
        use windows::Win32::Foundation::CloseHandle;
        use windows::Win32::System::JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, SetInformationJobObject,
            JobObjectExtendedLimitInformation, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        };
        use windows::Win32::System::Threading::{OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE};

        // 创建 Job Object:句柄保存在 self.job。应用进程无论以何种方式退出,
        // 该句柄都会被内核关闭 → KILL_ON_JOB_CLOSE 终止整棵 ollama 进程树。
        let job = unsafe { CreateJobObjectW(None, None) }
            .map_err(|e| format!("创建 Job Object 失败: {e}"))?;
        let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if let Err(e) = unsafe {
            SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const _,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        } {
            let _ = unsafe { CloseHandle(job) };
            return Err(format!("设置 Job Object 失败: {e}"));
        }

        // ollama.exe 必须在它所在的目录运行(依赖 ./lib/ollama/*.dll)
        let ollama_dir = std::path::Path::new(ollama_exe)
            .parent()
            .unwrap_or(std::path::Path::new("."));
        let mut child = StdCommand::new(ollama_exe)
            .arg("serve")
            .current_dir(ollama_dir)
            .env("OLLAMA_MODELS", models_dir)
            .env("OLLAMA_HOST", "127.0.0.1:11434")
            .env("OLLAMA_ORIGINS", "*") // 允许 tauri:// 页面(null Origin)访问,否则 release 版 fetch 被 403
            .env("OLLAMA_NOHISTORY", "1")
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .spawn()
            .map_err(|e| {
                let _ = unsafe { CloseHandle(job) };
                format!("启动 Ollama 失败: {e}")
            })?;

        // 读取 ollama 的 stderr,解析 GPU 检测日志("inference compute ... library=xxx"),
        // 把实际后端(cpu/gpu)发给主窗口,前端据此显示"未检测到 GPU,使用 CPU 模式"提示。
        if let Some(stderr) = child.stderr.take() {
            spawn_ollama_backend_watcher(stderr, app);
        }

        // 把 ollama 主进程放进 Job;之后它拉起的 llama-server 子进程自动继承同一 Job
        let pid = child.id();
        let assigned = unsafe {
            match OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, false, pid) {
                Ok(hproc) => {
                    let r = AssignProcessToJobObject(job, hproc);
                    let _ = CloseHandle(hproc);
                    r
                }
                Err(e) => {
                    eprintln!("[ollama] OpenProcess failed: {e}");
                    Err(e)
                }
            }
        };
        match assigned {
            Ok(()) => {
                eprintln!("[ollama] serve attached to kill-on-close job (pid={pid})");
                *self.job.lock().unwrap() = Some(JobHandle(job));
            }
            Err(e) => {
                // Job 绑定失败不阻塞启动:退回 Drop 里的 taskkill 兜底
                eprintln!("[ollama] AssignProcessToJobObject failed: {e} — fallback to taskkill");
                let _ = unsafe { CloseHandle(job) };
            }
        }
        eprintln!("[ollama] serve started (pid={pid})");
        *self.child.lock().unwrap() = Some(child);
        Ok(())
    }
}

/// 监听 ollama serve 的 stderr:ollama 启动时会输出 "inference compute ... library=CUDA/Vulkan/cpu",
/// 捕获实际选择的推理后端,emit "ollama-backend"(cpu/gpu) 到主窗口。
fn spawn_ollama_backend_watcher(stderr: std::process::ChildStderr, app: tauri::AppHandle) {
    std::thread::spawn(move || {
        use std::io::BufRead;
        let mut reader = std::io::BufReader::new(stderr);
        let mut emitted = false;
        let mut line = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line) {
                Ok(0) | Err(_) => break,
                Ok(_) => {
                    if line.contains("inference compute") {
                        let backend = line
                            .split("library=")
                            .nth(1)
                            .and_then(|s| s.split(' ').next())
                            .map(|s| s.trim())
                            .unwrap_or("cpu");
                        if !emitted {
                            emitted = true;
                            let is_cpu = backend.eq_ignore_ascii_case("cpu");
                            let _ = app.emit_to("main", "ollama-backend", if is_cpu { "cpu" } else { "gpu" });
                            eprintln!("[ollama] backend detected: {backend} (is_cpu={is_cpu})");
                        }
                    }
                }
            }
        }
    });
}

impl Drop for OllamaManager {
    fn drop(&mut self) {
        // 关闭 Job 句柄 → KILL_ON_JOB_CLOSE 终止整个 ollama 进程树(llama-server 一并被杀)
        if let Some(job) = self.job.lock().unwrap().take() {
            unsafe { let _ = windows::Win32::Foundation::CloseHandle(job.0); }
            eprintln!("[ollama] job closed (kill-on-close)");
        }
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

/// 清理本应用目录的残留 ollama 进程(上次退出异常留下的),按可执行文件路径匹配,
/// 绝不误杀朋友系统里已安装的 Ollama。taskkill 同步等待完成后再探测端口。
fn kill_leftover_bundled_ollama() {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, TH32CS_SNAPPROCESS,
        PROCESSENTRY32W,
    };
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_FORMAT, PROCESS_QUERY_LIMITED_INFORMATION,
    };

    let own_path = app_dir().join("ollama").join("ollama.exe").to_string_lossy().to_lowercase();
    unsafe {
        let Ok(snapshot) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else { return };
        let mut pids: Vec<u32> = Vec::new();
        let mut entry = PROCESSENTRY32W::default();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        if Process32FirstW(snapshot, &mut entry).is_ok() {
            loop {
                // szExeFile 是定长 C 字符串,取到第一个 \0 为止
                let name_len = entry
                    .szExeFile
                    .iter()
                    .position(|&c| c == 0)
                    .unwrap_or(entry.szExeFile.len());
                let name = String::from_utf16_lossy(&entry.szExeFile[..name_len]);
                if name.eq_ignore_ascii_case("ollama.exe") {
                    pids.push(entry.th32ProcessID);
                }
                if Process32NextW(snapshot, &mut entry).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(snapshot.into());
        for pid in pids {
            let Ok(hproc) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else { continue };
            let mut buf = [0u16; 520];
            let mut len = buf.len() as u32;
            let path = QueryFullProcessImageNameW(
                hproc,
                PROCESS_NAME_FORMAT(0),
                windows::core::PWSTR(buf.as_mut_ptr()),
                &mut len,
            )
            .map(|_| String::from_utf16_lossy(&buf[..len as usize]).to_lowercase())
            .unwrap_or_default();
            let _ = CloseHandle(hproc);
            eprintln!("[ollama] leftover check pid={pid} path={path}");
            if !path.is_empty() && path == own_path {
                eprintln!("[ollama] killing leftover bundled ollama pid={pid} ({path})");
                let _ = StdCommand::new("taskkill")
                    .args(["/pid", &pid.to_string(), "/t", "/f"])
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .creation_flags(0x08000000)
                    .output(); // 同步等待,确保杀完再探测端口
            }
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

// ============ 第8波:应用配置持久化(外接 API 供应商/引擎模式) ============
// 配置存 exe 同目录 config.json:绿色便携包拷贝到任何位置都自带配置,
// 符合"相对路径、随目录迁移"的硬性要求。Key 明文存储(个人工具,朋友自填自己的 Key)。
/// 便携定位:exe 所在目录。所有资源(ollama/models/ocr/asr/诊断文件)都相对它定位,
/// 整个文件夹拷贝到任意盘符/路径都能运行(Wave 10 硬性要求 #1)。
fn app_dir() -> std::path::PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .unwrap_or_else(|| std::path::PathBuf::from("."))
}

fn config_path() -> std::path::PathBuf {
    app_dir().join("config.json")
}

/// 读取应用配置(引擎模式 + 供应商列表);文件不存在或损坏时返回空对象
#[tauri::command]
fn load_app_config() -> serde_json::Value {
    let path = config_path();
    match std::fs::read_to_string(&path) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_else(|e| {
            eprintln!("[config] parse failed: {e}");
            serde_json::json!({})
        }),
        Err(_) => serde_json::json!({}),
    }
}

/// 保存应用配置:先写临时文件再改名,避免写入中途崩溃留下半个文件
#[tauri::command]
fn save_app_config(config: serde_json::Value) -> Result<(), String> {
    let path = config_path();
    let dir = path.parent().unwrap_or(std::path::Path::new("."));
    std::fs::create_dir_all(dir).map_err(|e| format!("创建配置目录失败: {e}"))?;
    let tmp = path.with_extension("json.tmp");
    let data = serde_json::to_string_pretty(&config).map_err(|e| format!("序列化配置失败: {e}"))?;
    std::fs::write(&tmp, data).map_err(|e| format!("写入配置失败: {e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("保存配置失败: {e}"))?;
    Ok(())
}

/// 广播设置到所有悬浮窗(外观即时生效):eval 注入,跨窗口最可靠(见 DECISIONS #014)
#[tauri::command]
fn broadcast_settings(settings: serde_json::Value, app: tauri::AppHandle) -> Result<(), String> {
    let js = format!("window.__applyAppSettings && window.__applyAppSettings({})", settings.to_string());
    for label in ["floating", "audio-floating", "audio-floating-mic"] {
        if let Some(w) = app.get_webview_window(label) {
            let _ = w.eval(&js);
        }
    }
    Ok(())
}

/// 悬浮窗快捷滑条改外观:读配置 → 合并 patch 到 settings.appearance[surface] → 存盘 → 广播
#[tauri::command]
fn update_appearance(surface: String, patch: serde_json::Value, app: tauri::AppHandle) -> Result<(), String> {
    let mut cfg: serde_json::Value = load_app_config();
    if !cfg.is_object() {
        cfg = serde_json::json!({});
    }
    let obj = cfg.as_object_mut().ok_or("配置格式错误")?;
    let settings = obj.entry("settings").or_insert_with(|| serde_json::json!({}));
    let s_obj = settings.as_object_mut().ok_or("settings 格式错误")?;
    let appearance = s_obj.entry("appearance").or_insert_with(|| serde_json::json!({}));
    let a_obj = appearance.as_object_mut().ok_or("appearance 格式错误")?;
    let target = a_obj.entry(surface).or_insert_with(|| serde_json::json!({}));
    if let (Some(t), Some(p)) = (target.as_object_mut(), patch.as_object()) {
        for (k, v) in p {
            t.insert(k.clone(), v.clone());
        }
    }
    save_app_config(cfg.clone())?;
    let s = cfg.get("settings").cloned().unwrap_or_else(|| serde_json::json!({}));
    broadcast_settings(s, app)
}

/// 显示并聚焦主窗口(托盘"打开主窗口" / 左键点击托盘用)
fn show_main_window(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.set_focus();
        // 强制抢前台:Windows 前台锁会拒绝后台进程 SetForegroundWindow。
        // 二次启动时已 AllowSetForegroundWindow(ASFW_ANY),这里再置顶兜底(TOPMOST 闪一下),
        // 确保被其他窗口盖住时也能带到最前。
        if let Ok(hwnd0) = w.hwnd() {
            unsafe {
                use windows::Win32::UI::WindowsAndMessaging::{
                    BringWindowToTop, SetWindowPos, HWND_NOTOPMOST, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
                };
                // tauri 依赖 windows 0.61,本项目用 0.62:经裸指针转换,类型不互通
                let hwnd = windows::Win32::Foundation::HWND(hwnd0.0 as usize as *mut core::ffi::c_void);
                let _ = BringWindowToTop(hwnd);
                let _ = SetWindowPos(hwnd, Some(HWND_TOPMOST), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
                let _ = SetWindowPos(hwnd, Some(HWND_NOTOPMOST), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
            }
            let _ = w.set_focus();
        }
        eprintln!("[main] shown from tray");
    }
}

/// 退出程序:主窗口"退出"按钮 / 托盘"退出"菜单调用;触发 OllamaManager Drop 清理子进程
#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    eprintln!("[app] quit requested");
    app.exit(0);
}

// ============ 第8波:外接 API Rust 代理(绕过浏览器 CORS) ============
// 中转站/中继服务(如 tokenhub)不返回 CORS 允许头,WebView fetch 会被浏览器拦截;
// Rust 侧 reqwest 直连无此限制,同时统一处理超时(chat 60s / 模型列表 20s)。
// 消息格式与 OpenAI 兼容:{"role":"user","content":...}
#[tauri::command]
async fn api_chat(
    base_url: String,
    api_key: String,
    model: String,
    messages: serde_json::Value,
    temperature: Option<f64>,
    no_thinking: bool,
    stream: bool,
    on_token: tauri::ipc::Channel<String>,
) -> Result<String, String> {
    use futures_util::StreamExt;
    let started = std::time::Instant::now();
    eprintln!("[api_chat] start url={base_url} model={model} stream={stream} no_thinking={no_thinking}");
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| {
            eprintln!("[api_chat] client build error: {e}");
            format!("创建 HTTP 客户端失败: {e}")
        })?;
    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));
    let mut body = serde_json::json!({
        "model": model.trim(),
        "messages": messages,
        "stream": stream,
    });
    if let Some(t) = temperature {
        body["temperature"] = serde_json::json!(t);
    }
    if no_thinking {
        // 推理模型(如 kimi-k2.5 / deepseek 思考版)首字极慢;支持方(如 Moonshot)接受 thinking:disabled
        body["thinking"] = serde_json::json!({ "type": "disabled" });
    }
    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", api_key.trim()))
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            eprintln!("[api_chat] network error after {}ms: {e}", started.elapsed().as_millis());
            format!("请求失败: {e}")
        })?;
    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        let msg = serde_json::from_str::<serde_json::Value>(&text)
            .ok()
            .and_then(|v| v["error"]["message"].as_str().map(|s| s.to_string()))
            .unwrap_or_else(|| text.chars().take(200).collect());
        eprintln!("[api_chat] error status={status} msg={msg}");
        return Err(format!("API {}: {}", status.as_u16(), msg));
    }
    if !stream {
        let data: serde_json::Value = resp.json().await.map_err(|e| {
            eprintln!("[api_chat] json error: {e}");
            format!("解析响应失败: {e}")
        })?;
        let out = data["choices"][0]["message"]["content"].as_str().unwrap_or("").trim().to_string();
        eprintln!("[api_chat] done stream=false out_len={} elapsed_ms={}", out.chars().count(), started.elapsed().as_millis());
        return Ok(out);
    }
    // SSE 流式解析:逐行 data: {…},choices[0].delta.content 通过 Channel 推给前端
    let mut full = String::new();
    let mut buf = String::new();
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("读取流失败: {e}"))?;
        buf.push_str(&String::from_utf8_lossy(&chunk));
        while let Some(pos) = buf.find('\n') {
            let line = buf[..pos].trim().to_string();
            buf.drain(..=pos);
            let Some(payload) = line.strip_prefix("data:") else { continue };
            let payload = payload.trim();
            if payload.is_empty() || payload == "[DONE]" {
                continue;
            }
            let Ok(v) = serde_json::from_str::<serde_json::Value>(payload) else { continue };
            let delta = &v["choices"][0]["delta"];
            if let Some(c) = delta["content"].as_str() {
                if !c.is_empty() {
                    full.push_str(c);
                    // 内容帧:前端追加到译文
                    let _ = on_token.send(serde_json::json!({ "c": c }).to_string());
                }
            } else if let Some(r) = delta["reasoning_content"].as_str() {
                if !r.is_empty() {
                    // 推理帧:前端显示"思考中"进度(不进入译文)
                    let _ = on_token.send(serde_json::json!({ "r": r }).to_string());
                }
            }
        }
    }
    eprintln!("[api_chat] done stream=true out_len={} elapsed_ms={}", full.chars().count(), started.elapsed().as_millis());
    Ok(full)
}

/// 非流式外接 API 请求:与 api_chat 共用逻辑,但不带 Channel。
/// 音频字幕/截图/划词等一次性翻译都走这里(避免 Channel 相关的 IPC 复杂度)。
#[tauri::command]
async fn api_chat_full(
    base_url: String,
    api_key: String,
    model: String,
    messages: serde_json::Value,
    temperature: Option<f64>,
    no_thinking: bool,
) -> Result<String, String> {
    let started = std::time::Instant::now();
    eprintln!("[api_chat_full] start url={base_url} model={model} no_thinking={no_thinking}");
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| {
            eprintln!("[api_chat_full] client build error: {e}");
            format!("创建 HTTP 客户端失败: {e}")
        })?;
    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));
    let mut body = serde_json::json!({
        "model": model.trim(),
        "messages": messages,
        "stream": false,
    });
    if let Some(t) = temperature {
        body["temperature"] = serde_json::json!(t);
    }
    if no_thinking {
        body["thinking"] = serde_json::json!({ "type": "disabled" });
    }
    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", api_key.trim()))
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            eprintln!("[api_chat_full] network error after {}ms: {e}", started.elapsed().as_millis());
            format!("请求失败: {e}")
        })?;
    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        let msg = serde_json::from_str::<serde_json::Value>(&text)
            .ok()
            .and_then(|v| v["error"]["message"].as_str().map(|s| s.to_string()))
            .unwrap_or_else(|| text.chars().take(200).collect());
        eprintln!("[api_chat_full] error status={status} msg={msg}");
        return Err(format!("API {}: {}", status.as_u16(), msg));
    }
    let data: serde_json::Value = resp.json().await.map_err(|e| {
        eprintln!("[api_chat_full] json error: {e}");
        format!("解析响应失败: {e}")
    })?;
    let out = data["choices"][0]["message"]["content"].as_str().unwrap_or("").trim().to_string();
    eprintln!("[api_chat_full] done out_len={} elapsed_ms={}", out.chars().count(), started.elapsed().as_millis());
    Ok(out)
}

/// 检测模型:GET {Base URL}/models → 模型 id 列表(走 Rust 代理,绕 CORS)
#[tauri::command]
async fn api_list_models(base_url: String, api_key: String) -> Result<Vec<String>, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;
    let url = format!("{}/models", base_url.trim_end_matches('/'));
    let resp = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", api_key.trim()))
        .send()
        .await
        .map_err(|e| format!("请求失败: {e}"))?;
    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        let msg = serde_json::from_str::<serde_json::Value>(&text)
            .ok()
            .and_then(|v| v["error"]["message"].as_str().map(|s| s.to_string()))
            .unwrap_or_else(|| text.chars().take(200).collect());
        return Err(format!("API {}: {}", status.as_u16(), msg));
    }
    let data: serde_json::Value = resp.json().await.map_err(|e| format!("解析响应失败: {e}"))?;
    let mut models: Vec<String> = Vec::new();
    if let Some(arr) = data["data"].as_array() {
        for m in arr {
            if let Some(id) = m["id"].as_str() {
                let id = id.trim().to_string();
                if !id.is_empty() && !models.contains(&id) {
                    models.push(id);
                }
            }
        }
    }
    Ok(models)
}

// ============ Wave 10.5: GGUF 本地模型导入 ============
// Ollama 0.32.x 的 /api/create 不再接受 Modelfile 的 FROM 路径(会报 invalid model name),
// 正确流程:1) 流式计算文件 sha256;2) 若 blob 尚未存在则 POST /api/blobs/sha256:<digest> 上传;
// 3) POST /api/create {"model", "files": {"model.gguf": "sha256:<digest>"}}。
// 大文件走 Rust 端 reqwest 流式上传,避免 WebView 内存暴涨。
#[tauri::command]
async fn import_gguf_model(model: String, path: String, on_status: tauri::ipc::Channel<String>) -> Result<String, String> {
    use sha2::Digest;
    use std::io::Read;

    let model = model.trim().to_string();
    if model.is_empty()
        || model.chars().any(|c| c.is_whitespace())
        || !model.chars().all(|c| c.is_ascii_alphanumeric() || "._:-/".contains(c))
    {
        return Err("模型名称只能包含字母、数字、. _ : - /".to_string());
    }
    let path = path.trim().to_string();
    if path.is_empty() {
        return Err("请填写 GGUF 文件路径".to_string());
    }

    let _ = on_status.send("正在校验文件(计算 SHA-256)…".into());
    // 1) 流式计算 sha256(1MB 块,大文件不占内存)
    let mut file = std::fs::File::open(&path).map_err(|e| format!("无法打开文件: {e}"))?;
    let size = file
        .metadata()
        .map_err(|e| format!("读取文件信息失败: {e}"))?
        .len();
    let mut hasher = sha2::Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = file
            .read(&mut buf)
            .map_err(|e| format!("读取文件失败: {e}"))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    let hex = format!("{:x}", hasher.finalize());
    let digest = format!("sha256:{hex}");
    eprintln!("[import] model={model} size={size} digest={digest}");

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3600))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;

    // 2) 把 GGUF 变成 Ollama 的 blob(内容寻址:文件名 sha256-<hex> 即校验)
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|d| d.to_path_buf()));
    let local_blob = exe_dir
        .as_ref()
        .map(|d| d.join("models").join("blobs").join(format!("sha256-{hex}")));
    let managed = MANAGED_OLLAMA.load(std::sync::atomic::Ordering::SeqCst);
    let mut need_upload = true;
    if managed {
        // 自带 Ollama:blob 存储就是本目录 models/blobs,直接拷贝(内容寻址)
        if let Some(blob) = &local_blob {
            if !blob.exists() {
                let _ = on_status.send(if size >= 1024 * 1024 * 1024 {
                    "正在复制模型文件到模型库(大文件需要一点时间)…".into()
                } else {
                    "正在复制模型文件到模型库…".into()
                });
                if let Some(parent) = blob.parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                std::fs::copy(&path, blob).map_err(|e| format!("复制模型文件失败: {e}"))?;
            }
            need_upload = false;
        }
    }
    if need_upload {
        let _ = on_status.send(if size >= 1024 * 1024 * 1024 {
            "正在上传模型文件(大文件需要几分钟)…".into()
        } else {
            "正在上传模型文件…".into()
        });
        let up = std::fs::File::open(&path).map_err(|e| format!("无法打开文件: {e}"))?;
        let stream = futures_util::stream::unfold(up, |mut f| async move {
            let mut chunk = vec![0u8; 1 << 20];
            match f.read(&mut chunk) {
                Ok(0) => None,
                Ok(n) => Some((Ok::<_, std::io::Error>(chunk[..n].to_vec()), f)),
                Err(e) => Some((Err(e), f)),
            }
        });
        let body = reqwest::Body::wrap_stream(stream);
        let resp = client
            .post(format!("http://127.0.0.1:11434/api/blobs/{digest}"))
            .header("Content-Type", "application/octet-stream")
            .body(body)
            .send()
            .await
            .map_err(|e| format!("上传失败: {e}"))?;
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(format!(
                "上传失败(HTTP {}): {}",
                status,
                text.chars().take(200).collect::<String>()
            ));
        }
    }

    // 3) 创建模型(files 方式;stream=false 一次性返回)
    let _ = on_status.send("正在创建模型(解析/转换 GGUF)…".into());
    let create_body = serde_json::json!({
        "model": model,
        "files": { "model.gguf": digest },
        "stream": false,
    });
    let resp = client
        .post("http://127.0.0.1:11434/api/create")
        .json(&create_body)
        .send()
        .await
        .map_err(|e| format!("创建请求失败: {e}"))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!(
            "创建模型失败(HTTP {}): {}",
            status,
            text.chars().take(200).collect::<String>()
        ));
    }
    let _ = on_status.send("导入完成".into());
    eprintln!("[import] {model} created OK");
    Ok(model)
}

// ============ 第7波:音频实时翻译 commands ============

/// 启动音频实时识别(source: "system"=电脑音频 / "mic"=麦克风)
#[tauri::command]
fn audio_subtitle_start(source: String, lang: String, app: tauri::AppHandle) -> Result<(), String> {
    let src = audio::AudioSource::from_str(&source);
    audio::start(src, &lang, app)
}

/// 停止指定来源的音频识别(source: "system" / "mic";省略则全停)
#[tauri::command]
fn audio_subtitle_stop(source: Option<String>) {
    match source {
        Some(s) => audio::stop(audio::AudioSource::from_str(&s)),
        None => audio::stop_all(),
    }
}

/// 查询指定来源是否运行中(source: "system" / "mic")
#[tauri::command]
fn audio_subtitle_running(source: Option<String>) -> bool {
    match source {
        Some(s) => audio::is_running(audio::AudioSource::from_str(&s)),
        None => audio::is_running(audio::AudioSource::System) || audio::is_running(audio::AudioSource::Mic),
    }
}

/// 获取所有语言的断句灵敏度(秒)
#[tauri::command]
fn audio_get_sensitivities() -> std::collections::HashMap<String, f32> {
    audio::all_sensitivities()
}

/// 设置某语言的断句灵敏度(秒):存值 + 广播联动(主界面/悬浮窗),不重启识别
#[tauri::command]
fn audio_set_sensitivity(lang: String, value: f32, app: tauri::AppHandle) {
    audio::set_sensitivity(&lang, value, &app);
}

/// 应用某语言的灵敏度(重启识别器使端点生效);滑块松手时调用
#[tauri::command]
fn audio_apply_sensitivity(lang: String, app: tauri::AppHandle) {
    audio::apply_sensitivity(&lang, &app);
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
        let cache = ModelCache::new(app_dir().join("ocr"));
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

/// 打开指定来源的语音窗(source: "system" / "mic";窗口 setup 时已预建,这里只 show)
#[tauri::command]
fn open_audio_floating_window(source: String, app: tauri::AppHandle) -> Result<(), String> {
    let label = audio::window_label(audio::AudioSource::from_str(&source));
    if let Some(w) = app.get_webview_window(label) {
        let _ = w.show();
        let _ = w.set_focus();
        eprintln!("[{label}] shown");
    }
    Ok(())
}

/// 关闭(隐藏)指定来源的语音窗(source: "system" / "mic")
#[tauri::command]
fn close_audio_floating_window(source: String, app: tauri::AppHandle) -> Result<(), String> {
    let label = audio::window_label(audio::AudioSource::from_str(&source));
    if let Some(w) = app.get_webview_window(label) {
        eprintln!("[{label}] hiding...");
        // 先清空内容,再隐藏(确保用户看不到残留)
        let _ = w.eval("window.__audioShow && window.__audioShow({text:'',src:'',tgt:'',result:''})");
        let _ = w.hide();
        eprintln!("[{label}] hidden");
    } else {
        eprintln!("[{label}] close: window not found");
    }
    Ok(())
}

/// 主窗口 → 语音窗中转:直接用 eval 注入 JS 到语音窗 webview
/// (绕开 Tauri 事件系统——跨窗口 emit 在本环境不可靠,静默丢失)
/// source: "system" → audio-floating 窗 / "mic" → audio-floating-mic 窗
#[tauri::command]
fn audio_forward_to_floating(
    source: String,
    text: String,
    src: String,
    tgt: String,
    result: String,
    role: String, // "cur"=当前句(partial 增量翻译), "prev"=上一句(定稿句翻译)
    app: tauri::AppHandle,
) -> Result<(), String> {
    use tauri::Manager as _;
    let label = audio::window_label(audio::AudioSource::from_str(&source));
    let has = app.get_webview_window(label).is_some();
    let labels: Vec<String> = app.webview_windows().keys().cloned().collect();
    eprintln!("[audio] forward: to={label} has={has} windows={labels:?} src={src} tgt={tgt} text_len={} result_len={}", text.chars().count(), result.chars().count());
    let Some(w) = app.get_webview_window(label) else {
        return Err(format!("{label} 窗口不存在"));
    };
    // 转义 payload 为 JS 字符串(JSON 序列化后嵌入)
    let js_payload = serde_json::json!({ "text": text, "src": src, "tgt": tgt, "result": result, "role": role }).to_string();
    let js = format!("window.__audioShow && window.__audioShow({js_payload})");
    w.eval(&js)
        .map_err(|e| format!("eval 到语音窗失败: {e}"))?;
    eprintln!("[audio] forward eval OK");
    Ok(())
}

/// 语音窗系统级拖动:Rust 循环移动窗口直到鼠标释放
/// (startDragging / 前端 setPosition 在本窗口均无效:前者系统拖拽被透明窗口吞,
///  后者鼠标移出 WebView 后 mousemove 丢失。这里 GetCursorPos 轮询 + tauri set_position,
///  不依赖 WebView 事件,鼠标移出窗口仍可拖动)
#[tauri::command]
fn audio_floating_drag_begin(source: String, app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager as _;
    let label = audio::window_label(audio::AudioSource::from_str(&source));
    let Some(w) = app.get_webview_window(label) else {
        return Err(format!("{label} 窗口不存在"));
    };
    // 拖动进行中则忽略重复触发(防多线程并发竞争窗口位置)
    static DRAGGING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    if DRAGGING.swap(true, std::sync::atomic::Ordering::SeqCst) {
        return Ok(());
    }
    // 用系统级 SetWindowPos 直接移动(无 IPC 延迟,比 tauri set_position 顺滑)
    let hwnd0 = w.hwnd().map_err(|e| format!("获取窗口句柄失败: {e}"))?;
    let hwnd_raw = hwnd0.0 as usize; // usize 可跨线程 Send
    let pos0 = w.outer_position().map_err(|e| format!("读取窗口位置失败: {e}"))?;
    std::thread::spawn(move || {
        use windows::Win32::Foundation::POINT;
        use windows::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState;
        use windows::Win32::UI::WindowsAndMessaging::{
            GetCursorPos, SetWindowPos, SWP_NOACTIVATE, SWP_NOSIZE, SWP_NOZORDER,
        };
        let hwnd = windows::Win32::Foundation::HWND(hwnd_raw as *mut core::ffi::c_void);
        unsafe {
            // 记录鼠标起点与窗口起点
            let mut start = POINT::default();
            let _ = GetCursorPos(&mut start);
            let mut win_x = pos0.x;
            let mut win_y = pos0.y;
            let mut last_x = start.x;
            let mut last_y = start.y;
            // 循环:窗口位置 += 鼠标位移增量(系统级移动,无 IPC,跟手)
            loop {
                let mut p = POINT::default();
                let _ = GetCursorPos(&mut p);
                // 左键已释放 → 结束
                if GetAsyncKeyState(0x01) & (0x8000u16 as i16) == 0 {
                    break;
                }
                let dx = p.x - last_x;
                let dy = p.y - last_y;
                last_x = p.x;
                last_y = p.y;
                if dx != 0 || dy != 0 {
                    win_x += dx;
                    win_y += dy;
                    let _ = SetWindowPos(
                        hwnd,
                        None,
                        win_x,
                        win_y,
                        0,
                        0,
                        SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE,
                    );
                }
                std::thread::sleep(std::time::Duration::from_millis(4));
            }
            DRAGGING.store(false, std::sync::atomic::Ordering::SeqCst);
            eprintln!("[audio-floating] drag end");
        }
    });
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
            .resizable(true)
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

// ============ Wave 9: 可配置全局快捷键 ============
// 组合键存 config.json settings.shortcuts(action → "Ctrl+Shift+D" 等;空字符串 = 禁用)。
// 设置中心改键后调用 apply_shortcuts 重新注册:先 unregister_all,再逐个注册。
fn apply_shortcuts_impl(
    app: &tauri::AppHandle,
    shortcuts: &std::collections::HashMap<String, String>,
) -> Result<(), String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    let mut items: Vec<(String, String)> = shortcuts
        .iter()
        .map(|(a, c)| (a.clone(), c.trim().to_string()))
        .filter(|(_, c)| !c.is_empty())
        .collect();
    items.sort();
    let mut registered = 0usize;
    for (action, combo) in items {
        let act = action.clone();
        let ok = gs.on_shortcut(combo.as_str(), move |app, _s, e| {
            if e.state == ShortcutState::Pressed {
                let _ = app.emit_to("main", "global-shortcut", act.clone());
            }
        });
        if let Err(e) = ok {
            eprintln!("[shortcut] register {combo} failed: {e}");
            return Err(format!("注册快捷键 {combo} 失败: {e}"));
        }
        registered += 1;
        eprintln!("[shortcut] registered {combo} -> {action}");
    }
    eprintln!("[shortcut] total registered: {registered}");
    Ok(())
}

/// 应用快捷键配置(设置中心保存后调用):空字符串 = 该动作无快捷键
#[tauri::command]
fn apply_shortcuts(shortcuts: std::collections::HashMap<String, String>, app: tauri::AppHandle) -> Result<(), String> {
    apply_shortcuts_impl(&app, &shortcuts)
}

// ============ 单实例(2026-08-12) ============
// 命名互斥体检测重复实例;二次启动时通过命名事件通知已有实例把主窗口带到前台,然后本实例退出。
// 放在 run() 最前面:重复实例不会执行 ollama 清理/启动逻辑,不会误杀已有实例的子进程。
const INSTANCE_MUTEX_NAME: &str = "Local\\TranslatorAssistant_SingleInstance";
static INSTANCE_MUTEX: std::sync::OnceLock<usize> = std::sync::OnceLock::new();

fn acquire_single_instance() -> bool {
    use windows::core::HSTRING;
    use windows::Win32::Foundation::{GetLastError, ERROR_ALREADY_EXISTS};
    use windows::Win32::System::Threading::CreateMutexW;
    use windows::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONINFORMATION, MB_OK};
    unsafe {
        let mutex_name = HSTRING::from(INSTANCE_MUTEX_NAME);
        let m = match CreateMutexW(None, true, &mutex_name) {
            Ok(h) => h,
            Err(e) => {
                eprintln!("[single-instance] mutex create failed: {e}, continuing anyway");
                return true;
            }
        };
        let already = GetLastError() == ERROR_ALREADY_EXISTS;
        if already {
            // 已有实例:弹提示后退出(用户决定不做"显示到顶层",只保证单实例)
            let text = HSTRING::from("该应用正在运行");
            let title = HSTRING::from("译刻");
            let _ = MessageBoxW(None, &text, &title, MB_OK | MB_ICONINFORMATION);
            return false;
        }
        let _ = INSTANCE_MUTEX.set(m.0 as usize);
        true
    }
}

/// 最小化主窗口(JS minimize 曾失效,直接走系统 ShowWindow,绕过 WebView/JS 层)
#[tauri::command]
fn minimize_main_window(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager as _;
    if let Some(w) = app.get_webview_window("main") {
        let hwnd0 = w.hwnd().map_err(|e| format!("获取窗口句柄失败: {e}"))?;
        let hwnd = windows::Win32::Foundation::HWND(hwnd0.0 as usize as *mut core::ffi::c_void);
        unsafe {
            use windows::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_MINIMIZE};
            let _ = ShowWindow(hwnd, SW_MINIMIZE);
        }
        eprintln!("[main] minimized via ShowWindow");
    }
    Ok(())
}

/// 最大化/还原主窗口(JS toggleMaximize 曾失效,直接走系统 ShowWindow)
#[tauri::command]
fn toggle_maximize_main_window(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager as _;
    if let Some(w) = app.get_webview_window("main") {
        let hwnd0 = w.hwnd().map_err(|e| format!("获取窗口句柄失败: {e}"))?;
        let hwnd = windows::Win32::Foundation::HWND(hwnd0.0 as usize as *mut core::ffi::c_void);
        unsafe {
            use windows::Win32::UI::WindowsAndMessaging::{IsZoomed, ShowWindow, SW_MAXIMIZE, SW_RESTORE};
            if IsZoomed(hwnd).as_bool() {
                let _ = ShowWindow(hwnd, SW_RESTORE);
            } else {
                let _ = ShowWindow(hwnd, SW_MAXIMIZE);
            }
        }
        eprintln!("[main] toggle maximize via ShowWindow");
    }
    Ok(())
}

// ============ 悬浮窗缩放(透明窗 startResizeDragging 无效,改用系统轮询) ============
#[tauri::command]
fn floating_resize_begin(kind: String, app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager as _;
    let label = match kind.as_str() {
        "audio" => "audio-floating",
        "audioMic" => "audio-floating-mic",
        _ => "floating",
    };
    let Some(w) = app.get_webview_window(label) else {
        return Err(format!("{label} 窗口不存在"));
    };
    static RESIZING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    if RESIZING.swap(true, std::sync::atomic::Ordering::SeqCst) {
        return Ok(());
    }
    let hwnd0 = w.hwnd().map_err(|e| format!("获取窗口句柄失败: {e}"))?;
    let hwnd_raw = hwnd0.0 as usize;
    let size0 = w.outer_size().map_err(|e| format!("读取窗口尺寸失败: {e}"))?;
    let scale = w.scale_factor().unwrap_or(1.0);
    let min_w = (280.0 * scale).round() as i32;
    let min_h = (160.0 * scale).round() as i32;
    std::thread::spawn(move || {
        use windows::Win32::Foundation::POINT;
        use windows::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState;
        use windows::Win32::UI::WindowsAndMessaging::{GetCursorPos, SetWindowPos, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOZORDER};
        let hwnd = windows::Win32::Foundation::HWND(hwnd_raw as *mut core::ffi::c_void);
        unsafe {
            let mut start = POINT::default();
            let _ = GetCursorPos(&mut start);
            loop {
                if GetAsyncKeyState(0x01) & (0x8000u16 as i16) == 0 { break; }
                let mut p = POINT::default();
                let _ = GetCursorPos(&mut p);
                let cur_w = (size0.width as i32 + (p.x - start.x)).max(min_w);
                let cur_h = (size0.height as i32 + (p.y - start.y)).max(min_h);
                let _ = SetWindowPos(hwnd, None, 0, 0, cur_w as i32, cur_h as i32, SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE);
                std::thread::sleep(std::time::Duration::from_millis(4));
            }
            RESIZING.store(false, std::sync::atomic::Ordering::SeqCst);
            eprintln!("[{label}] resize end");
        }
    });
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 单实例:已有一个实例在运行 → 让它显示到顶层,本实例直接退出
    if !acquire_single_instance() {
        eprintln!("[single-instance] another instance is running, bringing it to front and exiting");
        std::process::exit(0);
    }

    // 【WebView2 缺失引导(Wave 10)】界面依赖 WebView2 Runtime;
    // 缺失时 Tauri 窗口必然创建失败,直接提示 + 打开官方下载页 + 退出。
    if !webview2_installed() {
        use windows::core::HSTRING;
        use windows::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONWARNING, MB_OK};
        let text = HSTRING::from("检测到系统缺少 WebView2 运行时,本应用无法显示界面。\n\n即将打开微软官方下载页,安装后请重新运行本应用。");
        let title = HSTRING::from("译刻");
        let _ = unsafe { MessageBoxW(None, &text, &title, MB_OK | MB_ICONWARNING) };
        let _ = StdCommand::new("cmd")
            .args([
                "/c",
                "start",
                "",
                "https://developer.microsoft.com/microsoft-edge/webview2/",
            ])
            .creation_flags(0x08000000) // CREATE_NO_WINDOW:隐藏 cmd 窗口,start 打开默认浏览器
            .spawn();
        std::process::exit(1);
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![greet, ping, quit_app, minimize_main_window, toggle_maximize_main_window, load_app_config, save_app_config, broadcast_settings, update_appearance, apply_shortcuts, floating_resize_begin, api_chat, api_chat_full, api_list_models, import_gguf_model, capture_fullscreen, ocr_image_b64, win_ocr_b64, screenshot_ocr, subtitle_frame, open_screenshot_overlay, open_floating_window, close_floating_window, open_audio_floating_window, close_audio_floating_window, audio_forward_to_floating, audio_floating_drag_begin, audio_subtitle_start, audio_subtitle_stop, audio_subtitle_running, audio_get_sensitivities, audio_set_sensitivity, audio_apply_sensitivity])
        .setup(|app| {
            // 【Ollama 启动(Wave 10 便携版)】
            // 1) 先清理上次退出异常留下的"本应用目录" ollama(按 exe 路径匹配,不误杀朋友系统的 Ollama)
            // 2) 再探测 127.0.0.1:11434;仍被占用(朋友已有 Ollama 在跑)→ 弹窗提示,不启动自带引擎
            // 3) 空闲 → 启动本目录 ollama\ollama.exe serve(OLLAMA_MODELS = 本目录 models),Job Object 托管
            kill_leftover_bundled_ollama();
            std::thread::sleep(std::time::Duration::from_millis(300));
            eprintln!("[ollama] probing 127.0.0.1:11434...");
            let port_busy = std::net::TcpStream::connect("127.0.0.1:11434").is_ok();
            let mgr = OllamaManager::new();
            if port_busy {
                eprintln!("[ollama] port 11434 already in use — skipping bundled ollama");
                use windows::core::HSTRING;
                use windows::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONWARNING, MB_OK};
                let text = HSTRING::from("检测到 11434 端口已被占用(可能已有 Ollama 正在运行)。\n\n请先关闭已有的 Ollama,再重新打开本应用。\n否则本地翻译不可用。");
                let title = HSTRING::from("译刻");
                let _ = unsafe { MessageBoxW(None, &text, &title, MB_OK | MB_ICONWARNING) };
            } else {
                let base = app_dir();
                let ollama_exe = base.join("ollama").join("ollama.exe");
                let models_dir = base.join("models");
                eprintln!(
                    "[ollama] starting serve: {} models={}",
                    ollama_exe.display(),
                    models_dir.display()
                );
                if let Err(e) = mgr.start(
                    app.handle().clone(),
                    &ollama_exe.to_string_lossy(),
                    &models_dir.to_string_lossy(),
                ) {
                    eprintln!("[ollama] start failed: {e}");
                    // 不阻塞应用,翻译功能暂时不可用
                } else {
                    eprintln!("[ollama] serve started OK");
                    MANAGED_OLLAMA.store(true, std::sync::atomic::Ordering::SeqCst);
                }
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
                    .resizable(true)
                    .decorations(false)
                    .transparent(true)
                    .always_on_top(true)
                    .skip_taskbar(true)
                    .shadow(false)
                    .visible(false)
                    .build();
                // 音频字幕独立语音窗(右下角,透明置顶;与视频字幕窗分开)
                let _ = WebviewWindowBuilder::new(handle, "audio-floating", WebviewUrl::App("index.html".into()))
                    .title("语音窗")
                    .inner_size(380.0, 220.0) // 恢复默认大小(用户要求);四行紧凑显示
                    .min_inner_size(280.0, 160.0)
                    .resizable(true)
                    .decorations(false)
                    .transparent(true)
                    .always_on_top(true)
                    .skip_taskbar(true)
                    .shadow(false)
                    .visible(false)
                    .build();
                // 麦克风语音窗(独立窗口,与电脑音频窗分开)
                let _ = WebviewWindowBuilder::new(handle, "audio-floating-mic", WebviewUrl::App("index.html".into()))
                    .title("麦克风语音窗")
                    .inner_size(380.0, 220.0) // 恢复默认大小(用户要求);四行紧凑显示
                    .min_inner_size(280.0, 160.0)
                    .resizable(true)
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
                eprintln!("[setup] 预建隐藏窗口完成(floating / screenshot-overlay / audio-floating)");
                // 诊断:打印所有 webview window 的 label(确认 audio-floating 的 label)
                let ww: Vec<String> = app
                    .webview_windows()
                    .iter()
                    .map(|(l, _)| l.clone())
                    .collect();
                eprintln!("[setup] webview_windows: {ww:?}");
            }

            // 【全局快捷键:Rust 侧注册(Wave 9 起可配置)】
            // 只在 Rust 注册一次,事件统一 emit 到主窗口,由前端监听处理(避免 release 版
            // 多窗口重复注册 RegisterHotKey 冲突,事件被隐藏窗口独占的问题)。
            // 组合键从 config.json settings.shortcuts 读取(action → accelerator;空=禁用);
            // 配置缺失时回退默认 Ctrl+Shift+D/S/U(音频字幕默认无快捷键)。
            {
                let mut shortcuts: std::collections::HashMap<String, String> = std::fs::read_to_string(config_path())
                    .ok()
                    .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
                    .and_then(|v| v.get("settings").and_then(|x| x.get("shortcuts")).cloned())
                    .and_then(|v| serde_json::from_value::<std::collections::HashMap<String, String>>(v).ok())
                    .unwrap_or_default();
                if shortcuts.is_empty() {
                    shortcuts.insert("toggle-floating".to_string(), "Ctrl+Shift+D".to_string());
                    shortcuts.insert("screenshot".to_string(), "Ctrl+Shift+S".to_string());
                    shortcuts.insert("toggle-subtitle".to_string(), "Ctrl+Shift+U".to_string());
                    shortcuts.insert("toggle-audio-subtitle".to_string(), String::new());
                }
                if let Err(e) = apply_shortcuts_impl(app.handle(), &shortcuts) {
                    eprintln!("[shortcut] setup register error: {e}");
                }
            }

            // 【系统托盘】常驻工具的标准退出/恢复入口(第 8 波收尾):
            // 左键点击=打开主窗口;菜单=打开主窗口 / 退出。
            // 配合"主窗口 ✕ = 隐藏到后台",让用户明确知道程序仍在运行并可随时退出。
            {
                use tauri::menu::{Menu, MenuItem};
                use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
                if let Some(icon) = app.default_window_icon().cloned() {
                    let show_item = MenuItem::with_id(app, "show", "打开主窗口", true, None::<&str>)?;
                    let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
                    let menu = Menu::with_items(app, &[&show_item, &quit_item])?;
                    TrayIconBuilder::with_id("main-tray")
                        .icon(icon)
                        .menu(&menu)
                        .show_menu_on_left_click(false)
                        .on_menu_event(|app, event| match event.id.as_ref() {
                            "show" => show_main_window(app),
                            "quit" => app.exit(0),
                            _ => {}
                        })
                        .on_tray_icon_event(|tray, event| {
                            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                                show_main_window(tray.app_handle());
                            }
                        })
                        .build(app)?;
                    eprintln!("[tray] created (打开主窗口 / 退出)");
                } else {
                    eprintln!("[tray] default icon missing, tray skipped");
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    eprintln!("[win] {} CloseRequested", window.label());
                    if window.label() == "main" {
                        // 主窗口 ✕ 行为由 config.json 的 mainClose 决定(Wave 9 设置面板提供 UI):
                        //   hide = 隐藏到托盘(默认,驻留模式:后台功能继续,托盘可恢复/退出)
                        //   quit = 直接退出整个应用(含清理 Ollama 子进程)
                        let main_close = std::fs::read_to_string(config_path())
                            .ok()
                            .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
                            .and_then(|v| v.get("mainClose").and_then(|m| m.as_str()).map(|s| s.to_string()))
                            .unwrap_or_else(|| "hide".to_string());
                        api.prevent_close();
                        if main_close == "quit" {
                            eprintln!("[main] CloseRequested → quit app (mainClose=quit)");
                            // 先显式销毁所有窗口(WebView2 正确关闭,避免 msedgewebview2 子进程残留),
                            // 再请求退出。延迟 150ms 避开 CloseRequested 处理中的窗口状态;
                            // 若 exit 仍不生效,全部窗口销毁会触发最后一个窗口 Destroyed → 事件循环
                            // Exit → 进程正常退出,两条路都能保证退出。
                            let handle = window.app_handle().clone();
                            std::thread::spawn(move || {
                                std::thread::sleep(std::time::Duration::from_millis(150));
                                for (_, w) in handle.webview_windows() {
                                    let _ = w.destroy();
                                }
                                handle.exit(0);
                            });
                        } else {
                            let _ = window.hide();
                            eprintln!("[main] hidden to tray (resident mode, mainClose=hide)");
                        }
                    }
                }
                tauri::WindowEvent::Destroyed => eprintln!("[win] {} Destroyed", window.label()),
                _ => {}
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// 检测 WebView2 Runtime 是否安装(检查 EdgeWebView 安装目录,Win11 一般自带)
fn webview2_installed() -> bool {
    let candidates = [
        r"C:\Program Files (x86)\Microsoft\EdgeWebView\Application",
        r"C:\Program Files\Microsoft\EdgeWebView\Application",
    ];
    candidates.iter().any(|p| std::path::Path::new(p).exists())
}

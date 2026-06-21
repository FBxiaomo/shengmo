use super::*;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkCheckResult {
    pub online: bool,
    pub latency_ms: Option<u64>,
}

#[tauri::command]
pub async fn check_network() -> NetworkCheckResult {
    // Auto-update and marketplace connections removed; report online unconditionally.
    NetworkCheckResult {
        online: true,
        latency_ms: None,
    }
}

#[tauri::command]
pub fn get_hotkey_status(coord: CoordinatorState<'_>) -> HotkeyStatus {
    #[cfg(mobile)]
    {
        let _ = coord;
        return HotkeyStatus {
            adapter: crate::types::HotkeyAdapterKind::Unavailable,
            state: crate::types::HotkeyStatusState::Failed,
            message: Some("移动端不支持全局热键".into()),
            last_error: Some(crate::types::HotkeyInstallError {
                code: "unavailable".into(),
                message: "Global hotkeys are not available on mobile".into(),
            }),
        };
    }
    #[cfg(not(mobile))]
    coord.hotkey_status()
}

#[tauri::command]
pub fn get_hotkey_capability(coord: CoordinatorState<'_>) -> HotkeyCapability {
    #[cfg(mobile)]
    {
        let _ = coord;
        return HotkeyCapability::current();
    }
    #[cfg(not(mobile))]
    coord.hotkey_capability()
}

#[tauri::command]
pub fn set_shortcut_recording_active(coord: CoordinatorState<'_>, active: bool) {
    #[cfg(mobile)]
    {
        let _ = (coord, active);
        return;
    }
    #[cfg(not(mobile))]
    coord.set_shortcut_recording_active(active);
}

#[tauri::command]
#[cfg(mobile)]
pub fn list_microphone_devices() -> Result<Vec<crate::recorder::MicrophoneDevice>, String> {
    Ok(Vec::new())
}

#[tauri::command]
#[cfg(not(mobile))]
pub fn list_microphone_devices() -> Result<Vec<crate::recorder::MicrophoneDevice>, String> {
    crate::recorder::list_input_devices().map_err(|e| e.to_string())
}

#[tauri::command]
#[cfg(mobile)]
pub async fn start_microphone_level_monitor(
    _app: AppHandle,
    _device_name: String,
) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
#[cfg(not(mobile))]
pub async fn start_microphone_level_monitor(
    app: AppHandle,
    device_name: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<MicrophoneMonitorState>();
        if let Some(existing) = state.lock().take() {
            existing.stop();
        }

        let selected = device_name.trim().to_string();
        let microphone_device_name = if selected.is_empty() {
            None
        } else {
            Some(selected)
        };
        let consumer: Arc<dyn AudioConsumer> = Arc::new(LevelProbeConsumer);
        let level_app = app.clone();
        let level_handler: Arc<dyn Fn(f32) + Send + Sync> = Arc::new(move |level| {
            let _ = level_app.emit("microphone:level", serde_json::json!({ "level": level }));
        });
        let (recorder, _runtime_errors, _archive_active) =
            Recorder::start(microphone_device_name, consumer, level_handler, None)
                .map_err(|e| e.to_string())?;
        *state.lock() = Some(recorder);
        Ok(())
    })
    .await
    .map_err(|e| format!("start microphone monitor task failed: {e}"))?
}

#[tauri::command]
pub async fn stop_microphone_level_monitor(app: AppHandle) {
    #[cfg(mobile)]
    {
        let _ = app;
        return;
    }
    #[cfg(not(mobile))]
    let _ = tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<MicrophoneMonitorState>();
        let recorder = state.lock().take();
        if let Some(recorder) = recorder {
            recorder.stop();
        }
    })
    .await;
}

/// 把当前会话的 openless.log 复制到用户选择的位置（前端用 plugin-dialog 拿 target_path）。
/// 路径来自 lib::log_dir_path() —— mac: ~/Library/Logs/OpenLess/openless.log，
/// windows: %LOCALAPPDATA%\OpenLess\Logs\openless.log。
#[tauri::command]
pub fn export_error_log(target_path: String) -> Result<(), String> {
    let src = crate::log_dir_path().join("openless.log");
    if !src.exists() {
        return Err(format!("日志文件不存在：{}", src.display()));
    }
    std::fs::copy(&src, std::path::Path::new(&target_path))
        .map(|_| ())
        .map_err(|e| format!("复制日志失败：{}", e))
}

/// 返回当前进程的内存占用（跨平台 RSS / working set）。
/// macOS 上会聚合 WKWebView 等子进程的内存。
/// 移动端返回零值。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessMemoryInfo {
    /// 物理内存占用 (bytes) – Windows 工作集 / Linux RSS / macOS 常驻内存（含子进程）。
    pub memory_bytes: u64,
    /// 虚拟内存占用 (bytes)。
    pub virtual_bytes: u64,
    /// 运行平台: "windows" | "macos" | "linux"，供前端决定显示策略。
    pub platform: String,
}

#[tauri::command]
#[cfg(not(mobile))]
pub fn get_process_memory() -> ProcessMemoryInfo {
    use sysinfo::{Pid, ProcessesToUpdate, System};
    let my_pid = Pid::from(std::process::id() as usize);
    let mut s = System::new();
    // 刷新所有进程以捕获子进程（macOS WKWebView 渲染进程）
    s.refresh_processes(ProcessesToUpdate::All, true);

    let mut mem = 0u64;
    let mut virt = 0u64;
    for (pid, p) in s.processes() {
        if *pid == my_pid || p.parent() == Some(my_pid) {
            mem += p.memory();
            virt += p.virtual_memory();
        }
    }

    let platform = if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "linux"
    }
    .to_string();

    ProcessMemoryInfo {
        memory_bytes: mem,
        virtual_bytes: virt,
        platform,
    }
}

#[tauri::command]
#[cfg(mobile)]
pub fn get_process_memory() -> ProcessMemoryInfo {
    ProcessMemoryInfo {
        memory_bytes: 0,
        virtual_bytes: 0,
        platform: "mobile".to_string(),
    }
}

/// 显存占用信息。Windows 上通过 DXGI 获取；macOS（统一内存）返回 available=false。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuMemoryInfo {
    pub used_bytes: u64,
    pub available: bool,
}

#[tauri::command]
#[cfg(target_os = "windows")]
pub fn get_gpu_memory() -> GpuMemoryInfo {
    use windows::Win32::System::Performance::{
        PdhAddEnglishCounterW, PdhCloseQuery, PdhCollectQueryData, PdhGetFormattedCounterValue,
        PdhOpenQueryW, PDH_FMT_COUNTERVALUE, PDH_FMT_LARGE,
    };

    unsafe {
        let mut query: isize = 0;
        if PdhOpenQueryW(None, 0, &mut query) != 0 {
            return GpuMemoryInfo {
                used_bytes: 0,
                available: false,
            };
        }

        let mut dedicated_counter: isize = 0;
        let mut shared_counter: isize = 0;
        let _ = PdhAddEnglishCounterW(
            query,
            windows::core::w!(r"\GPU Adapter Memory(*)\Dedicated Usage"),
            0,
            &mut dedicated_counter,
        );
        let _ = PdhAddEnglishCounterW(
            query,
            windows::core::w!(r"\GPU Adapter Memory(*)\Shared Usage"),
            0,
            &mut shared_counter,
        );

        // First call establishes baseline; second call gets actual values.
        let _ = PdhCollectQueryData(query);
        let _ = PdhCollectQueryData(query);

        let mut total_used = 0u64;

        if dedicated_counter != 0 {
            let mut value: PDH_FMT_COUNTERVALUE = std::mem::zeroed();
            if PdhGetFormattedCounterValue(dedicated_counter, PDH_FMT_LARGE, None, &mut value) == 0
            {
                total_used += value.Anonymous.largeValue as u64;
            }
        }

        if shared_counter != 0 {
            let mut value: PDH_FMT_COUNTERVALUE = std::mem::zeroed();
            if PdhGetFormattedCounterValue(shared_counter, PDH_FMT_LARGE, None, &mut value) == 0 {
                total_used += value.Anonymous.largeValue as u64;
            }
        }

        let _ = PdhCloseQuery(query);

        GpuMemoryInfo {
            used_bytes: total_used,
            available: true,
        }
    }
}

#[tauri::command]
#[cfg(not(any(target_os = "windows", mobile)))]
pub fn get_gpu_memory() -> GpuMemoryInfo {
    // macOS / Linux：统一内存或无 DXGI，不显示显存
    GpuMemoryInfo {
        used_bytes: 0,
        available: false,
    }
}

#[tauri::command]
#[cfg(mobile)]
pub fn get_gpu_memory() -> GpuMemoryInfo {
    GpuMemoryInfo {
        used_bytes: 0,
        available: false,
    }
}

/// 进入迷你模式：隐藏主窗口，显示迷你浮窗到屏幕右下角。
#[tauri::command]
pub fn enter_mini_mode(app: tauri::AppHandle) -> Result<(), String> {
    if crate::show_mini_window(&app) {
        Ok(())
    } else {
        Err("无法创建迷你窗口".into())
    }
}

/// 退出迷你模式：隐藏迷你浮窗，恢复主窗口。
#[tauri::command]
pub fn exit_mini_mode(app: tauri::AppHandle) {
    crate::hide_mini_window(&app);
}

// ─────────────────────────── unused but exported (silences dead_code) ───────────────────────────

#[allow(dead_code)]
fn _ensure_snapshot_used(_: CredentialsSnapshot) {}

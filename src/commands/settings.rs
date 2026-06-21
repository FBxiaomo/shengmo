use super::*;

#[tauri::command]
pub fn get_settings(coord: CoordinatorState<'_>) -> UserPreferences {
    coord.prefs().get()
}

#[tauri::command]
pub fn get_default_style_system_prompts() -> StyleSystemPrompts {
    StyleSystemPrompts::default()
}

pub(crate) trait SettingsWriter {
    fn read_settings(&self) -> UserPreferences;
    fn write_settings(&self, prefs: UserPreferences) -> Result<(), String>;
    fn sync_active_asr_provider(&self, provider: &str) -> Result<(), String>;
    fn refresh_dictation_hotkey(&self);
    fn refresh_qa_hotkey(&self);
    fn refresh_combo_hotkey(&self);
    fn refresh_translation_hotkey(&self);
    fn refresh_switch_style_hotkey(&self);
    fn refresh_open_app_hotkey(&self);
    fn refresh_toggle_mini_hotkey(&self);
    fn refresh_coding_agent_hotkey(&self);
}

impl SettingsWriter for Coordinator {
    fn read_settings(&self) -> UserPreferences {
        self.prefs().get()
    }

    fn write_settings(&self, prefs: UserPreferences) -> Result<(), String> {
        self.prefs().set(prefs).map_err(|e| e.to_string())
    }

    fn sync_active_asr_provider(&self, provider: &str) -> Result<(), String> {
        self.sync_active_asr_provider_to_vault(provider)
    }

    fn refresh_dictation_hotkey(&self) {
        self.update_hotkey_binding();
    }

    fn refresh_qa_hotkey(&self) {
        self.update_qa_hotkey_binding();
    }

    fn refresh_combo_hotkey(&self) {
        self.update_combo_hotkey_binding();
    }

    fn refresh_translation_hotkey(&self) {
        self.update_translation_hotkey_binding();
    }

    fn refresh_switch_style_hotkey(&self) {
        self.update_switch_style_hotkey_binding();
    }

    fn refresh_open_app_hotkey(&self) {
        self.update_open_app_hotkey_binding();
    }

    fn refresh_toggle_mini_hotkey(&self) {
        self.update_toggle_mini_hotkey_binding();
    }

    fn refresh_coding_agent_hotkey(&self) {
        self.update_coding_agent_hotkey_binding();
    }
}

impl<T: SettingsWriter + ?Sized> SettingsWriter for Arc<T> {
    fn read_settings(&self) -> UserPreferences {
        (**self).read_settings()
    }

    fn write_settings(&self, prefs: UserPreferences) -> Result<(), String> {
        (**self).write_settings(prefs)
    }

    fn sync_active_asr_provider(&self, provider: &str) -> Result<(), String> {
        (**self).sync_active_asr_provider(provider)
    }

    fn refresh_dictation_hotkey(&self) {
        (**self).refresh_dictation_hotkey();
    }

    fn refresh_qa_hotkey(&self) {
        (**self).refresh_qa_hotkey();
    }

    fn refresh_combo_hotkey(&self) {
        (**self).refresh_combo_hotkey();
    }

    fn refresh_translation_hotkey(&self) {
        (**self).refresh_translation_hotkey();
    }

    fn refresh_switch_style_hotkey(&self) {
        (**self).refresh_switch_style_hotkey();
    }

    fn refresh_open_app_hotkey(&self) {
        (**self).refresh_open_app_hotkey();
    }

    fn refresh_toggle_mini_hotkey(&self) {
        (**self).refresh_toggle_mini_hotkey();
    }

    fn refresh_coding_agent_hotkey(&self) {
        (**self).refresh_coding_agent_hotkey();
    }
}

pub(crate) fn persist_settings<T: SettingsWriter>(
    coord: &T,
    mut prefs: UserPreferences,
) -> Result<(), String> {
    let mut previous = coord.read_settings();
    sync_dictation_hotkey_legacy_fields(&mut previous);
    sync_dictation_hotkey_legacy_fields(&mut prefs);
    reject_hotkey_collisions(&prefs)?;
    let dictation_shortcut_changed = previous.dictation_hotkey != prefs.dictation_hotkey;
    let dictation_mode_changed = previous.hotkey.mode != prefs.hotkey.mode;
    let qa_changed = previous.qa_hotkey != prefs.qa_hotkey;
    let translation_changed = previous.translation_hotkey != prefs.translation_hotkey;
    let switch_style_changed = previous.switch_style_hotkey != prefs.switch_style_hotkey;
    let open_app_changed = previous.open_app_hotkey != prefs.open_app_hotkey;
    let toggle_mini_changed = previous.toggle_mini_hotkey != prefs.toggle_mini_hotkey;
    let coding_agent_changed = previous.coding_agent_enabled != prefs.coding_agent_enabled
        || previous.coding_agent_voice_hotkey != prefs.coding_agent_voice_hotkey;
    let active_asr_provider_changed = previous.active_asr_provider != prefs.active_asr_provider;
    let active_asr_provider = prefs.active_asr_provider.clone();
    if active_asr_provider_changed {
        coord.sync_active_asr_provider(&active_asr_provider)?;
    }
    if let Err(error) = coord.write_settings(prefs.clone()) {
        if active_asr_provider_changed {
            if let Err(rollback_error) =
                coord.sync_active_asr_provider(&previous.active_asr_provider)
            {
                coord.write_settings(prefs).map_err(|roll_forward_error| {
                    format!(
                        "{error}; additionally failed to restore active ASR provider: {rollback_error}; additionally failed to preserve active ASR provider consistency: {roll_forward_error}"
                    )
                })?;
            } else {
                return Err(error);
            }
        } else {
            return Err(error);
        }
    }
    if dictation_shortcut_changed || dictation_mode_changed {
        coord.refresh_dictation_hotkey();
    }
    if dictation_shortcut_changed {
        coord.refresh_combo_hotkey();
    }
    if qa_changed {
        coord.refresh_qa_hotkey();
    }
    if translation_changed {
        coord.refresh_translation_hotkey();
    }
    if switch_style_changed {
        coord.refresh_switch_style_hotkey();
    }
    if open_app_changed {
        coord.refresh_open_app_hotkey();
    }
    if toggle_mini_changed {
        coord.refresh_toggle_mini_hotkey();
    }
    if coding_agent_changed {
        coord.refresh_coding_agent_hotkey();
    }
    Ok(())
}

#[cfg(not(mobile))]
#[tauri::command]
pub fn set_settings(
    coord: CoordinatorState<'_>,
    app: AppHandle,
    tray_microphones: State<'_, TrayMicrophoneMenuState>,
    mut prefs: UserPreferences,
) -> Result<(), String> {
    // 捕获旧值用于远程输入服务的 diff（persist 后端口/开关变化时启停/重启）。
    let remote_prev = coord.prefs().get();
    let packs = coord.style_packs().list().map_err(|e| e.to_string())?;
    sync_style_pack_preferences(&mut prefs, &packs);
    prefs.android_overlay_trigger = prefs.android_overlay_trigger.normalized();
    // 广播给所有 webview。issue #205：QaPanel 跑在独立 webview，
    // 没有 HotkeySettingsContext，必须靠事件感知录音键变化，否则面板可见时
    // 用户改键会让浮窗里的 "{recordHotkey}" 文案一直停留在旧值。
    persist_settings(&*coord, prefs.clone())?;
    #[cfg(target_os = "android")]
    coord.apply_android_overlay_settings_change(&remote_prev, &prefs);
    // refresh_tray_microphone_menu 内部会调用 NSStatusItem.set_menu，必须在主线程上跑。
    // set_settings 本身是同步 Tauri command，在 IPC handler 线程上执行；从这里直接调
    // 会触发 macOS 主线程断言或在 dispatch 队列上死锁，导致整个 UI 无响应（用户改
    // 偏好后所有按键都没反应即此根因）。dispatch 到主线程后立即返回，IPC 线程不阻塞。
    let app_for_main = app.clone();
    let prefs_for_main = prefs.clone();
    let _ = app.run_on_main_thread(move || {
        if let Err(err) = crate::refresh_tray_microphone_menu(&app_for_main) {
            log::warn!("[tray] refresh microphone menu after settings save failed: {err}");
            let tray_state = app_for_main.state::<TrayMicrophoneMenuState>();
            sync_tray_microphone_selection(
                &tray_state.lock(),
                &prefs_for_main.microphone_device_name,
            );
        }
    });
    // 抑制 unused 警告：tray_microphones 现在改在闭包里通过 app.state 取，
    // 但函数签名保留 State 入参，以便 Tauri 在调用前注入。
    let _ = tray_microphones;
    let _ = app.emit("prefs:changed", &prefs);
    // 远程输入：开关 / 端口变化时启停或重启服务（PIN 变化走 regenerate_remote_pin 命令）。
    if remote_prev.remote_input_enabled != prefs.remote_input_enabled
        || remote_prev.remote_input_port != prefs.remote_input_port
    {
        coord.refresh_remote_server();
    }
    Ok(())
}

#[cfg(mobile)]
#[tauri::command]
pub fn set_settings(
    coord: CoordinatorState<'_>,
    app: AppHandle,
    mut prefs: UserPreferences,
) -> Result<(), String> {
    let previous = coord.prefs().get();
    let packs = coord.style_packs().list().map_err(|e| e.to_string())?;
    sync_style_pack_preferences(&mut prefs, &packs);
    prefs.android_overlay_trigger = prefs.android_overlay_trigger.normalized();
    persist_settings(&*coord, prefs.clone())?;
    #[cfg(target_os = "android")]
    coord.apply_android_overlay_settings_change(&previous, &prefs);
    let _ = app.emit("prefs:changed", &prefs);
    let _ = app.emit_to("main", "prefs:changed", &prefs);
    Ok(())
}




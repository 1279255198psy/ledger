use chrono::{Datelike, Local, NaiveTime, TimeZone};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::Manager;

mod sync;

static SAVE_LOCK: Mutex<()> = Mutex::new(());

/// Mirrors `ReminderSettings` in the frontend.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReminderSettings {
    enabled: bool,
    /// Local wall-clock time, "HH:mm".
    time: String,
    /// daily | weekdays | weekends | custom
    frequency: String,
    /// JavaScript weekday numbering: 0 = Sunday … 6 = Saturday.
    weekdays: Vec<u32>,
    auto_start: bool,
}

impl Default for ReminderSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            time: "21:00".to_string(),
            frequency: "daily".to_string(),
            weekdays: (0..=6).collect(),
            auto_start: true,
        }
    }
}

impl ReminderSettings {
    fn parse_time(&self) -> Option<NaiveTime> {
        NaiveTime::parse_from_str(&self.time, "%H:%M").ok()
    }

    fn is_active_on(&self, weekday: u32) -> bool {
        match self.frequency.as_str() {
            "weekdays" => (1..=5).contains(&weekday),
            "weekends" => weekday == 0 || weekday == 6,
            "custom" => self.weekdays.contains(&weekday),
            _ => true,
        }
    }
}

struct ReminderRuntime {
    settings: Mutex<ReminderSettings>,
    /// "<YYYY-MM-DD> <HH:mm>" of the last reminder, so a tick cannot repeat it.
    last_fired: Mutex<String>,
}

fn ledger_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位应用数据目录：{error}"))?;
    fs::create_dir_all(&data_dir).map_err(|error| format!("无法创建应用数据目录：{error}"))?;
    Ok(data_dir.join("ledger.json"))
}

fn backup_path(path: &Path) -> PathBuf {
    path.with_file_name("ledger.json.bak")
}

fn atomic_write(path: &Path, contents: &[u8]) -> Result<(), String> {
    let temp_path = path.with_file_name("ledger.json.tmp");
    fs::write(&temp_path, contents).map_err(|error| format!("写入临时账本失败：{error}"))?;

    if path.exists() {
        let _ = fs::copy(path, backup_path(path));
    }

    match fs::rename(&temp_path, path) {
        Ok(()) => Ok(()),
        Err(_) => {
            // A few Windows configurations refuse replacing an existing file.
            // The backup has already been made, so fall back to a direct write.
            fs::write(path, contents).map_err(|error| format!("保存账本失败：{error}"))?;
            let _ = fs::remove_file(&temp_path);
            Ok(())
        }
    }
}

#[tauri::command]
fn load_ledger(app: tauri::AppHandle) -> Result<Option<Value>, String> {
    let path = ledger_path(&app)?;
    let raw = match fs::read_to_string(&path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("读取账本失败：{error}")),
    };

    match serde_json::from_str::<Value>(&raw) {
        Ok(value) => Ok(Some(value)),
        Err(primary_error) => {
            let backup = backup_path(&path);
            let backup_raw = fs::read_to_string(&backup)
                .map_err(|_| format!("账本文件损坏，且没有可用备份：{primary_error}"))?;
            let value = serde_json::from_str::<Value>(&backup_raw)
                .map_err(|error| format!("账本备份也损坏了：{error}"))?;
            let _ = fs::copy(&backup, &path);
            Ok(Some(value))
        }
    }
}

#[tauri::command]
fn save_ledger(app: tauri::AppHandle, data: Value) -> Result<(), String> {
    let _guard = SAVE_LOCK
        .lock()
        .map_err(|_| "账本保存锁不可用".to_string())?;
    let path = ledger_path(&app)?;
    let contents = serde_json::to_vec_pretty(&data)
        .map_err(|error| format!("序列化账本失败：{error}"))?;
    atomic_write(&path, &contents)
}

#[tauri::command]
fn write_export(path: String, contents: String) -> Result<(), String> {
    let target = PathBuf::from(path);
    fs::write(&target, contents.as_bytes()).map_err(|error| format!("写入导出文件失败：{error}"))
}

/// Rolling local snapshots kept beside the ledger. Names carry the timestamp
/// and reason so listing the folder never has to parse a whole ledger.
const MAX_BACKUPS: usize = 30;
const DAILY_KEEP_DAYS: usize = 14;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BackupMeta {
    name: String,
    created_at_ms: i64,
    reason: String,
    bytes: u64,
}

fn backup_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位应用数据目录：{error}"))?;
    let dir = data_dir.join("backups");
    fs::create_dir_all(&dir).map_err(|error| format!("无法创建备份目录：{error}"))?;
    Ok(dir)
}

fn is_safe_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 80
        && id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-')
}

fn is_safe_backup_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 160
        && name.ends_with(".json")
        && !name.contains("..")
        && name
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "-_.".contains(character))
}

fn parse_backup_name(name: &str) -> Option<(i64, String)> {
    let stem = name.strip_suffix(".json")?;
    let mut parts = stem.split("__");
    let created_at_ms = parts.next()?.parse::<i64>().ok()?;
    let reason = parts.next()?.to_string();
    // The id segment must exist, but listing does not need to inspect it.
    parts.next()?;
    Some((created_at_ms, reason))
}

fn scan_backups(dir: &Path) -> Vec<(BackupMeta, PathBuf)> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };

    let mut items = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        let Some((created_at_ms, reason)) = parse_backup_name(&name) else {
            continue;
        };
        let bytes = entry.metadata().map(|meta| meta.len()).unwrap_or(0);
        items.push((
            BackupMeta {
                name,
                created_at_ms,
                reason,
                bytes,
            },
            path,
        ));
    }

    items.sort_by(|left, right| right.0.created_at_ms.cmp(&left.0.created_at_ms));
    items
}

fn prune_backups(dir: &Path) {
    let items = scan_backups(dir);
    let mut keep = HashSet::new();

    for (meta, _) in items.iter().take(MAX_BACKUPS) {
        keep.insert(meta.name.clone());
    }

    let mut days = HashSet::new();
    for (meta, _) in &items {
        if days.len() >= DAILY_KEEP_DAYS {
            break;
        }
        let day = Local
            .timestamp_millis_opt(meta.created_at_ms)
            .single()
            .map(|value| value.format("%Y-%m-%d").to_string())
            .unwrap_or_else(|| meta.created_at_ms.to_string());
        if days.insert(day) {
            keep.insert(meta.name.clone());
        }
    }

    for (meta, path) in items {
        if !keep.contains(&meta.name) {
            let _ = fs::remove_file(path);
        }
    }
}

#[tauri::command]
fn save_ledger_backup(app: tauri::AppHandle, record: Value) -> Result<BackupMeta, String> {
    let id = record
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| "备份缺少 id".to_string())?;
    if !is_safe_id(id) {
        return Err("备份 id 不合法".to_string());
    }

    let created_at = record
        .get("createdAt")
        .and_then(Value::as_str)
        .ok_or_else(|| "备份缺少创建时间".to_string())?;
    let created_at_ms = chrono::DateTime::parse_from_rfc3339(created_at)
        .map(|value| value.timestamp_millis())
        .unwrap_or_else(|_| Local::now().timestamp_millis());

    let reason = record
        .get("reason")
        .and_then(Value::as_str)
        .unwrap_or("manual");
    let reason: String = reason
        .chars()
        .filter(|character| character.is_ascii_alphanumeric() || *character == '-')
        .take(32)
        .collect();
    let reason = if reason.is_empty() {
        "manual".to_string()
    } else {
        reason
    };

    let dir = backup_dir(&app)?;
    let name = format!("{created_at_ms}__{reason}__{id}.json");
    let target = dir.join(&name);
    let temp = dir.join(format!(".{name}.tmp"));
    let contents =
        serde_json::to_vec_pretty(&record).map_err(|error| format!("序列化备份失败：{error}"))?;

    fs::write(&temp, &contents).map_err(|error| format!("写入备份失败：{error}"))?;
    fs::rename(&temp, &target).map_err(|error| {
        let _ = fs::remove_file(&temp);
        format!("保存备份失败：{error}")
    })?;

    prune_backups(&dir);

    Ok(BackupMeta {
        name,
        created_at_ms,
        reason,
        bytes: contents.len() as u64,
    })
}

#[tauri::command]
fn list_ledger_backups(app: tauri::AppHandle) -> Result<Vec<BackupMeta>, String> {
    let dir = backup_dir(&app)?;
    Ok(scan_backups(&dir)
        .into_iter()
        .map(|(meta, _)| meta)
        .collect())
}

#[tauri::command]
fn read_ledger_backup(app: tauri::AppHandle, name: String) -> Result<Option<Value>, String> {
    if !is_safe_backup_name(&name) {
        return Err("备份名称不合法".to_string());
    }
    let path = backup_dir(&app)?.join(name);
    let raw = match fs::read_to_string(&path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("读取备份失败：{error}")),
    };

    let value = serde_json::from_str::<Value>(&raw)
        .map_err(|error| format!("备份文件已损坏：{error}"))?;
    Ok(Some(value))
}

#[tauri::command]
fn delete_ledger_backup(app: tauri::AppHandle, name: String) -> Result<(), String> {
    if !is_safe_backup_name(&name) {
        return Err("备份名称不合法".to_string());
    }
    let path = backup_dir(&app)?.join(name);
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("删除备份失败：{error}")),
    }
}

/// Windows keeps shortcut and taskbar icons in a cache keyed by file path.
/// When an update replaces the executable in place, Explorer can keep showing
/// the previous icon until the cache is rebuilt. Ask the shell to refresh the
/// icon cache once after each version change so the new icon is used.
#[cfg(windows)]
fn refresh_shell_icons_after_update(app: &tauri::AppHandle) {
    let version = app.package_info().version.to_string();
    let Ok(data_dir) = app.path().app_data_dir() else {
        return;
    };
    let marker = data_dir.join("shell-icon-version");
    if fs::read_to_string(&marker).ok().as_deref() == Some(version.as_str()) {
        return;
    }

    #[link(name = "shell32")]
    extern "system" {
        fn SHChangeNotify(
            event_id: i32,
            flags: u32,
            item1: *const std::ffi::c_void,
            item2: *const std::ffi::c_void,
        );
    }

    const SHCNE_ASSOCCHANGED: i32 = 0x0800_0000;
    const SHCNF_IDLIST: u32 = 0x0000;
    const SHCNF_FLUSH: u32 = 0x1000;

    unsafe {
        SHChangeNotify(
            SHCNE_ASSOCCHANGED,
            SHCNF_IDLIST | SHCNF_FLUSH,
            std::ptr::null(),
            std::ptr::null(),
        );
    }

    let _ = fs::create_dir_all(&data_dir);
    let _ = fs::write(marker, version);
}

#[cfg(not(windows))]
fn refresh_shell_icons_after_update(_app: &tauri::AppHandle) {}

fn show_reminder(app: &tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;
    app.notification()
        .builder()
        .title("账页 · 记账小提醒")
        .body("今天若有还没记下的收支，顺手记一笔就好。")
        .show()
        .map_err(|error| format!("发送提醒失败：{error}"))
}

fn apply_autostart(app: &tauri::AppHandle, enabled: bool) {
    use tauri_plugin_autostart::ManagerExt;
    let manager = app.autolaunch();
    let current = manager.is_enabled().unwrap_or(false);
    if enabled && !current {
        let _ = manager.enable();
    } else if !enabled && current {
        let _ = manager.disable();
    }
}

/// Returns the once-per-day key when `now` falls in the reminder minute, with
/// a five-minute grace window for a suspended or busy machine.
fn reminder_due(settings: &ReminderSettings, now: chrono::DateTime<Local>) -> Option<String> {
    if !settings.enabled {
        return None;
    }
    if !settings.is_active_on(now.weekday().num_days_from_sunday()) {
        return None;
    }
    let target_time = settings.parse_time()?;
    let today = now.date_naive();
    let elapsed = now
        .naive_local()
        .signed_duration_since(today.and_time(target_time))
        .num_seconds();
    if !(0..=300).contains(&elapsed) {
        return None;
    }
    Some(format!("{} {}", today.format("%Y-%m-%d"), settings.time))
}

fn reminder_tick(app: &tauri::AppHandle) {
    let Some(runtime) = app.try_state::<ReminderRuntime>() else {
        return;
    };
    let settings = match runtime.settings.lock() {
        Ok(settings) => settings.clone(),
        Err(_) => return,
    };
    let Some(key) = reminder_due(&settings, Local::now()) else {
        return;
    };

    if let Ok(last) = runtime.last_fired.lock() {
        if *last == key {
            return;
        }
    }

    if show_reminder(app).is_ok() {
        if let Ok(mut last) = runtime.last_fired.lock() {
            *last = key;
        }
    }
}

fn spawn_reminder_scheduler(app: tauri::AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(15));
        reminder_tick(&app);
    });
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "打开账页", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出账页", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip("账页 · 生活账簿")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

#[tauri::command]
fn sync_reminder_settings(
    app: tauri::AppHandle,
    settings: ReminderSettings,
) -> Result<(), String> {
    let runtime = app.state::<ReminderRuntime>();
    let changed_schedule = {
        let mut current = runtime
            .settings
            .lock()
            .map_err(|_| "提醒设置不可用".to_string())?;
        let changed = current.time != settings.time
            || current.frequency != settings.frequency
            || current.weekdays != settings.weekdays;
        *current = settings.clone();
        changed
    };
    if changed_schedule {
        if let Ok(mut last) = runtime.last_fired.lock() {
            last.clear();
        }
    }
    apply_autostart(&app, settings.auto_start);
    Ok(())
}

#[tauri::command]
fn send_test_notification(app: tauri::AppHandle) -> Result<(), String> {
    show_reminder(&app)
}

#[tauri::command]
fn reminder_permission_state(app: tauri::AppHandle) -> String {
    use tauri_plugin_notification::NotificationExt;
    match app.notification().permission_state() {
        Ok(state) if state == tauri_plugin_notification::PermissionState::Granted => {
            "granted".to_string()
        }
        Ok(_) => "denied".to_string(),
        // Desktop platforms without an app-level notification switch still
        // deliver the toast, so report it as ready.
        Err(_) => "granted".to_string(),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            refresh_shell_icons_after_update(app.handle());
            let _ = app.manage(ReminderRuntime {
                settings: Mutex::new(ReminderSettings::default()),
                last_fired: Mutex::new(String::new()),
            });
            let _ = app.manage(sync::SyncServerState::new());
            setup_tray(app)?;
            // The window starts hidden so a login launch goes straight to the
            // tray without a flash. A normal launch shows it right away.
            if !std::env::args().any(|arg| arg == "--autostart") {
                show_main_window(app.handle());
            }
            spawn_reminder_scheduler(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_ledger,
            save_ledger,
            write_export,
            save_ledger_backup,
            list_ledger_backups,
            read_ledger_backup,
            delete_ledger_backup,
            sync_reminder_settings,
            send_test_notification,
            reminder_permission_state,
            sync::sync_server_start,
            sync::sync_server_stop,
            sync::sync_server_status,
            sync::sync_server_read_blob,
            sync::sync_server_write_blob,
            sync::sync_server_write_blob_if
        ])
        .build(tauri::generate_context!())
        .expect("账页启动失败");

    // Closing the window keeps reminders alive in the tray; quitting from the
    // tray menu exits normally.
    app.run(|app_handle, event| {
        if let tauri::RunEvent::WindowEvent {
            label,
            event: tauri::WindowEvent::CloseRequested { api, .. },
            ..
        } = event
        {
            if label == "main" {
                api.prevent_close();
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.hide();
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn at(day: u32, hour: u32, minute: u32, second: u32) -> chrono::DateTime<Local> {
        Local
            .with_ymd_and_hms(2026, 10, day, hour, minute, second)
            .unwrap()
    }

    #[test]
    fn fires_within_the_grace_window() {
        let settings = ReminderSettings::default();
        assert!(reminder_due(&settings, at(23, 20, 59, 59)).is_none());
        assert!(reminder_due(&settings, at(23, 21, 0, 0)).is_some());
        assert!(reminder_due(&settings, at(23, 21, 4, 59)).is_some());
        assert!(reminder_due(&settings, at(23, 21, 5, 1)).is_none());
    }

    #[test]
    fn respects_frequency_and_disabled() {
        // 2026-10-23 is a Friday; 2026-10-25 is a Sunday.
        let mut settings = ReminderSettings::default();
        assert!(reminder_due(&settings, at(25, 21, 0, 0)).is_some());

        settings.frequency = "weekdays".into();
        assert!(reminder_due(&settings, at(25, 21, 0, 0)).is_none());
        assert!(reminder_due(&settings, at(23, 21, 0, 0)).is_some());

        settings.frequency = "weekends".into();
        assert!(reminder_due(&settings, at(25, 21, 0, 0)).is_some());

        settings.frequency = "custom".into();
        settings.weekdays = vec![1, 2];
        // Saturday is not in the custom list.
        assert!(reminder_due(&settings, at(24, 21, 0, 0)).is_none());

        settings.enabled = false;
        settings.frequency = "daily".into();
        assert!(reminder_due(&settings, at(23, 21, 0, 0)).is_none());
    }

    #[test]
    fn rejects_bad_time() {
        let mut settings = ReminderSettings::default();
        settings.time = "9pm".into();
        assert!(reminder_due(&settings, at(23, 21, 0, 0)).is_none());
    }

    #[test]
    fn key_is_stable_within_the_minute() {
        let settings = ReminderSettings::default();
        assert_eq!(
            reminder_due(&settings, at(23, 21, 0, 0)).unwrap(),
            "2026-10-23 21:00"
        );
        assert_eq!(
            reminder_due(&settings, at(23, 21, 3, 0)).unwrap(),
            "2026-10-23 21:00"
        );
    }
}

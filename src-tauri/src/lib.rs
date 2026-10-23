use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::Manager;

static SAVE_LOCK: Mutex<()> = Mutex::new(());

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            refresh_shell_icons_after_update(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_ledger,
            save_ledger,
            write_export
        ])
        .run(tauri::generate_context!())
        .expect("账页启动失败");
}

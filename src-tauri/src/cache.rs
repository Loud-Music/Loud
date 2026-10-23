use serde::Serialize;
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{Duration, Instant, SystemTime},
};

const DEFAULT_LIMIT: u64 = 2 * 1024 * 1024 * 1024;
static IO: Mutex<()> = Mutex::new(());
#[derive(Default)]
struct Active {
    pins: HashMap<PathBuf, String>,
    leases: HashMap<PathBuf, Instant>,
}
static ACTIVE: OnceLock<Mutex<Active>> = OnceLock::new();
fn active() -> &'static Mutex<Active> {
    ACTIVE.get_or_init(|| Mutex::new(Active::default()))
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheStatus {
    directory: String,
    limit_bytes: u64,
    size_bytes: u64,
    protected_bytes: u64,
    files: usize,
    removed_bytes: u64,
    downloaded_bytes: u64,
}
struct Entry {
    path: PathBuf,
    key: String,
    size: u64,
    used: SystemTime,
}
fn valid_key(key: &str) -> bool {
    key.len() == 64 && key.bytes().all(|ch| ch.is_ascii_hexdigit())
}
fn file_key(path: &Path) -> Option<String> {
    let stem = path
        .file_stem()?
        .to_str()?
        .strip_suffix(".lucida")
        .unwrap_or(path.file_stem()?.to_str()?);
    valid_key(stem).then(|| stem.to_owned())
}
fn entries(root: &Path) -> Result<Vec<Entry>, String> {
    let mut result = Vec::new();
    for item in fs::read_dir(root).map_err(|e| e.to_string())? {
        let item = item.map_err(|e| e.to_string())?;
        if !item.file_type().map_err(|e| e.to_string())?.is_file() {
            continue;
        }
        let path = item.path();
        if !matches!(
            path.extension().and_then(|s| s.to_str()),
            Some("flac" | "mp3" | "m4a" | "ogg" | "opus" | "webm" | "wav")
        ) {
            continue;
        }
        let Some(key) = file_key(&path) else { continue };
        let metadata = item.metadata().map_err(|e| e.to_string())?;
        let used = fs::metadata(root.join(format!("{key}.used")))
            .and_then(|m| m.modified())
            .or_else(|_| metadata.modified())
            .unwrap_or(SystemTime::UNIX_EPOCH);
        result.push(Entry {
            path,
            key,
            size: metadata.len(),
            used,
        });
    }
    Ok(result)
}
fn limit(root: &Path) -> u64 {
    root.parent()
        .and_then(|p| fs::read(p.join("audio-cache.json")).ok())
        .and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok())
        .and_then(|v| v["limitBytes"].as_u64())
        .filter(|v| (128 * 1024 * 1024..=20 * 1024 * 1024 * 1024).contains(v))
        .unwrap_or(DEFAULT_LIMIT)
}
pub fn hold(path: &Path) {
    let (Some(root), Some(key)) = (path.parent(), file_key(path)) else {
        return;
    };
    let _ = fs::write(root.join(format!("{key}.used")), []);
    if let Ok(mut state) = active().lock() {
        state
            .leases
            .insert(path.to_path_buf(), Instant::now() + Duration::from_secs(60));
    }
}
fn clean_metadata(root: &Path) {
    let Ok(items) = fs::read_dir(root) else {
        return;
    };
    for item in items.flatten() {
        if !item.file_type().is_ok_and(|kind| kind.is_file()) {
            continue;
        }
        let path = item.path();
        let name = item.file_name().to_string_lossy().into_owned();
        let metadata = name.strip_suffix(".cache.json").is_some_and(valid_key)
            || name
                .strip_prefix("recording-")
                .and_then(|s| s.strip_suffix(".json"))
                .is_some_and(valid_key);
        if metadata {
            let data = fs::read(&path)
                .ok()
                .and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok());
            if let Some(saved) = data
                .as_ref()
                .and_then(|v| v["path"].as_str())
                .map(Path::new)
            {
                if saved.parent() == Some(root) && !saved.exists() {
                    let _ = fs::remove_file(&path);
                }
            }
        }
        if let Some(key) = name.strip_suffix(".used").filter(|key| valid_key(key)) {
            let exists = fs::read_dir(root).is_ok_and(|items| {
                items.flatten().any(|other| {
                    file_key(&other.path()).as_deref() == Some(key)
                        && other.path().extension().and_then(|v| v.to_str()) != Some("used")
                })
            });
            if !exists {
                let _ = fs::remove_file(&path);
            }
        }
        if name.ends_with(".part")
            && name.get(..64).is_some_and(valid_key)
            && item
                .metadata()
                .and_then(|m| m.modified())
                .ok()
                .and_then(|at| at.elapsed().ok())
                .is_some_and(|age| age > Duration::from_secs(86400))
        {
            let _ = fs::remove_file(&path);
        }
    }
}
fn manage(root: &Path, clear: bool, target: Option<u64>) -> Result<CacheStatus, String> {
    let _guard = IO.lock().map_err(|e| e.to_string())?;
    let mut files = entries(root)?;
    let registry = root
        .parent()
        .and_then(|p| fs::read(p.join("audio-saved.json")).ok())
        .and_then(|bytes| serde_json::from_slice::<Vec<String>>(&bytes).ok());
    if clear && registry.is_none() {
        return Err("Wait for the music library to finish loading".into());
    }
    let ready = registry.is_some();
    let saved: std::collections::HashSet<String> =
        registry.unwrap_or_default().into_iter().collect();
    let downloaded_bytes: u64 = files
        .iter()
        .filter(|file| saved.contains(&file.key))
        .map(|file| file.size)
        .sum::<u64>()
        + crate::offline::size();
    files.retain(|file| !saved.contains(&file.key));
    let limit_bytes = target.unwrap_or_else(|| limit(root));
    let (pin, leases) = {
        let mut state = active().lock().map_err(|e| e.to_string())?;
        state.leases.retain(|_, until| *until > Instant::now());
        (state.pins.get(root).cloned(), state.leases.clone())
    };
    files.sort_by_key(|file| file.used);
    let mut size_bytes: u64 = files.iter().map(|file| file.size).sum();
    let mut protected_bytes = 0;
    let mut removed_bytes = 0;
    let mut count = files.len();
    for file in files {
        if pin.as_deref() == Some(&file.key) || leases.contains_key(&file.path) {
            protected_bytes += file.size;
            continue;
        }
        if ready && (clear || size_bytes > limit_bytes) && fs::remove_file(&file.path).is_ok() {
            size_bytes -= file.size;
            removed_bytes += file.size;
            count -= 1;
        }
    }
    clean_metadata(root);
    Ok(CacheStatus {
        directory: root.to_string_lossy().into_owned(),
        limit_bytes,
        size_bytes,
        protected_bytes,
        files: count,
        removed_bytes,
        downloaded_bytes,
    })
}
pub fn commit(app: &tauri::AppHandle, path: &Path) {
    hold(path);
    if let Ok(root) = crate::network::cache_root(app) {
        let _ = manage(&root, false, None);
    }
}
pub fn start(app: tauri::AppHandle) {
    std::thread::spawn(move || loop {
        if let Ok(root) = crate::network::cache_root(&app) {
            let _ = manage(&root, false, None);
        }
        std::thread::sleep(Duration::from_secs(60));
    });
}
#[tauri::command]
pub async fn audio_cache_status(app: tauri::AppHandle) -> Result<CacheStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        manage(&crate::network::cache_root(&app)?, false, None)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn audio_cache_clear(app: tauri::AppHandle) -> Result<CacheStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        manage(&crate::network::cache_root(&app)?, true, None)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn audio_cache_limit(app: tauri::AppHandle, bytes: u64) -> Result<CacheStatus, String> {
    if !(128 * 1024 * 1024..=20 * 1024 * 1024 * 1024).contains(&bytes) {
        return Err("Cache limit must be between 128 MB and 20 GB".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let root = crate::network::cache_root(&app)?;
        let path = root
            .parent()
            .ok_or("Invalid cache directory")?
            .join("audio-cache.json");
        let temp = path.with_extension("tmp");
        fs::write(
            &temp,
            serde_json::to_vec(&serde_json::json!({"limitBytes": bytes}))
                .map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        fs::rename(temp, path).map_err(|e| e.to_string())?;
        manage(&root, false, Some(bytes))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub fn audio_cache_pin(app: tauri::AppHandle, key: Option<String>) -> Result<(), String> {
    if key.as_ref().is_some_and(|key| !valid_key(key)) {
        return Err("Invalid cache key".into());
    }
    let root = crate::network::cache_root(&app)?;
    let mut state = active().lock().map_err(|e| e.to_string())?;
    if let Some(key) = key {
        state.pins.insert(root, key);
    } else {
        state.pins.remove(&root);
    }
    Ok(())
}

#[tauri::command]
pub async fn audio_cache_saved(app: tauri::AppHandle, keys: Vec<String>) -> Result<(), String> {
    if keys.len() > 20000 || keys.iter().any(|key| !valid_key(key)) {
        return Err("Invalid saved recordings".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let root = crate::network::cache_root(&app)?;
        {
            let _guard = IO.lock().map_err(|e| e.to_string())?;
            let path = root
                .parent()
                .ok_or("Invalid cache directory")?
                .join("audio-saved.json");
            let temp = path.with_extension("tmp");
            fs::write(&temp, serde_json::to_vec(&keys).map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
            fs::rename(temp, path).map_err(|e| e.to_string())?;
        }
        manage(&root, false, None)?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub fn audio_cache_contains(app: tauri::AppHandle, key: String) -> Result<bool, String> {
    if !valid_key(&key) {
        return Err("Invalid cache key".into());
    }
    let root = crate::network::cache_root(&app)?;
    Ok(entries(&root)?.iter().any(|file| file.key == key))
}

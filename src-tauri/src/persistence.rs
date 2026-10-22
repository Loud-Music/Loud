use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::Manager;
static WRITES: Mutex<()> = Mutex::new(());
fn root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let folder = crate::storage::data_root(app)?.join("user-data");
    fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    Ok(folder)
}
fn disk_lock(app: &tauri::AppHandle) -> Result<fs::File, String> {
    let file = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(root(app)?.join("storage.lock"))
        .map_err(|e| e.to_string())?;
    file.lock().map_err(|e| e.to_string())?;
    Ok(file)
}
fn read<T: serde::de::DeserializeOwned + Default>(path: &Path) -> Result<T, String> {
    if !path.exists() {
        return Ok(T::default());
    }
    let parse = |p: &Path| {
        fs::read(p)
            .map_err(|e| e.to_string())
            .and_then(|bytes| serde_json::from_slice(&bytes).map_err(|e| e.to_string()))
    };
    parse(path).or_else(|_| parse(&path.with_extension("json.bak")))
}
fn write(path: &Path, value: &impl Serialize) -> Result<(), String> {
    use std::io::Write;
    let temp = path.with_extension("tmp");
    let bytes = serde_json::to_vec(value).map_err(|e| e.to_string())?;
    let mut file = fs::File::create(&temp).map_err(|e| e.to_string())?;
    file.write_all(&bytes)
        .and_then(|_| file.sync_all())
        .map_err(|e| e.to_string())?;
    if path.exists()
        && fs::read(path)
            .ok()
            .is_some_and(|bytes| serde_json::from_slice::<Value>(&bytes).is_ok())
    {
        fs::copy(path, path.with_extension("json.bak")).map_err(|e| e.to_string())?;
    }
    fs::rename(temp, path).map_err(|e| e.to_string())
}
fn account_folder(app: &tauri::AppHandle, account: &str) -> Result<PathBuf, String> {
    if account.is_empty()
        || account.len() > 100
        || !account
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-')
    {
        return Err("Invalid account".into());
    }
    let folder = root(app)?.join("accounts").join(account);
    fs::create_dir_all(folder.join("files")).map_err(|e| e.to_string())?;
    Ok(folder)
}
#[tauri::command]
pub fn settings_load(app: tauri::AppHandle) -> Result<BTreeMap<String, String>, String> {
    let _lock = WRITES.lock().map_err(|e| e.to_string())?;
    let _disk = disk_lock(&app)?;
    read(&root(&app)?.join("settings.json"))
}
#[tauri::command]
pub fn settings_save(
    app: tauri::AppHandle,
    values: BTreeMap<String, String>,
) -> Result<(), String> {
    if values
        .iter()
        .any(|(k, v)| !k.starts_with("loud:") || v.len() > 8 * 1024 * 1024)
    {
        return Err("Invalid settings".into());
    }
    let _lock = WRITES.lock().map_err(|e| e.to_string())?;
    let _disk = disk_lock(&app)?;
    let path = root(&app)?.join("settings.json");
    let mut current: BTreeMap<String, String> = read(&path)?;
    current.extend(values);
    write(&path, &current)
}
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Record {
    track: Value,
    #[serde(default)]
    file: Option<String>,
}
#[derive(Deserialize)]
pub struct Import {
    track: Value,
    data: Option<String>,
}
fn records(app: &tauri::AppHandle, account: &str) -> Result<Vec<Record>, String> {
    read(&account_folder(app, account)?.join("library.json"))
}
#[tauri::command]
pub fn library_load(app: tauri::AppHandle, account: String) -> Result<Vec<Record>, String> {
    let _lock = WRITES.lock().map_err(|e| e.to_string())?;
    let _disk = disk_lock(&app)?;
    records(&app, &account)
}
#[tauri::command]
pub fn library_exists(app: tauri::AppHandle, account: String) -> Result<bool, String> {
    Ok(account_folder(&app, &account)?
        .join("library.json")
        .exists())
}
#[tauri::command]
pub fn library_save(
    app: tauri::AppHandle,
    account: String,
    items: Vec<Import>,
) -> Result<(), String> {
    let _lock = WRITES.lock().map_err(|e| e.to_string())?;
    let _disk = disk_lock(&app)?;
    let folder = account_folder(&app, &account)?;
    let mut rows = records(&app, &account)?;
    for item in items {
        let id = item
            .track
            .get("id")
            .and_then(Value::as_str)
            .filter(|id| !id.is_empty())
            .ok_or("Missing track ID")?;
        let mut stored = Record {
            track: item.track.clone(),
            file: rows
                .iter()
                .find(|r| r.track.get("id").and_then(Value::as_str) == Some(id))
                .and_then(|r| r.file.clone()),
        };
        if let Some(data) = item.data {
            let bytes = STANDARD.decode(data).map_err(|e| e.to_string())?;
            let file = folder
                .join("files")
                .join(format!("{:x}.audio", Sha256::digest(id.as_bytes())));
            let temp = file.with_extension("part");
            fs::write(&temp, bytes).map_err(|e| e.to_string())?;
            fs::rename(temp, &file).map_err(|e| e.to_string())?;
            app.asset_protocol_scope()
                .allow_file(&file)
                .map_err(|e| e.to_string())?;
            stored.file = Some(file.to_string_lossy().into_owned());
        }
        if let Some(old) = rows
            .iter_mut()
            .find(|r| r.track.get("id").and_then(Value::as_str) == Some(id))
        {
            *old = stored;
        } else {
            rows.push(stored);
        }
    }
    write(&folder.join("library.json"), &rows)
}

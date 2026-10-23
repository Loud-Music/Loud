use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager};

static ROOT: OnceLock<PathBuf> = OnceLock::new();
static JOBS: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
const LIMIT: u64 = 200 * 1024 * 1024;

pub fn init(app: &tauri::AppHandle) -> Result<(), String> {
    let root = crate::storage::data_root(app)?.join("user-data/offline");
    fs::create_dir_all(root.join("audio")).map_err(|e| e.to_string())?;
    fs::create_dir_all(root.join("partials")).map_err(|e| e.to_string())?;
    ROOT.set(root).ok();
    Ok(())
}
pub fn audio_path(key: &str) -> Option<PathBuf> {
    if key.len() != 64 || !key.bytes().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    ROOT.get()
        .map(|root| root.join("audio").join(format!("{key}.flac")))
        .filter(|p| p.is_file())
}
pub fn size() -> u64 {
    ROOT.get()
        .and_then(|r| fs::read_dir(r.join("audio")).ok())
        .map(|entries| {
            entries
                .flatten()
                .filter(|entry| entry.path().extension().is_some_and(|ext| ext != "json"))
                .filter_map(|entry| entry.metadata().ok())
                .map(|m| m.len())
                .sum()
        })
        .unwrap_or(0)
}
fn jobs() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    JOBS.get_or_init(|| Mutex::new(HashMap::new()))
}
#[tauri::command]
pub fn offline_pause(account: String, id: String) -> Result<(), String> {
    if let Some(flag) = jobs()
        .lock()
        .map_err(|e| e.to_string())?
        .get(&format!("{account}:{id}"))
    {
        flag.store(true, Ordering::Relaxed);
    }
    Ok(())
}
fn allowed(url: &reqwest::Url) -> bool {
    url.scheme() == "https"
        && url.port_or_known_default() == Some(443)
        && url.username().is_empty()
        && url.password().is_none()
        && url.host_str().is_some_and(|host| {
            [
                "lucida.to",
                "sndcdn.com",
                "soundcloud.cloud",
                "archive.org",
                "wikimedia.org",
                "ccmixter.org",
                "audius.co",
                "r2.cloudflarestorage.com",
            ]
            .iter()
            .any(|domain| host == *domain || host.ends_with(&format!(".{domain}")))
        })
}
fn root() -> Result<&'static PathBuf, String> {
    ROOT.get()
        .ok_or_else(|| "Офлайн-хранилище не готово".into())
}

#[tauri::command]
pub async fn offline_download(
    app: tauri::AppHandle,
    account: String,
    track: Value,
    source: Value,
) -> Result<Value, String> {
    if account.is_empty()
        || account.len() > 100
        || !account
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-')
    {
        return Err("Некорректный профиль".into());
    }
    let id = track["id"]
        .as_str()
        .filter(|s| !s.is_empty() && s.len() <= 500)
        .ok_or("Не указан трек")?
        .to_owned();
    let duration = track["duration"]
        .as_f64()
        .filter(|v| v.is_finite() && *v > 0.0)
        .ok_or("Неизвестна длительность записи")?;
    let job = format!("{account}:{id}");
    let paused = Arc::new(AtomicBool::new(false));
    {
        let mut active = jobs().lock().map_err(|e| e.to_string())?;
        if active.contains_key(&job) {
            return Err("Эта запись уже загружается".into());
        }
        active.insert(job.clone(), paused.clone());
    }
    let job_key = job.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let key = format!("{:x}", Sha256::digest(job_key.as_bytes()));
        let root = root()?;
        let transfer_lock = fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(root.join("partials").join(format!("{key}.lock")))
            .map_err(|e| e.to_string())?;
        transfer_lock
            .try_lock()
            .map_err(|_| "Эта запись загружается в другом окне LOUD".to_owned())?;
        let metadata = root.join("audio").join(format!("{key}.json"));
        let existing: Option<Value> = fs::read(&metadata)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok());
        if let Some(saved) = existing.filter(|value| {
            value["offlinePath"]
                .as_str()
                .is_some_and(|p| Path::new(p).is_file())
                && (value["duration"].as_f64().unwrap_or(0.0) - duration).abs() <= 3.0
        }) {
            crate::persistence::save_offline(&app, &account, saved.clone())?;
            return Ok(saved);
        }
        let check = || {
            if paused.load(Ordering::Relaxed) {
                Err("Загрузка приостановлена".to_owned())
            } else {
                Ok(())
            }
        };
        check()?;
        let temp = root.join("partials").join(format!("{key}.part"));
        let progress_at = Mutex::new(Instant::now() - Duration::from_secs(2));
        let progress = |bytes: u64, total: Option<u64>| -> Result<(), String> {
            check()?;
            let mut last = progress_at.lock().map_err(|e| e.to_string())?;
            if last.elapsed() >= Duration::from_secs(1) || total == Some(bytes) {
                let _ = app.emit(
                    "offline-progress",
                    json!({"account":account,"id":id,"bytes":bytes,"total":total}),
                );
                *last = Instant::now();
            }
            Ok(())
        };
        let mut downloaded = temp.clone();
        if let Some(path) = source["path"].as_str() {
            let path = fs::canonicalize(path).map_err(|e| e.to_string())?;
            let cache =
                fs::canonicalize(crate::network::cache_root(&app)?).map_err(|e| e.to_string())?;
            let audio = fs::canonicalize(root.join("audio")).map_err(|e| e.to_string())?;
            if !path.is_file() || !(path.starts_with(cache) || path.starts_with(audio)) {
                return Err("Недоступен сохранённый аудиофайл".into());
            }
            if fs::metadata(&path).map_err(|e| e.to_string())?.len() > LIMIT {
                return Err("Файл превышает ограничение 200 МБ".into());
            }
            fs::copy(path, &temp).map_err(|e| e.to_string())?;
        } else if source["hls"] == true {
            let service = source["serviceUrl"]
                .as_str()
                .ok_or("Неизвестен источник потока")?;
            let parsed = reqwest::Url::parse(service).map_err(|e| e.to_string())?;
            if parsed.scheme() != "https" || parsed.host_str() != Some("soundcloud.com") {
                return Err("Этот поток не поддерживает офлайн-загрузку".into());
            }
            crate::media_tools::ensure(&app)?;
            let (ffmpeg, _) = crate::media_tools::paths(&app)?;
            let mut command = crate::extractor::command(&app)?;
            command
                .args([
                    "--continue",
                    "--no-progress",
                    "--no-warnings",
                    "--max-filesize",
                    "200M",
                    "--format",
                    "bestaudio",
                    "--print",
                    "after_move:filepath",
                    "--no-simulate",
                    "--ffmpeg-location",
                ])
                .arg(ffmpeg.parent().ok_or("FFmpeg недоступен")?)
                .arg("--output")
                .arg(root.join("partials").join(format!("{key}.%(ext)s")))
                .arg("--")
                .arg(service)
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped());
            let mut child = command.spawn().map_err(|e| e.to_string())?;
            loop {
                if let Err(error) = check() {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(error);
                }
                if child.try_wait().map_err(|e| e.to_string())?.is_some() {
                    break;
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            let output = child.wait_with_output().map_err(|e| e.to_string())?;
            if !output.status.success() {
                return Err("Источник не отдал полную запись. Загрузку можно повторить.".into());
            }
            downloaded = PathBuf::from(
                String::from_utf8_lossy(&output.stdout)
                    .lines()
                    .last()
                    .ok_or("Источник не вернул файл")?
                    .trim(),
            );
            if downloaded.parent() != Some(root.join("partials").as_path()) {
                return Err("Некорректный путь загруженного файла".into());
            }
        } else {
            let url = source["url"].as_str().ok_or("Неизвестен адрес аудио")?;
            let parsed = reqwest::Url::parse(url).map_err(|e| e.to_string())?;
            if !allowed(&parsed) {
                return Err("Этот источник не поддерживает офлайн-загрузку".into());
            }
            let client = reqwest::blocking::Client::builder()
                .user_agent("Mozilla/5.0")
                .connect_timeout(Duration::from_secs(4))
                .timeout(Duration::from_secs(180))
                .tcp_nodelay(true)
                .redirect(reqwest::redirect::Policy::custom(|attempt| {
                    if attempt.previous().len() < 5 && allowed(attempt.url()) {
                        attempt.follow()
                    } else {
                        attempt.error("Недопустимое перенаправление")
                    }
                }))
                .build()
                .map_err(|e| e.to_string())?;
            crate::resumable::download(
                url,
                &temp,
                LIMIT,
                |offset, validator| {
                    check()?;
                    if parsed
                        .host_str()
                        .is_some_and(|host| host.ends_with(".lucida.to"))
                    {
                        return crate::lucida_stream::download_range(url, offset, validator);
                    }
                    let mut request = client.get(parsed.clone());
                    if offset > 0 {
                        request =
                            request.header(reqwest::header::RANGE, format!("bytes={offset}-"));
                        if let Some(validator) = validator {
                            request = request.header(reqwest::header::IF_RANGE, validator);
                        }
                    }
                    request.send().map_err(|e| e.to_string())
                },
                progress,
            )?;
        }
        check()?;
        if fs::metadata(&downloaded).map_err(|e| e.to_string())?.len() > LIMIT {
            return Err("Файл превышает ограничение 200 МБ".into());
        }
        crate::media_tools::ensure(&app)?;
        let info = match crate::extractor::inspect(&app, &downloaded, duration) {
            Ok(info) => info,
            Err(error) => {
                let _ = fs::remove_file(&downloaded);
                let _ = fs::remove_file(temp.with_extension("resume.json"));
                return Err(error);
            }
        };
        let extension = match info["format"].as_str() {
            Some("FLAC") => "flac",
            Some("AAC") => "m4a",
            Some("MP3") => "mp3",
            Some("OPUS") => "opus",
            Some("OGG") => "ogg",
            _ => return Err("Неподдерживаемый аудиоформат".into()),
        };
        let path = root.join("audio").join(format!("{key}.{extension}"));
        fs::rename(&downloaded, &path).map_err(|e| e.to_string())?;
        let mut saved = track;
        saved["offlinePath"] = json!(path.to_string_lossy());
        saved["nativeKey"] = json!(key);
        saved["format"] = info["format"].clone();
        saved["duration"] = info["duration"].clone();
        saved["sampleRate"] = info["sampleRate"].clone();
        saved["bitDepth"] = info["bitDepth"].clone();
        saved["downloaded"] = json!(true);
        saved["inLibrary"] = json!(true);
        saved["streamType"] = Value::Null;
        saved["streamCacheUrl"] = Value::Null;
        saved["streamCacheKey"] = Value::Null;
        saved["src"] = Value::Null;
        let metadata_temp = metadata.with_extension("tmp");
        fs::write(
            &metadata_temp,
            serde_json::to_vec(&saved).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        fs::rename(metadata_temp, &metadata).map_err(|e| e.to_string())?;
        crate::persistence::save_offline(&app, &account, saved.clone())?;
        let _ = fs::remove_file(temp.with_extension("resume.json"));
        Ok(saved)
    })
    .await
    .map_err(|e| e.to_string());
    jobs().lock().map_err(|e| e.to_string())?.remove(&job);
    result?
}

#[tauri::command]
pub async fn offline_cover(
    app: tauri::AppHandle,
    account: String,
    mut track: Value,
) -> Result<Value, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let key = track["nativeKey"]
        .as_str()
        .filter(|key| key.len() == 64 && key.bytes().all(|c| c.is_ascii_hexdigit()))
        .ok_or("Некорректная запись")?
        .to_owned();
    let url = track["cover"].as_str().ok_or("Нет обложки")?.to_owned();
    let image = crate::artwork::artwork_image(url).await?;
    let extension = match image.mime.as_str() {
        "image/jpeg" => "jpg",
        "image/png" => "png",
        "image/webp" => "webp",
        "image/avif" => "avif",
        _ => return Err("Неподдерживаемая обложка".into()),
    };
    let folder = root()?.join("covers");
    fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let path = folder.join(format!("{key}.{extension}"));
    fs::write(
        &path,
        STANDARD.decode(image.data).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    app.asset_protocol_scope()
        .allow_file(&path)
        .map_err(|e| e.to_string())?;
    track["offlineCoverPath"] = json!(path.to_string_lossy());
    crate::persistence::save_offline(&app, &account, track.clone())?;
    let metadata = root()?.join("audio").join(format!("{key}.json"));
    let temp = metadata.with_extension("tmp");
    fs::write(
        &temp,
        serde_json::to_vec(&track).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    fs::rename(temp, metadata).map_err(|e| e.to_string())?;
    Ok(track)
}

#[tauri::command]
pub fn lyrics_cache_get(app: tauri::AppHandle, key: String) -> Result<Option<Value>, String> {
    let file = lyric_path(&app, &key)?;
    if !file.exists() {
        return Ok(None);
    }
    fs::read(file).map_err(|e| e.to_string()).and_then(|bytes| {
        serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(|e| e.to_string())
    })
}
static LYRICS: Mutex<()> = Mutex::new(());
fn lyric_path(app: &tauri::AppHandle, key: &str) -> Result<PathBuf, String> {
    if key.len() > 4000 {
        return Err("Некорректный ключ текста".into());
    }
    let root = crate::storage::data_root(app)?.join("user-data/lyrics");
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    Ok(root.join(format!("{:x}.json", Sha256::digest(key.as_bytes()))))
}
#[tauri::command]
pub fn lyrics_cache_put(
    app: tauri::AppHandle,
    key: String,
    value: Value,
    pinned: Option<bool>,
) -> Result<(), String> {
    if serde_json::to_vec(&value).map_err(|e| e.to_string())?.len() > 2 * 1024 * 1024 {
        return Err("Текст слишком большой".into());
    }
    let _guard = LYRICS.lock().map_err(|e| e.to_string())?;
    let path = lyric_path(&app, &key)?;
    let old = fs::read(&path)
        .ok()
        .and_then(|b| serde_json::from_slice::<Value>(&b).ok());
    let pinned = pinned.unwrap_or(false) || old.is_some_and(|v| v["pinned"] == true);
    let at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    let temp = path.with_extension("tmp");
    fs::write(
        &temp,
        serde_json::to_vec(&json!({"at":at,"value":value,"pinned":pinned}))
            .map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    fs::rename(temp, path).map_err(|e| e.to_string())
}
#[tauri::command]
pub fn lyrics_cache_remove(app: tauri::AppHandle, key: String) -> Result<(), String> {
    let _guard = LYRICS.lock().map_err(|e| e.to_string())?;
    let path = lyric_path(&app, &key)?;
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

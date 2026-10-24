use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs,
    path::Path,
    process::Command,
    sync::{Arc, Mutex, OnceLock, Weak},
};
use tauri::Manager;

static DOWNLOADS: OnceLock<Mutex<HashMap<String, Weak<Mutex<()>>>>> = OnceLock::new();
static BRIDGE_SCRIPT: Mutex<()> = Mutex::new(());
fn download_lock(url: &str) -> Result<Arc<Mutex<()>>, String> {
    let mut locks = DOWNLOADS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .map_err(|e| e.to_string())?;
    locks.retain(|_, lock| lock.strong_count() > 0);
    if let Some(lock) = locks.get(url).and_then(Weak::upgrade) {
        return Ok(lock);
    }
    let lock = Arc::new(Mutex::new(()));
    locks.insert(url.to_owned(), Arc::downgrade(&lock));
    Ok(lock)
}
#[tauri::command]
pub fn playback_log(app: tauri::AppHandle, event: Value) -> Result<(), String> {
    use std::io::Write;
    let serialized = serde_json::to_vec(&event).map_err(|e| e.to_string())?;
    if serialized.len() > 6000 || !event.is_object() {
        return Err("Invalid playback event".into());
    }
    let root = crate::storage::data_root(&app)?.join("logs");
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let path = root.join("playback.log");
    if fs::metadata(&path).is_ok_and(|meta| meta.len() > 2 * 1024 * 1024) {
        let _ = fs::rename(&path, root.join("playback.previous.log"));
    }
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|e| e.to_string())?;
    file.write_all(&serialized)
        .and_then(|_| file.write_all(b"\n"))
        .map_err(|e| e.to_string())
}

pub(crate) fn command(app: &tauri::AppHandle) -> Result<Command, String> {
    let path = crate::media_tools::ytdlp(app)?;
    let mut cmd = crate::media_tools::run(&path);
    cmd.args([
        "--ignore-config",
        "--no-warnings",
        "--no-progress",
        "--no-playlist",
        "--socket-timeout",
        "15",
        "--retries",
        "1",
        "--concurrent-fragments",
        "4",
        "--fragment-retries",
        "1",
    ]);
    Ok(cmd)
}
fn output(mut cmd: Command) -> Result<Vec<u8>, String> {
    let out = cmd.output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr)
            .lines()
            .filter(|l| !l.contains("Deprecated Feature"))
            .collect::<Vec<_>>()
            .join("\n")
            .chars()
            .take(1200)
            .collect());
    }
    if out.stdout.len() > 8 * 1024 * 1024 {
        return Err("Music response too large".into());
    }
    Ok(out.stdout)
}
fn track_url(raw: &str) -> Result<String, String> {
    let url = reqwest::Url::parse(raw).map_err(|e| e.to_string())?;
    if url.scheme() == "https"
        && matches!(
            url.host_str(),
            Some("youtube.com" | "www.youtube.com" | "music.youtube.com")
        )
        && url.path() == "/watch"
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none()
    {
        let id = url
            .query_pairs()
            .find(|(key, _)| key == "v")
            .map(|(_, value)| value.into_owned())
            .ok_or("Missing video ID")?;
        if id.len() == 11
            && id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        {
            return Ok(format!("https://www.youtube.com/watch?v={id}"));
        }
        return Err("Invalid video ID".into());
    }
    if url.scheme() != "https"
        || !url.host_str().is_some_and(|h| {
            matches!(
                h,
                "soundcloud.com"
                    | "open.qobuz.com"
                    | "play.qobuz.com"
                    | "www.qobuz.com"
                    | "tidal.com"
                    | "music.yandex.ru"
                    | "music.yandex.com"
                    | "deezer.com"
                    | "www.deezer.com"
                    | "listen.tidal.com"
                    | "music.amazon.com"
                    | "music.amazon.co.uk"
                    | "music.amazon.de"
                    | "music.amazon.co.jp"
                    | "music.amazon.fr"
                    | "music.amazon.ca"
                    | "music.amazon.it"
                    | "music.amazon.es"
            )
        })
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || !(2..=4).contains(&url.path().split('/').filter(|p| !p.is_empty()).count())
    {
        return Err("Choose a public track from a supported service".into());
    }
    Ok(url.to_string())
}

pub(crate) fn lucida(
    app: &tauri::AppHandle,
    action: &str,
    value: &str,
    target: &str,
) -> Result<Value, String> {
    let python = crate::media_tools::module_python(app)?;
    let root = crate::network::cache_root(app)?;
    let script = root.join("lucida_bridge.py");
    {
        let _guard = BRIDGE_SCRIPT.lock().map_err(|e| e.to_string())?;
        let source = include_bytes!("../../scripts/lucida_bridge.py");
        if fs::read(&script).ok().as_deref() != Some(source.as_slice()) {
            fs::write(&script, source).map_err(|e| e.to_string())?;
        }
    }
    let mut cmd = crate::media_tools::run(&python);
    cmd.env("PYTHONIOENCODING", "utf-8")
        .env("PLAYWRIGHT_BROWSERS_PATH", root.join("browsers"))
        .arg(script)
        .args([action, value, target]);
    serde_json::from_slice(&output(cmd)?).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn lucida_search(
    app: tauri::AppHandle,
    query: String,
    service: Option<String>,
    fast: Option<bool>,
) -> Result<Value, String> {
    if query.trim().is_empty() || query.len() > 300 {
        return Err("Enter an artist or song title".into());
    }
    let service = service.unwrap_or_else(|| "all".into());
    if !matches!(service.as_str(), "all" | "amazon" | "others") {
        return Err("Unsupported music service".into());
    }
    if fast.unwrap_or(false) {
        return tauri::async_runtime::spawn_blocking(move || {
            crate::lucida_stream::search_fast(&query, &service)
        })
        .await
        .map_err(|e| e.to_string())?;
    }
    if service == "amazon" {
        return tauri::async_runtime::spawn_blocking(move || {
            let (send, receive) = std::sync::mpsc::channel();
            let native = send.clone();
            let text = query.clone();
            std::thread::spawn(move || {
                let _ = native.send(crate::lucida_stream::search_amazon(&text));
            });
            std::thread::spawn(move || {
                let result = tauri::async_runtime::block_on(
                    crate::media_tools::ensure_music_module(app.clone()),
                )
                .and_then(|_| lucida(&app, "search", &query, "amazon"));
                let _ = send.send(result);
            });
            let mut empty = None;
            let mut failure = "Не удалось найти запись в Amazon".to_owned();
            for _ in 0..2 {
                match receive.recv_timeout(std::time::Duration::from_secs(30)) {
                    Ok(Ok(result))
                        if result["tracks"]
                            .as_array()
                            .is_some_and(|tracks| !tracks.is_empty()) =>
                    {
                        return Ok(result)
                    }
                    Ok(Ok(result)) => empty = Some(result),
                    Ok(Err(error)) => failure = error,
                    Err(_) => break,
                }
            }
            empty.ok_or(failure)
        })
        .await
        .map_err(|e| e.to_string())?;
    }
    crate::media_tools::ensure_music_module(app.clone()).await?;
    tauri::async_runtime::spawn_blocking(move || lucida(&app, "search", &query, &service))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn soundcloud_import(app: tauri::AppHandle, url: String) -> Result<Value, String> {
    let mut parsed = reqwest::Url::parse(url.trim())
        .map_err(|_| "Вставьте ссылку на публичный трек или плейлист SoundCloud".to_string())?;
    let parts: Vec<_> = parsed.path().split('/').filter(|p| !p.is_empty()).collect();
    if parsed.scheme() != "https"
        || !matches!(
            parsed.host_str(),
            Some("soundcloud.com" | "www.soundcloud.com")
        )
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.port().is_some()
        || !(parts.len() == 2 && !matches!(parts[1], "sets" | "tracks" | "likes" | "reposts")
            || parts.len() == 3 && parts[1] == "sets")
        || parts.iter().any(|p| {
            !p.chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        })
    {
        return Err("Нужна ссылка на публичный трек или плейлист SoundCloud".into());
    }
    parsed
        .set_host(Some("soundcloud.com"))
        .map_err(|e| e.to_string())?;
    parsed.set_query(None);
    parsed.set_fragment(None);
    tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = command(&app)?;
        cmd.args([
            "--yes-playlist", "--skip-download", "--ignore-errors",
            "--ignore-no-formats-error", "--extractor-args", "soundcloud:formats=none",
            "--playlist-end", "1001", "--socket-timeout", "8", "--retries", "0",
            "--print", "%(.{id,title,artist,uploader,album,duration,webpage_url,thumbnail,availability,playlist_id,playlist_title,playlist_count})j",
            "--",
        ]).arg(parsed.as_str());
        let out = cmd.output().map_err(|e| format!("Не удалось запустить импорт: {e}"))?;
        if out.stdout.len() > 4 * 1024 * 1024 {
            return Err("Плейлист слишком большой. Разделите его на части до 1000 песен.".into());
        }
        let entries: Vec<Value> = String::from_utf8_lossy(&out.stdout)
            .lines().filter_map(|line| serde_json::from_str(line).ok()).collect();
        let count = entries.first().and_then(|item| item["playlist_count"].as_u64());
        if entries.len() > 1000 || count.is_some_and(|n| n > 1000) {
            return Err("За один раз можно импортировать до 1000 песен. Разделите плейлист на части.".into());
        }
        let first = entries.first().ok_or_else(|| {
            "SoundCloud не вернул песни. Проверьте ссылку и доступность плейлиста.".to_string()
        })?;
        Ok(json!({ "id": first["playlist_id"], "title": first["playlist_title"],
            "total": count.unwrap_or(entries.len() as u64), "entries": entries }))
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn extractor_search(
    app: tauri::AppHandle,
    query: String,
    source: Option<String>,
) -> Result<Value, String> {
    if query.trim().is_empty() || query.len() > 300 {
        return Err("Enter an artist or song title".into());
    }
    let youtube = match source.as_deref() {
        None | Some("soundcloud") => false,
        Some("youtube") => true,
        _ => return Err("Unsupported search source".into()),
    };
    tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = command(&app)?;
        cmd.args([
            "--flat-playlist",
            "--playlist-end",
            "20",
            "--dump-single-json",
        ]);
        if youtube {
            cmd.arg(format!("ytsearch3:{}", query.trim()));
        } else if query.starts_with("https://soundcloud.com/") {
            cmd.arg(track_url(&query)?);
        } else {
            cmd.arg(format!("scsearch20:{}", query.trim()));
        }
        serde_json::from_slice(&output(cmd)?).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
pub(crate) fn inspect(app: &tauri::AppHandle, path: &Path, expected: f64) -> Result<Value, String> {
    let (_, probe) = crate::media_tools::paths(app)?;
    let mut cmd = crate::media_tools::run(&probe);
    cmd.args([
        "-v",
        "error",
        "-protocol_whitelist",
        "file,pipe",
        "-show_streams",
        "-show_format",
        "-of",
        "json",
    ])
    .arg(path);
    let data: Value = serde_json::from_slice(&output(cmd)?).map_err(|e| e.to_string())?;
    let stream = data["streams"]
        .as_array()
        .and_then(|s| s.iter().find(|s| s["codec_type"] == "audio"))
        .ok_or("No audio stream in the downloaded recording")?;
    let codec = stream["codec_name"].as_str().ok_or("Unknown audio codec")?;
    let metadata_duration = data["format"]["duration"]
        .as_str()
        .and_then(|v| v.parse::<f64>().ok())
        .filter(|value| value.is_finite() && *value > 0.0);
    let duration = match metadata_duration {
        Some(duration) => duration,
        None if codec == "flac" => {
            let mut reader =
                claxon::FlacReader::open(path).map_err(|e| format!("Cannot verify FLAC: {e}"))?;
            let info = reader.streaminfo();
            if info.sample_rate == 0 || info.channels == 0 {
                return Err("Invalid FLAC stream information".into());
            }
            let samples_per_second = info.sample_rate as f64 * info.channels as f64;
            let limit = ((expected + 4.0) * samples_per_second).ceil() as u64;
            let mut samples = 0u64;
            for sample in reader.samples() {
                sample.map_err(|e| format!("Incomplete FLAC recording: {e}"))?;
                samples += 1;
                if samples > limit {
                    return Err("The source returned a different recording".into());
                }
            }
            samples as f64 / samples_per_second
        }
        None => return Err("Cannot verify recording duration".into()),
    };
    if duration <= 0.0 || duration < expected - 3.0 || duration > expected + 3.0 {
        return Err("The source returned a preview or a different recording".into());
    }
    if !matches!(codec, "flac" | "aac" | "mp3" | "opus" | "vorbis") {
        return Err("Unsupported source audio format".into());
    }
    Ok(
        json!({"duration":duration,"format":if codec == "aac" {"AAC"} else if codec == "opus" {"OPUS"} else if codec == "vorbis" {"OGG"} else if codec == "flac" {"FLAC"} else {"MP3"}, "sampleRate":stream["sample_rate"].as_str().and_then(|s|s.parse::<u32>().ok()), "bitDepth":stream["bits_per_raw_sample"].as_str().and_then(|s|s.parse::<u32>().ok())}),
    )
}
fn cached_audio(root: &Path, meta: &Path, duration: f64) -> Option<Value> {
    let bytes = fs::read(meta).ok()?;
    let data: Value = serde_json::from_slice(&bytes).ok()?;
    let path = Path::new(data["path"].as_str()?);
    let actual = data["duration"].as_f64()?;
    let size = fs::metadata(path).ok()?.len();
    if path.parent() == Some(root)
        && path.is_file()
        && size > 0
        && data["size"].as_u64() == Some(size)
        && (actual - duration).abs() <= 3.0
    {
        crate::cache::hold(path);
        Some(data)
    } else {
        None
    }
}
fn allow_audio(app: &tauri::AppHandle, data: &Value) -> Result<(), String> {
    let path = Path::new(data["path"].as_str().ok_or("Missing cached audio path")?);
    let scope = app.asset_protocol_scope();
    scope.allow_file(path).map_err(|e| e.to_string())?;
    if !scope.is_allowed(path) {
        return Err("Cached audio access denied".into());
    }
    Ok(())
}

static ALIAS: Mutex<()> = Mutex::new(());
fn save_alias(root: &Path, alias: &Path, data: &Value, duration: f64) -> Result<(), String> {
    let _guard = ALIAS.lock().map_err(|e| e.to_string())?;
    if data["format"] != "FLAC"
        && cached_audio(root, alias, duration).is_some_and(|old| old["format"] == "FLAC")
    {
        return Ok(());
    }
    let temp = alias.with_extension("tmp");
    fs::write(&temp, serde_json::to_vec(data).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    fs::rename(temp, alias).map_err(|e| e.to_string())
}

fn video_chunk(
    client: &reqwest::blocking::Client,
    url: &str,
    offset: u64,
    expected_total: Option<u64>,
) -> Result<(reqwest::blocking::Response, u64, u64), String> {
    let response = client
        .get(url)
        .header(
            reqwest::header::RANGE,
            format!("bytes={offset}-{}", offset + 524287),
        )
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .and_then(|r| r.error_for_status())
        .map_err(|e| e.to_string())?;
    if response.status().as_u16() != 206 {
        return Err("Audio server ignored byte range".into());
    }
    let range = response
        .headers()
        .get(reqwest::header::CONTENT_RANGE)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("bytes "))
        .ok_or("Missing audio byte range")?;
    let (span, total) = range.split_once('/').ok_or("Invalid audio byte range")?;
    let (start, end) = span.split_once('-').ok_or("Invalid audio byte range")?;
    let total = total.parse::<u64>().map_err(|_| "Invalid audio size")?;
    let start = start.parse::<u64>().map_err(|_| "Invalid audio offset")?;
    let end = end.parse::<u64>().map_err(|_| "Invalid audio offset")?;
    if start != offset
        || end < start
        || end >= total
        || end - start >= 524288
        || total > 200 * 1024 * 1024
        || expected_total.is_some_and(|value| value != total)
    {
        return Err("Audio byte range does not match the recording".into());
    }
    let size = end - start + 1;
    if response.content_length().is_some_and(|value| value != size) {
        return Err("Audio chunk has an invalid length".into());
    }
    Ok((response, total, size))
}

#[tauri::command]
pub async fn extractor_cache_stream(
    app: tauri::AppHandle,
    url: String,
    recording: String,
    duration: f64,
) -> Result<Value, String> {
    let parsed = reqwest::Url::parse(&url).map_err(|e| e.to_string())?;
    let parts: Vec<_> = parsed.path_segments().ok_or("Invalid stream")?.collect();
    let audius = parsed.host_str() == Some("api.audius.co")
        && parts.len() == 4
        && parts[0] == "v1"
        && parts[1] == "tracks"
        && parts[3] == "stream"
        && parts[2].chars().all(|ch| ch.is_ascii_alphanumeric());
    let youtube = parsed
        .host_str()
        .is_some_and(|host| host.ends_with(".googlevideo.com"));
    let lucida = parsed.host_str().is_some_and(|h| h.ends_with(".lucida.to"))
        && parts.len() == 5
        && parts[..3] == ["api", "fetch", "request"]
        && parts[4] == "download"
        && !parts[3].is_empty()
        && parts[3]
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_');
    if parsed.scheme() != "https"
        || !(audius || lucida || youtube)
        || parsed.port().is_some()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || !duration.is_finite()
        || duration <= 0.0
    {
        return Err("Unsupported stream cache source".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        use std::io::{Read, Write};
        let cache = download_lock(&url)?;
        let _guard = cache.lock().map_err(|e| e.to_string())?;
        let root = crate::network::cache_root(&app)?;
        let key = format!("{:x}", Sha256::digest(url.as_bytes()));
        let meta = root.join(format!("{key}.cache.json"));
        let alias = root.join(format!(
            "recording-{:x}.json",
            Sha256::digest(recording.as_bytes())
        ));
        if let Some(data) = cached_audio(&root, &meta, duration) {
            save_alias(&root, &alias, &data, duration)?;
            allow_audio(&app, &data)?;
            return Ok(data);
        }
        let client = reqwest::blocking::Client::builder()
            .user_agent("Mozilla/5.0")
            .connect_timeout(std::time::Duration::from_secs(5))
            .timeout(std::time::Duration::from_secs(180))
            .redirect(reqwest::redirect::Policy::custom(|attempt| {
                if attempt.previous().len() < 5
                    && attempt.url().scheme() == "https"
                    && attempt.url().host_str().is_some_and(|host| {
                        host == "api.audius.co"
                            || host.ends_with(".audius.co")
                            || host.ends_with(".googlevideo.com")
                            || host.ends_with(".r2.cloudflarestorage.com")
                            || host.ends_with(".lucida.to")
                    })
                {
                    attempt.follow()
                } else {
                    attempt.error("Unsupported stream redirect")
                }
            }))
            .build()
            .map_err(|e| e.to_string())?;
        let (mut response, mut chunk, total) = if youtube {
            let (response, total, size) = video_chunk(&client, &url, 0, None)?;
            (response, Some(size), Some(total))
        } else {
            let response = if lucida {
                crate::lucida_stream::download(&url)?
            } else {
                client
                    .get(parsed)
                    .send()
                    .and_then(|r| r.error_for_status())
                    .map_err(|e| e.to_string())?
            };
            let total = response.content_length();
            (response, None, total)
        };
        let limit = 200 * 1024 * 1024;
        if total.is_some_and(|size| size > limit) {
            return Err("Stream exceeds cache limit".into());
        }
        let temp = root.join(format!("{key}.part"));
        let length = temp.with_extension("length");
        if let Some(size) = total {
            fs::write(&length, size.to_string()).map_err(|e| e.to_string())?;
        }
        let result = (|| {
            let mut file = fs::File::create(&temp).map_err(|e| e.to_string())?;
            let mut size = 0;
            loop {
                let copied = std::io::copy(
                    &mut response.by_ref().take(chunk.unwrap_or(limit) + 1),
                    &mut file,
                )
                .map_err(|e| e.to_string())?;
                if chunk.is_some_and(|expected| copied != expected) {
                    return Err("Audio chunk was interrupted".into());
                }
                size += copied;
                if !youtube || total == Some(size) {
                    break;
                }
                let (next, _, count) = video_chunk(&client, &url, size, total)?;
                response = next;
                chunk = Some(count);
            }
            file.flush().map_err(|e| e.to_string())?;
            drop(file);
            if size == 0 || size > limit {
                return Err("Invalid stream size".into());
            }
            crate::media_tools::ensure(&app)?;
            let mut data = inspect(&app, &temp, duration)?;
            let extension = match data["format"].as_str() {
                Some("MP3") => "mp3",
                Some("AAC") => "m4a",
                Some("FLAC") => "flac",
                _ => return Err("Unsupported cached codec".into()),
            };
            let path = root.join(format!("{key}.{extension}"));
            fs::rename(&temp, &path).map_err(|e| e.to_string())?;
            data["key"] = json!(key);
            data["path"] = json!(path.to_string_lossy());
            data["size"] = json!(size);
            fs::write(meta, serde_json::to_vec(&data).map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
            save_alias(&root, &alias, &data, duration)?;
            crate::cache::commit(&app, &path);
            allow_audio(&app, &data)?;
            Ok(data)
        })();
        if result.is_err() {
            let _ = fs::remove_file(temp);
        }
        let _ = fs::remove_file(length);
        result
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn extractor_cached(
    app: tauri::AppHandle,
    recording: String,
    duration: f64,
    urls: Vec<String>,
) -> Result<Option<Value>, String> {
    if !duration.is_finite() || duration <= 0.0 {
        return Err("Invalid recording duration".into());
    }
    let root = crate::network::cache_root(&app)?;
    let alias = format!("recording-{:x}.json", Sha256::digest(recording.as_bytes()));
    if let Some(data) = cached_audio(&root, &root.join(alias), duration) {
        allow_audio(&app, &data)?;
        return Ok(Some(data));
    }
    for url in urls.iter().take(20) {
        let key = format!("{:x}.cache.json", Sha256::digest(url.as_bytes()));
        if let Some(data) = cached_audio(&root, &root.join(key), duration) {
            allow_audio(&app, &data)?;
            return Ok(Some(data));
        }
    }
    Ok(None)
}

#[tauri::command]
pub async fn extractor_audio(
    app: tauri::AppHandle,
    url: String,
    duration: f64,
    recording: Option<String>,
) -> Result<Value, String> {
    let url = track_url(&url)?;
    if !duration.is_finite() || duration <= 0.0 {
        return Err("Only full recordings are supported".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let download = download_lock(&url)?;
        let _guard = download.lock().map_err(|e| e.to_string())?;
        let root = crate::network::cache_root(&app)?;
        let key = format!("{:x}", Sha256::digest(url.as_bytes()));
        let meta = root.join(format!("{key}.cache.json"));
        let alias = recording.map(|value| {
            root.join(format!(
                "recording-{:x}.json",
                Sha256::digest(value.as_bytes())
            ))
        });
        if let Some(data) = cached_audio(&root, &meta, duration) {
            if let Some(alias) = &alias {
                save_alias(&root, alias, &data, duration)?;
            }
            allow_audio(&app, &data)?;
            return Ok(data);
        }
        crate::media_tools::ensure(&app)?;
        let (ffmpeg, _) = crate::media_tools::paths(&app)?;
        let mut cmd = command(&app)?;
        cmd.args([
            "--max-filesize",
            "200M",
            "--format",
            if url.starts_with("https://www.youtube.com/watch?") {
                "bestaudio[ext=m4a]"
            } else {
                "bestaudio"
            },
            "--print",
            "after_move:filepath",
            "--no-simulate",
            "--ffmpeg-location",
        ])
        .arg(ffmpeg.parent().unwrap())
        .arg("--output")
        .arg(root.join(format!("{key}.%(ext)s")))
        .arg(&url);
        let result = if url.starts_with("https://soundcloud.com/")
            || url.starts_with("https://www.youtube.com/watch?")
        {
            output(cmd)
        } else {
            Err("Loading through Lucida".into())
        };
        let path = match result {
            Ok(bytes) => std::path::PathBuf::from(
                String::from_utf8_lossy(&bytes)
                    .lines()
                    .last()
                    .ok_or("The source did not return an audio file")?
                    .trim(),
            ),
            Err(first_error) => {
                tauri::async_runtime::block_on(crate::media_tools::ensure_music_module(
                    app.clone(),
                ))
                .map_err(|e| format!("{first_error}\n{e}"))?;
                let result = lucida(
                    &app,
                    "download",
                    &url,
                    root.join(&key).to_str().ok_or("Invalid cache path")?,
                )
                .map_err(|e| format!("{first_error}\nLucida: {e}"))?;
                std::path::PathBuf::from(
                    result["path"]
                        .as_str()
                        .ok_or("Lucida did not return an audio file")?,
                )
            }
        };
        if path.parent() != Some(root.as_path()) || !path.is_file() {
            return Err("Invalid downloaded audio path".into());
        }
        if fs::metadata(&path).map_err(|e| e.to_string())?.len() > 200 * 1024 * 1024 {
            let _ = fs::remove_file(&path);
            return Err("Audio exceeds the 200 MB limit".into());
        }
        let mut data = match inspect(&app, &path, duration) {
            Ok(data) => data,
            Err(error) => {
                let _ = fs::remove_file(&path);
                return Err(error);
            }
        };
        let path = if data["format"] == "FLAC" {
            let destination = root.join(format!("{key}.flac"));
            if path != destination {
                fs::rename(&path, &destination).map_err(|e| e.to_string())?;
            }
            destination
        } else {
            path
        };
        data["key"] = json!(key);
        data["path"] = json!(path.to_string_lossy());
        data["size"] = json!(fs::metadata(&path).map_err(|e| e.to_string())?.len());
        fs::write(meta, serde_json::to_vec(&data).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        if let Some(alias) = alias {
            save_alias(&root, &alias, &data, duration)?;
        }
        crate::cache::commit(&app, &path);
        allow_audio(&app, &data)?;
        Ok(data)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn extractor_stream(
    app: tauri::AppHandle,
    url: String,
    duration: f64,
    direct_only: Option<bool>,
    recording: Option<String>,
    prepare_only: Option<bool>,
) -> Result<Value, String> {
    let url = track_url(&url)?;
    if !duration.is_finite() || duration <= 0.0 {
        return Err("Only full recordings are supported".into());
    }
    let youtube = url.starts_with("https://www.youtube.com/watch?");
    if url.starts_with("https://soundcloud.com/") || youtube {
        crate::media_tools::ensure_extractor_tool(app.clone()).await?;
    }
    tauri::async_runtime::spawn_blocking(move || {
        if url.starts_with("https://soundcloud.com/") || youtube {
            let attempt = (|| -> Result<Value, String> {
                let mut cmd = command(&app)?;
                cmd.args(["--skip-download", "--dump-single-json", "--format", if youtube { "bestaudio[ext=m4a]" } else { "bestaudio" }]).arg(&url);
                let data: Value = serde_json::from_slice(&output(cmd)?).map_err(|e|e.to_string())?;
                let actual = data["duration"].as_f64().ok_or("Missing full recording duration")?;
                if actual <= 0.0 || (actual - duration).abs() > 3.0 { return Err("Source returned a preview or different recording".into()); }
                let raw = data["url"].as_str().ok_or("Missing audio stream")?;
                let stream = reqwest::Url::parse(raw).map_err(|e|e.to_string())?;
                if stream.scheme() != "https" || !stream.host_str().is_some_and(|h|h.ends_with(".sndcdn.com") || h.ends_with(".soundcloud.cloud") || (youtube && h.ends_with(".googlevideo.com"))) { return Err("Unsupported audio stream host".into()); }
                let codec = data["acodec"].as_str().unwrap_or("");
                let format = if codec.starts_with("mp4a") || codec.contains("aac") { "AAC" } else if codec.contains("mp3") { "MP3" } else if codec.contains("flac") { "FLAC" } else { "Audio" };
                Ok(json!({"url":raw,"duration":actual,"format":format,"hls":data["protocol"].as_str().is_some_and(|p|p.starts_with("m3u8")),"size":0,"key":""}))
            })();
            match attempt {
                Ok(mut result) => {
                    if youtube {
                        let raw = result["url"].as_str().ok_or("Missing audio stream")?.to_owned();
                        result["cacheUrl"] = json!(raw);
                        result["cacheKey"] = json!(format!("{:x}", Sha256::digest(raw.as_bytes())));
                        if !prepare_only.unwrap_or(false) {
                            let (local, format) = crate::stream_proxy::register(app.clone(), raw, duration, recording)?;
                            result["url"] = json!(local);
                            result["format"] = json!(format);
                        }
                    }
                    return Ok(result);
                }
                Err(error) if youtube || direct_only.unwrap_or(false) => return Err(error),
                Err(_) => {}
            }
        }
        let began = std::time::Instant::now();
        let mut data = crate::lucida_stream::prepare(&url, duration)?;
        let stream = reqwest::Url::parse(data["url"].as_str().ok_or("Missing stream URL")?).map_err(|e|e.to_string())?;
        if stream.scheme() != "https" || !stream.host_str().is_some_and(|h| h.ends_with(".lucida.to")) || stream.port().is_some() || !stream.username().is_empty() || stream.password().is_some() { return Err("Invalid audio stream URL".into()); }
        let actual = data["duration"].as_f64().ok_or("Missing full recording duration")?;
        if actual <= 0.0 || (actual - duration).abs() > 3.0 { return Err("Source returned a preview or different recording".into()); }
        data["cacheUrl"] = json!(stream.as_str());
        data["cacheKey"] = json!(format!("{:x}", Sha256::digest(stream.as_str().as_bytes())));
        if prepare_only.unwrap_or(false) { return Ok(data); }
        let (local, format) = crate::stream_proxy::register(app.clone(), stream.to_string(), duration, recording)?;
        data["url"] = json!(local);
        data["format"] = json!(format);
        data["timings"]["firstBytesMs"] = json!(began.elapsed().as_millis());
        let _ = playback_log(app, json!({"stage":"lucida-stream-ready","timings":data["timings"],"format":data["format"]}));
        data["size"] = json!(0);
        data["key"] = json!("");
        Ok(data)
    }).await.map_err(|e|e.to_string())?
}

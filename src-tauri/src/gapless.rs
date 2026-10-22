use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    path::PathBuf,
    process::Stdio,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::{Duration, Instant, SystemTime},
};

struct Entry {
    path: PathBuf,
    complete: Mutex<Option<Result<(), String>>>,
    cancelled: AtomicBool,
    created: Instant,
}
type Entries = Arc<Mutex<HashMap<String, Arc<Entry>>>>;
static SERVER: OnceLock<Result<(u16, Entries), String>> = OnceLock::new();

fn server() -> Result<&'static (u16, Entries), String> {
    SERVER
        .get_or_init(|| {
            let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|e| e.to_string())?;
            let port = listener.local_addr().map_err(|e| e.to_string())?.port();
            let entries: Entries = Arc::new(Mutex::new(HashMap::new()));
            let shared = entries.clone();
            std::thread::spawn(move || {
                for socket in listener.incoming().flatten() {
                    let shared = shared.clone();
                    std::thread::spawn(move || {
                        let _ = serve(socket, shared);
                    });
                }
            });
            Ok((port, entries))
        })
        .as_ref()
        .map_err(Clone::clone)
}

fn serve(mut socket: TcpStream, entries: Entries) -> Result<(), Box<dyn std::error::Error>> {
    socket.set_read_timeout(Some(Duration::from_secs(3)))?;
    socket.set_write_timeout(Some(Duration::from_secs(15)))?;
    let mut request = Vec::new();
    let mut byte = [0];
    while request.len() < 8192 {
        if socket.read(&mut byte)? == 0 {
            return Ok(());
        }
        request.push(byte[0]);
        if request.ends_with(b"\r\n\r\n") {
            break;
        }
    }
    let text = String::from_utf8(request)?;
    let origin = crate::network::audio_origin(&text);
    let mut first = text.lines().next().unwrap_or("").split_whitespace();
    if first.next() != Some("GET") {
        return Ok(());
    }
    let key = first.next().unwrap_or("").trim_start_matches('/');
    let entry = entries
        .lock()
        .map_err(|_| "Gapless registry unavailable")?
        .get(key)
        .cloned();
    let Some(entry) = entry else {
        socket.write_all(
            b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        )?;
        return Ok(());
    };
    let mut file = fs::File::open(&entry.path)?;
    write!(socket, "HTTP/1.1 200 OK\r\nContent-Type: audio/mp4\r\nAccess-Control-Allow-Origin: {origin}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n")?;
    socket.flush()?;
    let mut buffer = [0; 65536];
    loop {
        if entry.cancelled.load(Ordering::Relaxed) {
            break;
        }
        let count = file.read(&mut buffer)?;
        if count > 0 {
            socket.write_all(&buffer[..count])?;
        } else if let Some(result) = entry
            .complete
            .lock()
            .map_err(|_| "Gapless state unavailable")?
            .as_ref()
        {
            if result.is_err() {
                return Err("Gapless remux failed".into());
            }
            let last = file.read(&mut buffer)?;
            if last == 0 {
                break;
            }
            socket.write_all(&buffer[..last])?;
        } else {
            std::thread::sleep(Duration::from_millis(10));
        }
    }
    Ok(())
}

#[derive(Serialize)]
pub struct Resource {
    url: String,
    mime: String,
}

#[tauri::command]
pub async fn gapless_prepare(
    app: tauri::AppHandle,
    src: String,
    path: Option<String>,
    format: String,
) -> Result<Resource, String> {
    let mime = match format.as_str() {
        "FLAC" => "audio/mp4; codecs=\"flac\"",
        "AAC" => "audio/mp4; codecs=\"mp4a.40.2\"",
        "MP3" => "audio/mp4; codecs=\"mp4a.6B\"",
        _ => return Err("This format does not support gapless playback".into()),
    }
    .to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        let input = if let Some(path) = path {
            let path = fs::canonicalize(path).map_err(|e| e.to_string())?;
            let cache =
                fs::canonicalize(crate::network::cache_root(&app)?).map_err(|e| e.to_string())?;
            let data = fs::canonicalize(crate::storage::data_root(&app)?.join("user-data"))
                .map_err(|e| e.to_string())?;
            if !path.is_file() || !(path.starts_with(cache) || path.starts_with(data)) {
                return Err("Unsupported local gapless source".into());
            }
            path.to_str().ok_or("Invalid source path")?.to_owned()
        } else if crate::stream_proxy::owns_url(&src) {
            src
        } else {
            return Err("Gapless requires a local or prepared stream".into());
        };
        crate::media_tools::ensure(&app)?;
        let (ffmpeg, _) = crate::media_tools::paths(&app)?;
        let (port, entries) = server()?;
        let key = format!(
            "{:x}",
            Sha256::digest(format!("{input}{:?}", SystemTime::now()).as_bytes())
        );
        let root = crate::network::cache_root(&app)?.join("gapless");
        fs::create_dir_all(&root).map_err(|e| e.to_string())?;
        for item in fs::read_dir(&root).map_err(|e| e.to_string())?.flatten() {
            if item.file_type().is_ok_and(|kind| kind.is_file())
                && item
                    .metadata()
                    .ok()
                    .and_then(|m| m.modified().ok())
                    .and_then(|time| time.elapsed().ok())
                    .is_some_and(|age| age > Duration::from_secs(7200))
            {
                let _ = fs::remove_file(item.path());
            }
        }
        let entry = Arc::new(Entry {
            path: root.join(format!("{key}.m4s")),
            complete: Mutex::new(None),
            cancelled: AtomicBool::new(false),
            created: Instant::now(),
        });
        {
            let mut entries = entries.lock().map_err(|e| e.to_string())?;
            entries.retain(|_, item| {
                if item.created.elapsed() > Duration::from_secs(1800) {
                    item.cancelled.store(true, Ordering::Relaxed);
                    let _ = fs::remove_file(&item.path);
                    false
                } else {
                    true
                }
            });
            if entries.len() >= 16 {
                return Err("Too many prepared gapless streams".into());
            }
            entries.insert(key.clone(), entry.clone());
        }
        let mut child = crate::media_tools::run(&ffmpeg)
            .args([
                "-nostdin",
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-analyzeduration",
                "0",
                "-probesize",
                "32768",
                "-i",
            ])
            .arg(input)
            .args([
                "-map",
                "0:a:0",
                "-vn",
                "-c:a",
                "copy",
                "-map_metadata",
                "-1",
                "-strict",
                "-2",
                "-movflags",
                "+empty_moov+default_base_moof+frag_keyframe",
                "-frag_duration",
                "200000",
                "-flush_packets",
                "1",
                "-f",
                "mp4",
            ])
            .arg(&entry.path)
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| e.to_string())?;
        let running = entry.clone();
        std::thread::spawn(move || {
            let result = loop {
                if running.cancelled.load(Ordering::Relaxed) {
                    let _ = child.kill();
                    let _ = child.wait();
                    break Err("Gapless stream cancelled".into());
                }
                match child.try_wait() {
                    Ok(Some(status)) if status.success() => break Ok(()),
                    Ok(Some(_)) => {
                        let mut error = String::new();
                        if let Some(stderr) = child.stderr.take() {
                            let _ = stderr.take(8192).read_to_string(&mut error);
                        }
                        break Err(error.chars().take(500).collect());
                    }
                    Ok(None) => std::thread::sleep(Duration::from_millis(15)),
                    Err(error) => break Err(error.to_string()),
                }
            };
            if let Ok(mut complete) = running.complete.lock() {
                *complete = Some(result);
            }
            if running.cancelled.load(Ordering::Relaxed) {
                let _ = fs::remove_file(&running.path);
            }
        });
        let deadline = Instant::now() + Duration::from_secs(6);
        loop {
            if fs::metadata(&entry.path).is_ok_and(|m| m.len() > 16) {
                return Ok(Resource {
                    url: format!("http://127.0.0.1:{port}/{key}"),
                    mime,
                });
            }
            if let Some(Err(error)) = entry.complete.lock().map_err(|e| e.to_string())?.as_ref() {
                return Err(error.clone());
            }
            if Instant::now() >= deadline {
                entry.cancelled.store(true, Ordering::Relaxed);
                return Err("Gapless stream preparation timed out".into());
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn gapless_release(url: String) -> Result<(), String> {
    let Some(Ok((port, entries))) = SERVER.get() else {
        return Ok(());
    };
    let url = reqwest::Url::parse(&url).map_err(|e| e.to_string())?;
    if url.host_str() != Some("127.0.0.1") || url.port() != Some(*port) {
        return Err("Unknown gapless stream".into());
    }
    if let Some(entry) = entries
        .lock()
        .map_err(|e| e.to_string())?
        .remove(url.path().trim_start_matches('/'))
    {
        entry.cancelled.store(true, Ordering::Relaxed);
        let _ = fs::remove_file(&entry.path);
    }
    Ok(())
}

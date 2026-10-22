use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs,
    io::{Read, Seek, SeekFrom, Write},
    net::{TcpListener, TcpStream},
    path::PathBuf,
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant, SystemTime},
};

struct Entry {
    partial: PathBuf,
    created: Instant,
    result: Mutex<Option<Result<Value, String>>>,
}
type Streams = Arc<Mutex<HashMap<String, Arc<Entry>>>>;
static SERVER: OnceLock<Result<(u16, Streams), String>> = OnceLock::new();

pub fn owns_url(raw: &str) -> bool {
    let Some(Ok((port, streams))) = SERVER.get() else {
        return false;
    };
    let Ok(url) = reqwest::Url::parse(raw) else {
        return false;
    };
    url.scheme() == "http"
        && url.host_str() == Some("127.0.0.1")
        && url.port() == Some(*port)
        && streams
            .lock()
            .is_ok_and(|entries| entries.contains_key(url.path().trim_start_matches('/')))
}

pub fn register(
    app: tauri::AppHandle,
    url: String,
    duration: f64,
    recording: Option<String>,
) -> Result<(String, String), String> {
    let (port, streams) = SERVER
        .get_or_init(|| {
            let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|e| e.to_string())?;
            let port = listener.local_addr().map_err(|e| e.to_string())?.port();
            let streams: Streams = Arc::new(Mutex::new(HashMap::new()));
            let entries = streams.clone();
            std::thread::spawn(move || {
                for socket in listener.incoming().flatten() {
                    let entries = entries.clone();
                    std::thread::spawn(move || {
                        let _ = serve(socket, entries);
                    });
                }
            });
            Ok((port, streams))
        })
        .as_ref()
        .map_err(Clone::clone)?;
    let key = format!(
        "{:x}",
        Sha256::digest(format!("{url}{:?}{}", SystemTime::now(), std::process::id()).as_bytes())
    );
    let audio_key = format!("{:x}", Sha256::digest(url.as_bytes()));
    let entry = Arc::new(Entry {
        partial: crate::network::cache_root(&app)?.join(format!("{audio_key}.part")),
        created: Instant::now(),
        result: Mutex::new(None),
    });
    {
        let mut entries = streams.lock().map_err(|e| e.to_string())?;
        entries.retain(|_, entry| entry.created.elapsed() < Duration::from_secs(900));
        if entries.len() >= 128 {
            return Err("Too many prepared streams".into());
        }
        entries.insert(key.clone(), entry.clone());
    }
    let downloading = entry.clone();
    std::thread::spawn(move || {
        let result = tauri::async_runtime::block_on(crate::extractor::extractor_cache_stream(
            app.clone(),
            url.clone(),
            recording.unwrap_or(url),
            duration,
        ));
        let event = match &result {
            Ok(data) => {
                serde_json::json!({"stage":"stream-download-complete","format":data["format"],"size":data["size"]})
            }
            Err(error) => {
                serde_json::json!({"stage":"stream-download-failed","error":error.split_whitespace().map(|part| if part.contains("http") { "[url]" } else { part }).collect::<Vec<_>>().join(" ").chars().take(500).collect::<String>()})
            }
        };
        let _ = crate::extractor::playback_log(app, event);
        if let Ok(mut state) = downloading.result.lock() {
            *state = Some(result);
        }
    });
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        if let Ok(mut file) = fs::File::open(available_path(&entry)?) {
            let mut head = [0; 12];
            if file.read_exact(&mut head).is_ok() {
                let format = if head.starts_with(b"fLaC") {
                    "FLAC"
                } else if &head[4..8] == b"ftyp" {
                    "AAC"
                } else if head.starts_with(b"ID3") || head[0] == 0xff {
                    "MP3"
                } else {
                    "Audio"
                };
                return Ok((format!("http://127.0.0.1:{port}/{key}"), format.into()));
            }
        }
        if Instant::now() >= deadline {
            return Err("Stream did not deliver audio in time".into());
        }
        std::thread::sleep(Duration::from_millis(15));
    }
}

fn available_path(entry: &Entry) -> Result<PathBuf, String> {
    match entry.result.lock().map_err(|e| e.to_string())?.as_ref() {
        Some(Ok(data)) => Ok(PathBuf::from(
            data["path"].as_str().ok_or("Missing cached stream")?,
        )),
        Some(Err(error)) => Err(error.clone()),
        None => Ok(entry.partial.clone()),
    }
}

fn serve(mut socket: TcpStream, streams: Streams) -> Result<(), Box<dyn std::error::Error>> {
    socket.set_nodelay(true)?;
    socket.set_read_timeout(Some(Duration::from_secs(3)))?;
    socket.set_write_timeout(Some(Duration::from_secs(15)))?;
    let mut header = Vec::with_capacity(1024);
    let mut byte = [0];
    while header.len() < 8192 {
        if socket.read(&mut byte)? == 0 {
            return Ok(());
        }
        header.push(byte[0]);
        if header.ends_with(b"\r\n\r\n") {
            break;
        }
    }
    if !header.ends_with(b"\r\n\r\n") {
        return Ok(());
    }
    let header = String::from_utf8(header)?;
    let origin = crate::network::audio_origin(&header);
    let mut lines = header.split("\r\n");
    let request: Vec<_> = lines.next().unwrap_or("").split_whitespace().collect();
    if request.len() != 3 || !matches!(request[0], "GET" | "HEAD") {
        return Ok(());
    }
    let key = request[1].strip_prefix('/').unwrap_or("");
    let entry = streams
        .lock()
        .map_err(|_| "Stream registry unavailable")?
        .get(key)
        .filter(|entry| entry.created.elapsed() < Duration::from_secs(900))
        .cloned();
    let Some(entry) = entry else {
        socket.write_all(
            b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        )?;
        return Ok(());
    };
    let range = lines
        .filter_map(|line| line.split_once(':'))
        .find(|(name, _)| name.eq_ignore_ascii_case("Range"))
        .map(|(_, value)| value.trim().to_owned());
    let mut file = fs::File::open(available_path(&entry)?)?;
    let completed = entry
        .result
        .lock()
        .map_err(|_| "Stream state unavailable")?
        .is_some();
    let size = file.metadata()?.len();
    let total = if completed {
        Some(size)
    } else {
        fs::read_to_string(entry.partial.with_extension("length"))
            .ok()
            .and_then(|value| value.parse::<u64>().ok())
            .filter(|total| *total >= size && *total > 0)
    };
    let mut start = 0;
    let mut end = total.map(|size| size.saturating_sub(1));
    let mut partial = false;
    if let Some(total) = total {
        match requested_range(range.as_deref(), total) {
            Ok(Some((first, last))) => {
                start = first;
                end = Some(last);
                partial = true;
            }
            Ok(None) => {}
            Err(()) => {
                write!(socket, "HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */{total}\r\nAccess-Control-Allow-Origin: {origin}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")?;
                return Ok(());
            }
        }
    }
    let mut head = [0; 12];
    file.read_exact(&mut head)?;
    file.seek(SeekFrom::Start(start))?;
    let mime = if head.starts_with(b"fLaC") {
        "audio/flac"
    } else if &head[4..8] == b"ftyp" {
        "audio/mp4"
    } else {
        "audio/mpeg"
    };
    write!(socket, "HTTP/1.1 {}\r\nContent-Type: {mime}\r\nAccess-Control-Allow-Origin: {origin}\r\nAccess-Control-Expose-Headers: Content-Range, Accept-Ranges, Content-Length\r\nCache-Control: no-store\r\nConnection: close\r\n", if partial { "206 Partial Content" } else { "200 OK" })?;
    if let Some(total) = total {
        let last = end.unwrap_or(total.saturating_sub(1));
        write!(
            socket,
            "Accept-Ranges: bytes\r\nContent-Length: {}\r\n",
            last - start + 1
        )?;
        if partial {
            write!(socket, "Content-Range: bytes {start}-{last}/{total}\r\n")?;
        }
    } else {
        socket.write_all(b"Accept-Ranges: none\r\n")?;
    }
    socket.write_all(b"\r\n")?;
    socket.flush()?;
    if request[0] == "HEAD" {
        return Ok(());
    }
    let mut remaining = end.map(|last| last - start + 1);
    let mut buffer = [0; 65536];
    let mut progress = Instant::now();
    loop {
        if remaining == Some(0) {
            break;
        }
        let limit = remaining
            .unwrap_or(buffer.len() as u64)
            .min(buffer.len() as u64) as usize;
        let read = file.read(&mut buffer[..limit])?;
        if read > 0 {
            socket.write_all(&buffer[..read])?;
            if let Some(remaining) = remaining.as_mut() {
                *remaining -= read as u64;
            }
            progress = Instant::now();
            continue;
        }
        let completed = entry
            .result
            .lock()
            .map_err(|_| "Stream state unavailable")?
            .as_ref()
            .map(|result| result.is_ok());
        if completed == Some(false) {
            return Err("Stream download failed".into());
        }
        if completed == Some(true) {
            let last = file.read(&mut buffer[..limit])?;
            if last == 0 {
                break;
            }
            socket.write_all(&buffer[..last])?;
            if let Some(remaining) = remaining.as_mut() {
                *remaining -= last as u64;
            }
        } else if progress.elapsed() > Duration::from_secs(30) {
            return Err("Stream download stalled".into());
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    Ok(())
}

fn requested_range(raw: Option<&str>, size: u64) -> Result<Option<(u64, u64)>, ()> {
    let Some(value) = raw.and_then(|value| value.strip_prefix("bytes=")) else {
        return Ok(None);
    };
    let Some((first, last)) = value.split_once('-') else {
        return Ok(None);
    };
    let (start, end) = if first.is_empty() {
        let Ok(length) = last.parse::<u64>() else {
            return Ok(None);
        };
        if length == 0 {
            return Err(());
        }
        (size.saturating_sub(length), size.saturating_sub(1))
    } else {
        let Ok(start) = first.parse::<u64>() else {
            return Ok(None);
        };
        let end = if last.is_empty() {
            size.saturating_sub(1)
        } else {
            let Ok(end) = last.parse::<u64>() else {
                return Ok(None);
            };
            end.min(size.saturating_sub(1))
        };
        (start, end)
    };
    if start > end || start >= size {
        return Err(());
    }
    Ok(Some((start, end)))
}

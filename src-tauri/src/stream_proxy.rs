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
    let needs_complete = range.as_ref().is_some_and(|r| r != "bytes=0-");
    while needs_complete
        && entry
            .result
            .lock()
            .map_err(|_| "Stream state unavailable")?
            .is_none()
    {
        if entry.created.elapsed() > Duration::from_secs(180) {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(20));
    }
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
    };
    let mut start = 0;
    let mut end = size.saturating_sub(1);
    let mut partial = false;
    if completed {
        if let Some(value) = range.as_ref().and_then(|r| r.strip_prefix("bytes=")) {
            let Some((first, last)) = value.split_once('-') else {
                return Ok(());
            };
            if first.is_empty() {
                start = size.saturating_sub(last.parse::<u64>()?);
            } else {
                start = first.parse()?;
                if !last.is_empty() {
                    end = last.parse::<u64>()?.min(end);
                }
            }
            if start > end || start >= size {
                write!(socket, "HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */{size}\r\nAccess-Control-Allow-Origin: http://tauri.localhost\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")?;
                return Ok(());
            }
            partial = true;
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
    let streaming_range = !completed && total.is_some() && range.as_deref() == Some("bytes=0-");
    write!(socket, "HTTP/1.1 {}\r\nContent-Type: {mime}\r\nAccess-Control-Allow-Origin: http://tauri.localhost\r\nAccess-Control-Expose-Headers: Content-Range, Accept-Ranges, Content-Length\r\nCache-Control: no-store\r\nConnection: close\r\n", if partial || streaming_range { "206 Partial Content" } else { "200 OK" })?;
    if completed {
        write!(
            socket,
            "Accept-Ranges: bytes\r\nContent-Length: {}\r\n",
            end - start + 1
        )?;
        if partial {
            write!(socket, "Content-Range: bytes {start}-{end}/{size}\r\n")?;
        }
    } else if let Some(total) = total {
        write!(
            socket,
            "Accept-Ranges: bytes\r\nContent-Length: {total}\r\n"
        )?;
        if streaming_range {
            write!(
                socket,
                "Content-Range: bytes 0-{}/{total}\r\n",
                total.saturating_sub(1)
            )?;
        }
    }
    socket.write_all(b"\r\n")?;
    socket.flush()?;
    if request[0] == "HEAD" {
        return Ok(());
    }
    if completed {
        std::io::copy(&mut file.take(end - start + 1), &mut socket)?;
    } else {
        let mut buffer = [0; 32768];
        loop {
            let read = file.read(&mut buffer)?;
            if read > 0 {
                socket.write_all(&buffer[..read])?;
            } else if entry
                .result
                .lock()
                .map_err(|_| "Stream state unavailable")?
                .is_some()
            {
                let last = file.read(&mut buffer)?;
                if last == 0 {
                    break;
                }
                socket.write_all(&buffer[..last])?;
            } else {
                std::thread::sleep(Duration::from_millis(15));
            }
        }
    }
    Ok(())
}

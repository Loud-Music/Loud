use reqwest::blocking::Client;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::PathBuf,
    time::Duration,
};
use tauri::Manager;

const MAX_AUDIO_BYTES: u64 = 200 * 1024 * 1024;

pub fn client() -> Result<Client, String> {
    Client::builder()
        .user_agent("LoudPlatform/0.2 (personal music player)")
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(180))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 8 {
                attempt.error("Too many redirects")
            } else if allowed_url(attempt.url()) {
                attempt.follow()
            } else {
                attempt.error("Redirected outside trusted catalog hosts")
            }
        }))
        .build()
        .map_err(|e| e.to_string())
}
fn allowed_url(url: &reqwest::Url) -> bool {
    url.scheme() == "https"
        && url.port_or_known_default() == Some(443)
        && url.username().is_empty()
        && url.password().is_none()
        && url.host_str().is_some_and(|host| {
            host == "archive.org"
                || host.ends_with(".archive.org")
                || matches!(
                    host,
                    "api.audius.co"
                        | "api.deezer.com"
                        | "commons.wikimedia.org"
                        | "upload.wikimedia.org"
                        | "ccmixter.org"
                        | "www.ccmixter.org"
                        | "api.openverse.org"
                        | "lrclib.net"
                        | "api.betterlyrics.org"
                        | "lyricsplus.binimum.org"
                        | "api.amll.dev"
                        | "api.lrcmux.dev"
                        | "itunes.apple.com"
                        | "lyrics.rmmreviv.al"
                )
        })
}
pub fn cache_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let root = if let Some(profile) = crate::storage::profile()? {
        profile.join("audio")
    } else {
        app.path()
            .app_cache_dir()
            .map_err(|e| e.to_string())?
            .join("audio")
    };
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    Ok(root)
}
pub fn audio_path(root: &std::path::Path, key: &str) -> Result<PathBuf, String> {
    if key.len() != 64 || !key.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("Invalid audio cache key".into());
    }
    Ok(root.join(format!("{key}.flac")))
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedAudio {
    pub key: String,
    pub path: String,
    pub size: u64,
}

#[tauri::command]
pub async fn archive_json(path: String) -> Result<serde_json::Value, String> {
    if path.len() > 4000
        || !(path.starts_with("/advancedsearch.php?") || path.starts_with("/metadata/"))
        || path.contains("..")
        || path.contains('#')
    {
        return Err("Unsupported Archive API request".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let response = client()?
            .get(format!("https://archive.org{path}"))
            .send()
            .map_err(|e| e.to_string())?
            .error_for_status()
            .map_err(|e| e.to_string())?;
        let mut body = String::new();
        response
            .take(8 * 1024 * 1024)
            .read_to_string(&mut body)
            .map_err(|e| e.to_string())?;
        serde_json::from_str(&body).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn apple_recordings(
    app: tauri::AppHandle,
    title: String,
    artist: String,
) -> Result<serde_json::Value, String> {
    if title.is_empty() || title.len() > 500 || artist.is_empty() || artist.len() > 500 {
        return Err("Invalid recording metadata".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let direct = (|| -> Result<Vec<String>, String> {
            let mut url = reqwest::Url::parse("https://music.apple.com/us/search")
                .map_err(|e| e.to_string())?;
            url.query_pairs_mut()
                .append_pair("term", &format!("{artist} {title}"));
            let response = reqwest::blocking::Client::builder()
                .connect_timeout(Duration::from_secs(2))
                .timeout(Duration::from_secs(4))
                .redirect(reqwest::redirect::Policy::custom(|attempt| {
                    if attempt.previous().len() < 3
                        && attempt.url().scheme() == "https"
                        && attempt.url().host_str() == Some("music.apple.com")
                    {
                        attempt.follow()
                    } else {
                        attempt.error("Unsupported catalog redirect")
                    }
                }))
                .build()
                .map_err(|e| e.to_string())?
                .get(url)
                .send()
                .and_then(|r| r.error_for_status())
                .map_err(|e| e.to_string())?;
            let mut html = String::new();
            response
                .take(4 * 1024 * 1024)
                .read_to_string(&mut html)
                .map_err(|e| e.to_string())?;
            let mut ids = Vec::new();
            for marker in ["?i=", "&i="] {
                for tail in html.split(marker).skip(1) {
                    let id: String = tail.chars().take_while(char::is_ascii_digit).collect();
                    if !id.is_empty() && !ids.contains(&id) {
                        ids.push(id);
                    }
                    if ids.len() >= 4 {
                        return Ok(ids);
                    }
                }
            }
            Ok(ids)
        })();
        if let Ok(ids) = direct {
            if !ids.is_empty() {
                return Ok(serde_json::json!(ids));
            }
        }
        tauri::async_runtime::block_on(crate::media_tools::ensure_music_module(app.clone()))?;
        crate::extractor::lucida(
            &app,
            "apple_recordings",
            &serde_json::json!({"title":title,"artist":artist}).to_string(),
            "apple",
        )
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn catalog_json(
    app: tauri::AppHandle,
    provider: String,
    path: String,
) -> Result<serde_json::Value, String> {
    let origin = match provider.as_str() {
        "lrclib" if path.starts_with("/api/get?") || path.starts_with("/api/search?") => {
            "https://lrclib.net"
        }
        "betterlyrics" if path.starts_with("/getLyrics?") => "https://api.betterlyrics.org",
        "lyricsplus" if path.starts_with("/v2/lyrics/get?") => "https://lyricsplus.binimum.org",
        "amll" if path.starts_with("/v1/lyrics/search?") || path.starts_with("/v1/lyrics/get?") => {
            "https://api.amll.dev"
        }
        "lrcmux" if path.starts_with("/get?") => "https://api.lrcmux.dev",
        "itunes" if path.starts_with("/search?") || path.starts_with("/lookup?") => {
            "https://itunes.apple.com"
        }
        "rmmrevival" if path.starts_with("/lyrics?id=") => "https://lyrics.rmmreviv.al",
        "deezer"
            if path.starts_with("/search/artist?")
                || path.starts_with("/search/album?")
                || path.starts_with("/artist/")
                || path.starts_with("/album/")
                || path.starts_with("/track/") =>
        {
            "https://api.deezer.com"
        }
        "audius" if path.starts_with("/v1/tracks/search?") => "https://api.audius.co",
        "wikimedia" if path.starts_with("/w/api.php?") => "https://commons.wikimedia.org",
        "ccmixter" if path.starts_with("/api/query?") => "https://ccmixter.org",
        "openverse" if path.starts_with("/v1/audio/?") => "https://api.openverse.org",
        _ => return Err("Unsupported catalog request".into()),
    };
    if path.len() > 4000 || path.contains("..") || path.contains('#') {
        return Err("Invalid catalog path".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let started=std::time::Instant::now();
        let result: Result<serde_json::Value,String> = (|| {
        let response = client()?
            .get(format!("{origin}{path}"))
            .timeout(Duration::from_secs(if provider == "deezer" { 3 } else { 30 }))
            .send()
            .map_err(|e| e.to_string())?;
        if matches!(provider.as_str(), "rmmrevival" | "betterlyrics" | "lyricsplus" | "lrcmux") && matches!(response.status().as_u16(), 403 | 429) {
            tauri::async_runtime::block_on(crate::media_tools::ensure_music_module(app.clone()))?;
            return crate::extractor::lucida(&app, "lyrics", &path, &provider);
        }
        let response = response.error_for_status().map_err(|e| e.to_string())?;
        let mut body = String::new();
        response
            .take(8 * 1024 * 1024)
            .read_to_string(&mut body)
            .map_err(|e| e.to_string())?;
        serde_json::from_str(&body).map_err(|e| e.to_string())
        })();
        if matches!(provider.as_str(), "lrclib" | "lyricsplus" | "betterlyrics" | "lrcmux" | "amll" | "rmmrevival" | "itunes") {
            if let Ok(folder)=app.path().app_log_dir() {
                let _=fs::create_dir_all(&folder);
                let file=folder.join("lyrics.log");
                if fs::metadata(&file).is_ok_and(|m|m.len()>512*1024) { let _=fs::remove_file(&file); }
                if let Ok(mut log)=fs::OpenOptions::new().create(true).append(true).open(file) {
                    let value=result.as_ref().ok();
                    let record=serde_json::json!({"at":std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d|d.as_millis()).unwrap_or(0),"provider":provider,"request":path,"elapsedMs":started.elapsed().as_millis(),"ok":result.is_ok(),"error":result.as_ref().err(),"syncedLength":value.and_then(|d|d["syncedLyrics"].as_str()).map(str::len),"wordSpans":value.and_then(|d|d["lyrics"].as_array()).map(|ls|ls.iter().filter_map(|l|l["syllabus"].as_array()).map(Vec::len).sum::<usize>())});
                    let _=writeln!(log,"{}",record);
                }
            }
        }
        result
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn cache_catalog_audio(
    app: tauri::AppHandle,
    url: String,
) -> Result<CachedAudio, String> {
    let root = cache_root(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let parsed = reqwest::Url::parse(&url).map_err(|e| e.to_string())?;
        let host = parsed.host_str().unwrap_or("");
        let archive = (host == "archive.org" || host.ends_with(".archive.org"))
            && parsed.path().starts_with("/download/");
        let commons =
            host == "upload.wikimedia.org" && parsed.path().starts_with("/wikipedia/commons/");
        let mixter = host == "ccmixter.org" && parsed.path().starts_with("/content/");
        let extension = if parsed.path().to_lowercase().ends_with(".flac") {
            "flac"
        } else if parsed.path().to_lowercase().ends_with(".mp3") {
            "mp3"
        } else {
            ""
        };
        if !allowed_url(&parsed) || !(archive || commons || mixter) || extension.is_empty() {
            return Err("Choose a FLAC or MP3 file from a supported catalog".into());
        }
        let key = format!("{:x}", Sha256::digest(url.as_bytes()));
        let path = root.join(format!("{key}.{extension}"));
        if !path.exists() {
            let mut response = client()?
                .get(parsed)
                .send()
                .map_err(|e| e.to_string())?
                .error_for_status()
                .map_err(|e| e.to_string())?;
            if response
                .content_length()
                .is_some_and(|n| n > MAX_AUDIO_BYTES)
            {
                return Err("This file is larger than the 200 MB download limit".into());
            }
            let temp = root.join(format!(
                "{key}-{}.part",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map_err(|e| e.to_string())?
                    .as_nanos()
            ));
            let result = (|| {
                let mut file = fs::File::create(&temp).map_err(|e| e.to_string())?;
                let copied =
                    std::io::copy(&mut response.by_ref().take(MAX_AUDIO_BYTES + 1), &mut file)
                        .map_err(|e| e.to_string())?;
                if copied > MAX_AUDIO_BYTES {
                    return Err("This file is larger than 200 MB".to_string());
                }
                file.flush().map_err(|e| e.to_string())?;
                if extension == "flac" {
                    claxon::FlacReader::open(&temp)
                        .map_err(|e| format!("Invalid FLAC download: {e}"))?;
                } else {
                    let mut header = [0; 3];
                    fs::File::open(&temp)
                        .map_err(|e| e.to_string())?
                        .read_exact(&mut header)
                        .map_err(|e| e.to_string())?;
                    if header != *b"ID3" && !(header[0] == 255 && header[1] & 224 == 224) {
                        return Err("Invalid MP3 download".to_string());
                    }
                }
                fs::rename(&temp, &path).map_err(|e| e.to_string())?;
                Ok(())
            })();
            if result.is_err() {
                let _ = fs::remove_file(&temp);
            }
            result?;
        }
        crate::cache::commit(&app, &path);
        Ok(CachedAudio {
            key,
            size: fs::metadata(&path).map_err(|e| e.to_string())?.len(),
            path: path.to_string_lossy().into_owned(),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn cache_local_flac(
    app: tauri::AppHandle,
    request: tauri::ipc::Request<'_>,
) -> Result<CachedAudio, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Expected binary FLAC audio".into());
    };
    if bytes.len() as u64 > MAX_AUDIO_BYTES {
        return Err("This file exceeds the 200 MB limit".into());
    }
    claxon::FlacReader::new(std::io::Cursor::new(bytes))
        .map_err(|e| format!("Exclusive output requires FLAC: {e}"))?;
    let key = format!("{:x}", Sha256::digest(bytes));
    let path = audio_path(&cache_root(&app)?, &key)?;
    if !path.exists() {
        fs::write(&path, bytes).map_err(|e| e.to_string())?;
    }
    crate::cache::commit(&app, &path);
    Ok(CachedAudio {
        key,
        size: bytes.len() as u64,
        path: path.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
pub fn show_music_folder(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let directory = cache_root(&app)?;
        std::process::Command::new("explorer.exe")
            .arg(directory)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        Err("Folder navigation is available on Windows".into())
    }
}

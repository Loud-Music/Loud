use reqwest::{blocking::Client, Url};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    io::Read,
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};

static STREAMS: OnceLock<Mutex<HashMap<String, Instant>>> = OnceLock::new();
static CLIENT: OnceLock<Result<Client, String>> = OnceLock::new();

fn http_client() -> Result<Client, String> {
    CLIENT
        .get_or_init(|| {
            Client::builder()
                .user_agent("LoudPlatform/0.3")
                .connect_timeout(Duration::from_secs(3))
                .timeout(Duration::from_secs(6))
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .map_err(|_| "Не удалось создать подключение к источнику".into())
        })
        .clone()
}

fn read_json(response: reqwest::blocking::Response) -> Result<Value, String> {
    if !response.status().is_success() {
        return Err(format!(
            "Источник вернул HTTP {}",
            response.status().as_u16()
        ));
    }
    let mut bytes = Vec::new();
    response
        .take(2 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Источник прервал ответ")?;
    if bytes.len() > 2 * 1024 * 1024 {
        return Err("Слишком большой ответ источника".into());
    }
    serde_json::from_slice(&bytes).map_err(|_| "Источник вернул некорректный ответ".into())
}

fn request_error(_: reqwest::Error) -> String {
    "Не удалось получить ответ источника".into()
}

fn loopback(url: &Url) -> bool {
    matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "[::1]"))
}

fn valid_url(url: &Url) -> bool {
    (url.scheme() == "https" || (url.scheme() == "http" && loopback(url)))
        && url.host_str().is_some()
        && url.username().is_empty()
        && url.password().is_none()
        && url.fragment().is_none()
}

fn remember_stream(url: &Url) -> Result<(), String> {
    let mut entries = STREAMS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .map_err(|_| "Хранилище потоков недоступно")?;
    entries.retain(|_, at| at.elapsed() < Duration::from_secs(900));
    if entries.len() >= 128 {
        if let Some(oldest) = entries
            .iter()
            .min_by_key(|(_, at)| **at)
            .map(|(key, _)| key.clone())
        {
            entries.remove(&oldest);
        }
    }
    entries.insert(url.to_string(), Instant::now());
    Ok(())
}

pub fn stream_url_allowed(url: &Url) -> bool {
    valid_url(url)
        && STREAMS.get().is_some_and(|entries| {
            entries.lock().is_ok_and(|entries| {
                entries
                    .get(url.as_str())
                    .is_some_and(|at| at.elapsed() < Duration::from_secs(900))
            })
        })
}

pub fn redirect_allowed(initial: &Url, target: &Url) -> bool {
    valid_url(target)
        && stream_url_allowed(initial)
        && (initial.origin() == target.origin()
            || (initial
                .host_str()
                .is_some_and(|host| host.ends_with(".saavncdn.com"))
                && target.scheme() == "https"
                && target.port().is_none()
                && target
                    .host_str()
                    .is_some_and(|host| host.ends_with(".saavncdn.com"))))
}

fn prepare_stream(
    app: tauri::AppHandle,
    remote: Url,
    duration: f64,
    recording: String,
    prepare_only: bool,
) -> Result<Value, String> {
    remember_stream(&remote)?;
    if prepare_only {
        return Ok(
            json!({"url":remote.as_str(),"format":"Аудио","duration":duration,"key":"","size":0}),
        );
    }
    let (url, format) =
        crate::stream_proxy::register(app, remote.to_string(), duration, Some(recording))?;
    Ok(
        json!({"url":url,"format":format,"duration":duration,"cacheUrl":remote.as_str(),"cacheKey":format!("{:x}", Sha256::digest(remote.as_str().as_bytes())),"key":"","size":0}),
    )
}

#[tauri::command]
pub async fn jiosaavn_search(query: String) -> Result<Value, String> {
    if query.trim().is_empty() || query.len() > 600 {
        return Err("Некорректный поисковый запрос".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        read_json(
            http_client()?
                .get("https://rthmx.vercel.app/api/songs")
                .query(&[("q", query)])
                .timeout(Duration::from_secs(4))
                .send()
                .map_err(request_error)?,
        )
    })
    .await
    .map_err(|_| "Поиск JioSaavn прерван".to_string())?
}

#[tauri::command]
pub async fn jiosaavn_stream(
    app: tauri::AppHandle,
    url: String,
    duration: f64,
    recording: String,
    prepare_only: Option<bool>,
) -> Result<Value, String> {
    let parsed = Url::parse(&url).map_err(|_| "Некорректная ссылка JioSaavn")?;
    let parts = parsed
        .path_segments()
        .ok_or("Некорректная ссылка JioSaavn")?
        .collect::<Vec<_>>();
    if !valid_url(&parsed)
        || parsed.scheme() != "https"
        || parsed.port().is_some()
        || !matches!(parsed.host_str(), Some("www.jiosaavn.com" | "jiosaavn.com"))
        || parts.len() != 3
        || parts[0] != "song"
        || parts[2].is_empty()
        || parts[2].len() > 100
        || !parts[2]
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_,-".contains(&b))
        || !duration.is_finite()
        || duration <= 0.0
        || recording.len() > 2000
    {
        return Err("Некорректная ссылка JioSaavn".into());
    }
    let token = parts[2].to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        let client = http_client()?;
        let song = read_json(
            client
                .get("https://rthmx.vercel.app/api/song")
                .query(&[("token", token)])
                .send()
                .map_err(request_error)?,
        )?;
        let actual = song["more_info"]["duration"]
            .as_str()
            .and_then(|v| v.parse::<f64>().ok())
            .or_else(|| song["more_info"]["duration"].as_f64())
            .ok_or("Нет длительности записи")?;
        if !actual.is_finite()
            || actual <= 0.0
            || (actual - duration).abs() > 3.0
            || song["token"].as_str() != parsed.path_segments().and_then(|mut p| p.nth(2))
        {
            return Err("JioSaavn вернул другую запись".into());
        }
        let media = song["more_info"]["encrypted_media_url"]
            .as_str()
            .filter(|value| value.len() <= 4000)
            .ok_or("JioSaavn не вернул аудио")?;
        let reply = read_json(
            client
                .get("https://www.jiosaavn.com/api.php")
                .query(&[
                    ("__call", "song.generateAuthToken"),
                    ("url", media),
                    ("bitrate", "320"),
                    ("_format", "json"),
                ])
                .send()
                .map_err(request_error)?,
        )?;
        if reply["status"] != "success" {
            return Err("JioSaavn не разрешил воспроизведение".into());
        }
        let remote = Url::parse(
            reply["auth_url"]
                .as_str()
                .ok_or("Нет ссылки на аудио JioSaavn")?,
        )
        .map_err(|_| "Некорректный адрес аудио JioSaavn")?;
        if !valid_url(&remote)
            || remote.scheme() != "https"
            || remote.port().is_some()
            || !remote
                .host_str()
                .is_some_and(|host| host.ends_with(".saavncdn.com"))
        {
            return Err("Неподдерживаемый адрес аудио JioSaavn".into());
        }
        prepare_stream(
            app,
            remote,
            actual,
            recording,
            prepare_only.unwrap_or(false),
        )
    })
    .await
    .map_err(|_| "Подготовка JioSaavn прервана".to_string())?
}

fn cobalt_endpoint(endpoint: &str) -> Result<Url, String> {
    let url = Url::parse(endpoint.trim()).map_err(|_| "Укажите адрес API cobalt")?;
    if !valid_url(&url) || url.query().is_some() {
        return Err("API cobalt должен использовать HTTPS или локальный HTTP".into());
    }
    Ok(url)
}

#[tauri::command]
pub async fn cobalt_status(endpoint: String, api_key: String) -> Result<Value, String> {
    let endpoint = cobalt_endpoint(&endpoint)?;
    if api_key.len() > 4096 || api_key.contains(['\r', '\n']) {
        return Err("Некорректный ключ API cobalt".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let mut request = http_client()?.get(endpoint);
        if !api_key.trim().is_empty() {
            request = request.header("Authorization", format!("Api-Key {}", api_key.trim()));
        }
        let data = read_json(request.send().map_err(request_error)?)?;
        let version = data["cobalt"]["version"]
            .as_str()
            .ok_or("По этому адресу нет API cobalt")?;
        Ok(json!({"version":version}))
    })
    .await
    .map_err(|_| "Проверка cobalt прервана".to_string())?
}

#[tauri::command]
pub async fn cobalt_stream(
    app: tauri::AppHandle,
    endpoint: String,
    api_key: String,
    url: String,
    duration: f64,
    recording: String,
    prepare_only: Option<bool>,
) -> Result<Value, String> {
    let endpoint = cobalt_endpoint(&endpoint)?;
    if api_key.len() > 4096 || api_key.contains(['\r', '\n']) {
        return Err("Некорректный ключ API cobalt".into());
    }
    let source = Url::parse(&url).map_err(|_| "Некорректная ссылка на трек")?;
    if !valid_url(&source)
        || source.scheme() != "https"
        || source.port().is_some()
        || !matches!(
            source.host_str(),
            Some("soundcloud.com" | "www.youtube.com")
        )
        || !duration.is_finite()
        || duration <= 0.0
        || recording.len() > 2000
    {
        return Err("cobalt поддерживает здесь только SoundCloud и YouTube".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let mut request = http_client()?.post(endpoint.clone()).header("Accept", "application/json")
            .json(&json!({"url":url,"downloadMode":"audio","audioFormat":"best","localProcessing":"disabled","disableMetadata":true}));
        if !api_key.trim().is_empty() {
            request = request.header("Authorization", format!("Api-Key {}", api_key.trim()));
        }
        let data = read_json(request.send().map_err(request_error)?)?;
        if !matches!(data["status"].as_str(), Some("tunnel" | "redirect")) {
            return Err("cobalt не вернул готовый аудиопоток".into());
        }
        let remote = Url::parse(data["url"].as_str().ok_or("Нет ссылки на поток cobalt")?)
            .map_err(|_| "Некорректный адрес потока cobalt")?;
        if !valid_url(&remote) || !(remote.origin() == endpoint.origin()
            || (remote.scheme() == "https" && remote.port().is_none() && remote.host_str().is_some_and(|host|
                host.ends_with(".sndcdn.com") || host.ends_with(".soundcloud.cloud") || host.ends_with(".googlevideo.com")))) {
            return Err("cobalt вернул неподдерживаемый адрес аудио".into());
        }
        prepare_stream(app, remote, duration, recording, prepare_only.unwrap_or(false))
    }).await.map_err(|_| "Подготовка cobalt прервана".to_string())?
}

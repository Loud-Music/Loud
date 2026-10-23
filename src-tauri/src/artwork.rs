use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use std::{io::Read, time::Duration};

fn allowed(url: &reqwest::Url) -> bool {
    url.scheme() == "https"
        && url.port_or_known_default() == Some(443)
        && url.username().is_empty()
        && url.password().is_none()
        && url.host_str().is_some_and(|host| {
            [
                "mzstatic.com",
                "dzcdn.net",
                "sndcdn.com",
                "archive.org",
                "wikimedia.org",
                "scdn.co",
                "media-amazon.com",
                "images-amazon.com",
                "ytimg.com",
            ]
            .iter()
            .any(|domain| host == *domain || host.ends_with(&format!(".{domain}")))
        })
}

#[derive(Serialize)]
pub struct Artwork {
    pub(crate) mime: String,
    pub(crate) data: String,
}

#[tauri::command]
pub async fn artwork_image(url: String) -> Result<Artwork, String> {
    let url = reqwest::Url::parse(&url).map_err(|_| "Некорректная ссылка на обложку")?;
    if !allowed(&url) {
        return Err("Источник обложки не поддерживается".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let client = reqwest::blocking::Client::builder()
            .connect_timeout(Duration::from_secs(2))
            .timeout(Duration::from_secs(6))
            .redirect(reqwest::redirect::Policy::custom(|attempt| {
                if attempt.previous().len() < 4 && allowed(attempt.url()) {
                    attempt.follow()
                } else {
                    attempt.error("Unsupported artwork redirect")
                }
            }))
            .build()
            .map_err(|e| e.to_string())?;
        let mut response = client
            .get(url)
            .send()
            .and_then(|r| r.error_for_status())
            .map_err(|_| "Обложка недоступна")?;
        let mime = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("")
            .split(';')
            .next()
            .unwrap_or("")
            .to_owned();
        let limit = 4 * 1024 * 1024;
        if !mime.starts_with("image/")
            || response
                .content_length()
                .is_some_and(|length| length > limit)
        {
            return Err("Некорректный формат обложки".into());
        }
        let mut bytes = Vec::new();
        response
            .by_ref()
            .take(limit + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "Не удалось прочитать обложку")?;
        if bytes.is_empty() || bytes.len() as u64 > limit {
            return Err("Превышен размер обложки".into());
        }
        Ok(Artwork {
            mime,
            data: STANDARD.encode(bytes),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

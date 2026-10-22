use std::{io::Read, time::Duration};

fn key() -> Option<String> {
    option_env!("LOUD_SPICY_CLIENT_KEY")
        .filter(|value| value.starts_with("sl_pk_") && value.len() <= 2048)
        .map(str::to_owned)
}

#[tauri::command]
pub async fn spicy_lyrics(
    app: tauri::AppHandle,
    title: String,
    artist: String,
    duration: f64,
) -> Result<Option<serde_json::Value>, String> {
    let Some(key) = key() else {
        return Ok(None);
    };
    if title.is_empty()
        || title.len() > 500
        || artist.is_empty()
        || artist.len() > 500
        || !duration.is_finite()
        || duration <= 0.0
    {
        return Err("Invalid recording metadata".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        tauri::async_runtime::block_on(crate::media_tools::ensure_music_module(app.clone()))?;
        let query =
            serde_json::json!({"title":title,"artist":artist,"duration":duration}).to_string();
        let recording = crate::extractor::lucida(&app, "spotify_metadata", &query, "spotify")?;
        let Some(id) = recording["id"].as_str() else {
            return Ok(None);
        };
        if id.len() != 22 || !id.bytes().all(|c| c.is_ascii_alphanumeric()) {
            return Err("Invalid Spotify recording ID".into());
        }
        let client = reqwest::blocking::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(8))
            .timeout(Duration::from_secs(15))
            .build()
            .map_err(|_| "Не удалось подключиться к Spicy Lyrics")?;
        let response = client
            .get(format!("https://api.spicylyrics.org/v1/lyrics/{id}"))
            .bearer_auth(key)
            .header("Origin", "http://tauri.localhost")
            .send()
            .map_err(|_| "Spicy Lyrics не отвечает")?;
        if response.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if !response.status().is_success() {
            return Err(format!("Spicy Lyrics: HTTP {}", response.status().as_u16()));
        }
        let mut body = String::new();
        response
            .take(8 * 1024 * 1024)
            .read_to_string(&mut body)
            .map_err(|_| "Не удалось прочитать ответ Spicy Lyrics")?;
        let payload: serde_json::Value =
            serde_json::from_str(&body).map_err(|_| "Некорректный ответ Spicy Lyrics")?;
        if payload["Body"]["id"].as_str() != Some(id) {
            return Err("Spicy Lyrics returned a different recording".into());
        }
        Ok(Some(payload))
    })
    .await
    .map_err(|_| "Spicy Lyrics request interrupted")?
}

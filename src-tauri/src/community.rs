#[tauri::command]
pub async fn open_community(destination: String) -> Result<(), String> {
    let url = match destination.as_str() {
        "telegram" => "https://t.me/loudplatform",
        "github" => "https://github.com/Loud-Music/Loud",
        _ => return Err("Неизвестная ссылка сообщества".into()),
    };
    open_browser(url.to_string()).await
}

#[tauri::command]
pub async fn open_artist_link(url: String) -> Result<(), String> {
    let parsed = reqwest::Url::parse(&url).map_err(|_| "Некорректная ссылка артиста")?;
    if parsed.scheme() != "https"
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || url.len() > 2000
        || url.chars().any(char::is_control)
    {
        return Err("Ссылка артиста должна использовать HTTPS".into());
    }
    open_browser(parsed.to_string()).await
}

async fn open_browser(url: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os = "windows")]
        let mut command = {
            let mut command = crate::media_tools::run(std::path::Path::new("rundll32.exe"));
            command.arg("url.dll,FileProtocolHandler");
            command
        };
        #[cfg(target_os = "macos")]
        let mut command = crate::media_tools::run(std::path::Path::new("open"));
        #[cfg(not(any(target_os = "windows", target_os = "macos")))]
        let mut command = crate::media_tools::run(std::path::Path::new("xdg-open"));
        let status = command.arg(url).status().map_err(|e| e.to_string())?;
        if status.success() {
            Ok(())
        } else {
            Err("Не удалось открыть браузер".into())
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

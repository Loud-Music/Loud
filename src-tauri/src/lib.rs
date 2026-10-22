mod artwork;
mod audio;
mod cache;
mod discord;
mod extractor;
mod gapless;
mod lucida_stream;
mod media_tools;
mod network;
mod persistence;
mod spicy;
mod storage;
mod stream_proxy;
use tauri::Manager;

#[tauri::command]
fn set_window_material(app: tauri::AppHandle, dark: bool) -> Result<String, String> {
    let window = app
        .get_webview_window("main")
        .ok_or("Main window is unavailable")?;
    #[cfg(windows)]
    {
        if window_vibrancy::apply_mica(&window, Some(dark)).is_ok() {
            return Ok("mica".into());
        }
        let tint = if dark {
            (20, 20, 27, 170)
        } else {
            (245, 245, 250, 170)
        };
        window_vibrancy::apply_acrylic(&window, Some(tint)).map_err(|e| e.to_string())?;
        Ok("acrylic".into())
    }
    #[cfg(not(windows))]
    {
        let _ = (window, dark);
        Ok("translucent".into())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let root = network::cache_root(app.handle()).map_err(std::io::Error::other)?;
            app.asset_protocol_scope().allow_directory(&root, true)?;
            let data = storage::data_root(app.handle())?.join("user-data");
            std::fs::create_dir_all(&data)?;
            app.asset_protocol_scope().allow_directory(&data, true)?;
            app.manage(audio::Engine::new(root));
            cache::start(app.handle().clone());
            app.manage(discord::Presence::new());
            let _ = set_window_material(app.handle().clone(), true);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            artwork::artwork_image,
            gapless::gapless_prepare,
            gapless::gapless_release,
            persistence::settings_load,
            persistence::settings_save,
            persistence::library_load,
            persistence::library_save,
            persistence::library_exists,
            discord::discord_presence,
            cache::audio_cache_saved,
            cache::audio_cache_contains,
            cache::audio_cache_status,
            cache::audio_cache_clear,
            cache::audio_cache_limit,
            cache::audio_cache_pin,
            extractor::playback_log,
            extractor::lucida_search,
            extractor::extractor_search,
            extractor::extractor_audio,
            extractor::extractor_cached,
            extractor::extractor_cache_stream,
            extractor::extractor_stream,
            media_tools::ensure_media_tools,
            media_tools::ensure_extractor_tool,
            media_tools::ensure_music_module,
            spicy::spicy_lyrics,
            network::show_music_folder,
            network::archive_json,
            network::catalog_json,
            network::apple_recordings,
            network::cache_catalog_audio,
            network::cache_local_flac,
            audio::exclusive_play,
            audio::exclusive_control,
            audio::exclusive_status,
            set_window_material
        ])
        .run(tauri::generate_context!())
        .expect("Could not start Loud Platform");
}

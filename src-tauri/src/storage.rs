use std::{fs, path::PathBuf};
use tauri::Manager;

pub fn profile() -> Result<Option<PathBuf>, String> {
    let Some(path) = std::env::var_os("LOUD_PROFILE_DIR") else {
        return Ok(None);
    };
    let path = PathBuf::from(path);
    if !path.is_absolute() {
        return Err("Profile path must be absolute".into());
    }
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    let marker = path.join(".loud-profile");
    if !marker.is_file() {
        if fs::read_dir(&path)
            .map_err(|e| e.to_string())?
            .next()
            .is_some()
        {
            return Err("A new profile needs an empty directory".into());
        }
        fs::write(marker, b"Loud profile\n").map_err(|e| e.to_string())?;
    }
    fs::canonicalize(path).map(Some).map_err(|e| e.to_string())
}

pub fn data_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Some(path) = profile()? {
        return Ok(path);
    }
    app.path().app_local_data_dir().map_err(|e| e.to_string())
}

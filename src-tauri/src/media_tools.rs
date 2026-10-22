use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::Command,
    sync::Mutex,
    time::Duration,
};

static INSTALL: Mutex<()> = Mutex::new(());
#[derive(Serialize)]
pub struct ToolStatus {
    pub ready: bool,
    pub version: String,
}

pub fn run(path: &Path) -> Command {
    let mut command = Command::new(path);
    #[cfg(target_os = "linux")]
    if let Some(app_dir) = std::env::var_os("APPDIR") {
        let app_dir = PathBuf::from(app_dir);
        if let Some(paths) = std::env::var_os("LD_LIBRARY_PATH") {
            let paths: Vec<_> = std::env::split_paths(&paths)
                .filter(|path| !path.starts_with(&app_dir))
                .collect();
            if paths.is_empty() {
                command.env_remove("LD_LIBRARY_PATH");
            } else if let Ok(paths) = std::env::join_paths(paths) {
                command.env("LD_LIBRARY_PATH", paths);
            }
        }
        command.env_remove("PYTHONHOME").env_remove("PYTHONPATH");
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command
}
fn executable(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_owned()
    }
}
fn make_executable(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())?;
    }
    let _ = path;
    Ok(())
}
fn python_path(folder: &Path) -> PathBuf {
    if cfg!(windows) {
        folder.join("env/Scripts/python.exe")
    } else {
        folder.join("env/bin/python3")
    }
}
fn root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    crate::storage::data_root(app).map(|p| p.join("tools").join("ffmpeg-8.1"))
}
pub fn paths(app: &tauri::AppHandle) -> Result<(PathBuf, PathBuf), String> {
    let folder = root(app)?;
    Ok((
        folder.join(executable("ffmpeg")),
        folder.join(executable("ffprobe")),
    ))
}
pub fn ytdlp(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let _guard = INSTALL.lock().map_err(|e| e.to_string())?;
    let folder = root(app)?;
    fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let path = folder.join(executable("yt-dlp"));
    let (asset, checksum) = if cfg!(windows) {
        (
            "yt-dlp.exe",
            "66674953fe251b89f4d08c5f0e35e0728679bd67ab3d7d05c0562af101dd3e7a",
        )
    } else {
        (
            "yt-dlp_linux",
            "58162f9bfdc27458ea47bfcb311cf47028f17d8154a8bf7d689861d46399230a",
        )
    };
    if !path.is_file()
        || format!(
            "{:x}",
            Sha256::digest(fs::read(&path).map_err(|e| e.to_string())?)
        ) != checksum
    {
        let response = reqwest::blocking::Client::builder()
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(180))
            .build()
            .map_err(|e| e.to_string())?
            .get(format!(
                "https://github.com/yt-dlp/yt-dlp/releases/download/2026.08.19/{asset}"
            ))
            .send()
            .map_err(|e| e.to_string())?
            .error_for_status()
            .map_err(|e| e.to_string())?;
        let mut bytes = Vec::new();
        response
            .take(60 * 1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        if bytes.len() > 60 * 1024 * 1024 || format!("{:x}", Sha256::digest(&bytes)) != checksum {
            return Err("yt-dlp checksum mismatch".into());
        }
        let temp = folder.join("yt-dlp.part.exe");
        fs::write(&temp, bytes).map_err(|e| e.to_string())?;
        make_executable(&temp)?;
        fs::rename(temp, &path).map_err(|e| e.to_string())?;
    }
    make_executable(&path)?;
    Ok(path)
}
fn download_tool(folder: &Path, name: &str, checksum: &str) -> Result<(), String> {
    let platform = if cfg!(windows) {
        "windows"
    } else {
        "linux-amd64"
    };
    let url = format!("https://github.com/spotbye/Dependencies/releases/download/FFmpeg-8.1/{name}-{platform}.zip");
    let client = reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(240))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() > 5
                || attempt.url().scheme() != "https"
                || !attempt.url().host_str().is_some_and(|h| {
                    matches!(
                        h,
                        "github.com"
                            | "release-assets.githubusercontent.com"
                            | "objects.githubusercontent.com"
                    )
                })
            {
                attempt.error("Untrusted tools download redirect")
            } else {
                attempt.follow()
            }
        }))
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .get(url)
        .send()
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    response
        .take(100 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > 100 * 1024 * 1024 || format!("{:x}", Sha256::digest(&bytes)) != checksum {
        return Err("FFmpeg archive checksum mismatch".into());
    }
    let mut archive =
        zip::ZipArchive::new(std::io::Cursor::new(bytes)).map_err(|e| e.to_string())?;
    let target = folder.join(executable(name));
    let temp = folder.join(format!("{name}.part"));
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        if entry
            .enclosed_name()
            .and_then(|p| p.file_name().map(|n| n == executable(name).as_str()))
            .unwrap_or(false)
        {
            if entry.size() > 200 * 1024 * 1024 {
                return Err("FFmpeg executable too large".into());
            }
            let mut file = fs::File::create(&temp).map_err(|e| e.to_string())?;
            std::io::copy(&mut entry, &mut file).map_err(|e| e.to_string())?;
            file.flush().map_err(|e| e.to_string())?;
            drop(file);
            make_executable(&temp)?;
            let output = run(&temp)
                .arg("-version")
                .output()
                .map_err(|e| e.to_string())?;
            if !output.status.success()
                || !String::from_utf8_lossy(&output.stdout).starts_with(name)
            {
                let _ = fs::remove_file(&temp);
                return Err(format!(
                    "{name} failed to start: {}",
                    String::from_utf8_lossy(&output.stderr)
                        .chars()
                        .take(800)
                        .collect::<String>()
                ));
            }
            fs::rename(&temp, &target).map_err(|e| e.to_string())?;
            return Ok(());
        }
    }
    Err("Media tool missing from archive".into())
}
pub fn ensure(app: &tauri::AppHandle) -> Result<ToolStatus, String> {
    if !cfg!(all(
        any(windows, target_os = "linux"),
        target_arch = "x86_64"
    )) {
        return Err("Automatic media tools support Windows and Linux x64".into());
    }
    let _guard = INSTALL.lock().map_err(|e| e.to_string())?;
    let folder = root(app)?;
    fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let tools = if cfg!(windows) {
        [
            (
                "ffmpeg",
                "32ce843a699eb08ac4efc3d6b794c3e3fa4cf499d2d0e72473043576a2b0d56e",
            ),
            (
                "ffprobe",
                "1caa5994a439d36cc148861ae354c542c2d27530fcdcbdf47fff59311a94c7c0",
            ),
        ]
    } else {
        [
            (
                "ffmpeg",
                "49f9a3642387626f82fd70dd6a268807efe23e0560d6934a6531d6e3e668f18f",
            ),
            (
                "ffprobe",
                "422082501af33fabb3946d101d098e5105f44492e5a16357c3fac79421544b0e",
            ),
        ]
    };
    for (name, checksum) in tools {
        let path = folder.join(executable(name));
        if path.is_file() {
            make_executable(&path)?;
        }
        let valid = path.is_file()
            && run(&path).arg("-version").output().is_ok_and(|o| {
                o.status.success() && String::from_utf8_lossy(&o.stdout).starts_with(name)
            });
        if !valid {
            download_tool(&folder, name, checksum)?;
        }
    }
    Ok(ToolStatus {
        ready: true,
        version: "8.1".into(),
    })
}
#[tauri::command]
pub async fn ensure_media_tools(app: tauri::AppHandle) -> Result<ToolStatus, String> {
    let report_app = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || ensure(&app))
        .await
        .map_err(|e| e.to_string())?;
    report_setup(&report_app, "FFmpeg", result)
}

fn report_setup(
    app: &tauri::AppHandle,
    component: &str,
    result: Result<ToolStatus, String>,
) -> Result<ToolStatus, String> {
    let _ = crate::extractor::playback_log(
        app.clone(),
        serde_json::json!({
            "stage": "playback-setup",
            "component": component,
            "platform": std::env::consts::OS,
            "ready": result.is_ok(),
            "error": result.as_ref().err(),
        }),
    );
    result.map_err(|error| format!("{component}: {error}"))
}

static MODULE_INSTALL: Mutex<()> = Mutex::new(());
#[tauri::command]
pub async fn ensure_music_module(app: tauri::AppHandle) -> Result<ToolStatus, String> {
    let report_app = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _guard = MODULE_INSTALL.lock().map_err(|e|e.to_string())?;
        let folder = root(&app)?.parent().unwrap().join("music-module");
        fs::create_dir_all(&folder).map_err(|e|e.to_string())?;
        let python = python_path(&folder);
        let marker = folder.join("music-runtime-v2.ready");
        if python.is_file() && marker.is_file() { return Ok(ToolStatus {ready:true,version:"5.0.5".into()}); }
        let uv = folder.join(executable("uv"));
        let (uv_url, uv_hash) = if cfg!(windows) {
            ("https://files.pythonhosted.org/packages/2a/8e/d23278bb327d2a75dc1d033c81b7fe23bbb28e363e02e7f306abd047924a/uv-0.13.1-py3-none-win_amd64.whl", "4f693cd4feb52f08f30474c4612f24be2050472609be65b9960b635f286da284")
        } else {
            ("https://files.pythonhosted.org/packages/14/0b/6602a613533602e7a083e908c4375f9b0e78a94ba2e21c29b21c41a0a611/uv-0.13.1-py3-none-manylinux_2_17_x86_64.manylinux2014_x86_64.whl", "696dcf6d807d85da978f4db8472da81dccc1254b18b52cbd1367c4d923c421e0")
        };
        if !uv.is_file() {
            let response = reqwest::blocking::Client::builder().connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(180)).build().map_err(|e|e.to_string())?.get(uv_url).send().map_err(|e|e.to_string())?.error_for_status().map_err(|e|e.to_string())?;
            let mut bytes=Vec::new();
            response.take(60 * 1024 * 1024 + 1).read_to_end(&mut bytes).map_err(|e|e.to_string())?;
            if format!("{:x}", Sha256::digest(&bytes)) != uv_hash {return Err("Python installer checksum mismatch".into());}
            let mut archive=zip::ZipArchive::new(std::io::Cursor::new(bytes)).map_err(|e|e.to_string())?;
            for i in 0..archive.len() {
                let mut entry=archive.by_index(i).map_err(|e|e.to_string())?;
                if entry.enclosed_name().and_then(|p|p.file_name().map(|n|n==executable("uv").as_str())).unwrap_or(false) {
                    let temp=folder.join("uv.part.exe");
                    let mut file=fs::File::create(&temp).map_err(|e|e.to_string())?;
                    std::io::copy(&mut entry,&mut file).map_err(|e|e.to_string())?;
                    drop(file);make_executable(&temp)?;fs::rename(temp,&uv).map_err(|e|e.to_string())?;break;
                }
            }
            if !uv.is_file(){return Err("Python installer missing from package".into());}
        }
        make_executable(&uv)?;
        let mut setup=run(&uv);
        setup.env("UV_PYTHON_INSTALL_DIR",folder.join("python")).env("UV_CACHE_DIR",folder.join("cache")).args(["venv","--python","3.12.10","--managed-python","--no-progress","--allow-existing"]).arg(folder.join("env"));
        if !python.is_file() {
            let result=setup.output().map_err(|e|e.to_string())?;
            if !result.status.success(){return Err(format!("Python setup failed: {}",String::from_utf8_lossy(&result.stderr).chars().take(800).collect::<String>()));}
        }
        let result=run(&uv).env("UV_CACHE_DIR",folder.join("cache")).args(["pip","install","--no-progress","--python"]).arg(&python).args(["spotiflac==5.0.5", "playwright==1.55.0", "json5==0.12.1"]).output().map_err(|e|e.to_string())?;
        if !result.status.success(){return Err(format!("SpotiFLAC setup failed: {}",String::from_utf8_lossy(&result.stderr).chars().take(800).collect::<String>()));}
        let result=run(&python).args(["-c","from importlib.metadata import version; assert version('spotiflac') == '5.0.5'; import SpotiFLAC, playwright.sync_api, json5"]).output().map_err(|e|e.to_string())?;
        if !result.status.success(){return Err(format!("SpotiFLAC verification failed: {}", String::from_utf8_lossy(&result.stderr).chars().take(800).collect::<String>()));}
        fs::write(marker,b"5.0.5").map_err(|e|e.to_string())?;
        Ok(ToolStatus{ready:true,version:"5.0.5".into()})
    }).await.map_err(|e|e.to_string())?;
    report_setup(&report_app, "SpotiFLAC", result)
}

pub fn module_python(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let folder = root(app)?
        .parent()
        .ok_or("Tools directory is unavailable")?
        .join("music-module");
    Ok(python_path(&folder))
}

#[tauri::command]
pub async fn ensure_extractor_tool(app: tauri::AppHandle) -> Result<ToolStatus, String> {
    let report_app = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        ytdlp(&app)?;
        Ok(ToolStatus {
            ready: true,
            version: "2026.08.19".into(),
        })
    })
    .await
    .map_err(|e| e.to_string())?;
    report_setup(&report_app, "yt-dlp", result)
}

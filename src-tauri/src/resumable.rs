use reqwest::blocking::Response;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{Read, Write},
    path::Path,
};

#[derive(Default, Serialize, Deserialize)]
struct Resume {
    url: String,
    validator: Option<String>,
    total: Option<u64>,
}

pub fn download(
    url: &str,
    path: &Path,
    limit: u64,
    request: impl Fn(u64, Option<&str>) -> Result<Response, String>,
    progress: impl Fn(u64, Option<u64>) -> Result<(), String>,
) -> Result<u64, String> {
    let sidecar = path.with_extension("resume.json");
    let old: Resume = fs::read(&sidecar)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default();
    let length = fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    let mut offset = if old.url == url && old.validator.is_some() {
        length
    } else {
        0
    };
    if offset > limit {
        return Err("Файл превышает ограничение 200 МБ".into());
    }
    if offset > 0 && old.total == Some(offset) {
        progress(offset, old.total)?;
        return Ok(offset);
    }
    let mut response = request(offset, old.validator.as_deref())?;
    if response.status().as_u16() == 416 && offset > 0 {
        offset = 0;
        response = request(0, None)?;
    }
    if !response.status().is_success() {
        return Err(format!("Источник вернул HTTP {}", response.status()));
    }
    let range = response
        .headers()
        .get(reqwest::header::CONTENT_RANGE)
        .and_then(|v| v.to_str().ok())
        .and_then(|value| value.strip_prefix("bytes "))
        .and_then(|value| value.split_once('/'))
        .and_then(|(range, total)| {
            let (start, end) = range.split_once('-')?;
            Some((
                start.parse::<u64>().ok()?,
                end.parse::<u64>().ok()?,
                total.parse::<u64>().ok()?,
            ))
        });
    if response.status().as_u16() == 206 {
        let (start, end, total) = range.ok_or("Источник вернул некорректный диапазон")?;
        if start != offset || end < start || end >= total {
            let _ = fs::remove_file(&sidecar);
            return Err("Источник вернул другой диапазон файла".into());
        }
    } else {
        offset = 0;
    }
    let total = range.map(|(_, _, total)| total).or_else(|| {
        response
            .content_length()
            .and_then(|n| n.checked_add(offset))
    });
    if total.is_some_and(|size| size > limit) {
        return Err("Файл превышает ограничение 200 МБ".into());
    }
    let validator = response
        .headers()
        .get(reqwest::header::ETAG)
        .and_then(|v| v.to_str().ok())
        .filter(|v| !v.starts_with("W/"))
        .or_else(|| {
            response
                .headers()
                .get(reqwest::header::LAST_MODIFIED)
                .and_then(|v| v.to_str().ok())
        })
        .map(str::to_owned);
    if offset > 0
        && validator
            .as_ref()
            .is_some_and(|v| Some(v) != old.validator.as_ref())
    {
        let _ = fs::remove_file(&sidecar);
        return Err("Файл у источника изменился. Повторите загрузку.".into());
    }
    let state = Resume {
        url: url.to_owned(),
        validator,
        total,
    };
    let temporary = sidecar.with_extension("tmp");
    fs::write(
        &temporary,
        serde_json::to_vec(&state).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    fs::rename(temporary, &sidecar).map_err(|e| e.to_string())?;
    let mut file = fs::OpenOptions::new()
        .create(true)
        .write(true)
        .append(offset > 0)
        .truncate(offset == 0)
        .open(path)
        .map_err(|e| e.to_string())?;
    progress(offset, total)?;
    let mut bytes = offset;
    let mut buffer = [0; 65536];
    loop {
        let count = response.read(&mut buffer).map_err(|e| e.to_string())?;
        if count == 0 {
            break;
        }
        bytes += count as u64;
        if bytes > limit || total.is_some_and(|total| bytes > total) {
            return Err("Источник превысил заявленный размер файла".into());
        }
        file.write_all(&buffer[..count])
            .map_err(|e| e.to_string())?;
        progress(bytes, total)?;
    }
    file.sync_all().map_err(|e| e.to_string())?;
    if bytes == 0 || total.is_some_and(|total| bytes != total) {
        return Err("Соединение оборвалось до конца файла".into());
    }
    Ok(bytes)
}

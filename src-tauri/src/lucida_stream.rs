use reqwest::blocking::{Client, Response};
use serde_json::{json, Value};
use std::{
    io::Read,
    sync::OnceLock,
    time::{Duration, Instant},
};

static CLIENT: OnceLock<Result<Client, String>> = OnceLock::new();

pub fn client() -> Result<&'static Client, String> {
    CLIENT
        .get_or_init(|| {
            Client::builder()
                .user_agent("Mozilla/5.0")
                .connect_timeout(Duration::from_secs(3))
                .timeout(Duration::from_secs(180))
                .pool_idle_timeout(Duration::from_secs(90))
                .pool_max_idle_per_host(4)
                .tcp_nodelay(true)
                .redirect(reqwest::redirect::Policy::custom(|attempt| {
                    if attempt.previous().len() < 5
                        && attempt.url().scheme() == "https"
                        && attempt
                            .url()
                            .host_str()
                            .is_some_and(|h| h == "lucida.to" || h.ends_with(".lucida.to"))
                    {
                        attempt.follow()
                    } else {
                        attempt.error("Unexpected Lucida redirect")
                    }
                }))
                .build()
                .map_err(|e| e.to_string())
        })
        .as_ref()
        .map_err(Clone::clone)
}

fn body(mut response: Response) -> Result<String, String> {
    if !response.status().is_success() {
        return Err(format!("Lucida returned HTTP {}", response.status()));
    }
    let mut bytes = Vec::new();
    response
        .by_ref()
        .take(8 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > 8 * 1024 * 1024 {
        return Err("Lucida response too large".into());
    }
    String::from_utf8(bytes).map_err(|e| e.to_string())
}

fn page_data(html: &str) -> Result<Value, String> {
    let mut remaining = html;
    while let Some(index) = remaining.find("const data =") {
        let text = remaining[index + "const data =".len()..].trim_start();
        remaining = text;
        if !text.starts_with('[') {
            continue;
        }
        let mut depth = 0i32;
        let mut start = 1;
        let mut quote = 0u8;
        let mut escaped = false;
        for (index, byte) in text.bytes().enumerate() {
            if quote != 0 {
                if escaped {
                    escaped = false;
                } else if byte == b'\\' {
                    escaped = true;
                } else if byte == quote {
                    quote = 0;
                }
                continue;
            }
            match byte {
                b'\'' | b'"' => quote = byte,
                b'[' | b'{' => depth += 1,
                b']' | b'}' => {
                    depth -= 1;
                    if depth == 0 {
                        if let Ok(value) = json5::from_str::<Value>(&text[start..index]) {
                            if let Some(data) = value.get("data") {
                                return Ok(data.clone());
                            }
                        }
                        break;
                    }
                }
                b',' if depth == 1 => start = index + 1,
                _ => {}
            }
        }
    }
    Err("Unsupported Lucida metadata format".into())
}

fn hydrate(
    index: i64,
    values: &[Value],
    trail: &mut Vec<usize>,
    budget: &mut usize,
) -> Result<Value, String> {
    if index == -1 || index == -2 {
        return Ok(Value::Null);
    }
    let index = usize::try_from(index).map_err(|_| "Unsupported compact value")?;
    if *budget == 0 || trail.len() >= 64 || trail.contains(&index) {
        return Err("Invalid compact metadata references".into());
    }
    *budget -= 1;
    let value = values.get(index).ok_or("Missing compact metadata value")?;
    trail.push(index);
    let result = match value {
        Value::Object(fields) => {
            let mut object = serde_json::Map::new();
            for (key, reference) in fields {
                object.insert(
                    key.clone(),
                    hydrate(
                        reference
                            .as_i64()
                            .ok_or("Invalid compact metadata reference")?,
                        values,
                        trail,
                        budget,
                    )?,
                );
            }
            Value::Object(object)
        }
        Value::Array(items) => {
            if items.first().and_then(Value::as_str) == Some("Date") {
                items.get(1).cloned().ok_or("Missing compact date")?
            } else {
                let mut array = Vec::new();
                for reference in items {
                    array.push(hydrate(
                        reference
                            .as_i64()
                            .ok_or("Unsupported compact metadata type")?,
                        values,
                        trail,
                        budget,
                    )?);
                }
                Value::Array(array)
            }
        }
        _ => value.clone(),
    };
    trail.pop();
    Ok(result)
}

fn compact_data(text: &str) -> Result<Value, String> {
    let response: Value = serde_json::from_str(text).map_err(|e| e.to_string())?;
    for node in response["nodes"]
        .as_array()
        .ok_or("Missing compact nodes")?
        .iter()
        .rev()
    {
        let Some(values) = node["data"].as_array() else {
            continue;
        };
        if values.len() > 65536 || values.first().and_then(|value| value.get("info")).is_none() {
            continue;
        }
        return hydrate(0, values, &mut Vec::new(), &mut 100000);
    }
    Err("Unsupported compact metadata format".into())
}

fn metadata(client: &Client, url: &str) -> Result<(Value, usize, bool), String> {
    let response = client
        .get("https://lucida.to/__data.json")
        .query(&[("url", url), ("x-sveltekit-invalidated", "01")])
        .header("Accept-Encoding", "identity")
        .timeout(Duration::from_secs(6))
        .send()
        .map_err(|e| e.to_string())?;
    if response.status().is_success() {
        let text = body(response)?;
        if let Ok(data) = compact_data(&text) {
            return Ok((data, text.len(), true));
        }
    } else if !matches!(response.status().as_u16(), 404 | 405 | 410) {
        return Err(format!(
            "Lucida metadata returned HTTP {}",
            response.status()
        ));
    }
    let response = client
        .get("https://lucida.to/")
        .query(&[("url", url)])
        .header("Accept-Encoding", "identity")
        .timeout(Duration::from_secs(6))
        .send()
        .map_err(|e| e.to_string())?;
    let text = body(response)?;
    Ok((page_data(&text)?, text.len(), false))
}

fn server_name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 63
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-')
}

pub fn prepare(url: &str, expected_duration: f64) -> Result<Value, String> {
    let started = Instant::now();
    let client = client()?;
    let (data, metadata_bytes, compact) = metadata(client, url)?;
    let info = &data["info"];
    if info["success"] != true {
        return Err(info["error"]
            .as_str()
            .unwrap_or("Recording unavailable")
            .into());
    }
    let duration = info["durationMs"]
        .as_f64()
        .ok_or("Missing recording duration")?
        / 1000.0;
    if duration <= 0.0 || (duration - expected_duration).abs() > 3.0 {
        return Err("Source returned a preview or different recording".into());
    }
    let metadata_ms = started.elapsed().as_millis();
    let payload = json!({
        "url":info["url"].as_str().unwrap_or(url), "account":{"id":"auto","type":"country"},
        "compat":false,"downscale":"original","handoff":true,"metadata":false,"private":true,"upload":{"enabled":false},
        "token":{"expiry":data["tokenExpiry"],"primary":data["token"],"secondary":info["csrfFallback"]}
    });
    let assigned = info["fromServerName"]
        .as_str()
        .filter(|value| server_name(value));
    let direct = assigned.map(|server| format!("https://{server}.lucida.to/api/fetch/stream/v2"));
    let endpoint = direct
        .as_deref()
        .unwrap_or("https://lucida.to/api/load?url=%2Fapi%2Ffetch%2Fstream%2Fv2");
    let mut response = client
        .post(endpoint)
        .header("Origin", "https://lucida.to")
        .json(&payload)
        .timeout(Duration::from_secs(5))
        .send()
        .map_err(|e| e.to_string())?;
    if direct.is_some() && matches!(response.status().as_u16(), 404 | 405 | 501) {
        response = client
            .post("https://lucida.to/api/load?url=%2Fapi%2Ffetch%2Fstream%2Fv2")
            .json(&payload)
            .timeout(Duration::from_secs(5))
            .send()
            .map_err(|e| e.to_string())?;
    }
    let result: Value = serde_json::from_str(&body(response)?).map_err(|e| e.to_string())?;
    let server = result["server"]
        .as_str()
        .or(assigned)
        .filter(|value| server_name(value))
        .ok_or("Missing Lucida server")?;
    let handoff = result["handoff"]
        .as_str()
        .filter(|value| {
            !value.is_empty()
                && value.len() <= 128
                && value
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
        })
        .ok_or_else(|| {
            result["error"]
                .as_str()
                .unwrap_or("Missing stream handoff")
                .to_owned()
        })?;
    Ok(
        json!({"url":format!("https://{server}.lucida.to/api/fetch/request/{handoff}/download"),
        "duration":duration,"format":"Audio","hls":false,
        "timings":{"metadataMs":metadata_ms,"metadataBytes":metadata_bytes,"compactMetadata":compact,"requestMs":started.elapsed().as_millis()-metadata_ms,"processingMs":0,"native":true}}),
    )
}

pub fn download(url: &str) -> Result<Response, String> {
    let client = client()?;
    let started = Instant::now();
    for attempt in 0..48 {
        let mut response = client.get(url).send().map_err(|e| e.to_string())?;
        if response.status().is_success() {
            return Ok(response);
        }
        if !matches!(response.status().as_u16(), 404 | 425)
            || started.elapsed() > Duration::from_secs(12)
        {
            return Err(format!("Lucida audio returned HTTP {}", response.status()));
        }
        let _ = std::io::copy(&mut response.by_ref().take(65536), &mut std::io::sink());
        if attempt == 2 {
            let status = client
                .get(url.trim_end_matches("/download"))
                .timeout(Duration::from_secs(2))
                .send();
            if let Ok(response) = status {
                if let Ok(text) = body(response) {
                    if let Ok(data) = serde_json::from_str::<Value>(&text) {
                        if matches!(data["status"].as_str(), Some("error" | "failed")) {
                            return Err(data["message"]
                                .as_str()
                                .unwrap_or("Lucida processing failed")
                                .chars()
                                .take(500)
                                .collect());
                        }
                    }
                }
            }
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    Err("Lucida audio preparation timed out".into())
}

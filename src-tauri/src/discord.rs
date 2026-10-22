use discord_rich_presence::{DiscordIpc, DiscordIpcClient};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Update {
    application_id: String,
    activity: Option<Value>,
}
pub struct Presence {
    update: Arc<Mutex<Option<Update>>>,
    status: Arc<Mutex<String>>,
}
impl Presence {
    pub fn new() -> Self {
        let update: Arc<Mutex<Option<Update>>> = Arc::new(Mutex::new(None));
        let status = Arc::new(Mutex::new("Отключено".to_string()));
        let state = update.clone();
        let result = status.clone();
        std::thread::spawn(move || {
            let mut client: Option<DiscordIpcClient> = None;
            let mut application = String::new();
            let mut last = Value::Null;
            let mut ticks = 0u64;
            loop {
                std::thread::sleep(Duration::from_secs(2));
                ticks += 1;
                let desired = state.lock().ok().and_then(|v| v.clone());
                let Some(desired) = desired else { continue };
                if desired.application_id.is_empty() || desired.activity.is_none() {
                    if let Some(mut ipc) = client.take() {
                        let _ = ipc.clear_activity();
                        let _ = ipc.close();
                    }
                    last = Value::Null;
                    if let Ok(mut s) = result.lock() {
                        *s = "Отключено".into();
                    }
                    continue;
                }
                if application != desired.application_id {
                    if let Some(mut ipc) = client.take() {
                        let _ = ipc.close();
                    }
                    application = desired.application_id.clone();
                    last = Value::Null;
                }
                if client.is_none() {
                    let mut ipc = DiscordIpcClient::new(&application);
                    if ipc.connect().is_err() {
                        if let Ok(mut s) = result.lock() {
                            *s = "Ожидаем Discord".into();
                        }
                        continue;
                    }
                    client = Some(ipc);
                    last = Value::Null;
                }
                let activity = desired.activity.unwrap_or(Value::Null);
                if activity == last && ticks % 8 != 0 {
                    continue;
                }
                let nonce = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis()
                    .to_string();
                let payload = json!({"cmd":"SET_ACTIVITY","args":{"pid":std::process::id(),"activity":activity},"nonce":nonce});
                let sent = client
                    .as_mut()
                    .map(|ipc| ipc.send(payload, 1).and_then(|_| ipc.recv()));
                match sent {
                    Some(Ok((_, reply)))
                        if reply.get("evt").and_then(Value::as_str) != Some("ERROR") =>
                    {
                        last = activity;
                        if let Ok(mut s) = result.lock() {
                            *s = "Подключено".into();
                        }
                    }
                    _ => {
                        if let Some(mut ipc) = client.take() {
                            let _ = ipc.close();
                        }
                        if let Ok(mut s) = result.lock() {
                            *s = "Переподключение".into();
                        }
                    }
                }
            }
        });
        Self { update, status }
    }
}
#[tauri::command]
pub fn discord_presence(
    state: tauri::State<'_, Presence>,
    update: Update,
) -> Result<String, String> {
    if !update.application_id.is_empty()
        && (!update.application_id.bytes().all(|c| c.is_ascii_digit())
            || !(17..=20).contains(&update.application_id.len()))
    {
        return Err("Некорректный Discord Application ID".into());
    }
    if let Some(activity) = &update.activity {
        if activity.to_string().len() > 8192 {
            return Err("Activity is too large".into());
        }
    }
    *state.update.lock().map_err(|e| e.to_string())? = Some(update);
    Ok(state.status.lock().map_err(|e| e.to_string())?.clone())
}

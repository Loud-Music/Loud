use serde::Serialize;
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc, Arc, Mutex,
    },
    time::{Duration, Instant},
};

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputStatus {
    pub session: u64,
    pub phase: String,
    pub key: String,
    pub position: f64,
    pub duration: f64,
    pub sample_rate: u32,
    pub bits: u32,
    pub channels: u32,
    pub device: String,
    pub exclusive: bool,
    pub error: Option<String>,
    pub level: f32,
    pub bass: f32,
}
enum Control {
    Play(String, f64, u64),
    Pause,
    Resume,
    Seek(f64),
    Stop,
}
pub struct Engine {
    serial: AtomicU64,
    tx: Mutex<mpsc::Sender<Control>>,
    status: Arc<Mutex<OutputStatus>>,
}
impl Engine {
    pub fn new(root: PathBuf) -> Self {
        let (tx, rx) = mpsc::channel();
        let status = Arc::new(Mutex::new(OutputStatus {
            phase: "idle".into(),
            ..Default::default()
        }));
        let shared = status.clone();
        std::thread::spawn(move || {
            #[cfg(windows)]
            let initialized = wasapi::initialize_mta().ok().map_err(|e| e.to_string());
            #[cfg(not(windows))]
            let initialized: Result<(), String> =
                Err("Exclusive output is currently available on Windows".into());
            let mut pending = None;
            loop {
                let command = match pending.take().map(Ok).unwrap_or_else(|| rx.recv()) {
                    Ok(command) => command,
                    Err(_) => break,
                };
                if let Control::Play(key, start, session) = command {
                    if let Ok(mut s) = shared.lock() {
                        *s = OutputStatus {
                            session,
                            key: key.clone(),
                            phase: "loading".into(),
                            ..Default::default()
                        };
                    }
                    let result = initialized
                        .as_ref()
                        .map_err(Clone::clone)
                        .and_then(|_| run(&root, &key, start, session, &rx, &shared));
                    match result {
                        Ok(next) => pending = next,
                        Err(error) => {
                            if let Ok(mut s) = shared.lock() {
                                s.phase = "error".into();
                                s.exclusive = false;
                                s.error = Some(error);
                            }
                        }
                    }
                } else if let Control::Stop = command {
                    if let Ok(mut s) = shared.lock() {
                        s.phase = "idle".into();
                        s.exclusive = false;
                    }
                }
            }
            #[cfg(windows)]
            if initialized.is_ok() {
                wasapi::deinitialize();
            }
        });
        Self {
            serial: AtomicU64::new(0),
            tx: Mutex::new(tx),
            status,
        }
    }
    fn send(&self, command: Control) -> Result<(), String> {
        self.tx
            .lock()
            .map_err(|e| e.to_string())?
            .send(command)
            .map_err(|e| e.to_string())
    }
}

pub struct Pcm {
    pub samples: Vec<i32>,
    pub rate: u32,
    pub bits: u32,
    pub channels: u32,
}
pub fn decode(path: &std::path::Path) -> Result<Pcm, String> {
    let mut reader =
        claxon::FlacReader::open(path).map_err(|e| format!("Cannot decode FLAC: {e}"))?;
    let info = reader.streaminfo();
    if ![16, 24, 32].contains(&info.bits_per_sample) {
        return Err("Exclusive output supports 16-, 24-, and 32-bit integer FLAC".into());
    }
    let count = info
        .samples
        .unwrap_or(0)
        .saturating_mul(info.channels as u64);
    const MAX_SAMPLES: usize = 128_000_000;
    if count > MAX_SAMPLES as u64 {
        return Err("This track is too large for the native decode buffer".into());
    }
    let mut samples = Vec::with_capacity((count as usize).min(MAX_SAMPLES));
    for sample in reader.samples() {
        if samples.len() >= MAX_SAMPLES {
            return Err("This track exceeds the decode memory limit".into());
        }
        samples.push(sample.map_err(|e| format!("FLAC integrity error: {e}"))?);
    }
    if samples.is_empty()
        || samples.len() % info.channels as usize != 0
        || (count > 0 && samples.len() != count as usize)
    {
        return Err("Truncated or empty FLAC audio".into());
    }
    Ok(Pcm {
        samples,
        rate: info.sample_rate,
        bits: info.bits_per_sample,
        channels: info.channels,
    })
}

pub fn pack_pcm(samples: &[i32], valid_bits: u32, container_bits: u32, output: &mut Vec<u8>) {
    output.clear();
    let shift = container_bits - valid_bits;
    for sample in samples {
        let bytes = sample.wrapping_shl(shift).to_le_bytes();
        output.extend_from_slice(&bytes[..(container_bits / 8) as usize]);
    }
}

#[cfg(windows)]
fn run(
    root: &std::path::Path,
    key: &str,
    start: f64,
    session: u64,
    rx: &mpsc::Receiver<Control>,
    shared: &Arc<Mutex<OutputStatus>>,
) -> Result<Option<Control>, String> {
    use wasapi::{DeviceEnumerator, Direction, SampleType, StreamMode, WaveFormat};
    let pcm = decode(&super::network::audio_path(root, key)?)?;
    let channels = pcm.channels as usize;
    let total_frames = pcm.samples.len() / channels;
    let duration = total_frames as f64 / pcm.rate as f64;
    let device = DeviceEnumerator::new()
        .map_err(|e| e.to_string())?
        .get_default_device(&Direction::Render)
        .map_err(|e| format!("No output device: {e}"))?;
    let device_name = device.get_friendlyname().map_err(|e| e.to_string())?;
    let mut client = device.get_iaudioclient().map_err(|e| e.to_string())?;
    let requested = WaveFormat::new(
        pcm.bits as usize,
        pcm.bits as usize,
        &SampleType::Int,
        pcm.rate as usize,
        channels,
        None,
    );
    let format = client.is_supported_exclusive_with_quirks(&requested).map_err(|e| format!("The device cannot open {} Hz / {}-bit in exclusive mode: {e}. No resampling was applied.", pcm.rate, pcm.bits))?;
    if format.get_samplespersec() != pcm.rate
        || format.get_validbitspersample() as u32 != pcm.bits
        || format.get_nchannels() as u32 != pcm.channels
        || !matches!(
            format.get_subformat().map_err(|e| e.to_string())?,
            SampleType::Int
        )
    {
        return Err("The output format does not match the source; playback was stopped".into());
    }
    let container_bits = format.get_bitspersample() as u32;
    if ![16, 24, 32].contains(&container_bits) || container_bits < pcm.bits {
        return Err("Unsupported integer sample container".into());
    }
    let (_, minimum_period) = client.get_device_period().map_err(|e| e.to_string())?;
    let period = client
        .calculate_aligned_period_near((minimum_period * 2).max(200_000), Some(128), &format)
        .map_err(|e| e.to_string())?;
    client.initialize_client(&format, &Direction::Render, &StreamMode::EventsExclusive { period_hns: period }).map_err(|e| format!("WASAPI Exclusive could not start: {e}. Close other exclusive players or enable exclusive mode in Windows sound settings."))?;
    let event = client.set_get_eventhandle().map_err(|e| e.to_string())?;
    let render = client.get_audiorenderclient().map_err(|e| e.to_string())?;
    let buffer_frames = client.get_buffer_size().map_err(|e| e.to_string())? as usize;
    let mut output = Vec::with_capacity(buffer_frames * format.get_blockalign() as usize);
    let write_buffer = |cursor: &mut usize, bytes: &mut Vec<u8>| -> Result<(), String> {
        let end = (*cursor + buffer_frames).min(total_frames);
        pack_pcm(
            &pcm.samples[*cursor * channels..end * channels],
            pcm.bits,
            container_bits,
            bytes,
        );
        bytes.resize(buffer_frames * format.get_blockalign() as usize, 0);
        render
            .write_to_device(buffer_frames, bytes, None)
            .map_err(|e| e.to_string())?;
        *cursor = end;
        Ok(())
    };
    let mut queued = None;
    let mut initial_pause = false;
    let mut base_position = start.max(0.0).min(duration);
    while let Ok(command) = rx.try_recv() {
        match command {
            Control::Play(..) | Control::Stop => queued = Some(command),
            Control::Pause => initial_pause = true,
            Control::Resume => initial_pause = false,
            Control::Seek(position) => base_position = position.max(0.0).min(duration),
        }
    }
    if let Some(next) = queued {
        return Ok(Some(next));
    }
    let mut cursor = ((base_position * pcm.rate as f64) as usize).min(total_frames);
    write_buffer(&mut cursor, &mut output)?;
    if !initial_pause {
        client.start_stream().map_err(|e| e.to_string())?;
    }
    let mut playing = !initial_pause;
    let mut since = Instant::now();
    let mut draining = if cursor == total_frames {
        Some(Instant::now() + Duration::from_secs_f64(buffer_frames as f64 / pcm.rate as f64))
    } else {
        None
    };
    if let Ok(mut s) = shared.lock() {
        *s = OutputStatus {
            session,
            key: key.into(),
            phase: if playing { "playing" } else { "paused" }.into(),
            duration,
            position: base_position,
            sample_rate: pcm.rate,
            bits: pcm.bits,
            channels: pcm.channels,
            device: device_name,
            exclusive: true,
            error: None,
            level: 0.0,
            bass: 0.0,
        };
    }
    let playback_result = (|| loop {
        while let Ok(command) = rx.try_recv() {
            match command {
                Control::Play(..) | Control::Stop => return Ok(Some(command)),
                Control::Pause if playing => {
                    client.stop_stream().map_err(|e| e.to_string())?;
                    base_position = (base_position + since.elapsed().as_secs_f64()).min(duration);
                    playing = false;
                }
                Control::Resume if !playing => {
                    client.start_stream().map_err(|e| e.to_string())?;
                    since = Instant::now();
                    playing = true;
                    if cursor == total_frames {
                        draining = Some(
                            Instant::now()
                                + Duration::from_secs_f64(buffer_frames as f64 / pcm.rate as f64),
                        );
                    }
                }
                Control::Seek(position) => {
                    client.stop_stream().map_err(|e| e.to_string())?;
                    client.reset_stream().map_err(|e| e.to_string())?;
                    base_position = position.max(0.0).min(duration);
                    cursor = (base_position * pcm.rate as f64) as usize;
                    write_buffer(&mut cursor, &mut output)?;
                    if playing {
                        client.start_stream().map_err(|e| e.to_string())?;
                    }
                    since = Instant::now();
                    draining = if cursor == total_frames {
                        Some(
                            Instant::now()
                                + Duration::from_secs_f64(buffer_frames as f64 / pcm.rate as f64),
                        )
                    } else {
                        None
                    };
                }
                _ => {}
            }
        }
        if let Ok(mut s) = shared.lock() {
            s.phase = if playing { "playing" } else { "paused" }.into();
            s.position = (base_position
                + if playing {
                    since.elapsed().as_secs_f64()
                } else {
                    0.0
                })
            .min(duration);
            if playing {
                let channels = pcm.channels as usize;
                let first = ((s.position * pcm.rate as f64) as usize).min(total_frames) * channels;
                let end = (first + 4096 * channels).min(pcm.samples.len());
                let scale = (1u64 << (pcm.bits - 1)) as f64;
                let low_alpha = 1.0 - (-2.0 * std::f64::consts::PI * 180.0 / pcm.rate as f64).exp();
                let dc_alpha = 1.0 - (-2.0 * std::f64::consts::PI * 25.0 / pcm.rate as f64).exp();
                let mut low = vec![0.0; channels];
                let mut dc = vec![0.0; channels];
                let mut power = 0.0;
                let mut bass_power = 0.0;
                let mut count = 0;
                for frame in pcm.samples[first..end].chunks_exact(channels) {
                    for (channel, sample) in frame.iter().enumerate() {
                        let value = *sample as f64 / scale;
                        low[channel] += low_alpha * (value - low[channel]);
                        dc[channel] += dc_alpha * (value - dc[channel]);
                        power += value * value;
                        bass_power += (low[channel] - dc[channel]).powi(2);
                        count += 1;
                    }
                }
                s.level = (power / count.max(1) as f64).sqrt().min(1.0) as f32;
                s.bass = (bass_power / count.max(1) as f64).sqrt().min(1.0) as f32;
            } else {
                s.level = 0.0;
                s.bass = 0.0;
            }
        }
        if !playing {
            std::thread::sleep(Duration::from_millis(20));
            continue;
        }
        if draining.is_some_and(|deadline| Instant::now() >= deadline) {
            if let Ok(mut s) = shared.lock() {
                s.phase = "ended".into();
                s.position = duration;
                s.exclusive = false;
            }
            return Ok(None);
        }
        event
            .wait_for_event(1000)
            .map_err(|e| format!("Output device stopped responding: {e}"))?;
        if draining.is_none() {
            write_buffer(&mut cursor, &mut output)?;
            if cursor == total_frames {
                draining = Some(
                    Instant::now()
                        + Duration::from_secs_f64(buffer_frames as f64 / pcm.rate as f64),
                );
            }
        }
    })();
    let _ = client.stop_stream();
    playback_result
}
#[cfg(not(windows))]
fn run(
    _: &std::path::Path,
    _: &str,
    _: f64,
    _: u64,
    _: &mpsc::Receiver<Control>,
    _: &Arc<Mutex<OutputStatus>>,
) -> Result<Option<Control>, String> {
    Err("WASAPI Exclusive requires Windows".into())
}

#[tauri::command]
pub fn exclusive_play(
    engine: tauri::State<Engine>,
    key: String,
    start: Option<f64>,
) -> Result<u64, String> {
    if key.len() != 64 || !key.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("Invalid audio key".into());
    }
    let session = engine.serial.fetch_add(1, Ordering::Relaxed) + 1;
    engine.send(Control::Play(
        key,
        start.filter(|x| x.is_finite()).unwrap_or(0.0),
        session,
    ))?;
    Ok(session)
}
#[tauri::command]
pub fn exclusive_control(
    engine: tauri::State<Engine>,
    action: String,
    position: Option<f64>,
) -> Result<(), String> {
    engine.send(match action.as_str() {
        "pause" => Control::Pause,
        "resume" => Control::Resume,
        "stop" => Control::Stop,
        "seek" => Control::Seek(
            position
                .filter(|x| x.is_finite())
                .ok_or("Invalid seek position")?,
        ),
        _ => return Err("Unknown output action".into()),
    })
}
#[tauri::command]
pub fn exclusive_status(engine: tauri::State<Engine>) -> Result<OutputStatus, String> {
    Ok(engine.status.lock().map_err(|e| e.to_string())?.clone())
}

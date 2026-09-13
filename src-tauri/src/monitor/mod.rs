mod platform;
mod vulkan;
mod worker;
mod media;

use std::cell::RefCell;
use std::sync::Arc;
use serde::{Deserialize, Serialize};
use tauri::Manager;

pub struct TrustedOrigin(pub String);
#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Bounds { pub x: f64, pub y: f64, pub width: f64, pub height: f64, pub pixel_ratio: f64 }
impl Bounds {
    fn validate(self) -> Result<Self, String> {
        if [self.x, self.y, self.width, self.height, self.pixel_ratio].iter().any(|n| !n.is_finite())
            || self.x < 0.0 || self.y < 0.0 || self.width < 1.0 || self.height < 1.0
            || self.x > 32768.0 || self.y > 32768.0 || self.width > 16384.0 || self.height > 16384.0
            || self.pixel_ratio < 0.25 || self.pixel_ratio > 8.0 { return Err("Invalid monitor bounds".into()); }
        Ok(self)
    }
    pub fn pixels(self) -> (u32, u32) {
        ((self.width * self.pixel_ratio).round().clamp(1.0, 8192.0) as u32,
         (self.height * self.pixel_ratio).round().clamp(1.0, 8192.0) as u32)
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SurfaceInfo { pub adapter: String, pub backend: &'static str, pub width: u32, pub height: u32, pub video_connected: bool }
struct Monitor { worker: worker::Worker, window: platform::NativeWindow, vendor: String, size: (u32, u32), scene: Option<Arc<media::Scene>>, frame: Option<u32>, video: bool }
static COMMANDS: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
// GTK/Win32 window ownership stays on the UI thread. Commands await worker
// shutdown before dropping the native window that backs its Vulkan surface.
thread_local! { static MONITOR: RefCell<Option<Monitor>> = const { RefCell::new(None) }; }

pub(crate) fn trusted(window: &tauri::WebviewWindow) -> Result<(), String> {
    let origin = window.state::<TrustedOrigin>();
    if window.label() != "main" || window.url().map_err(|e| e.to_string())?.origin().ascii_serialization() != origin.0 {
        return Err("Native commands are restricted to this editor backend.".into());
    }
    Ok(())
}
#[tauri::command]
pub fn desktop_info(window: tauri::WebviewWindow) -> Result<serde_json::Value, String> {
    trusted(&window)?;
    Ok(serde_json::json!({"platform": std::env::consts::OS, "surfacePrototype": true, "nativeVideo": true, "verification": "not-run"}))
}
// Serialize commands across their asynchronous GPU work. The UI remains free to
// dispatch Wayland events while Vulkan waits for presentation completion.
async fn on_ui<T: Send + 'static>(window: &tauri::WebviewWindow, action: impl FnOnce() -> T + Send + 'static) -> Result<T, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    window.run_on_main_thread(move || { let _ = tx.send(action()); }).map_err(|e| e.to_string())?;
    rx.await.map_err(|e| e.to_string())
}
async fn stop_current(window: &tauri::WebviewWindow) -> Result<(), String> {
    if std::env::var("FRAMECRAFT_DESKTOP_CHECK").is_ok() { eprintln!("Desktop check: stop requested"); }
    let worker = on_ui(window, || MONITOR.with(|m| m.borrow().as_ref().map(|m| m.worker.clone()))).await?;
    if let Some(worker) = worker { worker.stop().await; }
    if std::env::var("FRAMECRAFT_DESKTOP_CHECK").is_ok() { eprintln!("Desktop check: worker stopped"); }
    on_ui(window, || MONITOR.with(|m| { m.borrow_mut().take(); })).await
}
#[tauri::command]
pub async fn surface_open(window: tauri::WebviewWindow, bounds: Bounds, vendor: String, video: Option<bool>) -> Result<SurfaceInfo, String> {
    trusted(&window)?; let bounds = bounds.validate()?;
    if std::env::var("FRAMECRAFT_DISABLE_GPU").as_deref() == Ok("1") { return Err("GPU use is disabled in this process.".into()); }
    if vendor != "amd" && vendor != "nvidia" { return Err("Choose AMD or NVIDIA explicitly.".into()); }
    let video = video.unwrap_or(false);
    let bounds = if video {bounds} else {Bounds {width: bounds.width.min(640.0 / bounds.pixel_ratio), height: bounds.height.min(360.0 / bounds.pixel_ratio), ..bounds}};
    let _guard = COMMANDS.lock().await;
    stop_current(&window).await?;
    let owner = window.clone();
    let ready = on_ui(&window, move || -> Result<_, String> {
        let native = platform::NativeWindow::new(&owner, bounds)?;
        let (display, handle) = native.handles()?;
        let (worker, ready) = worker::Worker::start(vulkan::NativeHandles(display, handle), bounds.pixels(), vendor.clone(), video);
        MONITOR.with(|m| *m.borrow_mut() = Some(Monitor { worker, window: native, vendor, size: bounds.pixels(), scene: None, frame: None, video }));
        Ok(ready)
    }).await??;
    let result = ready.await.unwrap_or_else(|e| Err(e.to_string()));
    if result.is_err() { stop_current(&window).await?; }
    result
}
#[tauri::command]
pub async fn surface_resize(window: tauri::WebviewWindow, bounds: Bounds) -> Result<(), String> {
    trusted(&window)?; let bounds = bounds.validate()?;
    let _guard = COMMANDS.lock().await;
    let worker = on_ui(&window, move || MONITOR.with(|m| -> Result<_, String> {
        let mut state = m.borrow_mut(); let Some(m) = state.as_mut() else { return Ok(None) };
        m.window.resize(bounds)?; m.size = bounds.pixels(); m.scene = None; Ok(Some(m.worker.clone()))
    })).await??;
    if let Some(worker) = worker { worker.resize(bounds.pixels()).await?; }
    Ok(())
}
#[tauri::command]
pub async fn surface_frame(window: tauri::WebviewWindow, project_id: String, revision: u64, frame: u32, quality: Option<String>, media_key: Option<String>) -> Result<(), String> {
    trusted(&window)?;
    let quality = quality.unwrap_or_else(|| "high".into());
    let media_key = media_key.unwrap_or_default();
    if !["high", "proxy-1080", "performance", "proxy-360"].contains(&quality.as_str()) || media_key.len() > 100000 {return Err("Invalid playback quality".into());}
    let _guard = COMMANDS.lock().await;
    let id = project_id.clone();
    let cache_quality = quality.clone(); let cache_media = media_key.clone();
    let (worker, vendor, size, cached) = on_ui(&window, move || MONITOR.with(|m| -> Result<_, String> {
        let state = m.borrow(); let m = state.as_ref().filter(|m| m.video).ok_or("Native video is not open")?;
        let cached = m.scene.as_ref().filter(|s| s.project_id == id && s.revision == revision && s.quality == cache_quality && s.media_key == cache_media && frame >= s.start && frame < s.start + s.duration
            && m.frame.is_some_and(|last| frame >= last && frame - last <= (s.fps / 2.0).ceil() as u32)).cloned();
        Ok((m.worker.clone(), m.vendor.clone(), m.size, cached))
    })).await??;
    let scene = if let Some(scene) = cached {scene} else {
        let origin = window.state::<TrustedOrigin>().0.clone();
        let client = reqwest::Client::builder().no_proxy().timeout(std::time::Duration::from_secs(30)).redirect(reqwest::redirect::Policy::none()).build().map_err(|e| e.to_string())?;
        let response = client.post(format!("{origin}/api/render/native-preview")).json(&serde_json::json!({"revision": revision, "frame": frame,
            "width": (size.0 / 2 * 2).max(64), "height": (size.1 / 2 * 2).max(64), "vendor": vendor, "quality": quality, "mediaKey": media_key})).send().await.map_err(|e| e.to_string())?;
        if !response.status().is_success() {return Err(response.text().await.unwrap_or_else(|e| e.to_string()));}
        let scene: media::Scene = response.json().await.map_err(|e| e.to_string())?;
        if scene.project_id != project_id || scene.revision != revision || frame < scene.start || frame >= scene.start + scene.duration
            || scene.width != (size.0 / 2 * 2).max(64) || scene.height != (size.1 / 2 * 2).max(64) {return Err("Timeline changed during native preparation".into());}
        Arc::new(scene)
    };
    if let Err(error) = worker.frame(scene.clone(), frame).await {
        // A failed decoder/graph must be rebuilt on retry, even at the same frame.
        on_ui(&window, move || MONITOR.with(|m| {if let Some(m) = m.borrow_mut().as_mut() {m.scene = None; m.frame = None;}})).await?;
        return Err(error);
    }
    on_ui(&window, move || MONITOR.with(|m| {if let Some(m) = m.borrow_mut().as_mut() {m.scene = Some(scene); m.frame = Some(frame);}})).await
}
#[tauri::command]
pub async fn surface_close(window: tauri::WebviewWindow) -> Result<(), String> {
    trusted(&window)?;
    shutdown(&window).await
}
pub async fn shutdown(window: &tauri::WebviewWindow) -> Result<(), String> {
    let _guard = COMMANDS.lock().await;
    stop_current(window).await
}

#[tauri::command]
pub async fn surface_check_finished(window: tauri::WebviewWindow, result: serde_json::Value) -> Result<(), String> {
    if std::env::var("FRAMECRAFT_DESKTOP_CHECK").is_ok() { eprintln!("Desktop check: reporting {result}"); }
    trusted(&window)?;
    if !cfg!(debug_assertions) || std::env::var("FRAMECRAFT_DESKTOP_CHECK").is_err() { return Err("Desktop smoke runner is not enabled.".into()); }
    shutdown(&window).await?;
    let path = std::env::var("FRAMECRAFT_DESKTOP_CHECK_REPORT").map_err(|e| e.to_string())?;
    std::fs::write(path, serde_json::to_vec_pretty(&result).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    window.app_handle().exit(if result["status"] == "passed" { 0 } else { 1 });
    Ok(())
}

use std::path::Path;
use tauri::Manager;

#[tauri::command]
pub async fn open_render_output(window: tauri::WebviewWindow, job_id: String, folder: bool) -> Result<(), String> {
    crate::monitor::trusted(&window)?;
    if job_id.len() != 36 || !job_id.bytes().all(|c| c.is_ascii_hexdigit() || c == b'-') {
        return Err("Invalid render job ID".into());
    }
    let origin = window.state::<crate::monitor::TrustedOrigin>().0.clone();
    let client = reqwest::Client::builder().no_proxy().timeout(std::time::Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none()).build().map_err(|e| e.to_string())?;
    let response = client.get(format!("{origin}/api/render/{job_id}/output")).send().await.map_err(|e| e.to_string())?;
    let status = response.status();
    let data: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    if !status.is_success() { return Err(data["error"].as_str().unwrap_or("Could not locate the export").to_owned()); }
    let file = data["path"].as_str().ok_or("The backend did not return an export path")?.to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        let file = Path::new(&file);
        if !file.is_absolute() || !file.is_file() { return Err("The exported file is no longer available on disk.".into()); }
        open_path(if folder { file.parent().ok_or("Export folder is missing")? } else { file })
    }).await.map_err(|e| e.to_string())?
}

#[cfg(target_os = "linux")]
fn open_path(path: &Path) -> Result<(), String> {
    use gtk::gio::prelude::AppLaunchContextExt;
    let uri = gtk::glib::filename_to_uri(path, None).map_err(|e| e.to_string())?;
    let context = gtk::gio::AppLaunchContext::new();
    if let Some(appdir) = std::env::var_os("APPDIR").filter(|value| Path::new(value).is_absolute()) {
        for (name, value) in std::env::vars_os() {
            match crate::host_environment::external_value(&name, &value, Path::new(&appdir)) {
                Some(clean) => context.setenv(&name, &clean),
                None => context.unsetenv(&name),
            }
        }
    }
    gtk::gio::AppInfo::launch_default_for_uri(&uri, Some(&context)).map_err(|e| format!("Could not open export: {e}"))
}

#[cfg(target_os = "windows")]
fn open_path(path: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL};
    let file: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let action: Vec<u16> = "open\0".encode_utf16().collect();
    let result = unsafe { ShellExecuteW(std::ptr::null_mut(), action.as_ptr(), file.as_ptr(), std::ptr::null(), std::ptr::null(), SW_SHOWNORMAL) } as isize;
    if result <= 32 { Err(format!("Windows could not open this export (error {result}). Check its default application.")) } else { Ok(()) }
}

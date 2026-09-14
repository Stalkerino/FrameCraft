use tauri::Manager;

pub fn enabled() -> bool { std::env::args().any(|arg| arg == "--release-smoke") }

#[tauri::command]
pub fn release_ui_ready(window: tauri::WebviewWindow) -> Result<(), String> {
    super::monitor::trusted(&window)?;
    if !enabled() { return Err("Release check is not enabled".into()); }
    eprintln!("Release check: installed WebView loaded the editor and timeline.");
    window.app_handle().exit(0);
    Ok(())
}

pub fn watch(app: &tauri::AppHandle) {
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(45));
        eprintln!("Release check failed: the installed WebView did not load the editor and timeline within 45 seconds.");
        handle.exit(1);
    });
}

pub const SCRIPT: &str = r#"
(() => {
  const timer = setInterval(() => {
    if (!document.querySelector('.editor-layout .timeline-scroll [data-clip-id]')) return;
    if (document.querySelector('.fatal-error')) return;
    clearInterval(timer);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      window.__TAURI_INTERNALS__.invoke('release_ui_ready').catch(console.error);
    }));
  }, 100);
})();
"#;

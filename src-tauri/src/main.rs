#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod backend;
mod exports;
mod monitor;

use tauri::Manager;

fn main() {
    let app = tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![exports::open_render_output, monitor::desktop_info, monitor::surface_open, monitor::surface_resize, monitor::surface_frame, monitor::surface_close, monitor::surface_check_finished])
        .on_page_load(|window, payload| {
            if std::env::var("FRAMECRAFT_DESKTOP_CHECK").is_ok() { eprintln!("Desktop check: page {:?}", payload.event()); }
            if cfg!(debug_assertions) && matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                if let Ok(vendor) = std::env::var("FRAMECRAFT_DESKTOP_CHECK") {
                    if vendor == "amd" || vendor == "nvidia" {
                        let script = include_str!("surface-check.js").replace("__CHECK_VENDOR__", &vendor)
                            .replace("__CHECK_VIDEO__", if std::env::var("FRAMECRAFT_DESKTOP_VIDEO_CHECK").as_deref() == Ok("1") {"true"} else {"false"});
                        if let Err(e) = window.eval(&script) { eprintln!("Desktop check script: {e}"); }
                    }
                }
            }
        })
        .setup(move |app| {
            let backend = backend::Backend::start(app.handle()).map_err(std::io::Error::other)?;
            let origin = backend.url.clone();
            app.manage(backend);
            app.manage(monitor::TrustedOrigin(origin.clone()));
            // CI checks the installed native executable and its bundled backend
            // without opening a monitor or initializing any GPU resources.
            if std::env::args().any(|arg| arg == "--release-smoke") {
                app.handle().exit(0);
                return Ok(());
            }
            if std::env::var("FRAMECRAFT_DESKTOP_CHECK").is_ok() { eprintln!("Desktop check: creating window"); }
            tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::External(origin.parse()?))
                .title("Framecraft").theme(Some(tauri::Theme::Dark)).decorations(false)
                .inner_size(1440.0, 900.0).min_inner_size(960.0, 640.0)
                .disable_drag_drop_handler().build()?;
            if std::env::var("FRAMECRAFT_DESKTOP_CHECK").is_ok() { eprintln!("Desktop check: window created"); }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if let Some(webview) = window.app_handle().get_webview_window("main") {
                    api.prevent_close();
                    tauri::async_runtime::spawn(async move {
                        let _ = monitor::shutdown(&webview).await;
                        let _ = webview.destroy();
                    });
                }
            }
        })
        .build(tauri::generate_context!()).expect("Framecraft desktop could not start");
    app.run(|handle, event| {
        if matches!(event, tauri::RunEvent::Exit) { if let Some(backend) = handle.try_state::<backend::Backend>() { backend.close(); } }
    });
}

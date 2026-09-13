use std::{io::{BufRead, BufReader, Read, Seek, SeekFrom, Write}, path::PathBuf, process::{Child, Command, Stdio}, sync::{mpsc, Mutex}, time::Duration};
use tauri::Manager;

pub struct Backend { pub url: String, child: Mutex<Option<Child>> }
impl Backend {
    pub fn start(app: &tauri::AppHandle) -> Result<Self, String> {
        // Linux packages keep Node and its private native modules outside
        // usr/lib so AppImage deployment cannot rewrite their library paths.
        let packaged = if cfg!(target_os = "linux") {
            std::env::current_exe().map_err(|e| e.to_string())?
                .parent().ok_or("Missing desktop executable directory")?
                .join("../share/framecraft/app")
        } else { app.path().resource_dir().map_err(|e| e.to_string())?.join("app") };
        let installed = option_env!("FRAMECRAFT_RELEASE_BUILD").is_some();
        if installed && !packaged.join("release.json").is_file() {
            return Err("The installed Framecraft runtime is missing. Reinstall using the complete desktop package.".into());
        }
        let root = if installed {
            // Tauri canonicalizes Windows resources to \\?\ paths. Node's ESM
            // loader and cwd must receive the ordinary DOS/UNC representation.
            dunce::canonicalize(&packaged).map_err(|e| e.to_string())?
        } else { std::env::var_os("FRAMECRAFT_ROOT").map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent().unwrap().to_owned()) };
        let node = if installed { root.join(if cfg!(windows) {"runtime/node.exe"} else {"runtime/node"}) }
            else { std::env::var_os("FRAMECRAFT_NODE").map(PathBuf::from).unwrap_or_else(|| "node".into()) };
        let mut command = Command::new(node);
        command.arg(root.join("scripts/desktop-backend.mjs")).current_dir(&root)
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::inherit());
        let mut log_path = None;
        if installed {
            let data = std::env::var_os("FRAMECRAFT_DATA_DIR").map(PathBuf::from)
                .unwrap_or(app.path().app_data_dir().map_err(|e| e.to_string())?.join("data"));
            std::fs::create_dir_all(&data).map_err(|e| e.to_string())?;
            let data = dunce::canonicalize(data).map_err(|e| e.to_string())?;
            log_path = Some(data.join("desktop.log"));
            let log = std::fs::OpenOptions::new().create(true).append(true).open(data.join("desktop.log")).map_err(|e| e.to_string())?;
            command.env("FRAMECRAFT_DATA_DIR", &data).stderr(Stdio::from(log));
        }
        #[cfg(target_os = "windows")]
        { use std::os::windows::process::CommandExt; command.creation_flags(0x08000000); }
        let mut child = command.spawn().map_err(|e| format!("Could not launch the Node backend: {e}"))?;
        let stdout = child.stdout.take().unwrap(); let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) {
                    if value["event"] == "ready" { let _ = tx.send(Ok(value["url"].as_str().unwrap_or("").to_owned())); }
                    if value["event"] == "error" { let _ = tx.send(Err(value["message"].as_str().unwrap_or("Backend startup failed").to_owned())); }
                }
            }
        });
        match rx.recv_timeout(Duration::from_secs(60)) {
            Ok(Ok(url)) if url.starts_with("http://127.0.0.1:") => Ok(Self { url, child: Mutex::new(Some(child)) }),
            result => {
                if let Some(mut input) = child.stdin.take() { let _ = writeln!(input, "shutdown"); }
                for _ in 0..60 {
                    if child.try_wait().ok().flatten().is_some() { break; }
                    std::thread::sleep(Duration::from_millis(100));
                }
                let _ = child.kill();
                let _ = child.wait();
                let reason = match result { Ok(Err(message)) => message, other => format!("Backend readiness failed: {other:?}") };
                let mut tail = String::new();
                if let Some(file) = log_path.as_ref().and_then(|p| std::fs::File::open(p).ok()) {
                    let mut file = file;
                    let size = file.metadata().map(|m| m.len()).unwrap_or(0);
                    let _ = file.seek(SeekFrom::Start(size.saturating_sub(8192)));
                    let mut bytes = Vec::new(); let _ = file.read_to_end(&mut bytes);
                    tail = String::from_utf8_lossy(&bytes).into_owned();
                }
                Err(format!("{reason}\nNode: {}\nWorkspace: {}\n{tail}", command.get_program().to_string_lossy(), root.display()))
            }
        }
    }
    pub fn close(&self) {
        let Some(mut child) = self.child.lock().unwrap().take() else { return };
        if let Some(mut input) = child.stdin.take() { let _ = writeln!(input, "shutdown"); }
        // The supervisor stops only a server it owns. Existing CLI servers stay alive.
        std::thread::spawn(move || { let _ = child.wait(); });
    }
}
impl Drop for Backend { fn drop(&mut self) { self.close(); } }

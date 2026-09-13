use std::{io::{BufRead, BufReader, Write}, path::PathBuf, process::{Child, Command, Stdio}, sync::{mpsc, Mutex}, time::Duration};

pub struct Backend { pub url: String, child: Mutex<Option<Child>> }
impl Backend {
    pub fn start() -> Result<Self, String> {
        let root = std::env::var_os("FRAMECRAFT_ROOT").map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent().unwrap().to_owned());
        let node = std::env::var_os("FRAMECRAFT_NODE").unwrap_or_else(|| "node".into());
        let mut command = Command::new(node);
        command.arg(root.join("scripts/desktop-backend.mjs")).current_dir(&root)
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::inherit());
        #[cfg(target_os = "windows")]
        { use std::os::windows::process::CommandExt; command.creation_flags(0x08000000); }
        let mut child = command.spawn().map_err(|e| format!("Could not launch the Node backend: {e}"))?;
        let stdout = child.stdout.take().unwrap(); let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) {
                    if value["event"] == "ready" { let _ = tx.send(value["url"].as_str().unwrap_or("").to_owned()); }
                }
            }
        });
        match rx.recv_timeout(Duration::from_secs(20)) {
            Ok(url) if url.starts_with("http://127.0.0.1:") => Ok(Self { url, child: Mutex::new(Some(child)) }),
            _ => {
                if let Some(mut input) = child.stdin.take() { let _ = writeln!(input, "shutdown"); }
                let _ = child.wait();
                Err("Backend startup failed. See the desktop launcher output; no second workspace was opened.".into())
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

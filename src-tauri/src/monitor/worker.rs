use std::{sync::{mpsc, Arc}, ffi::CStr};
use tokio::sync::oneshot;
use super::{vulkan::{NativeHandles, Surface}, media::{Media, Scene}, SurfaceInfo};

enum Command {
    Resize((u32, u32), oneshot::Sender<Result<(), String>>),
    Frame(Arc<Scene>, u32, oneshot::Sender<Result<(), String>>),
    Stop(oneshot::Sender<()>),
}
// Field order: release presentation before the FFmpeg-owned Vulkan device.
struct Engine { surface: Surface, media: Option<Media>, scene: Option<Arc<Scene>>, has_frame: bool }
impl Engine {
    fn new(handles: NativeHandles, size: (u32, u32), vendor: &str, video: bool) -> Result<Self, String> {
        let (mut surface, media) = if video {
            let names = ash_window::enumerate_required_extensions(handles.0).map_err(|e| e.to_string())?;
            let extensions = names.iter().map(|p| unsafe {CStr::from_ptr(*p)}.to_string_lossy()).collect::<Vec<_>>().join("+");
            let media = Media::new(vendor, &extensions)?;
            let surface = Surface::for_media(handles, size, vendor, &media)?;
            (surface, Some(media))
        } else {(Surface::new(handles, size, vendor)?, None)};
        surface.present()?;
        Ok(Self {surface, media, scene: None, has_frame: false})
    }
    fn frame(&mut self, scene: Arc<Scene>, frame: u32) -> Result<(), String> {
        let media = self.media.as_mut().ok_or("Open native video mode first")?;
        if !self.scene.as_ref().is_some_and(|s| Arc::ptr_eq(s, &scene)) {
            self.has_frame = false; media.scene(&scene)?; self.scene = Some(scene.clone());
        }
        self.has_frame = false;
        media.frame(frame.checked_sub(scene.start).ok_or("Frame precedes native scene")?)?;
        self.surface.present_video(media)?; self.has_frame = true; Ok(())
    }
    fn resize(&mut self, size: (u32, u32)) -> Result<(), String> {
        self.surface.resize(size)?;
        if self.has_frame {self.surface.present_video(self.media.as_mut().unwrap())} else {self.surface.present()}
    }
}
#[derive(Clone)]
pub struct Worker(mpsc::Sender<Command>);
impl Worker {
    pub fn start(handles: NativeHandles, size: (u32, u32), vendor: String, video: bool) -> (Self, oneshot::Receiver<Result<SurfaceInfo, String>>) {
        let (tx, rx) = mpsc::channel(); let (ready, result) = oneshot::channel();
        std::thread::spawn(move || {
            let mut engine = match Engine::new(handles, size, &vendor, video) {
                Ok(engine) => {let _ = ready.send(Ok(engine.surface.info())); engine},
                Err(e) => {let _ = ready.send(Err(e)); return;}
            };
            while let Ok(command) = rx.recv() {
                match command {
                    Command::Resize(size, reply) => {let _ = reply.send(engine.resize(size));}
                    Command::Frame(scene, frame, reply) => {let _ = reply.send(engine.frame(scene, frame));}
                    Command::Stop(reply) => {drop(engine); let _ = reply.send(()); return;}
                }
            }
        });
        (Self(tx), result)
    }
    pub async fn frame(&self, scene: Arc<Scene>, frame: u32) -> Result<(), String> {
        let (tx, rx) = oneshot::channel(); self.0.send(Command::Frame(scene, frame, tx)).map_err(|_| "Presentation worker stopped")?;
        rx.await.map_err(|e| e.to_string())?
    }
    pub async fn resize(&self, size: (u32, u32)) -> Result<(), String> {
        let (tx, rx) = oneshot::channel();
        self.0.send(Command::Resize(size, tx)).map_err(|_| "Presentation worker stopped")?;
        rx.await.map_err(|e| e.to_string())?
    }
    pub async fn stop(&self) {
        let (tx, rx) = oneshot::channel();
        if self.0.send(Command::Stop(tx)).is_ok() {let _ = rx.await;}
    }
}

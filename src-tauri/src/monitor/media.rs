use std::{ffi::{c_char, c_int, c_void, CStr, CString}, ptr::NonNull};
use serde::Deserialize;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Scene {
    #[serde(default)] pub quality: String,
    #[serde(default)] pub media_key: String,
    pub project_id: String, pub revision: u64, pub start: u32, pub duration: u32,
    pub fps: f64, pub width: u32, pub height: u32, pub buffered_frames: u32, pub graph: String, pub inputs: Vec<Input>,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Input { pub file: String, pub source_start: f64, pub image: bool, pub width: u32, pub height: u32 }
#[repr(C)]
#[derive(Default)]
pub struct Device { pub instance: u64, pub physical: u64, pub device: u64, pub family: u32 }
#[repr(C)]
struct Source { file: *const c_char, start: f64, image: c_int, width: c_int, height: c_int }
#[repr(C)]
#[derive(Default)]
pub struct Frame { pub image: u64, pub semaphore: u64, pub value: u64, pub layout: u32, pub access: u32, pub family: u32, pub width: u32, pub height: u32 }
unsafe extern "C" {
    fn fc_media_create(device: *const c_char, extensions: *const c_char, error: *mut c_char, capacity: usize) -> *mut c_void;
    fn fc_media_destroy(media: *mut c_void);
    fn fc_media_device(media: *mut c_void, device: *mut Device) -> c_int;
    fn fc_media_scene(media: *mut c_void, graph: *const c_char, inputs: *const Source, count: c_int, fps: f64, buffered_frames: u32, error: *mut c_char, capacity: usize) -> c_int;
    fn fc_media_frame(media: *mut c_void, frame: c_int, error: *mut c_char, capacity: usize) -> c_int;
    fn fc_media_acquire(media: *mut c_void, frame: *mut Frame) -> c_int;
    fn fc_media_release(media: *mut c_void, submitted: c_int);
    fn fc_media_queue(media: *mut c_void, lock: c_int);
}
fn string(value: &str) -> Result<CString, String> { CString::new(value).map_err(|_| "Native media string contains a null byte".into()) }
fn error(buffer: &[c_char]) -> String { unsafe { CStr::from_ptr(buffer.as_ptr()).to_string_lossy().into_owned() } }
/// Worker-owned FFmpeg device, decoders and graph. Never passed to the UI thread.
pub struct Media { ptr: NonNull<c_void> }
impl Media {
    pub fn new(vendor: &str, extensions: &str) -> Result<Self, String> {
        let name = std::env::var("FRAMECRAFT_VULKAN_DEVICE").unwrap_or_else(|_| if vendor == "amd" { "AMD".into() } else { "NVIDIA".into() });
        let name = string(&name)?; let extensions = string(extensions)?; let mut message = [0; 1024];
        let ptr = unsafe { fc_media_create(name.as_ptr(), extensions.as_ptr(), message.as_mut_ptr(), message.len()) };
        Ok(Self {ptr: NonNull::new(ptr).ok_or_else(|| error(&message))?})
    }
    pub fn device(&self) -> Device { let mut result = Device::default(); unsafe {fc_media_device(self.ptr.as_ptr(), &mut result);} result }
    pub fn scene(&mut self, scene: &Scene) -> Result<(), String> {
        let graph = string(&scene.graph)?; let paths = scene.inputs.iter().map(|i| string(&i.file)).collect::<Result<Vec<_>, _>>()?;
        let sources = scene.inputs.iter().zip(&paths).map(|(s, p)| Source {file: p.as_ptr(), start: s.source_start, image: s.image as c_int, width: s.width as c_int, height: s.height as c_int}).collect::<Vec<_>>();
        let mut message = [0; 1024];
        let result = unsafe {fc_media_scene(self.ptr.as_ptr(), graph.as_ptr(), sources.as_ptr(), sources.len() as c_int, scene.fps, scene.buffered_frames, message.as_mut_ptr(), message.len())};
        if result < 0 {Err(error(&message))} else {Ok(())}
    }
    pub fn frame(&mut self, frame: u32) -> Result<(), String> {
        let mut message = [0; 1024];
        if unsafe {fc_media_frame(self.ptr.as_ptr(), frame as c_int, message.as_mut_ptr(), message.len())} < 0 {Err(error(&message))} else {Ok(())}
    }
    pub fn acquire(&mut self) -> Result<Frame, String> {
        let mut frame = Frame::default();
        if unsafe {fc_media_acquire(self.ptr.as_ptr(), &mut frame)} < 0 {Err("Native presentation requires a Vulkan RGBA frame".into())} else {Ok(frame)}
    }
    pub fn release(&mut self, submitted: bool) { unsafe {fc_media_release(self.ptr.as_ptr(), submitted as c_int);} }
    pub fn queue(&self, lock: bool) { unsafe {fc_media_queue(self.ptr.as_ptr(), lock as c_int);} }
}
impl Drop for Media { fn drop(&mut self) { unsafe {fc_media_destroy(self.ptr.as_ptr());} } }

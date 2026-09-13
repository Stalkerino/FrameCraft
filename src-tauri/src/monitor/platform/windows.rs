use std::num::NonZeroIsize;
use raw_window_handle::{RawDisplayHandle, RawWindowHandle, WindowsDisplayHandle, Win32WindowHandle};
use windows_sys::Win32::{Foundation::HWND, UI::WindowsAndMessaging::*, System::LibraryLoader::GetModuleHandleW};
use crate::monitor::Bounds;

pub struct NativeWindow { hwnd: HWND }
impl NativeWindow {
    pub fn new(owner: &tauri::WebviewWindow, bounds: Bounds) -> Result<Self, String> {
        let parent = owner.hwnd().map_err(|e| e.to_string())?.0;
        let class: Vec<u16> = "STATIC\0".encode_utf16().collect();
        let (w, h) = bounds.pixels();
        let hwnd = unsafe { CreateWindowExW(WS_EX_TRANSPARENT | WS_EX_NOACTIVATE, class.as_ptr(), std::ptr::null(),
            WS_CHILD | WS_VISIBLE | WS_CLIPSIBLINGS, (bounds.x * bounds.pixel_ratio).round() as i32, (bounds.y * bounds.pixel_ratio).round() as i32,
            w as i32, h as i32, parent, std::ptr::null_mut(), GetModuleHandleW(std::ptr::null()), std::ptr::null()) };
        if hwnd.is_null() { return Err(format!("Could not create the native monitor: {}", std::io::Error::last_os_error())); }
        Ok(Self { hwnd })
    }
    pub fn handles(&self) -> Result<(RawDisplayHandle, RawWindowHandle), String> {
        let mut window = Win32WindowHandle::new(NonZeroIsize::new(self.hwnd as isize).ok_or("Missing HWND")?);
        window.hinstance = NonZeroIsize::new(unsafe { GetModuleHandleW(std::ptr::null()) } as isize);
        Ok((RawDisplayHandle::Windows(WindowsDisplayHandle::new()), RawWindowHandle::Win32(window)))
    }
    pub fn resize(&self, bounds: Bounds) -> Result<(), String> {
        let (w, h) = bounds.pixels();
        let ok = unsafe { SetWindowPos(self.hwnd, HWND_TOP, (bounds.x * bounds.pixel_ratio).round() as i32,
            (bounds.y * bounds.pixel_ratio).round() as i32, w as i32, h as i32, SWP_NOACTIVATE) };
        if ok == 0 { return Err(std::io::Error::last_os_error().to_string()); } Ok(())
    }
}
impl Drop for NativeWindow { fn drop(&mut self) { unsafe { DestroyWindow(self.hwnd); } } }

use std::{ffi::c_void, ptr::NonNull};
use glib::{prelude::*, translate::ToGlibPtr};
use gtk::prelude::*;
use raw_window_handle::{RawDisplayHandle, RawWindowHandle, WaylandDisplayHandle, WaylandWindowHandle, XlibDisplayHandle, XlibWindowHandle};
use crate::monitor::Bounds;

#[link(name = "gdk-3")]
extern "C" {
    fn gdk_wayland_display_get_wl_display(display: *mut gdk::ffi::GdkDisplay) -> *mut c_void;
    fn gdk_wayland_window_get_wl_surface(window: *mut gdk::ffi::GdkWindow) -> *mut c_void;
    fn gdk_x11_display_get_xdisplay(display: *mut gdk::ffi::GdkDisplay) -> *mut c_void;
    fn gdk_x11_window_get_xid(window: *mut gdk::ffi::GdkWindow) -> std::ffi::c_ulong;
}

pub struct NativeWindow { window: gdk::Window, offset: (i32, i32), wayland: bool }
impl NativeWindow {
    pub fn new(owner: &tauri::WebviewWindow, bounds: Bounds) -> Result<Self, String> {
        let gtk = owner.gtk_window().map_err(|e| e.to_string())?;
        let parent = gtk.window().ok_or("Desktop window is not realized")?;
        let display = parent.display();
        let wayland = display.type_().name().contains("Wayland");
        let offset = owner.default_vbox().map_err(|e| e.to_string())?.translate_coordinates(&gtk, 0, 0).unwrap_or((0, 0));
        let (w, h) = bounds.pixels();
        let attr = gdk::WindowAttr { title: Some("Framecraft native monitor".into()),
            window_type: if wayland { gdk::WindowType::Subsurface } else { gdk::WindowType::Child },
            x: Some(bounds.x.round() as i32 + offset.0), y: Some(bounds.y.round() as i32 + offset.1),
            width: (w as f64 / bounds.pixel_ratio).ceil() as i32, height: (h as f64 / bounds.pixel_ratio).ceil() as i32,
            wclass: gdk::WindowWindowClass::InputOutput, ..Default::default() };
        let window = gdk::Window::new(Some(&parent), &attr);
        // Wayland subsurfaces use the transient parent, not GDK's logical
        // child hierarchy, to attach to the compositor's parent wl_surface.
        if wayland { window.set_transient_for(&parent); }
        window.set_pass_through(true); window.show(); display.flush();
        let native = Self { window, offset, wayland };
        native.handles()?;
        Ok(native)
    }
    pub fn handles(&self) -> Result<(RawDisplayHandle, RawWindowHandle), String> {
        let display = self.window.display();
        unsafe {
            if self.wayland {
                let d = NonNull::new(gdk_wayland_display_get_wl_display(display.to_glib_none().0)).ok_or("Missing Wayland display")?;
                let w = NonNull::new(gdk_wayland_window_get_wl_surface(self.window.to_glib_none().0)).ok_or("GTK did not create a native Wayland subsurface")?;
                Ok((RawDisplayHandle::Wayland(WaylandDisplayHandle::new(d)), RawWindowHandle::Wayland(WaylandWindowHandle::new(w))))
            } else {
                let d = NonNull::new(gdk_x11_display_get_xdisplay(display.to_glib_none().0)).ok_or("Missing X11 display")?;
                let w = gdk_x11_window_get_xid(self.window.to_glib_none().0);
                if w == 0 { return Err("Missing native X11 child window".into()); }
                Ok((RawDisplayHandle::Xlib(XlibDisplayHandle::new(Some(d), 0)), RawWindowHandle::Xlib(XlibWindowHandle::new(w))))
            }
        }
    }
    pub fn resize(&self, bounds: Bounds) -> Result<(), String> {
        let (w, h) = bounds.pixels();
        self.window.move_resize(bounds.x.round() as i32 + self.offset.0, bounds.y.round() as i32 + self.offset.1,
            (w as f64 / bounds.pixel_ratio).ceil() as i32, (h as f64 / bounds.pixel_ratio).ceil() as i32);
        self.window.display().flush(); Ok(())
    }
}
impl Drop for NativeWindow { fn drop(&mut self) {
    if std::env::var("FRAMECRAFT_DESKTOP_CHECK").is_ok() { eprintln!("Desktop check: hiding native child"); }
    self.window.hide();
    if std::env::var("FRAMECRAFT_DESKTOP_CHECK").is_ok() { eprintln!("Desktop check: destroying native child"); }
    // gdk_window_destroy consumes a reference even though gtk-rs exposes it
    // as &self. Supply that reference; the Rust wrapper still owns its own.
    unsafe { glib::gobject_ffi::g_object_ref(self.window.as_ptr().cast()); }
    self.window.destroy();
    if std::env::var("FRAMECRAFT_DESKTOP_CHECK").is_ok() { eprintln!("Desktop check: native child destroyed"); }
} }

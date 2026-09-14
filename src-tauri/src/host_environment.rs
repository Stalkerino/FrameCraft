use std::{ffi::{OsStr, OsString}, path::Path};
use std::os::unix::ffi::{OsStrExt, OsStringExt};

// Only clean the environment of applications opened outside Framecraft. The
// WebView, backend and render processes still need their private runtime paths.
pub fn external_value(name: &OsStr, value: &OsStr, appdir: &Path) -> Option<OsString> {
    match name.to_str().unwrap_or("") {
        "APPDIR" | "APPIMAGE" | "ARGV0" | "APPIMAGE_EXTRACT_AND_RUN" |
        "GTK_THEME" | "GDK_BACKEND" => None,
        "PATH" | "LD_LIBRARY_PATH" | "XDG_DATA_DIRS" | "GTK_PATH" |
        "GIO_EXTRA_MODULES" | "GI_TYPELIB_PATH" | "GST_PLUGIN_PATH" |
        "GST_PLUGIN_PATH_1_0" | "GST_PLUGIN_SYSTEM_PATH" | "GST_PLUGIN_SYSTEM_PATH_1_0" |
        "QT_PLUGIN_PATH" | "QML2_IMPORT_PATH" => {
            let paths: Vec<_> = std::env::split_paths(value)
                .filter(|path| !path.as_os_str().is_empty() && !path.starts_with(appdir)).collect();
            if paths.is_empty() { None } else { std::env::join_paths(paths).ok() }
        },
        "LD_PRELOAD" => {
            let libraries: Vec<_> = value.as_bytes().split(|byte| *byte == b':' || byte.is_ascii_whitespace())
                .filter(|item| !item.is_empty() && !Path::new(OsStr::from_bytes(item)).starts_with(appdir)).collect();
            if libraries.is_empty() { None } else { Some(OsString::from_vec(libraries.join(&b':'))) }
        },
        "GTK_DATA_PREFIX" | "GTK_EXE_PREFIX" | "GSETTINGS_SCHEMA_DIR" |
        "GTK_IM_MODULE_FILE" | "GDK_PIXBUF_MODULE_FILE" | "GDK_PIXBUF_MODULEDIR" |
        "GST_PLUGIN_SCANNER" | "GST_PLUGIN_SCANNER_1_0" | "GST_REGISTRY" | "GST_REGISTRY_1_0" => {
            if Path::new(value).starts_with(appdir) { None } else { Some(value.to_owned()) }
        },
        _ => Some(value.to_owned()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn clean(name: &str, value: &str) -> Option<OsString> {
        external_value(OsStr::new(name), OsStr::new(value), Path::new("/tmp/Framecraft.AppDir"))
    }
    #[test]
    fn removes_private_libraries_but_preserves_host_paths_and_desktop_session() {
        assert_eq!(clean("LD_LIBRARY_PATH", "/tmp/Framecraft.AppDir/usr/lib:/opt/host/lib:"), Some("/opt/host/lib".into()));
        assert_eq!(clean("LD_LIBRARY_PATH", "/tmp/Framecraft.AppDir/usr/lib"), None);
        assert_eq!(clean("LD_PRELOAD", "/tmp/Framecraft.AppDir/usr/lib/a.so /opt/host/b.so:/opt/host/c.so"), Some("/opt/host/b.so:/opt/host/c.so".into()));
        assert_eq!(clean("XDG_DATA_DIRS", "/tmp/Framecraft.AppDir/usr/share:/usr/share"), Some("/usr/share".into()));
        for name in ["DISPLAY", "WAYLAND_DISPLAY", "DBUS_SESSION_BUS_ADDRESS", "XDG_RUNTIME_DIR"] {
            assert_eq!(clean(name, "host-value"), Some("host-value".into()));
        }
    }
    #[test]
    fn clears_bundle_overrides_without_matching_unrelated_path_prefixes() {
        assert_eq!(clean("GSETTINGS_SCHEMA_DIR", "/tmp/Framecraft.AppDir/usr/share/glib-2.0/schemas"), None);
        assert_eq!(clean("GDK_PIXBUF_MODULE_FILE", "/opt/host/loaders.cache"), Some("/opt/host/loaders.cache".into()));
        assert_eq!(clean("LD_LIBRARY_PATH", "/tmp/Framecraft.AppDir-other/lib"), Some("/tmp/Framecraft.AppDir-other/lib".into()));
        assert_eq!(clean("APPDIR", "/tmp/Framecraft.AppDir"), None);
        assert_eq!(clean("GDK_BACKEND", "x11"), None);
    }
}

fn main() {
    let root = std::path::PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap()).parent().unwrap().to_owned();
    let runtime = std::env::var_os("FRAMECRAFT_MEDIA_SDK").map(std::path::PathBuf::from)
        .unwrap_or_else(|| root.join(".runtime/vulkan-shared/autobuild-2026-09-12-13-12"));
    let headers = root.join(".runtime/vulkan-headers/1.4.341/include");
    if !runtime.join("include/libavutil/hwcontext_vulkan.h").exists() || !headers.join("vulkan/vulkan.h").exists() {
        panic!("Native preview dependencies missing. Run npm run desktop:setup first.");
    }
    println!("cargo:rerun-if-env-changed=FRAMECRAFT_MEDIA_SDK");
    println!("cargo:rerun-if-changed=src/monitor/media.c");
    println!("cargo:rerun-if-changed=src/monitor/media.h");
    cc::Build::new().file("src/monitor/media.c").include(runtime.join("include")).include(headers).std("c11")
        .flag_if_supported("-Wno-deprecated-declarations").compile("framecraft_media");
    println!("cargo:rustc-link-search=native={}", runtime.join("lib").display());
    for library in ["avfilter", "avformat", "avcodec", "avutil"] { println!("cargo:rustc-link-lib=dylib={library}"); }
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("linux") {
        // DT_RPATH also resolves transitive dependencies of the isolated SDK.
        println!("cargo:rustc-link-arg=-Wl,--disable-new-dtags,-rpath,{}", runtime.join("lib").display());
    } else if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        // Keep the exact SDK DLLs beside the executable, including indirect
        // dependencies. Launching the .exe never depends on the user's PATH.
        let out = std::path::PathBuf::from(std::env::var("OUT_DIR").unwrap());
        let destination = out.ancestors().nth(3).expect("Cargo profile output directory");
        for entry in std::fs::read_dir(runtime.join("bin")).expect("FFmpeg runtime bin directory") {
            let entry = entry.unwrap();
            if entry.path().extension().is_some_and(|ext| ext.eq_ignore_ascii_case("dll")) {
                std::fs::copy(entry.path(), destination.join(entry.file_name())).expect("Copy native media DLL");
            }
        }
    }
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "open_render_output", "desktop_info", "surface_open", "surface_resize", "surface_frame", "surface_close", "surface_check_finished",
        ]),
    )).expect("Could not build desktop command permissions");
}

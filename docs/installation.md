# Install Framecraft

Download from [GitHub Releases](https://github.com/Stalkerino/FrameCraft/releases):

- **Windows 10/11 x64:** run `Framecraft_…_x64-setup.exe`. The installer includes the WebView2 offline installer for machines missing the embedded webview. Start Framecraft from the Start menu.
- **Linux x64:** download the `.AppImage`, mark it executable in file properties, then run it. Alternatively install the `.deb` with your package manager (for example `sudo apt install ./Framecraft_…_amd64.deb`). Linux builds target Ubuntu 22.04 and newer compatible glibc distributions; AppImage may require your distribution's FUSE 2 package, or run it with `--appimage-extract-and-run`.

These are Tauri desktop applications. Node, the backend, native FFmpeg libraries and built-in assets are included. Rust, npm and an external browser are not startup requirements. GPU rendering still requires a compatible graphics driver. The optional Remotion compatibility renderer downloads its browser into the user cache only when needed. AI providers remain optional and require their own configured CLI/authentication or Ollama server.

Projects, media, presets, model caches and `desktop.log` live under the OS application-data directory for `com.framecraft.studio`, in `data/`. Agent-generated files use its sibling `workspace/`. Installing an update replaces application files, preserving those user folders. Source-checkout projects remain in their existing `data/` folder; use project backup/import to transfer them. Releases currently have no code-signing certificate configured.

## Build from source

Install Node 22+ with npm, Rust, and the [Tauri platform build prerequisites](https://v2.tauri.app/start/prerequisites/). Windows needs MSVC C++ tools and a Windows SDK; Linux needs GTK 3 / WebKitGTK 4.1 development packages.

- **Build:** `Build-Windows.cmd`, `sh Build-Linux.sh`, or `npm run desktop:build`.
- **Start:** `Start-Windows.cmd`, `sh Start-Linux.sh`, or `npm run launch`.
- **Setup and start:** `Install-Windows.cmd` or `sh Install-Linux.sh` can bootstrap Node and build the desktop app; native compiler prerequisites must already be installed. `--no-launch` (Linux) / `-NoLaunch` (PowerShell script) builds without starting.

Normal launchers always open Tauri. Source builds require their checkout, `node_modules` and `.runtime` to remain available. Close Framecraft before rebuilding. Logs: `.runtime/desktop-build.log`.

The React interface and local backend are internal components of the desktop app. Use the desktop launchers above to open Framecraft.

## GitHub CI releases

1. Commit and push the prepared code.
2. In **Actions → Desktop release → Run workflow**, enter a version to build both platforms and download the resulting workflow artifacts without publishing.
3. To publish, push a new version tag, for example `git tag v0.1.0` followed by `git push origin v0.1.0`.

The tag supplies the installer version. CI builds Windows NSIS and Linux AppImage/DEB independently, installs/extracts the packages into temporary folders, checks the real native executable, bundled backend, built-in media and MCP connection without GPU rendering, then publishes all three packages plus `SHA256SUMS.txt`. Failed platform checks block publication. Tags containing a suffix such as `v0.2.0-beta.1` create prereleases. No separate GitHub token secret is needed; the publication job uses its scoped `GITHUB_TOKEN`.

`npm run desktop:release` runs the same packaging script locally on the destination OS; set `FRAMECRAFT_RELEASE_VERSION` to override the package version. Outputs: `.runtime/release/artifacts/`. Packaging stages production dependencies separately and never includes local projects, exports, credentials, AI models or development caches. Native graphics correctness/performance is validated separately on real hardware.

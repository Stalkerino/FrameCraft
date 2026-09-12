# Install and launch

Download the repository with **Code → Download ZIP** on GitHub and extract it completely into a writable folder, or clone it with Git. Do not run an installer from inside the ZIP. Internet access is needed for the first installation.

## Windows

1. Double-click **Install-Windows.cmd**.
2. Wait for dependency installation and the build. Framecraft opens in your default browser when ready.
3. Next time, double-click **Start-Windows.cmd**. Keep the console open while editing; Ctrl+C stops the server.

Windows 10/11, 64-bit, with built-in PowerShell 5.1 or newer is the primary target. ARM64 Windows needs x64 emulation for the downloaded Windows tools. No global Node/npm installation or administrator account is needed for the portable Windows dependencies.

Setup reuses Node 22+ with npm when available; otherwise it downloads the official Node 24 LTS x64 ZIP into `.runtime/node`. If FFmpeg/ffprobe are missing, it downloads the [Gyan release essentials ZIP](https://www.gyan.dev/ffmpeg/builds/), which includes AMF/NVENC hardware support. Both archives are checked against the publisher's SHA-256 files before extraction. No system PATH or machine-wide PowerShell execution policy is changed: the policy argument applies only to this installer process.

## Linux

Run **Install-Linux.sh** using your file manager's **Run in Terminal** action. Some desktops require **Properties → Permissions → Allow executing file as program** first. Linux does not universally allow executable scripts from a ZIP to run on double-click; the reliable first-run command is:

```sh
sh Install-Linux.sh
```

The installer uses your distribution's package manager for FFmpeg and browser libraries. It may request your `sudo` password. Run it as your normal user, **not** with `sudo` in front of the installer. Node 22+ with npm is reused, or the official Node 24 LTS Linux archive is downloaded and SHA-256 checked locally.

- **Ubuntu/Debian:** apt installs FFmpeg and the browser's shared libraries.
- **Arch and derivatives:** pacman installs FFmpeg and Chromium. Keep the distribution updated; setup does not perform a system upgrade.
- **Fedora/openSUSE:** dnf/zypper install FFmpeg and Chromium, but a multimedia repository providing a complete FFmpeg build must already be enabled. A build without libx264/AAC is rejected with an explanation.
- **Other distributions:** install Node 22+, npm, FFmpeg with ffprobe, and Chromium yourself, then run `npm run setup`.

Linux x64 with a recent glibc distribution is the main automated target. ARM64 requires a distribution Chromium executable; Remotion's downloadable browser is not available on every architecture. Set `CHROME_PATH` when needed.

After installation, use **Start-Linux.sh** or the generated **Framecraft.desktop** shortcut. Your desktop may ask you to trust that shortcut. Keep the installation in the same location, or rerun setup to regenerate its absolute launcher paths.

## What setup does

Setup checks Node/npm, FFmpeg, ffprobe and codec listings; runs `npm ci` from the lockfile; prepares Chromium; checks its executable version; builds the application; saves local runtime paths; and launches the editor at **http://127.0.0.1:4318**.

It does **not** run video/GPU stress tests, change GPU drivers, download AI models, sign into an AI provider, register a global MCP server, or modify your saved projects. First-time setup needs several hundred MB of downloads and additional disk space for dependencies. A setup log is saved at `.runtime/install.log` (bootstrap download/package-manager errors appear in the console).

For AI, choose **Ollama** in the editor and enter your existing server URL, or install/sign into **Codex CLI** separately. Editing works without either. User authentication cannot be automated by the installer.

## Restart, update and troubleshooting

- Start reuses an existing Framecraft service on the selected port. It reports an error if a different application occupies the port.
- Stop Framecraft before running setup again. Dependency replacement while an editor/export is active is refused.
- After replacing source files or pulling changes, Start detects changes and rebuilds through setup when necessary. It reuses existing downloads and preserves `data/`.
- To install without launching, use `sh Install-Linux.sh --no-launch` or `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install/windows.ps1 -NoLaunch`.
- With Node and system dependencies already installed, `npm run setup` and `npm run launch` call the shared cross-platform implementation.
- Set `PORT` before launching to use a different port. Existing `FFMPEG_PATH`, `FFPROBE_PATH`, `CHROME_PATH` and data-directory environment overrides remain supported. See [all configuration options](getting-started.md).
- `.runtime/`, `node_modules/`, the generated shortcut and project data are ignored by Git. Keep `data/` when replacing an installation; it contains your media and projects.

## Testing a clean installation

The **Installer smoke test** GitHub Actions workflow can be started manually from the repository's **Actions** tab. It runs the installer on Windows and Ubuntu, starts the built editor with an isolated temporary project directory, checks the HTTP endpoint/page, and stops that process. It does not render or exercise GPU filters. Failed jobs upload the installer log.

Local checks cover the bootstrap shell/Node syntax, runtime-path selection, npm entry point resolution and existing-service detection. A clean Windows installation must still be verified on Windows or through that workflow; Linux-only checks do not establish Windows runtime success.

#!/bin/sh
set -eu
trap 'FRAMECRAFT_EXIT=$?; if [ "$FRAMECRAFT_EXIT" -ne 0 ] && [ -t 0 ]; then printf "\nSetup stopped. Review the error above. Press Enter to close.\n"; IFS= read -r FRAMECRAFT_REPLY || true; fi; exit "$FRAMECRAFT_EXIT"' 0
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$ROOT"
RUNTIME="$ROOT/.runtime"
mkdir -p "$RUNTIME"
# Never run npm or the editor as root, or change graphics drivers during setup.
if [ "$(id -u)" = 0 ]; then echo 'Run this installer as your normal desktop user, not with sudo.' >&2; exit 1; fi
as_admin() { if command -v sudo >/dev/null 2>&1; then sudo "$@"; else echo 'sudo is needed to install missing system packages.' >&2; exit 1; fi; }
install_packages() {
    if command -v apt-get >/dev/null 2>&1; then
        as_admin apt-get update
        SOUND=libasound2
        if apt-cache show libasound2t64 >/dev/null 2>&1; then SOUND=libasound2t64; fi
        as_admin apt-get install -y ca-certificates curl xz-utils ffmpeg libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libx11-xcb1 libxcb1 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libxkbcommon0 libcups2 "$SOUND" libpango-1.0-0 libcairo2 fonts-liberation
    elif command -v pacman >/dev/null 2>&1; then
        as_admin pacman -S --needed --noconfirm ca-certificates curl xz ffmpeg chromium
    elif command -v dnf >/dev/null 2>&1; then
        as_admin dnf install -y ca-certificates curl xz ffmpeg chromium
    elif command -v zypper >/dev/null 2>&1; then
        as_admin zypper --non-interactive install ca-certificates curl xz ffmpeg chromium
    else
        echo 'Install Node.js 22+, curl, xz, FFmpeg (with libx264 and ffprobe), and Chromium using your distribution, then rerun this installer.' >&2
        exit 1
    fi
}
# Start skips package installation; a first installation prepares browser libraries too.
if [ "${1:-}" != '--launch' ] || [ ! -f "$RUNTIME/config.json" ]; then
    echo 'Preparing FFmpeg and browser libraries. The package manager may ask for your password.'
    install_packages
fi
NODE="$RUNTIME/node/bin/node"
if [ ! -x "$NODE" ]; then
    NODE=''
    if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1 && node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' 2>/dev/null; then NODE=$(command -v node); fi
fi
if [ -z "$NODE" ]; then
    case "$(uname -m)" in x86_64) ARCH=x64 ;; aarch64|arm64) ARCH=arm64 ;; *) echo 'Unsupported CPU: use a Linux x64 or ARM64 installation.' >&2; exit 1 ;; esac
    BASE=https://nodejs.org/dist/latest-v24.x
    curl --fail --location --proto '=https' --tlsv1.2 "$BASE/SHASUMS256.txt" -o "$RUNTIME/node-checksums.txt"
    ARCHIVE=$(awk -v arch="$ARCH" '$2 ~ ("^node-v24\\.[0-9]+\\.[0-9]+-linux-" arch "\\.tar\\.xz$") {print $2; exit}' "$RUNTIME/node-checksums.txt")
    if [ -z "$ARCHIVE" ]; then echo 'Cannot locate the official Node 24 archive.' >&2; exit 1; fi
    curl --fail --location --proto '=https' --tlsv1.2 "$BASE/$ARCHIVE" -o "$RUNTIME/$ARCHIVE.part"
    EXPECTED=$(awk -v file="$ARCHIVE" '$2 == file {print $1}' "$RUNTIME/node-checksums.txt")
    ACTUAL=$(sha256sum "$RUNTIME/$ARCHIVE.part" | awk '{print $1}')
    if [ "$EXPECTED" != "$ACTUAL" ]; then echo 'Node checksum mismatch; archive was not installed.' >&2; exit 1; fi
    mkdir -p "$RUNTIME/node"
    tar -xJf "$RUNTIME/$ARCHIVE.part" --strip-components=1 -C "$RUNTIME/node"
    rm "$RUNTIME/$ARCHIVE.part"
    NODE="$RUNTIME/node/bin/node"
fi
PATH="$(dirname "$NODE"):$PATH"; export PATH
if [ "${1:-}" = '--launch' ]; then "$NODE" "$ROOT/scripts/install/launch.mjs"; else "$NODE" "$ROOT/scripts/install/setup.mjs" "$@"; fi

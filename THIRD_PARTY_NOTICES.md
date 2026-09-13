# Third-party software

Framecraft's project license applies to its original code. It does not replace
the licenses of dependencies, bundled runtimes, fonts, AI models, or user media.

## Native media runtime

The desktop app distributes FFmpeg and links to its shared libraries. The pinned
runtime uses BtbN's **GPL builds**, not the LGPL-only variant. FFmpeg and included
codec libraries retain their GPL and other applicable upstream terms.

- [FFmpeg licensing](https://ffmpeg.org/legal.html)
- [Pinned runtime archives and checksums](shared/vulkan-runtime.json)
- [BtbN build recipes](https://github.com/BtbN/FFmpeg-Builds)

Installed packages include `app/notices/FFmpeg-GPL-3.txt`, runtime licenses, and
`app/release.json` identifying the exact binary archives and source revision.
Redistributing binaries also requires meeting the corresponding-source
obligations of the included licenses; references and checksums alone are not a
replacement for corresponding source.

## Remotion

The interface and compatibility renderer depend on Remotion 4.0.522. Remotion
uses its own license, with eligibility conditions for its free license and
separate company licensing. It is not relicensed by Framecraft's project license.

The installed dependency contains the exact terms in
`app/node_modules/remotion/LICENSE.md`. See also
[Remotion's licensing information](https://www.remotion.dev/docs/license).

## Other components

- **Node.js:** its license and bundled dependency notices are included in
  `app/notices/Node-LICENSE.txt`.
- **JavaScript dependencies:** upstream licenses remain in each package under
  `app/node_modules`. Versions are recorded in `package-lock.json`.
- **Rust dependencies:** versions are recorded in `src-tauri/Cargo.lock`; their
  upstream licenses apply independently, including Tauri and the Vulkan bindings.
- **Linux fallback fonts:** Liberation font terms are included in
  `app/notices/Liberation-LICENSE.txt`.
- **Windows WebView2:** Microsoft's runtime and installer retain Microsoft's
  terms. GPU drivers are provided by the OS or hardware vendor.
- **AI models and assistants:** model licenses and provider terms apply
  separately. User-downloaded model weights and external CLI assistants are not
  included in the application installer.

User projects, imported footage, and generated exports are not relicensed by
installing or using Framecraft.

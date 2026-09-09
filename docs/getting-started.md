# Getting started

Detailed setup and editing instructions for Windows and Linux. For an overview, see the [README](../README.md); for all tools and boundaries, see the [feature reference](feature-overview.md).

## Install and run

Install **Node.js 22 or newer** and **FFmpeg**, including `ffprobe`, and make sure both executables are available on your PATH. On Windows, a full FFmpeg build with `libx264` and AAC support is needed; restart your terminal after updating PATH. The same codec requirements apply on Linux.

Clone `https://github.com/Stalkerino/FrameCraft.git` and open its folder in PowerShell, Command Prompt, or a Linux terminal. Then run:

```sh
npm ci
npm run doctor
npm run dev
```

Open **http://127.0.0.1:5173**. The editing service runs at **http://127.0.0.1:4318**. Keep the terminal running.

For the production build:

```sh
npm run build
npm start
```

Then open **http://127.0.0.1:4318**. No web hosting or database is needed. Browser support targets current desktop Chrome, Chromium, Edge, and Firefox. Windows-compatible code paths and CI are included; local runtime verification was performed on Linux.

To serve the built editor on all network interfaces (Windows and Linux):

```sh
npm start -- --host 0.0.0.0 --port 4318
```

Open `http://<this-computer's-LAN-IP>:4318` from another device. The interface and API share this port; the internal MCP/rendering services continue to use loopback. Host/origin validation accepts this machine's network addresses when network listening is enabled.

Browser microphone access requires HTTPS or localhost. For dictation, use `http://localhost:4318` on the host computer or provide HTTPS for remote access.

Rendering uses local Chromium. On Linux, `/usr/bin/chromium` is detected automatically. Otherwise Remotion downloads its compatible Chrome Headless Shell on the first render, which requires internet access. You can set `CHROME_PATH` to an existing Chrome/Chromium executable instead.

Each render runs in a worker with temporary browser data, downloaded footage, and bundles under `data/render-cache/`, on the same disk as the projects. Its scratch directory is removed on completion or failure. This avoids filling a small system temporary disk. Preview playback waits for buffered video/audio and retries interrupted video loading without refreshing the editor.

Exports default to **Automatic · prefer GPU**. Choose **AMD**, **NVIDIA**, or **CPU** in Export settings; “Remember these settings” saves the selection with the project. AMD uses VA-API on Linux and AMF on Windows; NVIDIA uses NVENC on both. H.264, H.265 and AV1 are offered when the GPU, driver and FFmpeg build can encode them. The service tries the installed FFmpeg (`FFMPEG_PATH` or PATH) and Remotion's bundled FFmpeg, and checks one synthetic frame before rendering. Explicit AMD/NVIDIA selection fails early if unsupported; automatic mode reports its CPU fallback. Progress names the actual encoder. CPU frame workers scale with available cores and memory.

Eligible devlogs now use a faster layered export: FFmpeg reads the gameplay sequentially, while the shared React composition renders only transparent text and graphics. Identical artwork frames are reused, and each video cut is encoded once before a final join that copies video and encodes audio once. Hardware source decoding is enabled when supported. More complex timelines automatically retain the full compositor. GPU encoding reuses the same composition, effects, audio and frame timing. Quality mode uses hardware CQ/QP rather than CRF; equal quality numbers are not interchangeable across encoders. Bitrate mode retains the requested target. GPU encoding accelerates compression; Chromium frame composition and source decoding can still limit total export speed. [Remotion encoding documentation](https://www.remotion.dev/docs/hardware-acceleration), [FFmpeg VA-API documentation](https://ffmpeg.org/ffmpeg-codecs.html#VAAPI-encoders), [AMD AMF documentation](https://github.com/GPUOpen-LibrariesAndSDKs/AMF/wiki/AMF-Encoder-Settings-and-Tuning-in-FFmpeg).

For AMD/Linux, use an FFmpeg build with VA-API plus a working Mesa video driver and access to the AMD `/dev/dri/renderD*` device. For Windows, a standalone static FFmpeg build with AMF/NVENC is the easiest setup. Framecraft does not modify installed binaries: each render prepares its own executable directory. Codex can inspect availability with `get_export_encoders` and pass `encoder: "auto" | "amd" | "nvidia" | "cpu"` to `export_video`.

Optional environment variables:

| Variable | Purpose |
| --- | --- |
| `FFMPEG_PATH` | Full path to `ffmpeg` / `ffmpeg.exe` |
| `FFPROBE_PATH` | Full path to `ffprobe` / `ffprobe.exe` |
| `CHROME_PATH` | Full path to Chrome/Chromium executable |
| `FRAMECRAFT_DATA_DIR` | Workspace containing saved projects, imported media, previews, and exports; defaults to `data/` |
| `FRAMECRAFT_LIBRARY_DIR` | Shared reusable preset library; defaults to this installation's `data/asset-library/`, independently of the active project directory |
| `PORT` | Local service port, default `4318`; the Vite development proxy expects the default |
| `FRAMECRAFT_HOST` | Listen address, default `127.0.0.1`; `--host` overrides it |
| `FRAMECRAFT_URL` | Service URL used by the MCP bridge, default `http://127.0.0.1:4318` |
| `FRAMECRAFT_CODEX_PATH` | Optional full path to the Codex executable or npm `codex.js` entry point, if it is not on PATH |
| `FRAMECRAFT_MODEL_CACHE` | Local speech and search model cache; defaults to `.cache/models/` |
| `FRAMECRAFT_RENDER_CACHE` | Optional render scratch directory on a disk with free space; defaults to `data/render-cache/` |

Example Windows setup when FFmpeg is outside PATH:

```powershell
$env:FFMPEG_PATH = 'C:\Tools\ffmpeg\bin\ffmpeg.exe'
$env:FFPROBE_PATH = 'C:\Tools\ffmpeg\bin\ffprobe.exe'
$env:CHROME_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
npm run dev
```

## Edit a devlog

1. Open the project-name menu in the top bar and choose **New project**, choose a name and canvas settings, then **Create project**. Your other projects stay saved. This menu also provides **Open project**, **Save as**, **Rename project**, and **Start a blank timeline** to clear only the current timeline.
2. Click **Import files**, or drop files into the media library. Originals are saved under `data/projects/<project-key>/media/` and used for final rendering; thumbnails live alongside in `thumbnails/`. Full-quality playback uses the original when the browser supports it; otherwise it prepares a full-resolution H.264 compatibility copy on demand. **Performance** explicitly selects a smaller playback copy. Stop/Retry controls show preparation progress. Encoding runs one file at a time with limited threads. Uploads are moved from temporary storage without a second full copy; MCP path imports copy the file, keeping projects independent of the original location.
3. Use **Add track** to create video, text or audio tracks. Click an asset to preview it and choose a destination track, or use its **Add** button to append directly. Drag assets onto a track at a chosen position. Drag clips between compatible tracks or choose their **Timeline track** in Properties. Each track has visibility, mute and clear controls; track settings let you rename, reorder or remove empty tracks. Higher tracks appear in front.
4. Use **Cut (C)** and click a clip at the desired cut point. **V** returns to selection; drag clips to move them and edge handles to trim. To split at an exact playhead position, click the timeline ruler and press **S** or **Split at playhead**. The right piece becomes selected for your next split. Delete unwanted pieces and use Undo to restore them. **Fit timeline** fits a long recording into view. Nearby clip edges and the playhead snap during moves; hold Alt to bypass snapping.
5. Use **Titles** to add a heading, subtitle, or chapter label at the playhead. Drag visible elements directly in the paused preview and resize with corner handles; toggle **Edit elements on canvas** to enable or disable these controls. Small click movements are ignored. Enable **Lock position** in Properties to keep the selected element's X/Y fixed while editing its content, size or timing. A gesture creates one undo step. Properties groups content, timing, transform, animation and audio into collapsible sections. Text fields commit on blur; numeric fields also commit on Enter.
6. Select a visual clip and choose a transition. Dissolve, push, diagonal wipe, and pixel reveal are included. Transitions reveal the incoming clip over the outgoing last frame, preserving timeline duration. The hold is silent; it does not repeat outgoing audio.
7. Imported audio goes on the audio track. Clip volume, trim, and source-in are editable. The preview mute button affects monitoring only.
8. Open **Project settings** in the top bar to set canvas dimensions, frame rate, background, and master volume. **Match source** copies dimensions and, when recorded in the media metadata, frame rate from a chosen video. Presets include 720p through 8K, portrait and square; custom even dimensions from 64 to 8192 and frame rates from 1 to 120 fps are supported. Changing fps preserves elapsed clip and animation timing within frame rounding.
9. Open **Export video** to choose independent output dimensions/fps, fit/fill/stretch, codec/container, CRF or target bitrate, audio settings, and a time range. Available video formats include H.264/H.265/AV1 MP4, VP8/VP9 WebM, ProRes MOV and H.264 MKV. Compatible audio codecs, 44.1/48 kHz sample rates, H.264 encoding speed and ProRes profiles are exposed. Optionally save these defaults per project. Use the camera button for PNG frame captures. Exports use a frozen project revision, so editing may continue during rendering.

Edits save automatically, including the last 50 undo states per project. **Save as** opens an independent copy; **Open project** browses saved projects with search, thumbnails and canvas details. The UI and Codex share the active project and its undo history. Keep the entire `data/` workspace directory, plus any separately configured preset library, when moving projects between computers; media URLs are relative and portable. See [Managing projects](projects.md).

Use **Edit**, **Review**, or **AI edit** in the workspace bar to arrange the editor for the current task. Drag the panel dividers and timeline edge to resize them; layout preferences persist in this browser. Review gives the program monitor more space; AI edit opens the existing Codex panel. Timeline controls include copy/paste/duplicate, undo/redo, snapping, follow-playhead and a clip context menu.

The program monitor shows the actual playback source and its dimensions; **Fit**, **50%** and **100%** control display zoom. Full-resolution compatibility copies use CRF 18 and are still compressed, while supported originals avoid preview transcoding. Performance copies do not affect export. Exports always read original media, use lossless PNG intermediate frames when the full compositor is needed, and use Lanczos scaling in the optimized paths. New export settings default to CRF/CQ/QP 16; existing saved quality choices remain unchanged. Export **Match source** and dimension/frame-rate hints help avoid unintended downscaling. Older imports without frame-rate metadata retain the chosen frame rate, which can be set manually.

Supported imports: MP4, MOV, MKV, WebM, AVI, M4V; PNG, JPG, WebP; MP3, WAV, M4A, OGG, FLAC, AAC. Maximum file size: 2 GB. SVG demo assets are generated by the app; user-supplied SVG is intentionally outside the import format list.

| Shortcut | Action |
| --- | --- |
| Space | Play / pause |
| Left / Right | Step one frame |
| Shift + Left / Right | Step one second |
| S | Split the selected clip at the playhead |
| C | Cut tool: click a clip to split it there |
| V | Selection tool: move clips or trim their edges |
| N | Toggle snapping |
| Ctrl + C / V / D | Copy / paste at playhead / duplicate selected clip |
| Delete / Backspace | Remove selected clip |
| Ctrl + Z | Undo |
| Ctrl + Shift + Z / Ctrl + Y | Redo |
| Escape | Clear selection and return to the selection tool |

## Asset Studio

Open **Presets** to create and reuse animated titles, lower thirds, backgrounds, overlays, intros/outros and custom transitions. The built-in library includes editable starters and an expanded comparison/devlog pack. See the [asset pack guide](asset-pack.md) for the catalog and ready-to-use prompts. Ask the existing Codex chat on the right to generate an asset, place it, and edit the timeline in one prompt; it uses the asset and editing MCP tools in the same session, and saved results appear live in the library. Or choose **Create preset** and customize a starter, including layers/keyframes through the advanced recipe editor.

Open a card for an animated preview and text/color/motion controls, then apply it at the playhead. Drag cards onto the matching track or transitions onto incoming visual clips. Each use embeds its definition/version, so editing or deleting a library item preserves existing clips. Save variations, import/export portable JSON packages, and render isolated sample videos. New recipes require no restart or rebuild.

The library persists across project directories and restarts. Procedural assets use text/vector layers and deterministic keyframes; they do not generate photographic images, footage, music or sound effects. See [Asset Studio and the recipe format](asset-studio.md).

## Assisted editing tools

For footage without narration, click **Smart cut** on the timeline or open **Tools → Gameplay**. Select the source, describe the edit and set a target length. **Generate and apply cuts** starts/resumes the existing Codex chat, sends the request and authorizes replacing clips on your chosen video track in one undoable edit. Choose **Generate a proposal for review** to decide before applying. **Scan gameplay** is an optional visual map only; **Review in Codex** remains available to edit the prompt before sending it. Codex inspects source-frame grids and detailed sequences through MCP and makes the editorial choices. The local FFmpeg scan supplies visual changes and low-motion/dark cues. See [Gameplay cuts](gameplay-cuts.md) for sampling limits and the tools.

The speech tools use local CPU models; no additional API key is needed. The first transcription/search downloads its model from Hugging Face (about 210 MB combined with the current quantized models). Subsequent runs reuse the cache. Imported audio stays on this computer during local analysis. Jobs run one at a time in a separate process, show progress, and can be cancelled. Transcription supports video/audio sources up to two hours; shorter sources are more practical on CPU.

- **Transcript:** choose an imported source, select automatic language detection, French or English, and click **Transcribe**. Click words to seek; Shift-click to select a passage. Select a matching timeline clip to **Review cut**, then **Apply cut**. The removal closes the same frame ranges across every track and creates one undo step. Correct an individual word with the correction field and Save.
- **Captions:** select a transcribed timeline clip and choose clean, word highlight, or boxed captions. Generate editable style layers with frame-accurate word highlighting. Download SRT or VTT for all generated timeline captions. Correct words in the transcript before regenerating. Generated captions are independent timeline layers; regenerate after manually moving/trimming their source. You can convert a caption to plain text in Properties.
- **Search:** describe a moment in natural language. Multilingual embeddings rank transcribed speech passages; files without a transcript are matched by their names, explicitly labelled **Filename**. This does not inspect the imagery. Preview a source passage before appending it to the timeline.
- **First cut:** select sources, an optional topic and target duration. Review the proposed passages, preview/reorder/remove shots, and optionally add an opening title. **Append** keeps existing clips; **Replace** replaces timeline clips in one undoable operation and keeps media. Proposals retain source order and may be shorter than the target. Refresh the proposal if the timeline changed.
- **Focus:** add an arrow, frame or circle at the playhead. Adjust dimensions, position, rotation, stroke and color in Properties. Select a visual clip to add a smooth focus zoom, then set its focal point, magnification and timing. Preview and export share the same frame-based rendering.

Speech recognition uses [Whisper base with word timestamps](https://huggingface.co/onnx-community/whisper-base_timestamped); semantic search uses [multilingual MiniLM](https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2), through Transformers.js 3.8.1. Recognition can make mistakes, especially on noisy/game audio; review the transcript before cutting. A first cut selects timestamped passages, not a generated narrative or visual understanding of the footage.

Transcripts are saved separately in `data/transcripts/`. Corrections have their own revision checks and are outside timeline undo history. Model files and the disposable semantic index live in the model cache. Running analysis jobs are not resumed after a service restart. To install on a Linux machine with an incompatible globally installed libvips, set `SHARP_IGNORE_GLOBAL_LIBVIPS=1` in the environment during `npm install` so Sharp uses its supplied binary.

## Talk to Codex inside the editor

Install Codex CLI and sign in with `codex login` once. Open the **Codex AI** panel and click **Start Codex**. Type an editing request into the prompt box and click **Send** (or press Enter). Replies stream directly into the panel; the expand button opens a larger conversation view. Tool calls appear in the conversation, including automatically approved calls. **Activity** also shows actual tool calls, command output, file changes, and the shared timeline edit history. Model, reasoning and speed controls use the options returned by the spawned CLI and update its current thread while idle.

The integration launches the installed CLI's Codex App Server with your configured model and authentication. Framecraft does not require a separate OpenAI API key. It creates a dedicated chat for this editor and passes the Framecraft MCP configuration to that process automatically. It runs with a workspace write sandbox and asks for approvals in the chat. **Allow once**, **Decline**, and question forms respond to the real Codex request. **Stop response** interrupts generation; edits already applied stay in the undo history. This is an embedded chat client; external terminal conversations remain separate.

Enable **Auto-allow** to accept supported pending and incoming approvals automatically while checked. Questions requiring an answer remain manual. Unchecking restores manual approvals for subsequent requests; permission grants are limited to the current turn. The switch resets when the editor service restarts.

Browser reloads reconnect to the current conversation. After restarting the editor service, click **Start Codex** to resume the last thread. The thread ID is kept in `data/codex-session.json`; Codex stores its conversation history in its own normal storage. Use **+ / New Codex chat** to begin another conversation. A missing or unavailable saved thread can also be replaced using this button.

Use the microphone button to dictate in English or French. Stop dictation, review the text, then send it. **Local** recognition records up to two minutes using MediaRecorder and transcribes with the local Whisper worker; it supports Firefox and does not require the browser's speech-recognition service. Models download on first use and recordings are removed after processing. The optional **Browser** mode uses the [Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition) where available; some implementations send microphone audio to an online service. Microphone access requires localhost or HTTPS. Permission failures show an explanation; typing remains available. There is no automatic voice submission or spoken reply playback.

The process boundary uses Node argument arrays on Windows and Linux. Windows npm shims resolve to their JS entry point, so paths containing spaces do not pass through a command shell. No separate terminal emulator or API key is required for the embedded chat. If the app cannot find Codex, set `FRAMECRAFT_CODEX_PATH` and restart the editor service.

## Connect an external Codex CLI

The **Codex → Connection** tab includes optional manual setup for an external terminal. With the editor service running, register the MCP bridge once:

```sh
codex mcp add framecraft -- node "/absolute/path/to/Framecraft/scripts/mcp.mjs"
```

Windows example:

```powershell
codex mcp add framecraft -- node "C:\Projects\Framecraft\scripts\mcp.mjs"
```

Run the registration command at your **terminal shell prompt**, then run `codex` in that folder. Keep `npm start` (or `npm run dev` in development) running in a separate terminal. Registration saves the settings; opening Codex starts the connection. If Codex was already open when you registered the tool or updated the bridge, exit it and launch it again. Inside Codex, use `/mcp` to check tools and startup errors, then send a prompt such as “Use Framecraft’s get_project tool and tell me what is on the timeline.” Registration alone does not make timeline edits.

The launcher resolves its TypeScript loader from the installation directory, so the bridge itself does not depend on the caller's working directory. It uses the normal Codex CLI authentication; this app does not introduce a separate OpenAI API integration. The editor and rendering run locally; prompts and frames inspected by Codex are processed according to your Codex service configuration.

See the [complete MCP tool reference](feature-overview.md#mcp-tools) for editing, media, asset generation, visual analysis, transcription and export tools.

Example prompt:

> Use Framecraft to read my timeline. Shorten the opening shot to four seconds, add “Movement system update” as a title, and use a diagonal wipe into the next clip. Render frames before and during the wipe, inspect them, and adjust the text if it obscures the action.

The Codex panel reports actual initialized MCP sessions, including idle sessions. Each bridge sends a heartbeat every 10 seconds; closed sessions disconnect immediately and unresponsive ones expire after 35 seconds. Tool activity is tracked separately. A bridge reconnects automatically when the editor service restarts. The indicator includes embedded and external sessions; merely starting a chat process does not mark the timeline tools connected. Image inspection shows composition and sampled motion; final pacing and audio should also be checked through playback.

## Development and troubleshooting

Use `npm run dev` for frontend hot reload. Vite serves port **5173** and proxies the service on **4318**; keep the default service port in this mode unless you update `vite.config.ts`. Production uses `npm run build` followed by `npm start`, with both UI and API on **4318**. Stop the terminal process before starting another server on the same port. Rebuild after frontend changes; restart after changing server code or schemas.

- **Codex is not connected:** registration only saves configuration. Start the embedded session or an external `codex` session while Framecraft is running. Check `/mcp` in the external CLI. A running editor and an initialized bridge are both needed.
- **The source looks sharper:** select full-quality preview and compare at 100% zoom. Check the project and export dimensions separately; **Match source** avoids accidental downscaling. Performance playback copies never become export inputs. A full-resolution compatibility copy is still compressed.
- **First playback takes time:** unsupported browser formats need a one-time compatibility copy. Full-quality preparation preserves source dimensions and therefore costs more CPU/disk than the explicit Performance option.
- **Encoding is slow:** GPU encoding accelerates compression, but source decoding and complex composition can still be bottlenecks. Keep enough free space in the render cache. Worker concurrency and frame buffers are bounded according to available memory and image dimensions; high-resolution composition still needs memory.
- **An encoder is unavailable:** check the driver, device permissions and FFmpeg build, or select CPU. Explicit AMD/NVIDIA selection reports an error when that backend is unavailable; Automatic can fall back to CPU.
- **Microphone does not start:** use localhost or HTTPS and grant microphone permission. Choose Local recognition in Firefox; the first use downloads a speech model.

Manual edits, imported media, presets and completed exports are local. Codex prompts and inspected images use your configured Codex service and its normal usage allowance. Optional browser speech recognition may use the browser vendor's service; Local dictation processes audio on the editor host.

For contributor setup and focused checks, see [CONTRIBUTING](../CONTRIBUTING.md).

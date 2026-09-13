# GPU export pipeline

## Incremental migration: compatibility renderer retained

The restored Remotion implementation remains the default compatible renderer. It is isolated behind `server/services/rendering/engine-contract.ts`; HTTP, MCP and project editing keep their interfaces. A first **experimental native GPU export engine** is now implemented for full-canvas video cuts and scaling. Its four hardware combinations still need physical validation; this is not a complete GPU editor or compositor yet.

### Native Vulkan composition (second increment)

Run `npm run setup:gpu` once (included in the Windows/Linux x64 installer) to prepare the checksum-verified FFmpeg 8.1 runtime in `.runtime/vulkan`. The Vulkan adapter prefers it; other renderers keep their binaries. `FRAMECRAFT_VULKAN_FFMPEG` overrides this choice. This avoids FFmpeg 9's internally synchronized queues, which libplacebo API versions below 365 reject during device import. See [FFmpeg's queue import guard](https://github.com/FFmpeg/FFmpeg/blob/master/libavfilter/vf_libplacebo.c). Installation only downloads/extracts binaries and reads their version; it does not initialize a GPU.

**Export → Render engine → Native GPU · Vulkan composition**, or MCP `settings.renderer="native-vulkan"`, supports simultaneous videos and static images, crop/position/scaling, fit modes, backgrounds and separate audio tracks. GPU shaders apply static opacity and the same clip-then-project exposure, contrast, saturation, temperature, tint, gamma and hue calculations as preview. The video path remains **Vulkan decode → composition → Vulkan encode**, without browser, frame downloads or CPU video fallback. Static PNG/JPEG/WebP/AVIF images are decoded to RGBA once per job on CPU, uploaded once per GPU batch and looped in GPU memory. Audio and I/O remain CPU work. Position/scale/opacity keyframes (including hold and custom Bézier easing), zoom, fade, slide, diagonal and pixel transitions now execute in GPU shaders. The previous clip is held on GPU for same-track transitions; its audio stops at the original boundary. Saved recipes now render rect/ellipse/text layers, rounded corners, strokes, layer rotation, animated parameters and custom fade/wipe/iris/blocks reveals on GPU. Direct timeline titles support static/rise/typewriter animation, text-box cropping, clean/highlight/boxed captions and GPU shadow coverage. Text shaping and export-visible prefix geometry are prepared once within the font geometry budget; pixels and timed highlighting stay on GPU. Clip rotation (including keyframes) and rectangle/ellipse/polygon masks with inversion and Gaussian feather now run in the native shader. Mask coordinates follow the original element box, including dynamic text boxes. Native polygons are limited to 128 vertices to bound per-pixel work; editing and the compatible renderer retain larger polygons. Manually overlapping clips on the same video track remain blocked. The bounded `--effects` test passed on RX 9070 XT/Linux with a transparent PNG, video/image opacity and clip/global grading compared against an independent pixel reference.

Requires FFmpeg with `color_vulkan`, multi-input `libplacebo`, the selected `h264_vulkan`/`hevc_vulkan`/`av1_vulkan` encoder, and matching Vulkan Video driver support. VA-API/AMF/NVENC availability alone is insufficient. **AMD/Linux RX 9070 XT passed the bounded 30-frame H.264 composition check on 2026-09-12**, including crop, layer endings, background and audio duration. Other resolutions/codecs and AMD/Windows, NVIDIA/Windows and NVIDIA/Linux remain unvalidated. `FRAMECRAFT_VULKAN_FFMPEG` selects a custom build; `FRAMECRAFT_VULKAN_DEVICE` optionally selects a device-name substring containing the chosen vendor, e.g. `AMD Radeon RX 9070 XT`.

Adjacent visually continuous spans are coalesced independently of audio boundaries. One GPU process handles up to four remaining scenes (`FRAMECRAFT_GPU_BATCH_SPANS`, 1–8), sharing image uploads and static image shaders within that batch. Admission sums every branch’s allocation estimate against `FRAMECRAFT_GPU_BUDGET_MIB` (default 1024 MiB), splitting groups before opening a device. Filter queues are bounded; this is not measured VRAM or a hard driver cap. The 30-frame effects check passed on RX 9070 XT/Linux with three scenes in one GPU process; this is correctness evidence, not a throughput benchmark. Add `--composition` to the bounded hardware command below to check two videos, crop, layer endings and a background gap. Without `--run`, it only prints the plan.

The bounded `--animation --run` check passed on RX 9070 XT/Linux: 30 frames, all four standard transitions, held outgoing frames, animated image position/scale/opacity, custom Bézier/hold easing and zoom. GPU shaders follow the shared preview clocks and easing parameters; the adapter rejects shader failures even if FFmpeg would continue with the effect disabled. Shader bindings follow [libplacebo’s custom shader contract](https://libplacebo.org/custom-shaders/).

Text shaping uses Fontkit and the existing Arial/Helvetica/sans-serif font stack (Arial on Windows, fontconfig/Liberation Sans on Linux). CPU preparation emits bounded vector geometry; glyph coverage is rasterized on GPU, with no CPU text atlas or browser rendering. Missing glyphs produce an explicit error. A 30-frame `--artwork --run` check passed on RX 9070 XT/Linux against software browser references, including saved assets, vector text, a custom iris transition and a direct timeline title. Other hardware targets remain unvalidated.

### Try the first native increment

In **Export → Quality & format → Render engine**, select **Native GPU · cuts & scaling (experimental)**, then explicitly select AMD or NVIDIA. Existing projects default to **Compatible · all effects**. The native option requires H.264, H.265 or AV1 output and video filling the canvas throughout the export range. It supports sequential/reordered cuts (including cuts on different tracks when they do not overlap), output resizing at the same canvas aspect ratio, frame-rate scheduling, source audio, mute, master/clip volume and audio fades/envelopes.

Sources must currently be progressive, square-pixel, 8-bit 4:2:0, explicitly tagged limited-range BT.709 SDR, using a hardware-decodable H.264/HEVC/VP9/AV1 profile. Source headers are checked without decoding images. Untagged sources, HDR, grading, opacity, crop/position/borders, gaps, overlapping layers, text/graphic recipes, transitions and separate audio tracks produce explicit blockers. Nothing is silently dropped or converted to software rendering. Hidden layers and disabled/muted extra audio do not block export. Recipes, effects and existing preview continue to work in the compatible renderer.

MCP uses the same settings: call `get_render_plan` with `settings.renderer="native-gpu"` and `settings.encoder="amd"` or `"nvidia"`, plus output dimensions/fps. Pass those settings to `export_video`. The plan is structural analysis (`verification="not-run"`), not hardware validation. Unsupported timelines are rejected before queueing. Runtime failures identify the cut and adapter, with no CPU/browser fallback or second hardware attempt.

Native export does not start Chromium. Its FFmpeg adapters enforce hardware surfaces before the scaler and at the encoder, disable implicit format-conversion filters, and contain no `hwupload`/`hwdownload`. AMD/Linux stays within VA-API; NVIDIA stays within CUDA/NVENC; AMD/Windows derives AMF from the same AMD-selected D3D11 device. AMF scaling emits AMF GPU surfaces. There is no cross-device or VA-API/Vulkan interoperability experiment here.

Only one cut is encoded at a time. NVIDIA lookahead/B-frames are disabled and encoder surfaces are limited; VA-API uses a small asynchronous queue. Decoder extra surfaces and filter concurrency are bounded. Required codec reference surfaces and driver allocations still vary, so this is **not a hard VRAM/RSS cap**. Video scratch files contain encoded packets, not a raw/PNG frame sequence. Source audio is processed separately with video decoding disabled; the final video is packet-copied into the container. Audio processing, demuxing, muxing and file I/O use CPU. Completed output is published after muxing; each worker's scratch files are cleaned independently.

Preview still uses the existing Remotion composition. This native subset uses the same project frame-rate conversion, placement calculation and audio-envelope clock. A shared GPU compositor for preview/export and programmable GPU assets remains subsequent engine work.

### Bounded hardware check

`npm run test:gpu:native -- --vendor amd` (or `nvidia`) prints the planned check **without initializing hardware**. To execute deliberately on a test machine:

```text
npm run test:gpu:native -- --vendor amd --run --report native-amd-result.json
npm run test:gpu:native -- --vendor nvidia --run --report native-nvidia-result.json
```

Run only the command matching the intended GPU. Both commands work on Windows and Linux. They create isolated temporary media, export two reordered cuts (30 frames total, 640×360 source → 320×180 output), and verify frame count, audio duration and two image samples. One worker, no GPU retry, and a 60-second subprocess deadline. CPU generation/readback is confined to this explicit correctness harness and is not in the native export pipeline. Temporary media is removed; an optional JSON report records platform, adapter, result and scope. No benchmark, full-resolution export or hardware check runs in ordinary tests. Process deadlines cannot recover a faulty driver or guarantee that a desktop will never freeze.

Requires FFmpeg and ffprobe; `FFMPEG_PATH`/`FFPROBE_PATH` select executables. AMD/Windows requires a build with D3D11VA, the AMF hardware device, `vpp_amf` and AMF encoders. An encoder-only AMF build is insufficient. AMD/Linux requires `scale_vaapi` and the selected AMD DRM node; NVIDIA requires CUDA, `scale_cuda` and NVENC. Installed interfaces alone are not proof of hardware compatibility.

Export settings include a collapsed **Processing plan**. The same read-only analysis is available through `POST /api/render/plan` and MCP `get_render_plan`, with optional export settings and project revision. It names the clips and effects that select the complete composition and describes CPU, browser and hardware-dependent stages. Both planning and rendering use `shared/render-eligibility.ts`; planning does not render frames or scan every frame of a long timeline. Source metadata and driver checks at export can still change the final route. The report is not a GPU benchmark.

`get_export_encoders` and `/api/render/encoders` now read executable listings and device metadata only. `verification: "not-run"` is explicit: an `available` candidate means FFmpeg lists an encoder, not that a physical GPU or its driver has been verified. Synthetic encoder/source/filter checks remain restricted to actual export requests in the compatibility renderer.

Decoded-frame caches are limited to 256 MiB and scale down with available RAM. Browser workers default to at most four, at most two for GPU exports, and are reduced by the available-memory estimate; decoder thread counts follow the same limit. `FRAMECRAFT_RENDER_WORKERS=1` permits a smaller worker cap. The worker allocation estimate reserves at most 25% of currently available memory, capped at 2 GiB, including the cache. These controls bound concurrency and cache allocation, **not total process RSS or driver VRAM**; an individual high-resolution frame still needs its own memory. Native GPU pools and explicit VRAM accounting belong to the subsequent engine work.

Ordinary Playwright runs disable browser hardware acceleration and set `FRAMECRAFT_DISABLE_GPU=1` in the isolated editor and render workers. This also blocks explicit GPU requests and prevents automatic encoding probes; frame renders use software GL on Windows and Linux. Only the separately invoked hardware test opts in. Production export settings retain their existing behavior.

Next increments: validate the cuts and Vulkan composition paths on all four combinations, then GPU asset recipes/custom shaders, remaining effects, and shared native preview/export. Each requires separate hardware validation before being described as supported.

### Required platform and GPU matrix

Windows and Linux, each with AMD and NVIDIA GPUs, are equal targets from the first native increment. The order in which hardware is available for development does not change the supported-platform goal.

| Platform | GPU vendor | Implemented native path | Physical validation of this increment |
| --- | --- | --- | --- |
| Windows | AMD | D3D11VA → AMF `vpp_amf` → AMF encoding | Pending |
| Windows | NVIDIA | CUDA → `scale_cuda` → NVENC | Pending |
| Linux | AMD | VA-API → `scale_vaapi` → VA-API encoding | Pending |
| Linux | NVIDIA | CUDA → `scale_cuda` → NVENC | Pending |

All four targets share project semantics, MCP operations, reusable asset definitions, effect parameters and frame-based animation. Device-specific decoding, surface sharing, rendering and encoding belong behind native adapters. Each increment records build/functional checks separately from actual hardware checks for all four targets. Existing Windows/Linux CI is a software check, not validation of AMD or NVIDIA GPU execution. Codec and driver limitations must identify the affected combination and stage; unsupported native operations must not silently become CPU processing.

The adapter contracts, frame planning, failure behavior and safe CPU integration are covered by software tests. Those tests do not validate GPU throughput or hardware pixels. The matrix describes the new engine work. Existing compatibility-renderer capabilities and observations are documented below; they do not establish full native GPU support.

## Compatibility renderer

Framecraft selects video encoding separately from decoding and effect rendering. A working encoder does not prove that every filter is supported by the same driver. The export progress reports these stages separately.

| Stage | Implementation | CPU work that remains |
| --- | --- | --- |
| AMD Linux encoding | VA-API on the selected DRM render node | Demuxing, audio and output writes |
| NVIDIA encoding | NVENC on Windows/Linux | Demuxing, audio and output writes |
| AMD Windows encoding | AMF | Demuxing, audio and output writes |
| Source decoding | VA-API, CUDA or D3D11VA when the source probe succeeds | Unsupported sources use sequential software decoding |
| Eligible plain cuts | VA-API/CUDA/D3D11 frames go directly to their encoder after a source/encoder probe, without a CPU frame download/upload | Timestamp scheduling and audio |
| Eligible NVIDIA resize, position and artwork composition | CUDA decode → `scale_cuda` / `pad_cuda` → `overlay_cuda` → NVENC; footage stays in GPU memory | Sparse artwork PNG preparation/conversion/upload, timestamp scheduling and audio |
| Other static crop, position and scale | Native FFmpeg filters, followed by the selected encoder | Geometry/filter work; no full-video Chromium PNG sequence |
| Text, animations, masks, transitions, custom artwork and complex compositions | The shared Remotion composition with hardware OpenGL/ANGLE when Chromium confirms GPU compositing and rasterization | JavaScript, some browser effects, frame extraction/transfer and audio |

Plain-cut eligibility requires matching dimensions/frame rate, a source range that does not need an EOF hold, explicit limited-range BT.709 metadata, and no geometry, grading or artwork. Changing pixels routes through the appropriate filter/compositor. Unsupported native effects retain the full composition rather than disappearing.

The CUDA processing path accepts uncropped footage with the same limited-range BT.709 metadata, no grading/base opacity changes, and even output dimensions and positions. It supports output resizing, letterboxing, contained translation/scaling, frame-rate conversion and sparse alpha artwork from the shared composition. Source crops, odd chroma positions, EOF holds, unknown color metadata and unsupported filters retain the existing native CPU path. This does not implement general GPU multitrack video composition or GPU color grading.

Filter listings are only a first check. A tiny synthetic pixel check compares the actual CUDA padding/overlay graph with a CPU reference; builds that change geometry retain CPU filters. Each eligible cut then probes up to three source frames through the actual GPU filters and encoder and verifies the encoded dimensions and pixel aspect ratio. Failed probes retain GPU encoding with CPU filtering, with a warning. A runtime GPU failure retries only the unfinished part using CPU decoding/filtering and the same GPU encoder. Cancellation never triggers a retry. CUDA output surfaces are cropped to their visible region on the GPU before encoding so allocation alignment cannot change the export dimensions or artwork position. This allocation correction does not imply support for general source crops: the installed build failed a separate source-crop pixel check, so those retain native CPU processing.

Canvas gaps, including artwork extending past the last video, remain in the native plan as background segments. Static crop uses the same contain → inset → scale → translation geometry as the preview; it hides pixels instead of stretching the remaining region. Animated geometry continues to use the shared frame-based composition.

## Browser GPU selection

Linux retains ANGLE/EGL with a selected GPU encoder and its software default otherwise. Windows uses ANGLE independently of video encoding, including still images and CPU-encoded formats such as ProRes. If the hardware browser cannot start, software rendering is used and reported. For AMD Linux, the export worker resolves the selected VA-API render node to its PCI address and passes Mesa's documented `DRI_PRIME=pci-…` selector to the browser, unless the user already set `DRI_PRIME`. This avoids choosing integrated graphics for effects while the discrete card encodes.

One browser is reused for each export, with at most two concurrent GPU rendering pages and the existing RAM-based limits. Chromium's `SystemInfo.getInfo` must report hardware compositing and rasterization and a non-software renderer before progress labels it GPU rendering. Software rendering is reported explicitly. Plain native exports do not launch Chromium at all.

## VA-API processing and driver limits

Framecraft retains VA-API decode and encode support. It does **not** automatically enable `overlay_vaapi`, `pad_vaapi`, or Vulkan/VA-API interoperability based solely on `ffmpeg -filters` listings.

On the development RX 9070 XT / Mesa installation, an interoperability experiment reported a GPU context loss/hard recovery, and `overlay_vaapi` explicitly reported that the driver did not support overlay. Those paths were not added to production. Hardware ANGLE/EGL separately identified the RX 9070 XT and enabled GPU compositing/rasterization. This is a capability observation, not a guarantee against future driver faults or an end-to-end export speed measurement.

In the compatibility renderer, geometry/alpha composition outside the eligible CUDA path remains CPU work. The separate Vulkan engine implements multitrack video composition, transform animations and standard transitions; arbitrary effects and full GPU filter coverage remain unfinished. GPU encoding and hardware browser rendering do not make the entire application CPU-free.

## References

- [FFmpeg hardware devices, decoding and frame formats](https://ffmpeg.org/ffmpeg.html)
- [FFmpeg libplacebo composition and placement](https://ffmpeg.org/ffmpeg-filters.html#libplacebo)
- [FFmpeg VA-API overlay driver capability check](https://ffmpeg.org/pipermail/ffmpeg-cvslog/2022-January/130655.html)
- [Remotion GPU acceleration and its limits](https://www.remotion.dev/docs/gpu)
- [Mesa device selection with DRI_PRIME](https://docs.mesa3d.org/envvars.html)
- [FFmpeg CUDA filters](https://ffmpeg.org/ffmpeg-filters.html#CUDA-Video-Filters)
- [NVIDIA's FFmpeg hardware decoding/scaling/encoding guide](https://docs.nvidia.com/video-technologies/video-codec-sdk/13.0/ffmpeg-with-nvidia-gpu/index.html)
- [AMD's FFmpeg/AMF device sharing and video processing guide](https://github.com/GPUOpen-LibrariesAndSDKs/AMF/wiki/FFmpeg-and-AMF-HW-Acceleration)
- [FFmpeg AMF hardware-surface implementation](https://ffmpeg.org/doxygen/8.0/vf__amf__common_8c_source.html)

CPU exports and image comparisons check crop, scaling, placement, background gaps and frame counts without repeating the Linux driver experiments that froze the desktop. Unit tests cover GPU eligibility, hardware command negotiation, software-browser detection, probe/runtime failure recovery and cancellation.

`npm run test:e2e:gpu` explicitly requires NVIDIA CUDA/NVENC and the CUDA filters above. It exports resized, positioned footage with sparse semitransparent artwork and source cuts, asserts actual GPU-path progress (CPU fallback fails the test), and compares output frames and artwork regions with shared-composition stills while checking frame count and audio duration. This passed on Windows with an RTX 5070 Laptop GPU, driver 32.0.16.1088 and FFmpeg 9.0. This is correctness validation, not a throughput benchmark. AMD direct-surface negotiation and Linux browser/VA-API routing are covered by unit tests; AMD hardware and Linux CUDA processing still need hardware validation. The test launcher uses Node executable argument arrays on both platforms.


Nested sequences use recursive RGBA Vulkan composition before parent transforms, masks, grading and opacity; only the final scene is encoded. No video intermediate or GPU download is introduced. Child audio mixes retain stacked volume envelopes. Implementation is shared across AMD/Windows, NVIDIA/Windows, AMD/Linux and NVIDIA/Linux. Hardware validation of **nested composition** is pending on each of these four targets; structural graph tests and software-render comparisons do not validate drivers.

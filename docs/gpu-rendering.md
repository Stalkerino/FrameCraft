# GPU export pipeline

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

Geometry/alpha composition outside the eligible CUDA path remains CPU work. Full GPU filter coverage, including general multitrack composition and arbitrary effects, is not implemented. GPU encoding and hardware browser rendering do not make the entire application CPU-free.

## References

- [FFmpeg hardware devices, decoding and frame formats](https://ffmpeg.org/ffmpeg.html)
- [FFmpeg VA-API overlay driver capability check](https://ffmpeg.org/pipermail/ffmpeg-cvslog/2022-January/130655.html)
- [Remotion GPU acceleration and its limits](https://www.remotion.dev/docs/gpu)
- [Mesa device selection with DRI_PRIME](https://docs.mesa3d.org/envvars.html)
- [FFmpeg CUDA filters](https://ffmpeg.org/ffmpeg-filters.html#CUDA-Video-Filters)

CPU exports and image comparisons check crop, scaling, placement, background gaps and frame counts without repeating the Linux driver experiments that froze the desktop. Unit tests cover GPU eligibility, hardware command negotiation, software-browser detection, probe/runtime failure recovery and cancellation.

`npm run test:e2e:gpu` explicitly requires NVIDIA CUDA/NVENC and the CUDA filters above. It exports resized, positioned footage with sparse semitransparent artwork and source cuts, asserts actual GPU-path progress (CPU fallback fails the test), and compares output frames and artwork regions with shared-composition stills while checking frame count and audio duration. This passed on Windows with an RTX 5070 Laptop GPU, driver 32.0.16.1088 and FFmpeg 9.0. This is correctness validation, not a throughput benchmark. AMD direct-surface negotiation and Linux browser/VA-API routing are covered by unit tests; AMD hardware and Linux CUDA processing still need hardware validation. The test launcher uses Node executable argument arrays on both platforms.

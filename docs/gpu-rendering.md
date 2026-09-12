# GPU export pipeline

Framecraft selects video encoding separately from decoding and effect rendering. A working encoder does not prove that every filter is supported by the same driver. The export progress reports these stages separately.

| Stage | Implementation | CPU work that remains |
| --- | --- | --- |
| AMD Linux encoding | VA-API on the selected DRM render node | Demuxing, audio and output writes |
| NVIDIA encoding | NVENC on Windows/Linux | Demuxing, audio and output writes |
| AMD Windows encoding | AMF | Demuxing, audio and output writes |
| Source decoding | VA-API, CUDA or D3D11VA when the source probe succeeds | Unsupported sources use sequential software decoding |
| Eligible plain cuts | VA-API/CUDA frames go directly to their encoder, without a CPU frame download/upload | Timestamp scheduling and audio |
| Static crop, position and scale | Native FFmpeg filters, followed by the selected encoder | Geometry/filter work; no full-video Chromium PNG sequence |
| Text, animations, masks, transitions, custom artwork and complex compositions | The shared Remotion composition with hardware OpenGL/ANGLE when Chromium confirms GPU compositing and rasterization | JavaScript, some browser effects, frame extraction/transfer and audio |

Plain-cut eligibility requires matching dimensions/frame rate, a source range that does not need an EOF hold, explicit limited-range BT.709 metadata, and no geometry, grading or artwork. Changing pixels routes through the appropriate filter/compositor. Unsupported native effects retain the full composition rather than disappearing.

Canvas gaps, including artwork extending past the last video, remain in the native plan as background segments. Static crop uses the same contain → inset → scale → translation geometry as the preview; it hides pixels instead of stretching the remaining region. Animated geometry continues to use the shared frame-based composition.

## Browser GPU selection

Linux uses ANGLE/EGL; Windows uses ANGLE. For AMD Linux, the export worker resolves the selected VA-API render node to its PCI address and passes Mesa's documented `DRI_PRIME=pci-…` selector to the browser, unless the user already set `DRI_PRIME`. This avoids choosing integrated graphics for effects while the discrete card encodes.

One browser is reused for each export, with at most two concurrent GPU rendering pages and the existing RAM-based limits. Chromium's `SystemInfo.getInfo` must report hardware compositing and rasterization and a non-software renderer before progress labels it GPU rendering. Software rendering is reported explicitly. Plain native exports do not launch Chromium at all.

## VA-API processing and driver limits

Framecraft retains VA-API decode and encode support. It does **not** automatically enable `overlay_vaapi`, `pad_vaapi`, or Vulkan/VA-API interoperability based solely on `ffmpeg -filters` listings.

On the development RX 9070 XT / Mesa installation, an interoperability experiment reported a GPU context loss/hard recovery, and `overlay_vaapi` explicitly reported that the driver did not support overlay. Those paths were not added to production. Hardware ANGLE/EGL separately identified the RX 9070 XT and enabled GPU compositing/rasterization. This is a capability observation, not a guarantee against future driver faults or an end-to-end export speed measurement.

Current geometry/alpha composition through FFmpeg remains CPU work. Full GPU filter coverage, including general multitrack composition and arbitrary effects, is not implemented by this change. GPU encoding and hardware browser rendering do not make the entire application CPU-free.

## References

- [FFmpeg hardware devices, decoding and frame formats](https://ffmpeg.org/ffmpeg.html)
- [FFmpeg VA-API overlay driver capability check](https://ffmpeg.org/pipermail/ffmpeg-cvslog/2022-January/130655.html)
- [Remotion GPU acceleration and its limits](https://www.remotion.dev/docs/gpu)
- [Mesa device selection with DRI_PRIME](https://docs.mesa3d.org/envvars.html)

Validation for this change uses CPU exports and image comparisons to check crop, scaling, placement, background gaps and frame counts without repeating the driver experiments that froze the desktop. Hardware command negotiation and software-renderer detection are covered by unit tests. Full AMD/NVIDIA export performance still requires hardware validation.

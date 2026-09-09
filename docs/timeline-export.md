# Export an editable timeline

Click **Export timeline** beside **Export video** in the top bar, then **Prepare XML export → Download XML**. In Premiere, use **File → Import** and select the `.xml` file. This uses Final Cut Pro 7 XML / XMEML 5, not modern Final Cut Pro `.fcpxml` or a native Premiere `.prproj` file. Adobe documents the [FCP7 XML import workflow](https://helpx.adobe.com/ee/premiere-pro/how-to/migrate-from-final-cut-pro.html).

The exported artifacts describe the project revision captured when the dialog opened. Export does not change the timeline or its undo history. If the timeline changed before preparation starts, reopen the dialog.

## Files you receive

- **XML:** editable source clips, cuts, gaps, track placement, source trims, linked first-stream audio channels, disabled tracks, static opacity and audio gain.
- **Compatibility report:** omitted effects/artwork, XML track-to-Framecraft track mapping, and the media filenames and references to use for relinking.
- **Full Framecraft backup:** the original project JSON, including all recipes and settings. Other editors do not import this backup directly.

Overlapping clips on one Framecraft track are assigned additional XML tracks to retain their timing and stacking. Track names are recorded in the report; imported track labels/grouping depend on the destination editor. Audio channels are explicitly referenced and linked to their source video; review channel routing after import.

## Moving between computers

XML contains references, not video/audio files. By default they point at the current project-owned media on the Framecraft host. On another computer:

1. Copy the referenced files into a folder, keeping the filenames shown in the dialog's **Referenced media files** list. The list also provides individual downloads. Generated speed edits, processed audio and SFX must be copied too.
2. Optionally enter that folder under **Media location on the destination computer** before preparing XML, for example `D:\Framecraft\media`, `\\server\share\media`, or `/home/me/media`. This rewrites references only; it does not copy files or access that folder.
3. Use Premiere's **Link Media** when prompted. Select the copied media files, not the Framecraft preview proxies.

The export does not transcode sources or bundle them into an archive. Destination codec support may require converting unsupported media separately.

## What requires review

Custom titles, captions, annotations, procedural graphics and unsupported image types become named sequence markers with timing and text. They are not silently replaced with native titles. Rebuild or render those elements separately.

Crop, masks, position/scale/rotation, transform keyframes, zoom, grading, entrance transitions and audio fades/automation are reported for rebuilding. Source dimensions differing from the sequence may require **Set to Frame Size** to reproduce Framecraft's contain fit. A colored project background is not exported. This is an editorial handoff, not a guaranteed visual match of a finished render.

Speed ramps/freezes use their saved retimed media, and EQ/reverb use saved processed audio. Their audible/visible processing remains baked into those media files; the original processing curves are retained in the Framecraft backup, not translated into native Premiere effect controls.

Integer and standard NTSC sequence/source rates are supported. NTSC display values such as 29.97 are encoded as 30 × 1000/1001, preserving timeline frame numbers. Mixed-rate source trims round to source-frame boundaries. Unrepresentable custom rates produce an actionable error; variable-rate sources are flagged for alignment review.

XML serialization and the UI/MCP download workflow are covered by focused automated checks. Premiere itself is not installed in the development environment, so importing in Premiere and other commercial editors remains a destination-side check. The format follows [Apple's XMEML reference](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/FinalCutPro_XML/Elements/Elements.html).

## MCP

Call `export_timeline` with the current `revision`, optional `format: "premiere-xml"`, and optional `mediaRoot`. It returns `xmlUrl`, `reportUrl`, `projectUrl`, the suggested XML `filename`, and the report. No encoding job is required; source metadata is probed locally and cached.

Example prompt: “Export this reviewed gameplay cut as an editable Premiere XML. I will copy the media to D:\Framecraft\media. Tell me which effects need rebuilding.”

# Speed changes, ramps and freeze holds

Select a video or audio clip and open **Properties → Speed & timing**. Choose a constant speed or build a ramp, decide how to handle audio, then **Apply speed change**. Framecraft prepares a retimed media copy and uses that same file for preview and export.

Original media and the editable recipe remain in the project. Progress and cancellation reflect the actual local FFmpeg job. The completed replacement is one undo step.

## Ctrl-drag the end of a video

Hold **Ctrl** and drag a video clip's **right edge**:

- Drag farther right to play the same source interval more slowly.
- Drag left to play that interval faster.
- While dragging, a badge shows the proposed duration and speed ratio relative to the current clip.
- Release to start processing. Pointer movement alone does not launch jobs.
- Press Escape or cancel the pointer gesture to discard the draft.

Dragging that edge without Ctrl still trims the source normally. The speed gesture preserves the selected source interval, including an existing ramp, within supported speed limits. It keeps the clip's start fixed; following clips retain their positions, so review any new gap or overlap afterward.

## Constant speed and ramps

**Constant speed** uses a multiplier from **0.125× to 8×**. For example, 0.5× doubles the duration of the source interval; 2× halves it, before any freeze holds are added.

**Speed ramp** exposes points with source time, speed and outgoing easing. Times are relative to the selected original source span. Points must be distinct and increasing; the inspector displays seconds and stores them as project frames. The speed before the first point is the base speed if that point begins after frame 0.

| Easing | Behavior until the next point |
| --- | --- |
| Hold speed | Keep the current speed, then change at the next point. |
| Linear ramp | Change speed linearly across the source interval. |
| Smooth ramp | Ease into and out of the speed change with smoothstep. |

After the final point, its speed continues through the remaining source. Add or remove points to revise the recipe; changes are drafted until you apply them.

## Freeze frames and audio

**Freeze holds** add output time at specified source frames. Each hold has a source position and a duration in output seconds/frames. Holds must occur before the source interval ends. Held video repeats the chosen frame; held audio is silent.

**Preserve pitch** adjusts audible sections using tempo processing. **Mute** removes the video's sound, or produces silent output for an audio-only clip. Slow video repeats available source frames; there is no optical-flow interpolation. Audio ramps use short tempo slices, so extreme changes or rapidly varying ramps can introduce audible artifacts.

## Edit again or restore the source

Applied media retains the original asset ID, source interval, frame rate and recipe. Reapplying a speed edit starts from that retained source rather than repeatedly encoding the previously generated video.

A trimmed or split retimed clip maps its visible interval back to the original source. The inspector loads the corresponding cropped recipe at the current project fps. Cropped smoothstep sections become sampled linear points at frame precision. **Reset to original speed** restores that retained source interval at 1×, with other clips left in place.

Duration changes proportionally rescale the selected clip's existing transform keyframes, motion offset, audio envelope, zoom timing and transition duration. They do not retime separate captions, labels, music or other tracks automatically. Review those related elements after changing speed, especially on an already synchronized multi-track sequence.

## MCP example

Read `get_project`, then call `apply_speed_ramp` using its revision and the target clip ID. Supply either `recipe` or `targetDurationFrames`, never both.

At 60 fps, this recipe starts at normal speed, slows toward 0.25× by source second two, returns to normal by second four, and holds the frame at source second two for half a second:

```json
{
  "revision": 42,
  "clipId": "your-video-clip-id",
  "recipe": {
    "speed": 1,
    "points": [
      {"frame": 0, "speed": 1, "easing": "smoothstep"},
      {"frame": 120, "speed": 0.25, "easing": "smoothstep"},
      {"frame": 240, "speed": 1, "easing": "hold"}
    ],
    "holds": [{"frame": 120, "duration": 30}],
    "audio": "preserve"
  }
}
```

The selected original source interval must be at least four seconds long. Speed-point `frame` and hold `frame` are **source-relative project frames**; hold `duration` is **additional output frames**. For a processed clip, use its resolved source context and frame-rate conversion rather than treating generated output-frame positions as original source positions.

To stretch the current visible source interval to exactly five seconds at 60 fps:

```json
{
  "revision": 42,
  "clipId": "your-video-clip-id",
  "targetDurationFrames": 300
}
```

`get_speed_job` returns progress, status, output duration or an error; `cancel: true` requests cancellation. `reset_clip_speed` restores normal speed for the retained source interval. Timeline revisions are checked again before committing completed work; another edit during processing can require retrying on the current project.

Example prompt:

> Slow the landing into a smooth 0.25× moment, hold the best frame for half a second, then return to normal speed. Preserve pitch, keep the original source available, and inspect the result before adjusting the surrounding cuts.

## Processing limits

Video retiming writes full-resolution H.264 with quality 16, using the saved project encoder preference or automatic GPU detection with a reported CPU fallback. The selected encoder and any warning appear with the job. CPU CRF and GPU CQ/QP values are encoder-specific; the result is a high-quality compressed copy, not lossless original media. Pitch-preserved audio processing produces intermediate PCM and uses AAC when muxed into video. Linear video ramps integrate source time; smoothstep is approximated by short linear sections. Processing runs one job at a time with bounded threads and audio batches.

Project files, source files and completed retimed media persist. Job status and queues are transient across service restarts. This feature changes source timing; it does not add motion tracking, generated in-between frames or automatic synchronization of unrelated clips.

See [crop, masks and transform keyframes](advanced-editing.md), [coordinated timeline cuts](timeline-editing.md), and [audio editing](audio-editing.md).

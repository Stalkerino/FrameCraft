# Color grading

Adjust exposure, contrast, saturation, temperature, tint, gamma and hue on video/image clips or across the project. Grading is an editable project setting: original media stays unchanged, and the same adjustments appear in preview, frame inspections and export.

## In the editor

- Select a video or image clip and open **Properties → Color grading**. Changes apply to that clip and participate in undo/redo.
- Open **Project settings → Video color grade** for a baseline across the footage, then apply the project settings.
- **Reset color grade** clears the grade at that scope. Clearing a clip's grade leaves the project baseline active.

Each clip's grade is applied first, then the project grade. Text, captions, annotations, generated graphics and the project background keep their own colors. This lets you correct individual shots before applying a common look, while preserving label and branding colors.

| Control | Meaning | Range | Neutral value |
| --- | --- | --- | --- |
| Exposure | Exposure-style brightness adjustment in EV | −4 to 4 | `0` |
| Contrast | Contrast multiplier | 0 to 3 | `1` |
| Saturation | Color intensity multiplier | 0 to 3 | `1` |
| Temperature | Cooler/warmer color balance | −1 to 1 | `0` |
| Tint | Green/magenta color balance | −1 to 1 | `0` |
| Gamma | Midtone adjustment | 0.25 to 4 | `1` |
| Hue | Hue rotation in degrees | −180 to 180 | `0` |

Temperature and tint are normalized controls from −1 to 1, not Kelvin or a camera's calibrated white-balance measurements.

## Grade a segment through Codex

`set_color_grade` can target named clips, tracks or the whole timeline. Optional timeline ranges restrict the change to their intersections with those targets. Clips crossing a boundary are split so footage outside the chosen interval retains its previous grade.

Example prompts:

> Lift the exposure of the dark gameplay section from 12–18 seconds by half a stop and reduce saturation slightly. Keep the rest of the sequence and the labels unchanged. Preview the edit plan, apply it, and inspect frames inside and outside that section.

> Give all footage a slightly warmer baseline, then reduce the exposure of the bright outdoor clips. Keep the title and comparison labels at their current colors.

> Match the two comparison recordings more closely using exposure, gamma and color balance. Use modest adjustments, inspect both sides at the same action, and show me the result.

The agent chooses settings by inspecting actual frames. These controls do not automatically perform shot matching, recover clipped highlights or infer a scene's original white balance.

## MCP scope and units

| Scope | Target |
| --- | --- |
| `"timeline"`, no ranges | Update the project-wide baseline grade. |
| `"timeline"`, with ranges | Apply a clip-level grade to video/image intersections within those timeline intervals. |
| `"clips"` | Target `clipIds`, optionally restricted by ranges. |
| `"tracks"` | Target video/image clips on `trackIds`, optionally restricted by ranges. |

Clip and track scope update the clips currently selected by that request. Track scope does not install a persistent track effect for clips added later. The project-wide grade remains active across the footage until changed or reset.

Read `get_project` first. `revision` must match the current project. All ranges use **integer project frames**, with inclusive `start` and exclusive `end`; they are not source-media timestamps. At 60 fps, frames 720–1080 correspond to timeline seconds 12–18.

Example plan for that section:

```json
{
  "revision": 42,
  "scope": "timeline",
  "ranges": [{"start": 720, "end": 1080}],
  "grade": {
    "exposure": 0.5,
    "saturation": 0.9
  },
  "apply": false
}
```

`grade` is a **partial patch**: the example changes exposure and saturation while preserving each target's other settings. It does not replace omitted controls with neutral values. `apply: false` previews the **edit plan**, without changing the project. Commit with `apply: true` and the current revision when the user has requested the adjustment, then use `render_frame` to inspect its visual result. A substantial batch is one undo step.

Use `grade: null` to clear the grade for the chosen scope. Resetting a timeline range clears the clip-level adjustments in that range; it does not remove an active project baseline. To clear that baseline, use `scope: "timeline"` with no ranges and `grade: null`.

## Timing and boundaries

Grading ranges changes appearance without closing gaps, moving clips or changing timeline duration. It is separate from `edit_timeline_ranges`, whose remove/assemble operations deliberately change sequence timing.

When a video is split for grading, each fragment retains the appropriate source, motion and audio-envelope offsets. Separate audio tracks remain at their original positions. Labels and other non-footage layers keep their existing timing and colors; caption parent references can follow the corresponding source fragment.

A range boundary inside an active incoming transition is rejected, because splitting there would change that transition's duration. Grade the complete clip, or choose a boundary after its entrance transition. This operation does not silently shorten or rebuild a transition.

## Current boundaries

These are basic SDR image adjustments rather than a calibrated color-management pipeline. There is no LUT import, scopes, color wheels, selective masks, animated grading curves, automatic shot matching or dedicated HDR/log conversion. Preview still depends on the browser's decoding, display and chosen playback source; use full-quality playback when judging detail.

Browser preview and full-compositor export use shared sRGB matrix/gamma stages. The optimized native export uses cached 33³ matrix lookup tables with tetrahedral interpolation, followed by separate per-channel gamma tables to preserve shadow detail. Opacity blends the graded pixels against the project background before artwork is added. Small interpolation and pixel-format differences mean the native path is not bit-identical to Chromium's output; neutral grading and full opacity bypass this processing.

Settings are saved with the project and follow ordinary clip edits. See the [MCP reference](feature-overview.md#mcp-tools), [timeline range editing](timeline-editing.md), and [project settings guide](getting-started.md) for related workflows.

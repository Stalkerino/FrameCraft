# Crop, masks, keyframes and retiming

Framecraft exposes crop, masks, rotation and transform keyframes as ordinary clip properties. The visual editor and Codex use the same frame-based settings, so edits participate in project history and render through the shared composition.

## Crop and masks

Select a visual clip and open **Properties → Crop** or **Mask**. Drag the geometry guide's crop bounds, mask bounds or polygon vertices, or enter precise values. Add/remove polygon vertices and adjust Invert mask or Mask feather. The program monitor shows the actual rendered edge; the inspector drawing is a geometry guide.

Crop removes margins from the element's drawing area. Left, top, right and bottom are percentages; opposite margins must total less than 100% so a visible area remains. Cropping does not automatically resize or reposition the retained picture. Use Transform to place it afterward.

Masks can be rectangles, ellipses or polygons. Rectangle/ellipse masks use a center position and width/height in percent. Polygon vertices use percent coordinates. Invert keeps the area outside the shape instead, and feather softens its edge using a canvas-pixel setting.

Crop and mask apply before the element's transform. Their coordinate space is the element's drawing box: the canvas-sized media/graphic box for footage and graphics, or the text element's own box. Letterboxing inside a media box is therefore part of the crop/mask coordinate space.

Example `edit_project` command for a circular video inset:

```json
{
  "type": "clip.update",
  "id": "your-video-clip-id",
  "patch": {
    "mask": {
      "shape": "ellipse",
      "x": 50,
      "y": 50,
      "width": 60,
      "height": 60,
      "inverted": false,
      "feather": 8
    },
    "x": 80,
    "y": 24,
    "scale": 0.35
  }
}
```

On a rectangular drawing box, equal width/height percentages describe an ellipse in pixels. Adjust their ratio if you need a geometrically circular mask. Read the clip and project dimensions, inspect the composited result, and refine the placement.

## Animated transforms

Open **Properties → Transform keyframes**, choose an animated property, and add a key at the playhead. Edit keys and outgoing easing in the list or adjust a custom Bézier curve with graph handles. Transform fields show the evaluated value at the current frame. When a property already has keys, canvas dragging or nudging updates its current key instead of changing a static value hidden behind the animation.

Keyframes animate `x`, `y`, `scale`, `rotation` and `opacity`. X/Y use percentages, scale is a multiplier, rotation uses degrees, and opacity ranges from 0 to 1. Static opacity is also available for all visible elements; the inspector presents it as a percentage.

Each property's keyframes have strictly increasing, unique integer frame positions. The first/last values hold outside the keyed interval. Supported easing is `linear`, `hold`, `ease-in`, `ease-out`, `ease-in-out`, or a custom cubic `bezier`.

An easing value belongs to the **outgoing interval** from that key to the next key. Custom Bézier curves provide `x1`, `y1`, `x2`, `y2`; X controls are restricted to 0–1, while Y controls can overshoot. The final transform value is clamped to that property's supported range.

Example at 30 fps: move from X 25% to X 75% over two seconds, while fading in during the first half-second:

```json
{
  "type": "clip.update",
  "id": "your-clip-id",
  "patch": {
    "keyframes": {
      "x": [
        {"frame": 0, "value": 25, "easing": "ease-in-out"},
        {"frame": 60, "value": 75, "easing": "linear"}
      ],
      "opacity": [
        {"frame": 0, "value": 0, "easing": "ease-out"},
        {"frame": 15, "value": 1, "easing": "linear"}
      ]
    }
  }
}
```

Before replacing a `keyframes` object, read the clip and retain any existing property arrays you want to keep. Position locks still protect X/Y edits; do not unlock a clip unless the user requested it.

## Animation timing after cuts

Keyframe positions use the clip's original animation clock. Evaluation adds `motionOffset` to the current frame relative to the clip. Splits and trims retain this offset so animations continue from the retained moment instead of restarting. Project fps changes resample key times onto the new frame grid.

For a new animation on a previously trimmed fragment, explicitly choose whether to keep that clock or start a new one with `motionOffset: 0`. Do not confuse these key positions with absolute timeline frames or source-file seconds.

`inspect_clip_animation` reports evaluated transform values at requested timeline frames. Use that alongside `render_frame` to check timing and the actual composition. This evaluates configured animation; it does not detect or track an object in footage.

## Example prompts

> Crop the capture's black margins, then place it inside a softly feathered elliptical inset. Keep the main gameplay full-frame and inspect the result.

> Animate this result card from the lower left to the center over two seconds, with an ease-in-out move and a short fade in. Keep its existing scale animation and save all edits together.

> Add a rectangular inverted mask over this overlay to reveal the video beneath it. Use a soft edge and inspect the beginning, midpoint and end.

## Speed and freeze frames

**Properties → Speed & timing** handles constant speed, editable ramps and freeze holds for video/audio clips. Ctrl-dragging a video's right edge changes duration by retiming the same source span; an ordinary drag still trims it. Processing starts on release, displays real progress and can be cancelled. The original source and recipe remain available for further edits or reset. See the [speed-ramping guide](speed-ramping.md) for frame units, audio behavior and MCP examples.

## Rendering and current boundaries

Crop, masks, rotation and animated transforms use the shared compositor. Timelines that require those features fall back from the optimized native video path where necessary; simpler eligible footage retains the faster path. More complex composition can increase export work even when GPU encoding is selected.

These tools do not provide motion tracking, automatic subject segmentation or selective color-grading masks. Current arbitrary keyframes cover the transform/opacity properties listed above; crop, mask geometry and color-grade controls are separate static settings. Existing procedural asset recipes also keep their own independent layer animations.

See [color grading](color-grading.md), [whole-sequence editing](timeline-editing.md), and the [MCP reference](feature-overview.md#mcp-tools) for related operations.

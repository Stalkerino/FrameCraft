# Editing whole sequences through MCP

Codex can cut and rearrange an existing sequence across multiple tracks with `edit_timeline_ranges`. The same time mapping applies to every included video, audio, text, caption and graphic clip, so related material moves together in one undoable edit.

This complements ordinary clip commands. Use `edit_project` for individual trims, placement, track changes and volume adjustments; use `edit_timeline_ranges` for removing or assembling sections of an already edited timeline.

## Two operations

| Operation | Result |
| --- | --- |
| `remove` | Delete the specified timeline intervals, split clips crossing their boundaries, and close the removed time on included tracks. Overlapping or adjacent intervals are merged before applying the cut. |
| `assemble` | Read intervals from the original timeline, in the supplied order, and concatenate them starting at frame 0 on included tracks. Reordering, overlapping intervals and intentional repeats are supported. Material outside the chosen intervals is omitted from those tracks. |

Omit `trackIds` to include **all tracks**, including muted or hidden tracks. Supply explicit track IDs to edit a synchronized subset. Tracks outside that subset remain at their existing times: for example, omit a background-music track if its placement should stay fixed while you rearrange gameplay and labels.

Relative positions inside each retained interval are preserved, including gaps and simultaneous clips. Clips crossing a boundary are trimmed into fragments; media source offsets advance to the retained source content. The source files themselves are unchanged.

All ranges use **integer project frames**, with an inclusive `start` and exclusive `end`. At 60 fps, `{"start": 600, "end": 900}` addresses timeline seconds 10–15 and contains 300 frames. These are current timeline positions, not source-file seconds and not source frame indices. For fractional frame rates, calculate boundaries from the current project fps and round consistently. Ranges must be nonempty and lie within the current timeline duration. Explicit track selections must contain valid, distinct IDs and cannot be empty.

Fragments beginning inside a clip advance its source and animation offsets; entrance transitions are cleared on those fragments. Other clip properties and embedded preset definitions remain intact. Captions are mapped to corresponding source-clip fragments when both tracks participate. The edit summary warns about related caption/source tracks omitted from a subset; include them together when they should remain synchronized.

## A reliable agent workflow

1. Read `get_project` to obtain the active project, fps, tracks, clips and revision.
2. Inspect the relevant sources and composited timeline frames to choose useful sections. A time-range operation does not decide which gameplay is interesting.
3. Call `edit_timeline_ranges` with `apply: false` to review the planned change without editing.
4. Apply the same operation with `apply: true` and the current revision when the user has requested the edit.
5. Inspect the resulting cut boundaries and play the sequence. Undo restores the whole operation if needed.

A revision conflict means the project changed after it was read. Reread and reconsider the ranges before applying; the same numeric positions may now address different content. Previewing is optional at the protocol level but useful for a substantial rearrangement.

## Remove a section across the whole timeline

For a 60 fps project, this previews removing seconds 10–15 and 22–25 across every track:

```json
{
  "revision": 42,
  "operation": "remove",
  "ranges": [
    {"start": 600, "end": 900},
    {"start": 1320, "end": 1500}
  ],
  "apply": false
}
```

When applying this edit, both ranges still refer to the **original** timeline at revision 42. Do not subtract the first removal from the second interval yourself. Use `apply: true` to commit the operation once; the tool handles the accumulated time shift.

Example prompt:

> Remove the quiet sections from 10–15 seconds and 22–25 seconds from this timeline. Keep both gameplay angles, labels, captions and audio synchronized. Preview the range edit, then apply it as one undo step and inspect the new joins.

## Reorder several tracks together

This 60 fps example assembles seconds 20–24, then 0–6, then repeats 20–24. The resulting selected-track sequence is 14 seconds long. Replace the example track IDs with IDs returned by `get_project`.

```json
{
  "revision": 42,
  "operation": "assemble",
  "ranges": [
    {"start": 1200, "end": 1440},
    {"start": 0, "end": 360},
    {"start": 1200, "end": 1440}
  ],
  "trackIds": ["video-before", "video-after", "comparison-labels"],
  "apply": false
}
```

All intervals are extracted from the original timeline, even when their order changes or the same interval appears more than once. Included tracks are rebuilt from frame 0; this operation does not append to their previous contents. Omitted tracks stay fixed and may extend the project's overall duration beyond the assembled sequence.

Framecraft derives project duration from the last remaining clip, with a one-second minimum. It has no separate sequence-end marker, so trailing empty time in a chosen interval does not extend a timeline after its last clip. The preview summary reports the actual resulting duration.

Example prompts:

> Put the strongest four-second result first, then the setup, then replay that result. Move both comparison videos and their labels together. Leave the music track at its current timing. Review the edit before applying it.

> Make a 30-second cut from this existing timeline. Inspect the footage, keep setup, action and payoff, and remove repetition. Assemble the chosen intervals across all tracks so captions and gameplay audio stay with their shots. Do not replace just Video 1.

## What stays separate

- **Visual analysis / Automatic Cuts:** `analyze_video` and `inspect_video` inspect individual source assets. Codex can combine those observations with `render_frame` and the timeline structure to plan a sequence, but range editing is not a whole-timeline semantic analysis engine.
- **Single-track proposals:** `apply_video_cut` applies selected source shots to one video track; other tracks keep their existing times. Use range editing when coordinated changes to existing tracks are required.
- **Persistent clip groups:** tracks are selected per operation. The editor does not create permanent links that force later independent clip moves to follow each other.
- **Audio effects:** audio clips and their existing gain envelopes participate in coordinated cuts and moves. Fades, automation, clip-span ducking, and rendered EQ/compression/reverb are available as separate [audio editing tools](audio-editing.md); range editing does not analyze loudness or generate those effects automatically.
- **Saved assets:** range editing rearranges existing clips; reusable graphic recipes remain in the shared preset library. See the [asset pack](asset-pack.md) for comparison and presentation graphics.

The tool runs through the same validated project repository as manual editing. It uses revision checks and a single undo transaction, and changes appear live in the editor. See the [MCP reference](feature-overview.md#mcp-tools) and [architecture](architecture.md) for the shared domain and transport boundaries.

## Select and edit multiple clips

Drag from an empty timeline area to draw a selection rectangle across clips and tracks. Shift/Ctrl (or Cmd) adds to the selection; Shift/Ctrl-click a clip to add or remove it. Drag any selected clip horizontally to move the group while preserving track assignments and relative timing. The earliest clip cannot move before frame zero.

Delete/Backspace, Copy/Paste and Duplicate act on the selection. Group copies retain track assignments and spacing; pasted groups start at the playhead and duplicates follow the end of the group. Each group edit is one undo step. Escape cancels a rectangle or group drag, and a plain click on empty space clears the selection and seeks. Trim handles still edit the individual clip.

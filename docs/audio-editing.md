# Audio editing

Select an audio or video clip and open **Properties → Audio**. Clip volume, fades and editable gain automation use the same frame-based envelope in preview and export. Track mute and project master volume still apply.

## Fades and volume automation

- **Fade in / Fade out:** durations in seconds, converted to project frames. Fades multiply the clip's base volume and automation gain.
- **Volume automation:** add a point at the playhead, change its local time and gain percentage, or remove it. Values interpolate linearly between points. Gain is 0–100% of the clip's volume.
- **Reset fades & automation:** removes the envelope so the clip returns to its base volume. It does not change media, timeline placement or track volume.

Splitting, trimming and coordinated range edits retain the envelope's original clock through an offset. For a trimmed fragment, the inspector shows that offset and keeps automation points outside the visible fragment intact. Point times shown in the editor remain relative to the selected clip. Fade controls retain their original envelope timing; reset the envelope explicitly if you want a new fade beginning at the fragment's own start. Frame-rate changes convert the envelope along with the timeline.

Codex uses `edit_project` with `clip.update.audioEnvelope` for manual automation:

```json
{
  "duration": 180,
  "offset": 0,
  "fadeIn": 12,
  "fadeOut": 18,
  "keyframes": [
    {"frame": 0, "value": 1},
    {"frame": 60, "value": 0.25},
    {"frame": 120, "value": 0.25},
    {"frame": 150, "value": 1}
  ]
}
```

All numbers representing time in that object are **project frames**, not source seconds. At 30 fps, 180 frames is six seconds. Keyframes must have distinct, increasing positions inside the envelope duration. Set `audioEnvelope` to `null` to reset it.

## Duck music beneath another track

Open **Automatic ducking**, select a foreground track, choose the reduction percentage and attack/release durations, then apply. The resulting curve is editable under Volume automation and can be undone in one step.

Ducking uses the **timeline spans of foreground clips**. It does not detect speech, measure loudness, recognize sound events, or run a live sidechain compressor. Muted tracks and the selected target clips are excluded as triggers. If a long foreground clip contains silence, that silent span still participates; trim foreground clips to their intended audible ranges first.

Applying ducking **replaces the target's existing fades and automation**. Reapply after moving or trimming foreground clips because the generated curve is a saved edit, not a persistent relationship between tracks.

Codex can call `duck_audio` with `apply: false` to review the generated commands, then `apply: true` with the current project revision to commit. `gain` is the remaining multiplier (0.25 means 75% reduction); `attackFrames` and `releaseFrames` use project frames.

## EQ, compression and room reverb

Open **Audio effects**, enable the desired effects, adjust their controls, and choose **Apply audio effects**:

| Effect | Inspector controls | Processing |
| --- | --- | --- |
| Three-band EQ | Low, mid and high gain in dB | Bass around 180 Hz, mid band around 1.2 kHz, treble around 5 kHz. |
| Compressor | Threshold in dB and ratio | Default attack 10 ms, release 180 ms and no makeup gain; MCP can also set these values. |
| Room reverb | Wet mix and room size | A compact multi-tap room/echo effect. |

Processing runs locally through FFmpeg with one bounded audio task at a time. The inspector displays actual queued/running/completed/error state and offers cancellation. These are rendered effects, not a live plugin rack.

The result is a project-owned 48 kHz stereo WAV used by both preview and export. Original media is preserved:

- An **audio clip** keeps its timeline position and receives the processed source.
- A **video clip** keeps its image and is muted; a separate processed audio clip is placed at the same start and duration. Use **Select processed audio** to edit that new clip.
- Reapplying effects to generated audio starts from its retained original source, avoiding repeated compression/reverb buildup.
- Reverb tails are trimmed at the clip's end to preserve synchronization. Processing does not extend clips or add trailing timeline space.
- If the timeline changes during processing, the operation reports a conflict instead of overwriting newer edits. Retry against the current project.

The completed change is one undo step. Generated files remain ordinary project media; undoing the edit does not delete source files. Codex uses `apply_audio_effects` and polls `get_audio_effect_job`, which also accepts `cancel: true`.

For reusable synthesized whooshes, impacts and interface sounds, use the Audio library's sound presets. For cuts spanning music, footage and overlays together, see [coordinated timeline editing](timeline-editing.md).

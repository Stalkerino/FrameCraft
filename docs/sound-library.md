# Sound effects library

Open **Audio → Sound library** for reusable effects generated locally. **Project audio** still contains imported music, recordings and sound files. The sound library uses the existing Codex conversation and MCP connection.

Twelve editable starter recipes cover common devlog and presentation cues:

| ID | Sound | Typical use |
| --- | --- | --- |
| `whoosh-soft` | Soft whoosh | Labels and small reveals |
| `whoosh-heavy` | Heavy whoosh | Larger transitions |
| `impact-soft` | Soft impact | Result cards or emphasized cuts |
| `impact-deep` | Deep impact | Major reveals |
| `riser-clean` | Clean riser | A tonal build into the next section |
| `riser-air` | Air riser | A softer transition build |
| `ui-click` | UI click | Tutorial keypresses or interface actions |
| `ui-toggle` | UI toggle | Switching between views |
| `notification` | Notification | Short confirmations |
| `glitch-tick` | Glitch tick | Digital interruptions or abrupt reveals |
| `transition-hit` | Transition hit | A sweep followed by a landing |
| `success-chime` | Success chime | Completed features or milestones |

## Preview, customize and place

1. Press a sound's play button to hear the actual generated audio. Starting another preview stops the previous one.
2. Click its name to adjust duration, pitch and volume. Preview those settings before placing it.
3. Choose an audio track and **Add at playhead**. The library card's **+** button uses the selected audio track, otherwise the first audio track. A track is created if none exists.
4. Use **Save variation** for a separate reusable recipe or **Save changes** for a new version of the existing recipe.

Placement creates an ordinary audio clip backed by a WAV copied into the project media folder. Move, trim, duplicate or remove it like imported audio. The media import, any necessary audio track, and clip placement commit together as one undoable edit when successful. A concurrent project change prevents placement on the wrong timeline; a completed import is retained in the requesting project for recovery.

The settings dialog's **Advanced synthesis layers** edits the recipe's tone/noise layers. Save before previewing advanced layer changes. **Recipe** downloads a portable `.framecraft-sound.json` file; **Import recipe** adds a saved definition to another installation.

Deleting a library recipe does not delete previously generated project audio. Intentional starter deletions survive restarts. New starter IDs can be installed later without overwriting customized sounds.

## Ask the existing agent

**Ask Codex** opens the existing conversation with a draft request. Review and send it; the button does not automatically submit or create another agent process.

Example prompts:

> Add subtle sound effects to the main title entrances and transitions in this timeline. Use the saved sound library, keep gameplay audio clear, and avoid putting an effect on every cut.

> Add a soft whoosh at the start of the comparison wipe, then a quiet impact when the new-build result card lands. Place them on a Sound effects track. Save a shorter, lower-pitched whoosh variation for reuse.

> Create a small three-note confirmation sound using a portable local recipe. Save it as “Feature complete”, then place it at the result reveal. Use the same chat and timeline.

## MCP tools and units

| Tool | Use |
| --- | --- |
| `list_sound_presets` | Discover saved sounds; read a complete recipe by ID before modifying it. |
| `save_sound_preset` | Create a recipe or save a versioned update. |
| `preview_sound_preset` | Generate a local WAV preview without editing the project. |
| `apply_sound_preset` | Generate/import the sound and place it at an exact timeline frame. |

Read `get_project` before placement. `frame` and optional `durationFrames` use **integer project frames**; `values.duration` is the generated sound length in **seconds**. `values.pitch` is a frequency multiplier, and `values.volume` is a gain between 0 and 1.

Example placement at second 10 in a 60 fps project:

```json
{
  "id": "whoosh-soft",
  "version": 1,
  "revision": 42,
  "frame": 600,
  "values": {"duration": 0.8, "pitch": 0.9, "volume": 0.4}
}
```

Use the actual preset version and project revision returned by the tools. `trackId` optionally chooses an existing audio track. `durationFrames` trims the generated sound from its beginning; it must not exceed the generated duration. To move the sound after placement, use ordinary timeline commands.

## Recipe format and storage

Recipes contain a name, category, duration, pitch, volume, deterministic noise seed and up to six layers. Each layer uses `sine`, `triangle` or filtered `noise`, with start/end frequencies, gain, normalized start/end positions, attack and release. Layers contain data rather than executable code. Attack and release describe fractions of a layer's duration.

Generation produces mono **48 kHz, 16-bit PCM WAV**, with smooth edges and peak amplitude limited to 0.8. Durations range from 0.08 to 4 seconds; synthesis uses bounded sample arrays and simple DSP, with no model download or external generation service. This is useful procedural SFX generation, not music composition, voice synthesis, or imitation of recorded real-world sounds. Import existing music and recordings through Project audio.

The shared catalog is stored under `<libraryDir>/sounds/catalog.json`, with generated preview files in `sounds/audio/`. The default library directory is `data/asset-library/`; `FRAMECRAFT_LIBRARY_DIR` can relocate it. Save operations use revisioned definitions and atomic catalog writes. Applied WAVs are copied into the requesting project's media directory, so later recipe edits or removal do not change existing clips.

See [audio processing and timeline features](feature-overview.md), [whole-sequence editing](timeline-editing.md) and the [graphic asset pack](asset-pack.md) for related tools.

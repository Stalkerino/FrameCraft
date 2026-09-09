# Asset Studio

Open **Assets** in the left toolbar to create and reuse procedural animations and transitions. Presets are saved permanently; applying them again does not require Codex or an editor rebuild.

## Workflow

1. **Ask Codex:** use the existing chat on the right, for example: “Create and save an orange glitch transition, apply it to the second shot, and add a chapter title.” The same session handles generation, placement and edits through MCP. Follow real progress and approvals there. Codex reads a starter recipe, creates a new preset, renders a preview, and inspects it. The saved asset appears through live library updates. Assets contains the reusable library and preset controls; it does not start another agent process.
2. **Create preset:** alternatively choose a starter, edit its name, duration and exposed defaults, then save. Advanced users can edit layers/keyframes in JSON; **Update recipe preview** validates changes before saving.
3. **Use it:** open a card to preview/customize the asset and add it at the playhead. By default, backgrounds/intros/outros use a video track and titles/lower thirds/overlays use a text track. Drag graphics onto any video or text track to choose their layer. Transitions apply to the selected incoming visual clip or the incoming clip you drop onto, using the outgoing scene from that same track. Use **Add track** for additional layers; higher tracks appear in front.
4. **Customize:** selected clips expose their preset's text, colors and numeric controls in Properties. Drag/scale a graphic as a whole in the canvas. Graphic **Animation length** controls animation speed; clip duration controls how long the asset stays on the timeline. The final animation frame holds if the clip continues.
5. **Reuse and share:** save customized controls as a new variation, edit an existing library preset, or export/import a portable `.framecraft.json` package. Imports create independent items. Recipes are self-contained text/vector graphics with no external media dependencies.

Seven editable starters are included: Purple Glitch, Chapter Title, Developer Lower Third, Orbit Background, Focus Callout, Devlog Intro and Devlog Outro. **Render sample video** creates an isolated sample in the normal render queue without changing the project. Transition samples contain two example scenes.

Editing a library item creates a new version. Existing timeline clips retain their embedded recipe and values, including after the library item is deleted. New applications use the latest version. **Save as library variation** also works from an applied clip's inspector.

## Storage

The catalog defaults to `data/asset-library/presets.json` relative to this installation, independently of `FRAMECRAFT_DATA_DIR`. Set `FRAMECRAFT_LIBRARY_DIR` to share another library location across project directories. Back it up alongside project data. Browser tests use explicitly isolated project and library directories.

The repository serializes writes, atomically renames saved JSON, and checks preset versions before updates/deletion. SSE broadcasts library changes. Library edits are separate from timeline undo; applying a preset uses the usual project revision check and creates one undo step.

Each instance embeds its ID, version, full definition, parameter values and duration, so the library is not needed to render an existing project. Split/ripple-cut fragments preserve graphic animation offsets and do not replay incoming transitions. Preview and export share the same frame-based composition across project/output frame rates.

## MCP tools

| Tool | Behavior |
| --- | --- |
| `list_asset_presets` | List summaries, parameters, IDs and versions; pass `id` for a complete recipe or `query` to filter names/tags. |
| `save_asset_preset` | Create with `definition` and `expectedVersion: null`; update with `id`, `expectedVersion` and the revised definition. |
| `preview_asset_preset` | Pass `id`, `version`, optional `values`, `duration`, `progress` (0–1), and `kind` (`frame`/`video`). Frames return actual PNGs when ready; poll `get_render` for pending jobs. |
| `apply_asset_preset` | Pass preset `id`/`version`, project `revision`, insertion `frame`, optional `trackId`, `values` and `duration`; transitions also need incoming `clipId`. |

Read a complete starter before authoring. Existing external Codex sessions must reconnect after upgrading the bridge to discover newly added tools. Embedded Codex receives them on its next startup.

## Recipe format

Version 1 supports rectangles, ellipses and multiline text, painted in array order. `x`/`y` are layer-center coordinates in canvas percentages; width/height are also percentages. Font size, corner radius and stroke width use percentages of canvas height. Scale, rotation and opacity are independently animatable. Text alignment uses the declared layer width.

Scalars accept a number, a numeric parameter reference, or ordered keyframes. Keyframe `at` runs from 0 to 1 over the animation duration. Easing: `linear`, `ease-in`, `ease-out`, `ease-in-out`, `step`. Values hold before the first and after the last keyframe. Text and colors accept literals or matching typed references.

```json
{
  "schemaVersion": 1,
  "name": "Slide-in chapter",
  "category": "title",
  "duration": 3,
  "parameters": [
    {"key": "title", "label": "Title", "type": "text", "default": "NEW MOVEMENT SYSTEM"},
    {"key": "accent", "label": "Accent", "type": "color", "default": "#bc8cff"}
  ],
  "layers": [{
    "id": "heading", "type": "text",
    "text": {"param": "title"}, "fill": {"param": "accent"}, "fontSize": 8,
    "x": {"keyframes": [{"at": 0, "value": -50}, {"at": 0.25, "value": 50}], "easing": "ease-out"},
    "y": 50
  }]
}
```

Transitions use `category: "transition"` and `reveal: {type: "fade" | "wipe" | "iris" | "blocks"}`. Wipes accept `direction: "left" | "right" | "up" | "down"`; blocks accept `steps` from 2 to 30. Optional graphic layers paint above the incoming reveal and disappear when it finishes. The outgoing scene is held silently; timeline duration stays unchanged.

Limits: 40 layers, 20 parameters, 24 keyframes per property, and 0.1–120 seconds. Parameters are text, hexadecimal colors or bounded numbers. Invalid references, unknown fields, bad ranges and unordered keyframes are rejected. Recipes cannot execute JavaScript or load arbitrary URLs.

These assets run locally once authored; Codex uses its existing authentication. This feature does not generate photographic images, footage, music or sound effects, or package imported-media clip groups. Those need separate providers or dependency packaging. Effects beyond the recipe primitives can still be implemented in the [shared renderer](custom-effects.md).

## Architecture

`shared/asset-presets.ts` owns schemas, parameters and interpolation; `shared/preset-project.ts` creates instances/commands/isolated preview projects. The preset repository persists the catalog; `PresetService` applies assets, generates thumbnails and queues previews. HTTP/SSE and MCP consume those boundaries.

Pure SVG artwork in `src/video/assets/` is shared by thumbnails, Remotion preview and export. Atomic parameter fields, cards and previews feed Asset Studio and its dialogs. Typed services handle HTTP and drag/drop. The existing Codex chat uses the shared MCP tools for both assets and timeline commands. SCSS lives in `src/styles/components/_asset-studio.scss`, exposed through the 7–1 entry point. Storage and process APIs support Windows and Linux.

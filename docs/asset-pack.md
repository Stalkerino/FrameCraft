# Reusable presentation and devlog assets

Framecraft includes **24 editable starter recipes**: the original seven and 17 presentation, comparison and gameplay additions. Find them under **Presets** or ask the connected Codex agent to use them. They are local vector artwork and animation definitions, so no image service, extra Codex process or generation request is needed to reuse them.

Recipes expose text, colors and relevant sizes. Duration is adjustable per use. Coordinates are percentages of the project canvas; animation timing comes from frames in the same composition used for preview and export.

## New recipes

| Recipe ID | Use | Editable controls |
| --- | --- | --- |
| `comparison-wipe-horizontal` | Reveal the upper video left to right, with a vertical divider following its boundary. | Divider color and thickness; transition duration. |
| `comparison-wipe-vertical` | Reveal the upper video top to bottom, with a horizontal divider. | Divider color and thickness; transition duration. |
| `comparison-side-by-side` | Labels and a static center divider over two separately positioned videos. | Both labels, accent, text and panel colors. |
| `comparison-stacked` | Labels and a static horizontal divider over separately positioned top/bottom videos. | Both labels, accent, text and panel colors. |
| `presentation-pip-frame` | An open frame and label around a separately positioned inset video. | Label and colors; use clip transform to reposition the entire graphic. |
| `feature-callout` | Lower-left feature announcement. | Category, headline, detail and colors. |
| `fix-callout` | Lower-left bug-fix explanation with an amber accent. | Category, headline, detail and colors. |
| `result-card` | Benchmark, milestone or result card. | Metric label, result, context and colors. Values are supplied text. |
| `shortcut-card` | Key combination and action label for a tutorial. | Keys, action and colors. |
| `code-panel` | File label, multiline plain-text code/pseudocode and explanation. | All text, code size and colors. |
| `step-badge` | Compact numbered tutorial instruction. | Step number, instruction and colors. |
| `progress-line` | A thin progress line filling over the graphic's duration. | Accent, track color and line thickness. |
| `section-card` | Full-frame chapter heading, index and summary. | Text, headline size and colors. |
| `clean-fade` | A clean linear dissolve into the incoming clip. | Transition duration. |
| `accent-edge-wipe` | A quick reveal led by a colored edge. | Edge color, width and transition duration. |
| `focus-marker` | Target dot, leader line and label pointing to a fixed detail. | Label and colors; clip position moves the annotation. |
| `caption-strip` | Readable manual commentary over silent footage. | Caption, text size and colors. |

Existing recipe IDs remain unchanged: `purple-glitch`, `chapter-title`, `lower-third`, `orbit-background`, `focus-callout`, `devlog-intro`, and `devlog-outro`.

## Build a moving before/after comparison

1. Import both recordings and identify corresponding source moments. Set the project resolution and frame rate first.
2. Put **Before** on a lower video track and **After** on an upper video track. Their timeline ranges must overlap while the wipe runs. Align their source offsets so the same action occurs at the same timeline frame.
3. Apply `comparison-wipe-horizontal` to the upper **After** clip, choosing a duration such as four seconds. The reveal begins at that clip's start. Use `comparison-wipe-vertical` for a top-to-bottom reveal.
4. Add separate text clips for any persistent labels and choose which recording supplies the audio.
5. Inspect frames near the beginning, midpoint and end, then preview the movement.

Both videos continue playing during this arrangement. The divider uses **linear** motion matched to the reveal; changing its easing independently would detach it from the boundary. A transition between adjacent clips on the *same* track instead holds the preceding clip's last frame, so use overlapping tracks when comparing moving recordings.

Example prompt:

> Compare Before.mp4 and After.mp4 on two video tracks, synchronized to the landing. Reveal After from left to right over four seconds using the saved comparison wipe. Keep Before's audio only, add small labels, and inspect the result before exporting.

## Static comparisons and picture in picture

These overlays provide artwork; video positioning is a separate timeline edit. With videos matching the project's aspect ratio, these starting transforms preserve their complete images:

| Layout | First video | Second video | Overlay |
| --- | --- | --- | --- |
| Side by side | X 25%, Y 50%, scale 0.5 | X 75%, Y 50%, scale 0.5 | `comparison-side-by-side` |
| Stacked | X 50%, Y 25%, scale 0.5 | X 50%, Y 75%, scale 0.5 | `comparison-stacked` |
| Picture in picture | Full-frame background | X 80%, Y 22%, scale 0.3 | `presentation-pip-frame` |

Place each video on its own track and the graphic on a text/graphics track above both videos. Side-by-side and stacked layouts leave space around the complete images; filling each half would require cropping or a different source aspect ratio. PiP placement assumes matching source/project aspect ratios. Adjust together when media has a different shape.

Example prompt:

> Show the old build and new build side by side for six seconds without cropping either recording. Use the comparison labels, then show a result card reading “FRAME TIME / 8.3 ms / 1440p · Optimized build”. Keep the style consistent with teal accents.

## Reuse and persistence

- `list_asset_presets` finds the recipe and its current version. Supplying its ID returns the complete definition.
- `apply_asset_preset` inserts a graphic or attaches a transition to an incoming clip, using the current project revision. Pass `values` to customize parameters and `duration` in seconds.
- `preview_asset_preset` renders an isolated preview. Use `render_frame` to inspect the actual multi-track composition.
- `save_asset_preset` saves a new reusable definition or a versioned update. The UI can also download/import portable `.framecraft.json` recipe files.

The shared library lives under `data/asset-library/presets.json` by default. Every applied instance embeds its recipe and values: later library edits or deletion do not change an existing timeline. Keep the data directory when moving an installation if you want to retain the reusable library itself.

On startup, newly introduced starter IDs are added to existing libraries without overwriting customizations. An `installedStarterIds` ledger preserves intentional starter deletions across restarts. Legacy libraries treat the original seven as already installed. A full library defers new additions until space is available rather than preventing startup.

These recipes do not add media cropping/masking, arbitrary video keyframes, speed ramps, tracking, benchmark measurement, syntax highlighting, or automatic audio/video synchronization. They work with the existing timeline transforms and rect/ellipse/text animation primitives. Long text should use newlines or a smaller exposed text size; automatic wrapping is not part of the recipe renderer.

# Automatic Cuts

Use **Smart cut** in the timeline toolbar or **Tools → Automatic Cuts** for recordings whose meaning is visual. The toolbar uses the selected video as its source. Works with gameplay, devlogs, demonstrations, travel footage and other videos. No transcript is required. For edits driven by spoken words, use Transcript & captions or Rough cut.

1. Select an imported video and describe what the edit should show: a mechanic demonstration, varied combat, interesting traversal, or another concrete goal. Set an approximate target length.
2. Choose the AI result. **Generate and apply cuts** lets Codex create the edit on the chosen video track. **Generate a proposal for review** stops at a saved proposal for you to inspect.
3. Click the matching Generate button. It starts or resumes the existing right-hand Codex session and sends the request immediately, preserving any unsent composer draft. Follow progress, approvals and answers in that chat. No separate agent process is created for automatic cuts.
4. Codex scans as needed, inspects actual source images and cut boundaries, and saves a proposal with reasons and confidence. In automatic mode it then calls `apply_video_cut` to replace clips on the chosen track. Other tracks keep their current timing; source media is preserved. One Undo restores the previous timeline.
5. In review mode, preview shots, deselect unwanted ones and reorder them, then choose a video track and click **Apply cut**. Append retains existing clips; replace-track replaces only that track.

**Scan video** is optional: it creates a local visual map, without choosing or applying cuts. **Frames** opens grids and timestamps preview source moments. **Review in Codex** prepares an editable prompt in the chat without sending it. Both remain available when you want more control. Analysis covers the full source recording, even if its selected timeline clip is trimmed.

Example prompt: “Visually review this gameplay rush. Build a one-minute demonstration of movement mechanics, keep complete actions, and skip visually confirmed menus or repetition. Save a proposal for review before applying it.”

## What performs the analysis

FFmpeg samples grayscale frames at an interval adapted to the source duration, with no fixed source-duration cutoff. Frame differences and brightness identify low-motion stretches, dark sections and large visual changes. The initial map uses up to 48 representative frames across the source; Codex can request further inspections wherever needed. These measurements do not identify semantic events: a still scene may be meaningful gameplay, and a dark screen may be part of the action.

Codex supplies visual interpretation from actual images returned by MCP. Overview grids contain up to 12 frames; it can request shorter ranges for temporal context or larger single frames for details. Instructions require inspecting the overview and relevant cut boundaries, preserving setup/action/payoff, and stating uncertainty. Every proposed shot cites timestamps previously returned by the inspection service. That validates its source references, not the accuracy of the model's judgment.

This is sampled visual review, not continuous video understanding or a game-specific win/death detector. Brief events can fall between samples; ask for closer inspection when timing matters. The target duration guides Codex's selection and is not automatically forced by truncating actions.

The local scan needs FFmpeg and no extra inference API key or downloaded vision model. Sending the request to Codex uses its normal model access. Cached maps/images avoid repeated extraction. Overview sampling is bounded to limit image volume; dense inspection adds model input only when requested.

## MCP tools

| Tool | Purpose |
| --- | --- |
| `analyze_video` | Queue a local visual scan by `assetId`; returns a job. Reuses saved maps unless `refresh: true`. |
| `get_analysis` | Poll the job for progress, errors or its completed `reportId`. |
| `get_video_analysis` | Read a `reportId`, or list reports and saved proposals for the active project. |
| `inspect_video` | Pass `inspection: {reportId, page}` for an overview grid, `{reportId, start, end}` for any valid source range, or `{reportId, time}` for a larger frame. Contact sheets sample up to 12 frames per response; request further ranges for detail. |
| `save_video_cut` | Save any number of ordered shots and evidence timestamps, without truncating IDs, reasons, title or goal. New proposals use `expectedVersion: null`; updates require the current version. Does not edit the timeline. |
| `apply_video_cut` | Apply a saved proposal with current project revision, proposal version, optional video `trackId`, mode and ordered `shotIds`. |

Images are indexed left to right, top to bottom, with timestamps returned alongside them. Unused grid cells are black padding. Evidence timestamps must belong to their shot and match inspected frames. Completed inspection caches retain those references across service restarts, including caches made by previous versions. Saved proposals remain usable after restart.

Automatic Cuts proposals have no application count cap for evidence, shots, selected shot IDs or resulting timeline clips. Both append and replace apply in one bulk transaction, avoiding the general edit-command batch limit. Automatic Cuts save/apply requests have no fixed JSON body-size cap. The target length and inspected range have no fixed upper duration, though source boundaries remain enforced. Generated timeline labels abbreviate long proposal titles for display; saved proposal text stays intact. Machine memory, processing time and Codex model/transport constraints still apply; image batching keeps each inspection response practical.

## Persistence and architecture

Reports, image caches and proposals live in `FRAMECRAFT_DATA_DIR/visual-rush/`. Reports follow their imported source asset; proposals belong to their project. They survive refresh/restart and workspace backup. Scan jobs themselves are transient and cancellable.

`shared/visual-rush.ts` owns schemas, visual-signal summaries and source-second-to-frame editing rules. `VideoFrameService` wraps cancellable FFmpeg argument arrays; `VisualRushService` coordinates cached inspections and versioned proposals through its repository. HTTP/MCP use those services. Typed browser services/hooks feed the Automatic Cuts panel and reusable review component; styling lives in the SCSS 7–1 components folder. Applied clips use the existing shared preview/export composition on Windows and Linux.

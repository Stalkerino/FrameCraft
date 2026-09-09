# Architecture

Framecraft separates editing rules, storage, transports, rendering, and interface composition. See the [feature reference](feature-overview.md) for user-facing capabilities and [CONTRIBUTING](../CONTRIBUTING.md) for development checks.

Project lifecycle schemas and blank-project construction live in `shared/project-library.ts`. `ProjectRepository` serializes edits, undo and new/copy/open operations through one queue. `ProjectCatalogRepository` stores inactive projects under hashed IDs; the atomic active `project.json` remains authoritative. A switch archives the outgoing project before committing the new active state, retaining each project's history. Revisions increase across switches so stale edits cannot affect another project. Existing work loads without replacing the source file. Media paths remain stable across switches and copied projects; imports capture their originating project and exports keep frozen snapshots. The HTTP project adapter and MCP use the same repository boundary; typed UI services feed atomic project-menu/card components and dialogs. See [Managing projects](projects.md).

The browser's `workspace-events` service multiplexes project snapshots, agent state and preset notifications over one SSE connection per page. This leaves HTTP connections available for edits/media when multiple tabs are open. Subscribers share reconnection and release the connection when no consumers remain. Project identity changes reset view state and stale responses cannot replace newer revisions.

```text
shared/
  project.ts                      Schemas, types, validation, pure command reducer
  demo.ts                         Portable sample project and original SVG artwork
server/
  app.ts                          Local HTTP transport and composition root
  mcp.ts                          Codex MCP transport; calls the local service
  config.ts                       Paths and environment configuration
  repositories/project-repository.ts
                                  Serial transactions, revisions, persistence, undo
  services/
    media-service.ts              Import, metadata, thumbnails, playback copies
    process-service.ts            Cross-platform executable adapter
    render-service.ts             Frozen render jobs, composition bundling, export
    agent-connection-service.ts   Initialized MCP session presence and expiry
    mcp-presence-service.ts       Protocol-triggered heartbeat and reconnection
    codex-command-service.ts     CLI resolution and per-process MCP configuration
    json-rpc-process.ts          Supervised JSONL subprocess transport
    codex-session-service.ts     Codex threads, streamed turns, approvals, recovery
    codex-event-service.ts       Protocol items normalized for the interface
  routes/agent-routes.ts          Validated chat actions and SSE snapshots
src/
  components/
    atoms/                        Buttons, fields
    molecules/                    Media cards, timeline clips
    organisms/                    Header, library, preview, inspector, timeline
    templates/                    Editor layout slots
  pages/                          Editor page assembly
  stores/                         Editor state and queued user operations
  services/                       Typed HTTP client
  hooks/                          Editor keyboard lifecycle
  video/
    ProjectComposition.tsx        Shared preview/export composition
    effects/registry.ts           Deterministic transition strategy registry
  styles/
    abstracts/                    Sass tokens and mixins
    base/                         Reset and typography
    components/                   Reusable element and module styles
    layout/                       Application grid and panel structure
    pages/                        Studio-specific canvas presentation
    themes/                       Semantic color tokens
    vendors/                      Remotion integration adjustments
    main.scss                     Single 7–1 entry point
```

## Commands and consistency

All times in the domain are integer frames at project fps. A clip's `start` is an absolute timeline position. `sourceStart` is the trim offset into its media source, also expressed at project fps. Media durations are stored in seconds from ffprobe. Images can extend freely; video and audio cannot extend beyond source duration.

Clients submit `{revision, label, commands}`. The repository serializes operations, checks the expected revision, applies all commands to an isolated copy, validates the result, writes a temporary file, atomically renames it into place, and only then publishes the committed snapshot over SSE. An invalid batch changes nothing. A stale client gets HTTP 409 and must reread before deciding whether to retry. One batch equals one revision and one undo step.

The UI queues quick consecutive mutations, preventing clicks from being silently lost while a previous command is saving. It does not blindly replay conflicting agent/user edits. Preview selection, playhead, monitoring mute, and zoom are ephemeral UI state. Selection/playhead are mirrored to the local service for agent context.

Connection presence is independent of tool activity: an MCP bridge starts heartbeats only after receiving the protocol's `initialized` notification. The editor tracks each session separately, removes orderly disconnects, and expires missing heartbeats after 35 seconds. The UI polls presence every two seconds and clears its connected indicator when the service is unreachable. An idle session remains connected; merely saving a registration does not create a session.

## Embedded Codex chat

`CodexSessionService` owns one local `codex app-server --listen stdio://` process and one active thread. A JSON-RPC adapter correlates requests, rejects pending operations when the process stops, and streams protocol notifications into normalized chat messages and tool activity. The HTTP adapter exposes start/resume, send, interrupt, pending-request responses, model discovery and validated model settings. It does not expose arbitrary RPC methods, executable paths, or shell commands to the browser. Existing localhost host/origin checks protect these routes too.

The CLI receives a session-specific Framecraft MCP entry pointing to the actual Node executable, project directory, and service URL. Model and authentication come from Codex configuration. Thread setup selects the workspace write sandbox with approvals routed to the user. Pending requests retain their original protocol IDs privately; the browser replies using generated opaque IDs. Grants use only the permissions requested by Codex and last for the current turn. Standard MCP tool confirmations are supported through empty approval forms; external elicitation forms requiring additional fields can be declined. Resolved, interrupted, and crashed requests are removed, and unknown server requests fail explicitly.

The model selector loads all pages from `model/list` with `includeHidden: true`, using each model's supported reasoning efforts and service tiers. The client declares the required experimental capability when initializing the installed CLI's app-server. Changes go through `thread/settings/update` on the existing thread while idle. No prompt is sent and no new chat process is created. The UI reports the selected tier's usage description from Codex. Model, effort and speed preferences are saved with the thread pointer and restored for resumed or new chats; global Codex configuration is unchanged. Framecraft does not send these settings to a separate hosted inference API.

The browser receives throttled SSE snapshots, so reloads attach to existing work without launching another process or resending a prompt. A small atomic pointer file identifies the last Codex thread for resumption after service restarts. The actual transcript lives in Codex storage; the UI retains the last 200 messages and 100 activity entries. Base64 image payloads are excluded from activity text. Agent Markdown is rendered without raw HTML or embedded remote images.

Atomic message, request-card, and composer components consume the agent store and typed service. Auto-allow is an explicit session flag: supported pending and incoming approvals call the same response method as manual approval, retain current-turn permission scope, and leave questions manual. Server restart resets the flag.

Dictation lives in reusable services and a hook; the composer captures speech into a reviewable draft. Local mode records with MediaRecorder, posts a bounded recording to the analysis adapter, and polls its cancellable Whisper job. Temporary extracted audio and recordings are cleaned up. The optional browser mode uses native speech recognition. Unmounting releases microphone tracks and cancels local work; neither mode submits automatically.

Undo/redo is a global project history shared by user and agent. Revisions remain monotonic even when undoing. Original imported media stays available on disk; undo never deletes original media files. Back up the entire data directory, not only the project JSON.

## Local assisted editing

`shared/transcript.ts` defines source-second word documents. `shared/assisted-editing.ts` maps word selections through source trims into timeline frames, computes ripple cuts across every track, groups caption words and creates first-cut proposals. `clips.replace` applies the validated resulting timeline as one repository transaction; HTTP and MCP use the same revision and undo boundary.

`TranscriptRepository` persists each source transcript in a separate atomic JSON file, with serialized revision checks. Transcript correction does not rewrite the project or its history. `AnalysisService` owns a bounded serial job queue and cancellable workers. Its injected `InferenceProvider` is the boundary for machine learning. The production provider spawns Node with argument arrays, extracts mono 16 kHz float audio using FFmpeg into a private temporary directory, and runs real Transformers.js pipelines in a separate process. Cancellation terminates the child; extracted audio is cleaned up. CPU threads are bounded; each completed worker releases model memory. Models cache on disk rather than inside the frontend bundle.

Semantic embeddings are keyed by text hashes, persisted in a disposable cache and invalidated when words are corrected. Search distinguishes speech from filename matches and reports source timestamps. Topic-based first-cut jobs rank those passages, then return a proposal tied to the project revision. Applying a reviewed proposal is a separate operation. Analysis jobs are transient; transcripts and downloaded models persist.

The atomic UI consumes `analysis-api.ts`, the analysis store and a shared action hook. Transcript, search, first-cut and focus panels are organisms; source preview, progress and property controls are reusable molecules. The Assist stylesheet is exposed through the existing SCSS 7–1 entry point. `CaptionLayer`, `AnnotationLayer` and `zoomAtFrame` are used by the shared Remotion composition. `motionOffset` preserves animation continuity through splits and ripple cuts. Captions currently remain independent layers; regenerate them after manually changing their source clip timing.

## Rendering pipeline

The reusable asset library has a separate versioned repository and SSE stream. `shared/asset-presets.ts` validates parameterized vector/text layers and normalized keyframes; `shared/preset-project.ts` builds ordinary project commands and isolated preview projects. HTTP and MCP call `PresetService` for application and rendering. Applying a preset embeds its definition/version/values in the clip, so later library edits and deletion cannot change existing projects. The library lives independently of the active project data directory; tests configure an isolated library explicitly.

`PresetArtwork` is a pure SVG renderer shared by generated thumbnails, animated library previews, timeline graphics and transition decorations. Graphic clips retain their original animation duration and frame offsets through trims/splits; custom transition instances are cleared from later fragments. The existing right-hand Codex chat handles asset generation and timeline edits through the same MCP connection. Asset Studio observes actual saved library updates without its own chat or process. See [Asset Studio](asset-studio.md) for the schema and MCP workflow.

The [comparison/devlog pack](asset-pack.md) uses these same recipe primitives. A preset is artwork or an incoming-clip reveal, not a project template. A two-live-video comparison places the recordings on separate simultaneous tracks and reveals the upper clip over the still-playing lower clip. The ordinary outgoing freeze applies only to the previous visual clip on the same track; it does not freeze other tracks. Synchronization, source offsets and layout remain ordinary project commands.

`shared/tracks.ts` defines ordered, named video/text/audio tracks and compatible clip placement. The project reducer validates track commands and enforces locked clip positions; legacy projects are normalized on repository load. Timeline controls and MCP use the same undoable commands. Preview/export paint tracks from bottom to top and apply visibility, audio mute, and transitions within each track. Position locks preserve X/Y while allowing content, scale, timing and track changes; the canvas hook also ignores pointer jitter before a drag begins.

The same React composition renders the Player, PNG inspections, and video exports. Every render job captures a project snapshot and its revision when queued. The worker runs one job at a time with bounded frame concurrency. Each job rebundles composition code so changes to custom effects are picked up by subsequent exports. For eligible devlogs, `layered-render-plan.ts` separates a full-canvas sequence of plain video cuts from its artwork. The same `ProjectComposition` renders the upper layers with transparency; preset scalar evaluation identifies identical artwork frames for reuse. `layered-render-service.ts` decodes the original footage sequentially in FFmpeg, composites those artwork frames, and encodes each cut once. NUT intermediates preserve frame timestamps and PCM audio, then the final join copies video and encodes audio once. Hardware decoding is used when the actual source codec/profile is supported; otherwise decoding remains sequential on CPU. GPU encoding remains enabled independently. Source transforms, gaps, extra video/audio tracks, rotated/HDR/anamorphic footage, mismatched aspect ratios and unsupported binaries retain the full compositor. No styles or preset animations are reimplemented in FFmpeg. A service restart is needed for server schema changes.

Full-compositor intermediate frames are lossless PNGs. Optimized scaling uses Lanczos. Artwork PNGs are normalized to RGBA before FFmpeg reads them: otherwise opaque RGB frames mixed with transparent RGBA frames can reinitialize the filter graph at transitions and strand buffered inputs. Repeated artwork stays sparse through duration-bearing concat entries, rather than expanding a long held graphic into a queue of duplicated frames.

`render-resources-service.ts` budgets Chromium workers and decoded frame caches from available system/process memory and image dimensions. FFmpeg input/filter threads are bounded; supported binaries receive a resolution-aware filter-frame ceiling. These controls limit queues rather than guaranteeing a universal fixed RAM footprint. Progress comes from FFmpeg's reported frames and output size. A stalled hardware decoder can retry the unfinished cut with CPU decoding while retaining the chosen GPU encoder and completed segments. `ffmpeg-progress-service.ts` and the process adapter report stalls, exit codes and termination signals.

`shared/media-settings.ts` defines validated canvas and export settings, codec/container compatibility, and reusable presets. `shared/project-settings.ts` converts frame boundaries, source offsets, captions and animations when fps changes; adjacent boundaries use the same conversion. Project setting changes are ordinary undoable commands. Export-only changes reframe a frozen copy and place its original canvas into the chosen output dimensions using contain, cover or stretch. The live timeline is preserved. Time ranges become inclusive output-frame ranges; codec-specific quality, bitrate, profiles and audio options are passed to Remotion's renderer.

Preview transformations measure visible composition elements in canvas coordinates. A reusable hook maps pointer movement to domain position/scale, keeps an ephemeral composition draft during a gesture, and commits once on release using the captured revision. Escape, cancellation and concurrent revisions discard the draft. Selection outlines and handles are separate UI elements and never appear in exports.

Preview source selection is shared by the program monitor, source preview and export-settings preview. Full quality chooses original media when the browser can decode it, and falls back to a separately cached full-resolution H.264/AAC compatibility copy. That copy uses CRF 18 and remains lossy. Performance explicitly selects a smaller playback copy. Preparation starts on demand, runs one conversion at a time, and supports cancellation/retry; opening the library does not eagerly transcode every file. Stable source selections avoid resetting video elements on ordinary progress updates. Playback quality and monitor zoom are browser preferences, independent of project/export settings.

Exports always use original media. Custom transitions reveal an incoming clip over a silent freeze of the previous clip's last frame on that track, while other tracks continue normally. The overlap does not shorten the timeline or read past the source's end. Ordered tracks determine compositing; monitoring mute and canvas editing handles never change exported output.

The worker-only `remotion-encoder-adapter.ts` routes only video encoding commands to a selected external GPU FFmpeg. Audio preparation, probing and copy-only muxing in the standard Remotion pipeline use its matching bundled binary, which preserves compatibility with its `filter_script:a` calls. This small adapter is tied to the exact Remotion version; it never edits installed files.

Render jobs are in memory; completed files remain on disk. Restarting the service loses queue/status records, but preserves completed exports, project data, and undo history. A first-time Chromium download and initial composition bundle can delay the first export.

## Platform boundaries

Executable processes use Node's `spawn`/`execFile` with argument arrays and `shell: false`. Filesystem paths use `node:path`; URL paths use forward slashes. Startup uses Node scripts instead of Bash-only environment assignments or process management. The MCP launcher resolves its loader relative to the installation. FFmpeg and ffprobe are prerequisites on each platform; `doctor` detects missing executables. Browser paths and storage locations have explicit environment overrides.

The service binds to loopback by default; `--host 0.0.0.0` enables network listening. Host/origin checks then also accept this machine's interface addresses and hostname at the configured port. Internal MCP and rendering traffic stays on loopback. Browser mutations require JSON or multipart content. Uploaded media receives generated filenames. Imported originals and exports stay under the configured data directory. This is a trusted local editing service, not a hardened multi-user hosted application.

## Extending the app

Add new commands in `shared/project.ts`, implement them in `applyCommand`, and cover their editing invariant with a domain test. Add reusable UI in the smallest appropriate atomic-design layer. Keep side effects in services or the repository. New transports call the same command boundary. Do not create a separate agent-only project model, modify `data/project.json` while the service is running, or implement export styling separately from the preview.

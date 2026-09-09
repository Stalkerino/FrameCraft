# Managing projects

Click the project name in the top bar to open the project menu. Everything saves automatically on the computer running Framecraft.

- **New project:** choose a name, resolution and frame rate. Creates an empty timeline and media list with video, text and audio tracks. Also available through the page-plus button in the top bar. The previous project stays saved.
- **Open project:** search saved projects, view their canvas settings, media and clip counts, and open a project to continue editing. Refreshing the browser or restarting the service reopens the last active project.
- **Save as:** name a separate copy of the current timeline, media list and project/export settings. Framecraft opens the copy. The original remains in Open project. The copy starts its own undo history; subsequent edits are independent.
- **Rename project:** changes the current project's name.
- **Start a blank timeline:** clears clips in the current project, retaining media, tracks and settings. This is undoable. Use New project when you want a separate project, or Save as before clearing when you want another version.

Each project retains up to 50 undo states, including across switches and restarts. Asset Studio presets remain available across projects. New projects inherit the current canvas settings as editable defaults.

The same right-hand Codex conversation follows the active project. The `list_projects` and `manage_project` MCP tools provide the same new/copy/open actions. Codex must reread `get_project` after switching. Finish or stop an active Codex response before switching manually.

There is one active project per running workspace. Opening a project updates every connected browser and MCP client. Playhead, clip selection and pending preview gestures reset on a switch. Imports already underway stay attached to the project that requested them. Queued exports use frozen project snapshots and continue using their original media after a switch; completed files remain in the workspace's `exports/` directory.

## Storage and backups

`FRAMECRAFT_DATA_DIR` selects the workspace directory (default `data/`). Its active `project.json` is managed by the running repository. Inactive projects and their histories are stored under `projects/`. Opening an existing installation automatically includes its current project; no manual conversion is needed.

Project names are display names, so names containing characters reserved in Windows filenames are safe. Storage uses hashed project IDs and cross-platform Node filesystem APIs. New imports are stored in `projects/<project-key>/media/`, with thumbnails in `projects/<project-key>/thumbnails/`; the saved project catalog entry is `projects/<project-key>.json`. Uploads are moved into this folder and local path imports are copied, without links to external files. Older workspace media remains supported in its existing location. Save as retains references to already imported files while timelines and media lists are independent; new imports go into the copy’s own folder. Transcript analysis remains associated with each source asset. Back up the whole workspace, rather than treating one project folder as a portable package.

Compatible videos use the original directly in the browser. Other formats prepare a playback copy in the background, with progress and Stop/Retry controls in Media. Conversion is serialized and thread-limited. Project changes and undo do not restart completed conversions; previews already on disk are reused after a service restart. Final export uses the full-quality original even while preview conversion is pending.

To back up or move the workspace, stop the service and copy the entire workspace directory, including projects, media, thumbnails, transcripts and exports. A project JSON alone does not include its media. If `FRAMECRAFT_LIBRARY_DIR` points elsewhere, back up that asset library too. Do not edit the running editor's project files directly.

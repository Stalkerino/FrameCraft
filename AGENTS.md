# Framecraft development

- Preserve the modular boundary: shared domain → repository/services → HTTP/MCP adapters; atomic UI consumes typed services.
- Follow the SCSS 7–1 structure. Add styles to their responsibility folder and expose them through `src/styles/main.scss`.
- Components follow atoms → molecules → organisms → templates → pages. Put reusable side effects in services or hooks.
- Use cross-platform Node APIs and argument arrays for executables. Windows and Linux are both supported targets. Do not add Bash-only startup requirements.
- Run `npm run build` and `npm test` after changes to editing logic. For import, preview, export, or transport changes, run `npm run test:e2e` with FFmpeg and Chromium available.
- Remotion packages must use the same exact version.
- Preview and export must share the same composition and frame-based animation logic.
- A running editor owns `data/project.json`; use MCP/HTTP commands to edit its project. Do not overwrite the file directly.
- Do not remove user media or exports as part of code cleanup. Tests use isolated data directories.
- The Codex panel describes an actual MCP connection. Do not replace it with canned chat replies or simulated agent activity.

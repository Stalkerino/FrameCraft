# Framecraft development

- Preserve the modular boundary: shared domain → repository/services → HTTP/MCP adapters; atomic UI consumes typed services.
- Follow the SCSS 7–1 structure. Add styles to their responsibility folder and expose them through `src/styles/main.scss`.
- Components follow atoms → molecules → organisms → templates → pages. Put reusable side effects in services or hooks.
- Use cross-platform Node APIs and argument arrays for executables. Windows and Linux are both supported targets. Do not add Bash-only startup requirements.
- Native GPU rendering has four equal targets from the first increment: AMD/Windows, NVIDIA/Windows, AMD/Linux and NVIDIA/Linux. Keep platform and device interoperability behind adapters with shared editing, asset, animation and MCP contracts. Record implementation and hardware validation separately for each combination; success on one does not validate the others. Missing hardware access means validation is pending, not that the target is dropped or supported without evidence.
- Run `npm run build` and `npm test` after changes to editing logic. For import, preview, export, or transport changes, run `npm run test:e2e` with FFmpeg and Chromium available.
- Remotion packages must use the same exact version.
- Migrate GPU rendering incrementally. Preserve the working Remotion compatibility renderer and AI-authored asset library until each native replacement is usable.
- A native GPU path must keep video frames on GPU through decoding, pixel processing, asset rendering, composition, presentation and encoding. Never call an encoder listing or a partially accelerated renderer a verified complete GPU pipeline. Report unsupported stages explicitly; CPU control logic and audio are separate.
- Reading encoder capabilities or a render plan must not initialize GPU hardware or encode test frames. Ordinary integration tests set FRAMECRAFT_DISABLE_GPU=1; do not run GPU benchmarks/probes during routine development. Hardware validation must be explicitly communicated and bounded because prior experiments froze the desktop.
- Preview and export must share the same composition and frame-based animation logic.
- A running editor owns `data/project.json`; use MCP/HTTP commands to edit its project. Do not overwrite the file directly.
- Do not remove user media or exports as part of code cleanup. Tests use isolated data directories.
- The Codex panel describes an actual MCP connection. Do not replace it with canned chat replies or simulated agent activity.

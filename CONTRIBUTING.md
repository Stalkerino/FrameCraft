# Contributing to Framecraft

Framecraft targets Windows and Linux. Read [AGENTS.md](AGENTS.md) and the [architecture guide](docs/architecture.md) before changing editing or rendering behavior.

Original contributions use the project's [GPL-3.0-or-later terms and Remotion additional permission](LICENSING.md). Preserve upstream copyright and license notices.

## Development setup

Install Node.js 22+, Rust, and the [Tauri build prerequisites](https://v2.tauri.app/start/prerequisites/), then run:

```sh
npm run desktop:build
npm run desktop:dev
```

Development opens the Tauri application with its local backend. Use `npm run desktop:start` to open the compiled app and `npm run desktop:release` to create installers. See [installation](docs/installation.md) for platform setup and GPU requirements.

## Keep changes in the appropriate layer

- Put schemas, timing rules, and pure editing commands in `shared/`.
- Keep persistence and reusable side effects in repositories, services, or hooks. HTTP and MCP must use the same validated command boundary.
- Build UI from atoms, molecules, organisms, templates, and pages. UI components consume typed services.
- Follow the SCSS 7–1 folders and expose styles through `src/styles/main.scss`.
- Use Node path/process APIs and executable argument arrays; avoid Bash-only scripts and shell interpolation.
- Keep every Remotion package on the same exact version. Preview and export must share frame-based composition logic.

A running editor owns `data/project.json`. Use its HTTP/MCP commands to edit the active project; never overwrite the file behind the repository. Do not delete user media, exports, or saved presets during development cleanup. Keep generated data, credentials, model caches, and local Codex sessions out of commits.

## Verification

Choose checks relevant to the change. Editing logic requires:

```sh
npm run build
npm test
```

Import, preview, export, and transport changes also require browser/integration coverage:

```sh
npx playwright install chromium firefox
npm run test:e2e
```

FFmpeg and Chromium must be available for integration tests. Playwright starts a separate service with isolated `.cache/e2e-*` storage, preserving the user's `data/`. Protocol fixtures simulate Codex only inside tests; automated checks do not spend Codex tokens. Runtime chat must always use the actual CLI and MCP connection.

For focused iteration, pass a test file to `npm test -- tests/<file>.test.ts` or `npm run test:e2e -- tests/e2e/<file>.spec.ts`. Avoid broad repeated runs after relevant checks pass unless another change or failure warrants them.

## Reviewable changes

Explain the concrete problem, resulting behavior, and relevant validation. Mention a platform or hardware path you could not exercise. Update the user guide when controls or workflows change, and the MCP reference when capabilities change.

Documentation screenshots should come from the real interface using generated/demo media and isolated data. Do not include personal footage, credentials, local conversation contents, or fabricated agent replies. Keep asset recipes deterministic and parameterized where practical, with matching preview/export output.

Regenerate the README screenshots with `npm run build` followed by `npm run docs:screenshots`. The capture script creates demo footage locally, starts its own temporary editor, and removes that isolated workspace afterward. It never starts a Codex session. FFmpeg and Chromium must be available; `FFMPEG_PATH` and `CHROME_PATH` can select their executables.

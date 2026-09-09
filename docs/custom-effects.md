# Custom transitions and text animation

Start with [Asset Studio](asset-studio.md) for reusable assets: parameterized text/shapes, keyframes and fade/wipe/iris/block reveals. Codex can save recipes through MCP; they appear immediately without rebuilding. The source extension process below is for effects beyond those primitives.

The transition strategy registry lives in `src/video/effects/registry.ts`. Each transition has a name, description, and pure `style(progress)` function. Progress is clamped from zero to one according to the incoming clip's `transitionFrames`. Styles must derive from frame progress, not elapsed wall-clock time, random values, CSS animation timers, or external network state.

To add a new effect:

1. Add an identifier to `effectNames` in `shared/project.ts`.
2. Add its typed definition to `transitions` in `src/video/effects/registry.ts`.
3. Optionally add a matching thumbnail swatch under `src/styles/components/_media.scss`.
4. Restart the development service, because it owns the validated schema. The library and inspector discover the registry entry automatically.
5. Apply it through the UI or `edit_project`. Render frames at the clip start, midpoint, and end of the transition with `render_frame`, then inspect the images. Check a short playback preview for motion and pacing.

For example, a circular reveal strategy could return:

```tsx
iris: {
  name: 'Circle reveal',
  description: 'Open the next scene from the center',
  style: progress => ({clipPath: `circle(${progress * 75}% at 50% 50%)`}),
}
```

For transitions that need layered graphics rather than a style, extend the rendering strategy interface to accept a React component and keep it within the shared composition. Expose visual controls through the project schema so users can adjust generated effects without editing code.

Text animation lives in `TextLayer` inside `ProjectComposition.tsx`. It uses `useCurrentFrame()` local to the text sequence. The existing rise and typewriter animations provide examples. Font rendering uses local Arial/Helvetica/sans-serif fallbacks; platform font metrics may differ slightly. For exact typography across operating systems, add a properly licensed bundled font and load it in both UI and composition before rendering.

## Agent workflow

Read the project first; use stable clip IDs and the current revision. Apply changes through MCP commands instead of writing the running project's JSON. Batch related edits into one undo step. To create new effect code, work in source files, run `npm run build` and the relevant tests, and restart the service after schema changes. Render actual frames to inspect appearance and report which frames were checked. Never claim to have watched or heard an export based only on screenshots.

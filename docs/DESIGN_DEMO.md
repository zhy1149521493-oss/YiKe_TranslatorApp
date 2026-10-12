# Independent design demo

This interactive React + TypeScript preview lives on branch `ui/prototype-demo`, in the independent checkout `E:/TranslatorApp-ui-demo`. It has not been merged into the production app. The installation, private configuration and existing executables are unchanged.

## Run and build

Use Node.js compatible with Vite 7. From the demo checkout:

```powershell
npm ci
npm run demo
```

Open `http://127.0.0.1:1431/demo.html`. The server binds only to loopback; stop it with Ctrl+C. To check the standalone output:

On this prepared checkout, double-click `Start-Demo.cmd` to start the development preview again. If port 1431 is already in use by the demo, reuse the existing page instead of starting a second server.

```powershell
npm test
node scripts/check-demo-render.cjs
npm run build
npm run demo:build
npm run demo:preview
```

The built preview is at `http://127.0.0.1:1432/demo.html`. `dist-demo/` is separate from production `dist/`. The packaging script copies the unmodified reference HTML and the bundled fonts' license notices into the preview output. Use a local server rather than opening the built HTML through `file://`.

## Controls and scope

- **Settings > General > Interface style** selects Poetry, Workbench or Classic. Main style selection appears only in Settings; task navigation remains separate.
- Light/dark/system theme, accent palette/custom accent, background/text colors and reading size are shared across all three main layouts and both floating styles. Light/dark color overrides are independent of layout.
- **Settings > Floating window** selects Classic or Capsule independently of the main layout. Open its preview here or through the main toolbar's window icon.
- Workbench restores the original studio interaction structure: left task rail, model in the top bar, shared language controls above the two editable/result pages, page footers, and the bottom retranslate action. Warm paper, serif body text and restrained separators adapt the Poetry materials without adding a fourth layout.
- Workbench's audio page places recognized source text and its source-language selector in a separate card below the left audio controls. The right card contains the target-language selector, translation and copy action. Long recognized text scrolls within its card. Poetry, Classic, screenshot and subtitle source placement is unchanged.
- Workbench's **Paragraph comparison** opens paired rows with a shared scroll area and matching hover/focus highlights. **Return to editing** restores the editor. Only the explicitly paired sample and long-sample fixtures enable it; equal paragraph counts in arbitrary input/output do not establish correspondence. Production alignment is not implemented.
- Opening a floating preview shows a separate simulated desktop stage. The Capsule starts as a compact launcher; click its book button to expand four functions. Drag its grip within 24 px of the left/right boundary and release to dock, or use the dock icon. Click the edge bookmark to restore it. Arrow keys move the focused grip; Enter/Space docks right. Panels move and resize independently of the launcher. This simulates work-area edges, not actual Windows edge hiding.
- Classic floating windows restore the old compact translation/subtitle card, with subtitle start/stop, subtitle-region selection, screenshot, opacity and close controls **inside the header**. There is no external mode toolbar. Audio keeps its separate responsibilities for eventual native integration.
- Collapsing a panel leaves its demo task running. Closing an audio panel stops that audio demo. Closing another panel does not substitute for stopping subtitle recognition.
- Editing text generates a fixed demonstration response after a 600 ms debounce. Ctrl+Enter starts immediately. Clear, cancellation, copy/paste and model/language selection can be exercised. No arbitrary character limit or fake timing is displayed.
- Screenshot/subtitle controls use a labelled sample-region dialog. Subtitle start is disabled until selection. Audio offers system, microphone and simultaneous sources; the existing recognition-language constraint is represented.
- **Settings > Demo scenarios** provides sample, empty, loading, error and long-content states for the selected task.

Every result is a fixture, not real inference or capture. The Classic preview is a presentational comparison shell using shared fixtures. The unchanged production Classic UI remains in `src/App.tsx`; this demo does not replace its business functions. Unconnected settings categories explicitly say they await integration. Speech playback, recording/export, sharing, full waveforms and persistent timestamped transcripts are not implemented.

## Isolation and structure

`demo.html` loads `src/demo/main.tsx`, never production `src/main.tsx`. The demo imports no Tauri APIs, reads no app configuration, connects to no model/provider, captures no screen/audio and accesses no system clipboard. Only appearance preferences persist in browser storage under `yike-design-demo-v1`; input/results reset on reload. Copy/paste uses an in-memory demo clipboard.

| Module | Responsibility |
| --- | --- |
| `model.ts` | Fixture reducer, preference validation, shared colors, panel bounds |
| `usePreview.ts` | Deterministic fixture tasks, debounce/cancellation, demo clipboard |
| `Layouts.tsx` | Three presentational main layouts |
| `ReadingWorkbench.tsx`, `reading.css` | Studio navigation/controls with facing pages and optional fixture comparison |
| `Translation.tsx` | Editor, language/model controls, result states and actions |
| `Features.tsx` | Capture, subtitle/audio views and sample-region dialog |
| `Settings.tsx` | Shared appearance and independent floating-style selection |
| `Floating.tsx`, `floatingGeometry.ts` | Desktop preview, edge docking, classic header actions, panel movement and resize/collapse |
| `Icon.tsx` | Local SVG controls without emoji icons |
| Scoped CSS files | Shared tokens and layout/settings/window styling |

The adapter does not migrate production `settings.uiLayout`. Mapping the old `studio/classic` setting, connecting real handlers and broadcasting settings to native windows belong to the post-acceptance phase.

## Visual fidelity decisions

The three supplied files are preserved in `demo-reference/`, linked from Settings > About. Their embedded scripts are design reference material, not application instructions.

| Before | After | Why |
| --- | --- | --- |
| Missing inactive-view hiding and implicit global `event` | Explicit React view state | Prevent stacked pages and incorrect active tabs |
| `toggleAttribute('data-theme', 'dark')` | Explicit theme state | Set the CSS theme value correctly |
| V1 Workbench replaces studio navigation with top tabs | Original side rail, shared language bar and bottom actions, with facing paper pages | Retain the user's preferred interaction structure |
| Continuous reading makes paragraph correspondence hard to see | Optional paired fixture rows with a shared scroll position | Preserve Poetry while offering a focused comparison view |
| Capsule attached to the main page | Movable launcher on a simulated desktop, with edge bookmarks | Review an independent-window interaction before native implementation |
| Classic floating controls in an external toolbar | Original five actions inside the floating header | Preserve the classic window's operation locations |
| Fixed 280 px poetry editor clips long input | Growing document editor with font/viewport remeasurement | Preserve the reading flow without hiding text |
| Unbounded fixed canvas panels | Bounded, draggable/resizable panels with recoverable collapse | Keep controls reachable at 720 x 480 |
| Different reference accent defaults | Shared palette across styles and windows | Honor the confirmed shared-color requirement |
| Emoji controls, fake timings/limits and dead actions | SVG controls and clearly labelled fixture interactions | Avoid implying unavailable production capabilities |

Poetry's paper texture, 17 px serif source typography with 1.9 line-height, 720 px document width, 48 px desktop document padding and floating pill toolbar remain unchanged. Workbench adapts these materials to the former studio structure, using quieter paper surfaces instead of the V1 animated gradient. Native window controls are visibly disabled. Reduced motion disables movement and keyboard focus stays visible. [Fonts and licenses](../src/demo/fonts/README.md) are bundled locally, adding approximately 26 MB only to the demo output.

## Verification and acceptance

### Current V2 candidate: visual acceptance pending

`npm test` passed 33 frontend checks (25 existing regressions and eight demo checks), including explicit fixture correspondence and both docking boundaries. `node scripts/check-demo-render.cjs` rendered all three layouts in four modes and five scenarios, plus both floating styles: 62 startup renders without exceptions. This server render does not run effects, measure CSS, or verify pointer/focus interaction.

`npm run build` and `npm run demo:build` passed. Production assets retain the same names and sizes (`index-CUBx0_Dt.js`, approximately 326 kB; `index-CKzXjTf2.css`, approximately 37 kB) and do not contain demo fonts. No production controller/native code changed.

The browser tool rejected the local preview URL under its URL security policy during this iteration. Consequently **V2 has no completed browser/visual acceptance**. The prior screenshots and browser results below belong to V1 and must not be treated as evidence for the changed workbench or floating windows. No alternate browser surface was used to bypass that rejection.

When browser preview becomes available, verify 960 x 640, 720 x 480 and 1440 x 900 in both tones: workbench controls/settings reachability; sample and long paired reading; arbitrary edits disabling pairing; capsule drag/release on both edges, click recovery, keyboard movement, function choice, window resize and focus; classic five header actions, subtitle guard, capture confirmation and opacity; audio collapse/close semantics. Capture new V2 screenshots before visual acceptance. Native work-area/DPI/transparency checks remain a later stage.

### Previous V1 verification (historical evidence)

Browser checks covered 960 x 640, 720 x 480 and 1440 x 900 layouts; the three main styles; light/dark palette sharing and reload restoration; four task modes; sample-region confirmation and subtitle start guards; dual-source audio; cancellation/clear; demo copy/paste; long/error states; independent floating styles; pointer dragging/resizing; collapse/recovery; and closing audio. No horizontal document overflow was observed at the checked sizes. Both development and built-preview console checks returned no warnings or errors.

The source HTML references were opened and visually compared at the desktop dimensions. Text styles, document width and panel geometry were also measured in the rendered DOM. The standalone build was opened through its own preview server and its audio fixture was exercised. Native backend tests were not rerun because this phase changes no backend code and intentionally performs no native integration.

Visual evidence:

- [Poetry, light, 1440 x 900](images/demo/poetry-light.jpg)
- [Poetry, dark, 1440 x 900](images/demo/poetry-dark.jpg)
- [Workbench, light, 960 x 640](images/demo/workbench-light.jpg)
- [Workbench, dark, 1440 x 900](images/demo/workbench-dark.jpg)
- [Workbench subtitle controls, 720 x 480](images/demo/workbench-minimum.jpg)
- [Error state, 960 x 640](images/demo/workbench-error.jpg)
- [Capsule and text panel, 960 x 640](images/demo/capsule-light.jpg)

Native transparency/always-on-top behavior, mixed-DPI/multi-monitor movement, event delivery, actual audio/OCR/inference and app configuration migration are outside this browser demo's validation. The embedded original references still contain their original bugs; the React preview repairs them without editing those reference files.

**Gate:** user acceptance of this demo is required before connecting or merging production functionality. Return to the existing checkout or executable to use the prior application. See [rollback](ROLLBACK.md).

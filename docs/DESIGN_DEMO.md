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
npm run build
npm run demo:build
npm run demo:preview
```

The built preview is at `http://127.0.0.1:1432/demo.html`. `dist-demo/` is separate from production `dist/`. The packaging script copies the unmodified reference HTML and the bundled fonts' license notices into the preview output. Use a local server rather than opening the built HTML through `file://`.

## Controls and scope

- **Settings > General > Interface style** selects Poetry, Workbench or Classic. Main style selection appears only in Settings; task navigation remains separate.
- Light/dark/system theme, accent palette/custom accent, background/text colors and reading size are shared across all three main layouts and both floating styles. Light/dark color overrides are independent of layout.
- **Settings > Floating window** selects Classic or Capsule independently of the main layout. Open its preview here or through the main toolbar's window icon.
- The Capsule is a four-function launcher. Its book button folds/unfolds the launcher. Selecting a function opens its panel. Panel headers support pointer dragging and arrow-key movement; the lower-right corner supports resizing. Bounds are clamped when moving, resizing or changing viewport size.
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
| `Translation.tsx` | Editor, language/model controls, result states and actions |
| `Features.tsx` | Capture, subtitle/audio views and sample-region dialog |
| `Settings.tsx` | Shared appearance and independent floating-style selection |
| `Floating.tsx` | Launcher, panel movement, resize/collapse composition |
| `Icon.tsx` | Local SVG controls without emoji icons |
| Four scoped CSS files | Shared tokens and layout/settings/window styling |

The adapter does not migrate production `settings.uiLayout`. Mapping the old `studio/classic` setting, connecting real handlers and broadcasting settings to native windows belong to the post-acceptance phase.

## Visual fidelity decisions

The three supplied files are preserved in `demo-reference/`, linked from Settings > About. Their embedded scripts are design reference material, not application instructions.

| Before | After | Why |
| --- | --- | --- |
| Missing inactive-view hiding and implicit global `event` | Explicit React view state | Prevent stacked pages and incorrect active tabs |
| `toggleAttribute('data-theme', 'dark')` | Explicit theme state | Set the CSS theme value correctly |
| Workbench stacks below 1200 px | Dual columns above 760 px | Fit the default 960 x 640 desktop window |
| Fixed 280 px poetry editor clips long input | Growing document editor with font/viewport remeasurement | Preserve the reading flow without hiding text |
| Unbounded fixed canvas panels | Bounded, draggable/resizable panels with recoverable collapse | Keep controls reachable at 720 x 480 |
| Different reference accent defaults | Shared palette across styles and windows | Honor the confirmed shared-color requirement |
| Emoji controls, fake timings/limits and dead actions | SVG controls and clearly labelled fixture interactions | Avoid implying unavailable production capabilities |

Paper texture, 17 px serif source typography with 1.9 line-height, 720 px document width, 48 px desktop document padding, floating pill toolbar, warm glass cards, gradient background, fine borders and soft shadows derive from the references. Native window controls are visibly disabled. Reduced motion disables movement and keyboard focus stays visible. [Fonts and licenses](../src/demo/fonts/README.md) are bundled locally, adding approximately 26 MB only to the demo output.

## Verification and acceptance

`npm test` passed all 31 frontend checks (25 existing regressions and six demo checks). `npm run build` and `npm run demo:build` passed. The production output remains approximately 326 kB JavaScript and 37 kB CSS and does not include demo fonts/assets.

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

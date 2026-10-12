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
- **Settings > General > Navigation behavior** selects persistent navigation (default) or hover disclosure for all three styles. Older saved demo preferences default to persistent navigation. This adds `navigation: "persistent" | "hover"` under the existing isolated browser storage key; production configuration is unaffected.
- On initial load the workspace is folded. Click a task to slide its workspace open; click the currently open task to fold it again, or use the small collapse handle. Select another task to open that task. Settings follows the same disclosure behavior; its Back/Close button returns to the current task. Escape returns from Settings first, then folds the task workspace. Folding does not unmount the current view or stop background fixture jobs. Task and Settings navigation highlights indicate the visibly open workspace only; all are unselected while it is folded, including on startup. Reopening restores the corresponding highlight.
- Poetry retains its horizontal top capsule; Workbench retains its left rail; Classic retains its header and four task tiles. Hover mode reveals these from the YiKe translation-bubble mark. An open workspace pins its entire navigation open, including Settings. Only after folding the workspace and leaving navigation does it shrink to the icon after a 180 ms delay; keyboard-visible focus can keep navigation available until focus leaves. Mouse/touch button focus does not pin navigation; a pointer press also clears an earlier keyboard pin even if the button was already focused. Touch users can tap the icon. The rail and Classic navigation occupy their original layout tracks in both behaviors, never covering open content. Existing responsive rail compaction is preserved. Clicking the brand while content is open folds that content first.
- Navigation uses 160 ms transitions; content uses a 240 ms slide/reveal and 200 ms fade, with reversible CSS transitions. Keyboard actions and reduced-motion preferences disable travel. Mount transitions progressively use `@starting-style`; browsers without support still display the selected workspace immediately. This changes the preview app shell, not native window sizes, transparency or edge docking.
- Light/dark/system theme, accent palette/custom accent, background/text colors and reading size are shared across all three main layouts and Classic floating windows. Light/dark color overrides are independent of layout.
- **Settings > Floating window** describes the retained Classic windows and opens their preview. The main toolbar's window icon also opens it. Capsule floating launchers and edge docking have been removed from the active demo at the user's request. Saved `floatingStyle: "capsule"` preferences normalize to `"classic"` without resetting other preferences; production configuration is unaffected.
- Workbench restores the original studio interaction structure: left task rail, model in the top bar, shared language controls above the two editable/result pages, page footers, and the bottom retranslate action. Warm paper, serif body text and restrained separators adapt the Poetry materials without adding a fourth layout.
- Workbench's screenshot, subtitle and audio pages place recognized text and source-language controls below the left capture/listening controls. The right side contains translation, target-language controls and copy actions. Long recognized text scrolls within its card. Screenshot/subtitle source placement in Poetry and Classic is unchanged.
- Audio keeps independent computer and microphone source/result/language state across all three layouts. Simultaneous listening shows two source cards side by side below Workbench controls and two labelled translation cards stacked on the right. Narrow screens stack the source cards. Each channel has independent source/target language selectors and copies only its own translation. The fixture callbacks arrive separately (computer at 900 ms, microphone at 1300 ms) with distinct sample sentences. Switching sources during listening preserves completed channel content and cancels pending callbacks for inactive channels; stopping cancels both. Explicitly starting again resets the selected channels. These language selections do not change the fixed fixture translation or run recognition.
- Workbench's **Paragraph comparison** opens paired rows with a shared scroll area and matching hover/focus highlights. **Return to editing** restores the editor. Only the explicitly paired sample and long-sample fixtures enable it; equal paragraph counts in arbitrary input/output do not establish correspondence. Production alignment is not implemented.
- Opening a floating preview shows a separate simulated desktop stage with the Classic translation/subtitle card, or an audio panel when opened from the audio page. Panels support title dragging and resize; no floating capsule or edge bookmark remains.
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
| `Disclosure.tsx`, `disclosure.css`, `workspace.ts` | Nonmodal navigation disclosures, motion, workspace visibility and settings/task transitions |
| `ReadingWorkbench.tsx`, `reading.css` | Studio navigation/controls with facing pages and optional fixture comparison |
| `Translation.tsx` | Editor, language/model controls, result states and actions |
| `Features.tsx` | Capture/listening controls, source/result placement and sample-region dialog |
| `AudioTranscript.tsx` | Labelled per-channel source/result cards, language selectors and copy actions |
| `Settings.tsx` | Shared appearance, navigation behavior and Classic floating preview entry |
| `Floating.tsx` | Classic desktop preview/header actions, audio panel, movement and resize/collapse |
| `Icon.tsx`, `BrandMark.tsx`, `brand/` | Semantic SVG controls, themed YiKe outline brand and cleaned supplied app artwork |
| Scoped CSS files | Shared tokens and layout/settings/window styling |

The adapter does not migrate production `settings.uiLayout`. Mapping the old `studio/classic` setting, connecting real handlers and broadcasting settings to native windows belong to the post-acceptance phase.

## Visual fidelity decisions

The three supplied files are preserved in `demo-reference/`, linked from Settings > About. Their embedded scripts are design reference material, not application instructions.

| Before | After | Why |
| --- | --- | --- |
| Missing inactive-view hiding and implicit global `event` | Explicit React view state | Prevent stacked pages and incorrect active tabs |
| Navigation and workspaces always occupy the screen | Shared persistent/hover navigation plus click-to-reveal content drawers | Support the requested compact launcher interaction while retaining all three silhouettes |
| Hover rail covered source text while its workspace stayed open | Pin navigation while the workspace is open; restore original rail/header layout tracks | Preserve the original complete interface and prevent text occlusion |
| Generic book brand in navigation | Two translation bubbles with A/Chinese strokes; supplied color artwork for the demo favicon | Match the user-supplied app identity while keeping functional icons recognizable |
| A collapse could be confused with stopping or closing a task | Visibility reducer separate from the fixture task controller; children remain mounted | Preserve task state, reading position and in-progress jobs on folding |
| `toggleAttribute('data-theme', 'dark')` | Explicit theme state | Set the CSS theme value correctly |
| V1 Workbench replaces studio navigation with top tabs | Original side rail, shared language bar and bottom actions, with facing paper pages | Retain the user's preferred interaction structure |
| Continuous reading makes paragraph correspondence hard to see | Optional paired fixture rows with a shared scroll position | Preserve Poetry while offering a focused comparison view |
| Experimental Capsule floating launcher | Classic translation/subtitle and separate audio panels only | Follow the revised user scope while retaining main navigation capsules |
| Recognized text shares the right result card | Workbench source cards below left controls, translations on the right | Keep capture and recognized input together |
| Simultaneous audio shares one result | Independent labelled computer/microphone source and translation cards | Prevent one source from replacing the other and clarify correspondence |
| Classic floating controls in an external toolbar | Original five actions inside the floating header | Preserve the classic window's operation locations |
| Fixed 280 px poetry editor clips long input | Growing document editor with font/viewport remeasurement | Preserve the reading flow without hiding text |
| Unbounded fixed canvas panels | Bounded, draggable/resizable panels with recoverable collapse | Keep controls reachable at 720 x 480 |
| Different reference accent defaults | Shared palette across styles and windows | Honor the confirmed shared-color requirement |
| Emoji controls, fake timings/limits and dead actions | SVG controls and clearly labelled fixture interactions | Avoid implying unavailable production capabilities |

Poetry's paper texture, 17 px serif source typography with 1.9 line-height, 720 px document width, 48 px desktop document padding and floating pill toolbar remain unchanged. Workbench adapts these materials to the former studio structure, using quieter paper surfaces instead of the V1 animated gradient. Native window controls are visibly disabled. Reduced motion disables movement and keyboard focus stays visible. [Fonts and licenses](../src/demo/fonts/README.md) are bundled locally, adding approximately 26 MB only to the demo output.

## Verification and acceptance

### Current V3.2 recognition-split and Classic-only candidate: visual acceptance pending

`npm test` passed 43 frontend checks (25 existing regressions and eighteen demo checks). Audio callback/reducer checks cover staggered independent results, stopping pending callbacks, switching active sources while preserving completed data, and per-channel language/copy isolation. Preference checks cover migration of old Capsule values to Classic. Three disclosure callback checks retain the mouse/keyboard focus regressions across the navigation variants. Hook tests use mocked state and timers; they do not run effects, real DOM focus, devices or inference.

`node scripts/check-demo-render.cjs` passed 724 startup renders: 720 main-layout combinations across three layouts, task modes (including all three audio source choices), five scenarios, two navigation behaviors, task/settings views and folded/open states; four Classic floating cases cover text and each audio source choice. Assertions cover source/result channel identity, Workbench OCR/subtitle source placement in markup, folded selection clearing, open-workspace navigation pinning and absence of the retired floating capsule. Server rendering does not measure CSS, pointer geometry, scroll or animation.

`npm run build` and `npm run demo:build` passed. Production assets retain the same names and sizes (`index-CUBx0_Dt.js`, approximately 326 kB; `index-CKzXjTf2.css`, approximately 37 kB) and do not contain demo fonts. No production controller/native code changed.

The browser tool previously rejected the local preview URL under its URL security policy. Consequently **V2, V3, V3.1 and V3.2 have no completed browser/visual acceptance**. The prior screenshots and browser results below belong to V1 and must not be treated as evidence for the changed workbench, disclosures or floating windows. No alternate browser surface was used to bypass that rejection.

The supplied SVG and new outline were rasterized and inspected separately: [cleaned color artwork](images/brand/app-cleaned.png), [outline mark](images/brand/outline.png). These are asset checks, not evidence of full-page rendering or animation. See [asset provenance and exports](../src/demo/brand/README.md).

When browser preview becomes available, verify 960 x 640, 720 x 480 and 1440 x 900 in both tones: all three navigation silhouettes/preferences; logo-to-menu pointer travel, workspace pinning, folding/departure, keyboard/touch recovery, rapid reversal, settings reload and reduced motion. Check screenshot/video/audio source cards below Workbench controls; simultaneous audio's two source cards and two matching result cards, long-content scrolling, independent languages/copy, source switching and stop during staggered callbacks. Check Classic header actions and audio-panel close/return/Escape stopping both channels; old Capsule preferences must reopen Classic. Capture new V3.2 screenshots before visual acceptance. Native DPI/transparency and device/event checks remain a later stage.

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

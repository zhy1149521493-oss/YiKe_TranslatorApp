# Responsive Poetry reading layout

The Poetry workspace remains one continuous vertical reading page. Original text, its editing actions and the translation follow one another in document order. The toolbar, paper texture, serif typography and native drawer behavior remain in place. The reading column grows with the window up to 1040 CSS pixels; it does not stretch across the entire screen. Reading text uses a minimum 18-pixel serif size, or the larger saved reading size.

Empty and short passages use compact, height-sensitive minimums and smaller separators instead of a fixed 280-pixel blank editor and large section gaps. The editor grows with actual text and remeasures after window/container width changes or offline font loading. Clearing text shrinks it again. Long passages continue down the page and may require page scrolling; long documents are intentionally not forced into two equal-height panes. Settings retain their existing page scrolling.

Screenshot and subtitle pages in all three main styles no longer render the large dashed capture placeholder or repeat recognized text in it. Their compact control area retains screen selection, screenshot translation, subtitle start/stop, FPS, region readiness, status and the system OCR test. Recognized text and translation remain in their respective reading areas. Poetry audio retains real meters and independent computer/microphone columns. Auxiliary Classic floating windows are unchanged.

## Implementation and verification

`src/interface/poetry.css` owns the reading measure, responsive spacing and thin theme-aware page scrollbar. `Translation.tsx` remeasures the flowing editor with a width observer, resize listener and font readiness callback; cleanup detaches them. `Features.tsx` provides the compact capture summary. The desktop controller, task queues, OCR/ASR commands and saved configuration schema are unchanged.

Run `npm test` and `npm run build` from the repository root. Regression tests render long original/result content without truncation, exercise editor remeasurement/cleanup, and check that capture, language, FPS and OCR-test controls remain present after removing the placeholder. These tests do not prove visual sizing. Desktop acceptance must check the default 960×640 window, 720×480 minimum, maximized view, long passages, light/dark colors, capture/subtitle controls and folding/reopening. Device OCR/ASR accuracy is outside this layout change.

The first experimental equal-height/wide-column candidate was inspected on the desktop but rejected by the user for losing the vertical reading feel. It is not the accepted design. The revised flowing-page candidate requires renewed desktop visual acceptance; computer automation was stopped by the user during the first experiment and was not resumed in that turn.

The source is isolated on `fix/poetry-responsive-layout`. The previous executable and `checkpoint/native-drawer-2026-10-12-candidate` remain available; see [rollback instructions](ROLLBACK.md).

The revised local executable is `E:/TranslatorApp/译刻-诗集阅读修正版.exe`. Exit the running tray instance before launching it. The earlier `译刻-诗集优化版.exe` is the rejected equal-height experiment and should not be used to judge this revision. The final revision passes 65 frontend checks and the frontend/Tauri release build; native visual acceptance is still pending. Source, executable identity and font licenses are recorded in the [candidate archive](../../TranslatorApp/archives/poetry-reading-2026-10-12-candidate/README.md). No original executable or private configuration was replaced.

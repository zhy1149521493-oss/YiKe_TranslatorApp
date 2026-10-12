# Runtime architecture and request lifecycle

## Isolated design preview

`demo.html` and `src/demo/main.tsx` form a separate entry. `model.ts` owns typed fixture state and shared appearance preferences; `usePreview.ts` is an in-memory task/clipboard adapter. Layout, translation, recognition, settings and floating-panel components consume this single controller. They import no production controller or Tauri APIs. `vite.demo.config.ts` builds `dist-demo/`, separately from the main app. See [design demo boundaries and validation](DESIGN_DEMO.md). Native window integration and production configuration migration await user acceptance.

`ReadingWorkbench.tsx` keeps the studio rail/top model bar, shared text-language controls and bottom action. Its editor and paired-reading view share task state. `fixturePairs` accepts only complete, explicitly known sample fixtures; it does not infer alignment from paragraph counts. `Floating.tsx` renders a simulated desktop with a separately movable Capsule launcher and function panel, or the restored Classic header/body. `floatingGeometry.ts` defines the edge threshold against browser bounds; monitor work areas, always-on-top/transparency and native window synchronization are not connected. Both styles use the same appearance tokens as all three main layouts. V2 visual acceptance remains pending.

## Components

`src/App.tsx` routes to main, translation floating, audio floating or screenshot overlay components using the native window label. The main window owns configuration and provider selection, and orchestrates translation. React and CSS are embedded into the portable executable by the Tauri CLI release build.

The main window's studio/classic layouts share state and translation handlers. `src/Studio.css` scopes the redesign to `.studio` and the main document's `data-layout="studio"`; auxiliary windows retain `src/App.css` and their original palettes. `settings.uiLayout` selects the layout without changing native IPC. `scripts/ui-preview.mjs` supplies development-only fixture IPC through Vite and is not included in the production frontend. See [workbench behavior](WORKBENCH.md).

`src/text-tools.ts` provides bounded language heuristics and conservative normalized subtitle deduplication. Uncertain source detection returns `auto`; prompts then ask the model to detect the original language. These heuristics do not replace a full language-identification model.

`src/request.ts` bounds the complete translation operation to 60 seconds. Its AbortSignal is passed to local Ollama fetch calls, including body reads. For native API IPC calls, the UI task settles on cancellation and the channel ignores late callbacks; the HTTP operation itself currently runs until its existing native timeout/completion.

`src/latest-task.ts` serializes main text, video, screenshot and clipboard work per queue, keeping the newest pending request. Input/settings changes, stop/close and effect cleanup invalidate prior results. Video OCR returns directly to its requesting polling effect, so old frame results cannot become events in a new session. Screenshot OCR keeps source and request context together.

`src/audio-tasks.ts` has independent queues for system audio and microphone. Jobs include a native session ID and utterance ID, source, text and final state. Pending partials coalesce; finals are preserved rather than overwritten by the next partial. Pending work is bounded to three jobs to match the short display history under slow inference. Recognition events own history finalization; results update matching IDs/text. A partial result cannot overwrite a finalized line. Stopping or changing translation settings invalidates the queue.

`src-tauri/src/lib.rs` implements commands, portable resource paths, provider HTTP requests, OCR/capture and window orchestration. `streaming.rs` decodes byte-buffered SSE; `capture_bounds.rs` translates validated physical desktop rectangles into monitor-local crops. A crop must fit one monitor; cross-monitor or stale/out-of-bounds regions return an error instead of panicking.

`src-tauri/src/audio.rs` owns WASAPI capture and sherpa-onnx recognition. The engine-map mutex protects short state operations; a separate lifecycle mutex serializes start/stop/restart. Engine snapshots do not carry the map lock into loops, and capture threads are joined after releasing it. Start/stop commands use the blocking worker pool. Each recognizer start assigns a monotonic session ID, and each endpoint advances an utterance ID. `audio_samples.rs` decodes supported formats and handles silent packets without reading the packet pointer.

Audio floating windows have an event-only capability for status listening and close notifications. Recognition is forwarded directly by native eval to `__audioPartial` / `__audioFinal`; translated output is forwarded to `__audioShow`. Shared reducers attach text/results by identity in both the main and floating windows.

## Changed internal IPC contracts

These interfaces are internal. Ship matching frontend and backend binaries; consumers of the old events/return values must migrate as follows.

| Command/event | Current shape and behavior | Previous behavior |
| --- | --- | --- |
| `capture_fullscreen` | Returns `{ b64, x, y }`; `x/y` are the primary monitor's physical desktop origin. Overlay image crops remain image-local, while emitted regions add the desktop origin. | Returned only the base64 string and selected the first enumerated monitor. |
| `screenshot_ocr` | Returns its own OCR text or rejects with an error, using a blocking worker. | Returned `processing`, later emitted a shared `ocr-done` event. |
| `subtitle_frame` | Returns OCR text, including `ERROR:` messages, directly to the requesting poll. | Returned `processing`, later emitted `subtitle-ocr`. |
| `audio-status` | `{ source, session, status }`; obsolete sessions and explicitly stopped sources are ignored. | Had no session field. |
| `audio-partial` / `audio-final` | `{ source, session, id, text }`; `id` is `session:utterance`. Native partial/final window injection uses the same object. | Had only source/text; window partial injection took a string. |
| `audio_forward_to_floating` | Requires `id` and `session` in addition to source/text/language/result/role. Results update existing history by identity. | Updated whichever line occupied the current/previous position when translation finished. |
| `audio_subtitle_start` / `audio_subtitle_stop` | Asynchronous commands using blocking workers; success resolves without a payload, failure rejects. | Synchronous start/stop could block IPC while joining/reloading capture. |

Configuration remains version 3, with the existing paths and keys. Restored subtitle coordinates are interpreted as physical desktop coordinates. Regions saved by older builds assumed a zero-origin primary monitor; reselect the region if the display arrangement changed. Default subtitle capture uses the monitor containing the main window; the screenshot-selection overlay currently covers the primary monitor.

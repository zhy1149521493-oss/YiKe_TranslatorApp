# Startup and durable preferences

The main interface no longer waits inside Tauri setup for bundled Ollama cleanup/startup or for four hidden WebViews. `src-tauri/src/startup.rs` starts the engine on a worker and prewarms the same translation, system-audio, microphone and screenshot windows after the main frontend's first-paint acknowledgment. A two-second fallback still starts prewarming if that acknowledgment is unavailable. Window creation stays on a separate thread, avoiding the synchronous Windows/WebView2 command or event-handler construction documented to deadlock by the installed Tauri API.

Each auxiliary frontend acknowledges its configuration and mounted event listeners. Opening an auxiliary window waits asynchronously for this acknowledgment, with a 30-second limit and an explicit initialization error. Audio capture waits before starting WASAPI, screenshot capture waits before sending `overlay-start`, and subtitle publishing waits before its first stream. Thus early clicks do not silently lose their first events. Hidden windows acknowledge without `requestAnimationFrame`, which can be suspended while hidden. The existing labels, close/source-stop behavior, recognition engines and task queues remain.

Local model discovery runs independently of rendering. It waits for engine initialization, then retries connection failures up to 12 times, 700 ms apart; each request has a two-second deadline. A successful empty list finishes immediately. Manual model refresh has a five-second deadline. These changes remove known blocking work; no cold-start speedup or first-inference benchmark is claimed without native measurements. Native stderr diagnostics record elapsed milliseconds and window labels, never configuration contents.

The first local translation waits for that shared discovery operation within its normal cancellation/deadline guard. Cancelled work cannot issue an inference request after discovery finishes. External API translations do not wait for the local service.

The existing warning for an occupied Ollama port opens on its own worker. Dismissing that warning is not a prerequisite for completing engine initialization or discovering models.

After preference flushes succeed, shutdown stops further prewarming, wakes pending readiness requests, and destroys a window whose creation finished during teardown. This prevents an immediate exit from leaving a late auxiliary WebView outside the teardown snapshot.

## Saving and restoring

Application exit waits for the three existing floating WebViews to acknowledge their final shared-opacity and sensitivity writes after the main writer flushes. Native caller identity and an attempt ticket reject unrelated, stale and duplicate acknowledgments. A failed save or six-second acknowledgment timeout cancels exit; successful completion destroys auxiliary WebViews first and the main WebView last before exiting. No configuration lock is held while waiting for JavaScript or native teardown.

`src/config-writer.ts` starts a save as soon as a hydrated preference changes, replacing the previous 400 ms debounce gap and duplicate full-snapshot writers. Writes are serialized and rapid edits coalesce. Only changed fields are sent. The native configuration mutex serializes read/merge/write operations, and recursive object patches preserve settings edited by another window and unknown fields from compatible versions. Arrays and scalar values replace their prior values; an explicit `null` clears a nullable value. Configuration version remains 3.

The main window rebases externally updated floating appearance before its next save, so changing a theme or model does not restore an old floating opacity. Normal close and tray exit flush pending saves. A real save failure keeps the application open and displays an error; tray failures bring the main window forward. A malformed or unreadable existing configuration disables automatic saves and shows a persistent warning, while still allowing exit without modifying that file. A missing configuration uses defaults and can be created normally. The application does not promise survival of a forced process kill during an unsent UI event or an operating-system/storage failure.

These formerly omitted preferences now restore after restart:

| Configuration path | Default | Meaning |
| --- | --- | --- |
| `settings.translate.model` | `maternion/hy-mt2:1.8b` | Selected local translation model |
| `settings.audio.mode` | `system` | `system`, `mic` or `both`; does not start capture automatically |
| `settings.audio.sensitivities` | 0.6 seconds for each supported language | ASR endpoint trailing-silence settings for `auto`, `zh`, `en`, `ja` and `ko` |

Sensitivity writes validate supported languages and finite numbers, clamp to the existing 0.1–5.0 second range, and persist before updating/broadcasting the value. Restore ignores unsupported or invalid entries. Source/target languages, providers, theme, main style/navigation, shared opacity, denoising, shortcuts and subtitle settings keep their existing paths. Older executables may ignore the new optional fields; rolling back does not require deleting the configuration.

Main Settings and audio-window sensitivity sliders serialize live writes and commit the final displayed value before rebuilding a recognizer. Pointer release and keyboard adjustment both apply the final value; normal exit waits for pending sensitivity writes as well as the main configuration writer.

## Verification

Run from the source root:

```powershell
node --test tests/config-writer.test.cjs tests/settings.test.cjs tests/startup-models.test.cjs tests/startup-routing.test.cjs tests/audio-sensitivity.test.cjs tests/render.test.cjs
npm test
npm run build
Push-Location src-tauri
cargo test --lib --locked --offline
Pop-Location
```

Focused tests cover immediate/serialized saves, concurrent appearance updates, provider-array removal, nullable region clearing, migration, read/save failures, flush-before-quit, local-model/source restoration, bounded model discovery, auxiliary readiness and sensitivity validation. Native acceptance must also check first launch, immediate first-use windows, normal exit/restart with changed preferences, hidden-window event delivery and actual device/model readiness. Unit tests and a successful build alone do not establish startup speed or live audio accuracy.

The candidate passed normal-exit/relaunch checks for style, tone, pinning, audio mode and final shared opacity with three auxiliary windows open. Opening each auxiliary window from Settings did not start capture. See [the acceptance scope](WINDOW_BEHAVIOR.md#candidate-acceptance) for exact checks and pending OS/device/startup measurements.

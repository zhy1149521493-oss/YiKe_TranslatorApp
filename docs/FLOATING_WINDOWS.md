# Classic floating windows

The translation/video-subtitle window and the independent computer-audio and microphone windows use one `FloatingChrome` component. They remain real desktop windows; selecting a main-window layout does not change their shape or controls.

## Appearance

- The visible rectangle fills the native client area without an invisible outer gutter. Square corners allow neighboring window edges to meet cleanly.
- All three window types use the same 44-pixel header, action sizing, resize affordance, warm light/dark palette, separators and empty states. Computer audio and microphone have distinct icons and labels.
- Theme and accent follow the shared application settings, including operating-system theme changes. Existing per-surface background, foreground and font-size overrides remain available.
- **Follow shared theme** in Settings clears explicit background/foreground colors for the four auxiliary surfaces in one action. It preserves all font sizes, opacity values and the entire main-window appearance; legacy custom colors are not reset automatically.
- Auxiliary opacity is shared across translation, subtitle, computer audio and microphone. `settings.appearance.floating.opacity` is the canonical value when opening older configurations with differing opacity values. The main window retains its own opacity.
- A quick settings slider is labeled **Shared opacity** and shows its percentage. The settings subscription installs before reading configuration and discards an older configuration response if a newer settings broadcast has already arrived.
- The main Settings sliders for auxiliary windows update the same shared value. A failed quick-slider save displays an error in the window's settings instead of silently claiming persistence.
- Quick-slider writes are serialized per window and intermediate positions coalesce to the latest input. Earlier broadcasts do not pull an active slider backwards while its latest write is pending.
- Each mounted floating window exposes an asynchronous settings-flush boundary. It waits for the final coalesced opacity write and, for audio windows, all queued sensitivity writes/applications before acknowledging completion to the native exit coordinator.
- Failed opacity and per-language sensitivity writes remain dirty. A subsequent flush retries them; newer input for the same value supersedes the failed request. A failure that persists rejects the exit barrier instead of acknowledging an unsaved value.

The appearance hook applies saved colors before showing the chrome and signals `frontend_ready` after listener effects have mounted. Hidden WebViews use a task rather than an animation frame for this signal because they may throttle animation frames.

## Retained behavior

Settings > Floating windows provides **Open translation**, **Open computer audio** and **Open microphone** actions for arranging the actual desktop windows. These actions preserve existing content and do not start audio recognition. A failure to open is reported in the main window. Starting or stopping recognition remains an explicit audio-task action.

Translation-window actions still start/stop video subtitles, select the subtitle region, launch screenshot translation, show settings and close the window. Closing an audio window stops only its corresponding source. Text, previous/current recognized lines, asynchronous results and source/session identity still belong to the existing controllers in `App.tsx`.

The header delegates dragging to `start_window_drag`; the lower-right handle delegates resizing to `floating_resize_begin`. Buttons and form controls do not start dragging. Native magnetic placement is implemented independently of the shared React chrome.

Long content scrolls inside the window and remains selectable. Reduced-motion preferences suppress the previous-line motion. Existing language-specific audio segmentation controls remain in each audio window's settings.

Audio segmentation sliders update their displayed value on every input. Releasing a pointer, completing a keyboard adjustment or leaving the control commits its actual final value before applying it to the running recognizer; the live-update throttle cannot discard the last adjustment. Failed commits are shown in the floating settings.

## Validation

```powershell
node --test tests/floating-appearance.test.cjs tests/floating-settings-flush.test.cjs tests/audio-sensitivity.test.cjs tests/render.test.cjs
npm run build
```

The focused tests cover legacy opacity normalization, retained per-surface customization, shared light/dark/system tokens, malformed optional appearance values, stale hydration responses, unmount cleanup, final-write exit barriers and retained translation/audio controls. Native visual inspection is required separately to assess actual desktop transparency, edge placement, dragging and resizing; static rendering does not verify these behaviors.

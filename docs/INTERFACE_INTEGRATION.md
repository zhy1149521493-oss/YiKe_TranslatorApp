# Connected three-style desktop interface

The approved V3.2 visual design is connected to the existing desktop controller on local branch `ui/design-integration`, in `E:/TranslatorApp-icon-update`. This is a local integration candidate, not a public release. The independent Demo remains available on `ui/prototype-demo`. Existing original, repair and workbench executables are retained.

## Use the candidate

Exit any existing YiKe instance through its tray menu, then run `E:/TranslatorApp/译刻-新版界面.exe` beside the existing portable resources. The executable shares the installation configuration and recognition/model resources. It does not import Demo local-storage preferences. Settings > General > Interface layout selects **Poetry**, **Workbench** or **Classic**. Style selection is available only in Settings; the toolbar switches functions. Older `studio` preferences select Workbench, and older `classic` preferences select Classic. Missing preferences retain the previous Workbench default.

All three styles share light/dark/system theme, accent, main background/text and font settings. Default accents are clay `#C8886D` in light mode and `#D9987F` in dark mode; an existing custom accent takes precedence. Original floating windows retain their layout and controls, with the shared theme/accent. Fonts load locally. Full Inter and Noto Serif SC assets add approximately 26 MB before executable compression; their OFL notices ship in `public/licenses/` and with the local archive.

Persistent navigation is the default. Hover mode folds navigation to the logo after the workspace is folded and the pointer leaves. An open workspace pins navigation; keyboard-visible focus retains keyboard access. Clicking a selected function folds its content; clicking another opens that function. Folding clears navigation selection and keeps tasks running. Escape folds the task workspace or returns from Settings; shortcut recording keeps ownership of its key events. Folded workspaces are inert. Minimize, maximize/restore, close and blank-title dragging use existing native operations. Closing the main window still follows hide-to-tray/quit settings.

## Component and functional mapping

The follow-up [native drawer correction](NATIVE_DRAWER.md) removes the empty desktop rectangle after folding. It clips the main window's painting and hit testing to navigation/logo bounds while retaining the expanded reading canvas. The previous candidate described below remains archived.

| Presentation component | Live state / command | Preserved behavior |
| --- | --- | --- |
| `ConnectedMain`, `Layouts`, `Disclosure` | MainWindow mode/settings, local disclosure state | Three silhouettes, workspace pinning, folded selection clearing, keyboard/reduced-motion handling; folding never stops a job |
| `Translation`, `ReadingWorkbench` | Main input/output, LatestTask, model selector, clipboard plugin | 600 ms debounce, streaming/full output, deadlines, latest request wins, Ctrl+Enter, copy/paste/clear, language conflict hint |
| `Features` screenshot | Screenshot queue, `open_screenshot_overlay`, existing OCR/translation handlers | Real screen selection, OCR status/errors, source/result isolation; no fixture image or made-up translation |
| `Features` subtitle | Current subtitle/region/FPS and start/stop functions | Existing OCR engine, scheduling, default region, OCR test, native subtitle window and audio mutual exclusion |
| `AudioTranscript`, live audio meters | Source/session/utterance history, independent queues, native audio level events | Separate computer/microphone originals, translations, language choices, copy actions and actual levels |
| Existing Settings content | Original settings state and handlers | Providers, tests/model picker, local downloads/import/deletion, recognition components, sensitivities/denoise, shortcuts and appearance controls |
| Existing `FloatingWindow` / `AudioFloatingWindow` | Original native events and lifecycle | Classic controls stay on the actual floating windows; audio-window close stops that source; no Capsule launcher |

Workbench puts screenshot/video recognized text below the left controls, matching audio. Simultaneous audio uses two source cards on the left and two translation cards on the right. Histories retain up to three entries per source, including the current empty marker, so a busy computer channel cannot evict microphone content. Matching also checks source alongside utterance identity. Audio start/source changes serialize pending operations; each channel uses its own ASR language and translation direction. Source-language controls are disabled while listening or changing capture state. Target-language changes cancel only that channel's pending translation. Settings > Audio restores both channel overrides to the audio default after listening stops. ASR still supports only automatic/Chinese/English/Japanese/Korean recognition.

Demo fixtures, capture dialog, simulated volume waveforms and fixture-only paragraph alignment are excluded from the production entry. Workbench uses facing pages; arbitrary translations are not presented as verified aligned paragraphs. Both model pickers in dual-audio results control the same translation engine, as before; per-channel model selection is not implemented.

## Configuration compatibility

Configuration version remains 3. Existing business keys stay in place. New optional fields:

```json
{
  "settings": {
    "uiLayout": "studio",
    "design": { "mainStyle": "poetry", "navigation": "persistent" },
    "audio": {
      "channelLanguages": {
        "system": { "src": "en", "tgt": "zh" },
        "mic": null
      }
    }
  }
}
```

`mainStyle` accepts `poetry`, `workbench`, `classic`; `navigation` accepts `persistent`, `hover`. Invalid design values fall back to the previous layout/default. A null/missing channel pair follows the existing audio mode language. Invalid channel pairs are rejected independently; target `auto` is invalid. Saving preserves unrelated top-level and nested settings keys. Legacy `uiLayout` remains `studio` for Poetry/Workbench and `classic` for Classic, so old binaries can load their supported fallback. Old binaries may remove unknown optional fields when saving; they cannot preserve new-style choices reliably. Never commit the private runtime configuration or API keys.

## Before / after / reason

| Before | After | Reason |
| --- | --- | --- |
| Approved UI used deterministic sample jobs and capture dialogs | Typed presentation adapter calls existing live handlers | Preserve production queues and avoid simulated success |
| Title-bar layout toggle mixed style and task navigation | Three styles selected only in Settings | Keep toolbar actions focused and preferences consistent |
| Audio history shared one three-entry limit | Three entries retained per source; results match source and identity | Avoid cross-source eviction or overwriting |
| ASR used one common language for both devices | Each channel can override recognition/translation languages | Support simultaneous conversations with different directions |
| Demo paired reading was restricted to known fixtures | Live Workbench uses facing pages without asserted alignment | Avoid implying unavailable real alignment |
| Browser-only window controls were disabled | Existing native operations are wired, including when folded | Make the design usable as a desktop application |

## Validation and remaining acceptance

`npm test` passes 57 frontend checks, including actual controller callbacks, inference router synchronization, native command dispatch, asynchronous settings hydration, all settings sections across three styles, per-source retention, rapid audio startup serialization and production disclosure focus callbacks. Some retained checks cover the independent Demo; they are not evidence of native behavior. `npm run build`, `npm run demo:build` and eight Rust tests also pass. The Rust loopback API fixture initially received a proxy-related 502; removing HTTP/HTTPS/ALL proxy variables and setting NO_PROXY to localhost/127.0.0.1 only in the test process allowed all eight tests to pass. The native Tauri release build passes and is installed separately as `译刻-新版界面.exe` (54,091,776 bytes). Its SHA-256 is `5ddf595ae8800a494abb75b47a9535afd8e65545e8f7da120225f4ccfdd15a6c`. See the [candidate archive](../../TranslatorApp/archives/design-integration-2026-10-12-candidate/README.md) and its manifest for compiled source/binary identity and build results.

Actual desktop visual acceptance remains pending. The preview tool previously rejected the local URL under its URL policy; no alternate browser path was used to bypass that rejection. Server rendering and compilation do not verify pixels, overflow, pointer hit regions or native WebView animation. The candidate must be checked at 960×640 and 720×480, enlarged/DPI-scaled, in all three styles and themes, with long text, Settings, hover folding, native title buttons and actual clipboard. Device-level OCR/dual audio/subtitle workflows and third-party API credentials also require native smoke testing; automated tests use dummy state/IPC and do not activate microphones or paid services.

See [rollback and checkpoints](ROLLBACK.md), [runtime architecture](ARCHITECTURE.md) and [offline font notices](../src/assets/fonts/README.md).

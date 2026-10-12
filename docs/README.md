# YiKe developer documentation

The independent [design demo](DESIGN_DEMO.md) previews Poetry, Workbench and Classic layouts plus independent floating-style selection. The V2 candidate restores studio controls with paper reading surfaces, adds paired fixture reading, and demonstrates capsule edge docking and classic header actions. Compilation and startup checks pass; V2 browser/visual acceptance is pending. It is not merged into the desktop app; run `npm run demo` in the demo checkout. Main-app setup and behavior below remain unchanged.

YiKe is a Windows desktop translator built with React, TypeScript and Tauri. It translates text using local Ollama models or an OpenAI-compatible API, and includes selection/clipboard translation, screenshot OCR, video subtitle OCR and streaming audio recognition. OCR and ASR are separate recognition components; this repository does not train translation models.

## Setup and development

Use Windows 10/11 x64 with WebView2, Node.js compatible with Vite 7, Rust with the MSVC toolchain, and the Windows SDK/C++ build tools. This review used Node.js 24.18.1. Run these commands from the repository root:

```powershell
npm ci
npm run tauri dev
```

The native application resolves `config.json`, `ollama/`, `models/`, `ocr/` and `asr/` relative to its executable, not the shell working directory. Development executables live under `src-tauri/target/debug/`; arrange the required runtime resources there when testing local inference. The existing portable installation on this machine is `E:/TranslatorApp`. Do not copy a real API key into the repository.

Local translation requires an Ollama executable/runtime and at least one downloaded or imported model. API translation requires a configured provider. Screenshot/video recognition additionally requires the selected OCR engine; audio recognition requires the corresponding ASR model. Optional GTCRN denoising requires `asr/denoise/gtcrn_simple.onnx`. Installed components can be managed under Settings > Models.

## Build and run

```powershell
npm run tauri build -- --no-bundle --ci
```

The portable executable is `src-tauri/target/release/tauri-app.exe`. Place it alongside the runtime resources and required DLLs of a prepared portable installation. Use the Tauri CLI to build releases: a bare `cargo build --release` does not enable the asset embedding feature used by this application. The application enforces a single instance; exit the existing instance through the tray before trying a different executable.

The repair build is delivered as `E:/TranslatorApp/译刻-修复版.exe`. It supersedes the earlier UI-only trial build. The original executable was retained. This is a local trial build, not a published release.

The redesigned build is delivered separately as `E:/TranslatorApp/译刻-工作台版.exe`. See [workbench controls and preview](WORKBENCH.md) and [source/binary rollback](ROLLBACK.md). The new layout can switch immediately to classic; optional `settings.uiLayout` defaults to `studio` and also accepts `classic`.

## Configuration and behavior

Configuration version 3 is stored in `config.json` next to the executable. Configure providers through the UI using a base URL, API key and model. Keys are currently stored in plaintext locally. API mode sends translation text to the selected provider. Local mode uses Ollama at `127.0.0.1:11434`. Auto mode selects a complete API provider when available, otherwise local inference; a failed API request is not retried through local inference.

Defaults include local inference, hide-to-tray on close, light theme, automatic source language, Chinese target language, streaming output and a 1024-token context. Video subtitle defaults are 2 FPS, translation-first scheduling and Windows OCR. Saved subtitle FPS, scheduling, OCR engine and region now restore after asynchronous configuration loading. Provider migration preserves unrelated settings.

Light, dark and system themes cover native controls and scrollbars. System theme changes update open translation windows. Main text translation waits 600 ms after input changes and retains only the newest pending request. Superseded results cannot overwrite current text or reappear after clearing input. All translation operations have a 60-second deadline, including response-body reads. Local requests are aborted on supersession/stop; native API invokes cannot currently be cancelled at the transport level, but cancellation settles the UI task immediately and late tokens/results are ignored.

The 19 language choices are translation selections, not a guarantee of 19-language automatic detection. Distinctive scripts and common Latin-language words provide lightweight detection. Ambiguous text retains `auto`, and the prompt asks the translation model to infer the source. Select the source manually when accuracy requires it. Subtitle deduplication compares normalized text exactly, preserving word order, repeated characters and punctuation.

## Verification

```powershell
npm test
npm run build
Push-Location src-tauri
cargo test --lib --locked --offline
Pop-Location
```

`npm test` uses Node's built-in test runner and the existing TypeScript dependency. It checks request supersession, deadlines, queueing/finalization, source/session identity, startup rendering, language detection, asynchronous subtitle restoration and settings migration. Rust tests check locking, silent packets, cropping bounds and SSE decoding; one test runs the real API proxy against a loopback HTTP fixture with a dummy key. Offline Cargo checks require cached dependencies. Browser preview checks use mocked IPC and inference; they do not validate actual Windows audio devices, native window behavior, paid APIs or multi-monitor capture.

See [the review and completed repairs](REVIEW.md), [architecture and native IPC contracts](ARCHITECTURE.md), [the workbench interface](WORKBENCH.md) and [rollback instructions](ROLLBACK.md). The existing machine-specific project memory remains in `E:/TranslatorApp/docs`; this source documentation is kept in Git so contributors can reproduce the build and understand the current limitations.

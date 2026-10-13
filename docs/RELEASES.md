# Lite releases and upgrades

Starting with 1.2.0, public binary releases contain only the Windows x64 Lite ZIP and its SHA-256 checksum. Do not produce or upload a new Full/model bundle. Historical Full assets remain available in previous GitHub Releases. The automatically generated GitHub source archives are separate from the application ZIP.

## Contents and prerequisites

The standard ZIP contains one `YiKe-Lite-v<version>/` folder with `译刻.exe`, the matching `tauri_app_lib.dll`, `DirectML.dll`, a Chinese user guide, `version.json` and the two embedded font licenses. It excludes Ollama, translation/OCR/ASR/denoising models, personal configuration, WebView profiles, development archives and logs. All application features remain; their external engine/components must be configured or downloaded when needed.

Windows 10/11 x64 and WebView2 are required. API translation needs a configured OpenAI-compatible provider. Local translation additionally needs a complete portable engine at `ollama/ollama.exe` with its accompanying `lib/` files before model downloads/imports can work. The Lite package does not download/install that engine. Existing Full users can retain their `ollama/` and `models/` directories. Recognition components can be downloaded from Settings > Models; Windows OCR depends on installed recognition languages.

## Version and build

Keep `package.json`, the root package entries in `package-lock.json`, `src-tauri/Cargo.toml`, its package entry in `Cargo.lock`, and `src-tauri/tauri.conf.json` at the same semantic version. The About screen reads the Tauri version. Preserve the existing application identifier so upgrades retain their identity.

Run from the source root on Windows with Node.js, Rust/MSVC and Windows SDK prerequisites:

```powershell
npm ci
npm test
npm run tauri build -- --no-bundle --ci
Push-Location src-tauri
cargo test --lib --locked --offline
Pop-Location
./scripts/package-lite.ps1
```

The script defaults to `src-tauri/target/release` and writes under ignored `release/`. For a configured shared Cargo target use explicit paths, for example `./scripts/package-lite.ps1 -ReleaseDir E:/TranslatorApp-dev/src-tauri/target/release -OutputDir E:/TranslatorApp/releases/v1.2.0`. These machine-local example paths are not required for contributors.

The packager checks source/binary versions and required files, copies only an explicit allowlist into a standard ZIP, and refuses to overwrite existing version artifacts. It never recursively archives a personal installation. Check every ZIP member, verify CRC/hash and PE versions, and inspect the release diff for private data before uploading. Tests/build success does not substitute for native visual checks; [window acceptance](WINDOW_BEHAVIOR.md#candidate-acceptance) records the integration baseline and its remaining limits.

Publish the source commit to the default branch without force-pushing, create the corresponding `v<version>` tag, prepare a draft GitHub Release, upload the Lite ZIP and `SHA256SUMS.txt`, then publish after verifying their identities. Preserve old releases and assets. Do not push machine-local checkpoint branches/tags with `--all` or `--mirror`.

## Upgrade and rollback

Save input and exit the old tray instance normally before replacing files. Back up the old executable/DLLs. Copy the new program and matching DLLs into the existing application directory; retain `config.json`, `ollama/`, `models/`, `ocr/` and `asr/`. The package never supplies a default configuration that could replace credentials. Configuration remains version 3; optional new settings are documented in [startup and preferences](STARTUP_AND_SETTINGS.md).

To roll back, exit normally and restore the backed-up program/DLLs. Older builds may ignore new optional preferences or save their own defaults. A fresh Lite installation can configure API mode without local models. OS shutdown, different monitor/DPI combinations, maximized fast dragging and formal startup timing still need broader acceptance.

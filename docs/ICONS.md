# Clay application and shortcut icon

The approved icon keeps the supplied overlapping A/Chinese speech bubbles with clay `#C8886D`–`#D9987F`, warm paper `#F9F7F4` and brown details. The fixed artwork does not automatically change with Windows theme settings. `src-tauri/icons/yike-clay.svg` is the editable vector source; no fonts or remote resources are required. The original supplied SVG and earlier icon checkpoints are preserved.

## Source assets

The root PNG/ICO/ICNS files in `src-tauri/icons/` were generated using the existing Tauri CLI. The ICO includes 16, 24, 32, 48, 64 and 256 px frames with transparency. The original drawing proportions and transparent padding are retained. Existing mobile asset subdirectories were not changed because this application targets Windows.

From a checkout with dependencies installed, generate to a new temporary directory for inspection:

```powershell
npm exec tauri -- icon src-tauri/icons/yike-clay.svg --output ./icon-output
```

Copy the reviewed root files into `src-tauri/icons/`. Normal Tauri builds use these assets for the executable and embedded default window/tray image. This icon-only branch does not merge the independent UI Demo or rebuild the installed applications.

## Installed Windows file icons

At `E:/TranslatorApp`, the existing `译刻.exe`, `译刻-修复版.exe` and `译刻-工作台版.exe` received only updated PE icon resources. Their unsigned original executables are backed up under `archives/clay-icon-2026-10-12/originals/`. `manifest.json` there records before/after SHA-256 values. The application code, embedded UI, non-icon PE resources and executable entry point remain identical. In-memory/default window/tray images in these existing builds were not rebuilt. `译刻-陶土橙.ico` is available for manually configured Windows shortcuts; existing `.lnk` files were not searched or modified.

`tools/update-exe-icon.py` uses Windows resource-update APIs to produce a new staged file. It requires Python 3 and `pefile`, refuses signed inputs and an existing output, and verifies all non-resource sections, non-icon resources, entry-point identity and any overlay before deployment. It never overwrites its input. Use only on backed-up unsigned local builds:

```powershell
python tools/update-exe-icon.py C:/path/to/original.exe src-tauri/icons/icon.ico C:/path/to/new-icon.exe
```

Close the application through its tray before replacing a running executable. Installation used a same-directory temporary file and atomic replacement after verifying backup/source hashes. Only targeted shell refresh notifications were sent; Explorer was not restarted and its cache was not deleted. If Explorer retains the old icon, refresh the folder or reopen it.

## Rollback and verification

Exit YiKe through the tray, then copy the desired original executable back from `E:/TranslatorApp/archives/clay-icon-2026-10-12/originals/`. For example:

```powershell
Copy-Item -LiteralPath 'E:/TranslatorApp/archives/clay-icon-2026-10-12/originals/译刻-工作台版.exe' -Destination 'E:/TranslatorApp/译刻-工作台版.exe' -Force
```

Do not change private configuration or model resources. The pre-icon source remains at `checkpoint/workbench-2026-10-08`; this isolated branch is `ui/clay-app-icon`. No public release was made.

Validation includes ICO frame decoding/transparency, comparison with the approved SVG, byte-for-byte preservation of non-icon executable sections/resources, installed-file and backup hashes, staging guard checks and Python compilation. UI/native device regression tests were not rerun because no business code was changed. Actual Explorer cache refresh is user-visible and has not been visually observed by automation.

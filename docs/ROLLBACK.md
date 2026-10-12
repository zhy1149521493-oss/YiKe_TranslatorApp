# Local checkpoints and rollback

## Motion candidate

`fix/fluid-interface-motion` is based on `checkpoint/context-menu-audio-2026-10-12-candidate` (`ef4d8ae`). The separate `译刻-动画优化版-v2.exe` retains all menu/audio corrections. To return to that preceding candidate, save input, exit through the tray and run the retained `译刻-右键与音频修正版.exe`. No configuration migration or task logic change is included. Focused native motion checks cover the three layouts; final Workbench control visibility awaits recheck. Tag `checkpoint/fluid-motion-2026-10-12-candidate` and the [source/binary archive](../../TranslatorApp/archives/fluid-motion-2026-10-12-candidate/README.md) retain this revision.

## Context-menu and audio-reading candidate

`fix/context-menu-audio-reading` starts from `checkpoint/portrait-poetry-2026-10-12-candidate` (`0969288`). The new side-by-side candidate is `E:/TranslatorApp/译刻-右键与音频修正版.exe`. Exit through the tray before switching builds. Run the retained `译刻-书页布局版.exe` to restore the preceding software; no private configuration migration is required. The main-window pin choice is session-only. Tag `checkpoint/context-menu-audio-2026-10-12-candidate` and the [source/binary archive](../../TranslatorApp/archives/context-menu-audio-2026-10-12-candidate/README.md) retain this candidate.

## Portrait Poetry and golden-ratio reading

Tag `checkpoint/portrait-poetry-2026-10-12-candidate` and the [complete source/binary archive](../../TranslatorApp/archives/portrait-poetry-2026-10-12-candidate/README.md) preserve this revision. The archive manifest records verification scope and remaining native checks.

`fix/style-window-orientation` builds separately as `译刻-书页布局版.exe`. Poetry defaults to 640×860 logical pixels with a centered 61.8%-width text/OCR reading column; Workbench and Classic default to 960×640. Manual normal sizes are independent and stored locally in the WebView, not in portable `config.json`. Short pages distribute content vertically; OCR controls align with reading text and audio stacks at portrait widths. See [behavior and responsive exceptions](POETRY_LAYOUT.md). To roll back, exit through the tray and launch the retained `译刻-诗集阅读修正版.exe`. The previous source is tagged `checkpoint/poetry-reading-2026-10-12-candidate`; no reset or private configuration migration is required. The older build ignores the new geometry storage key.

## Flowing Poetry reading candidate

`fix/poetry-responsive-layout` retains vertical document reading while reducing empty spacing, reflowing the editor after resize/font loading and removing redundant OCR preview boxes. Its separate executable is `译刻-诗集阅读修正版.exe`; the earlier `译刻-诗集优化版.exe` is a rejected equal-height experiment. Revised desktop visual acceptance remains pending. Exit through the tray and run `译刻-拉窗修正版.exe` to return to the previous native-drawer UI. Configuration and runtime resources stay shared; this change adds no schema migration. Tag `checkpoint/poetry-reading-2026-10-12-candidate` and the [source/binary archive](../../TranslatorApp/archives/poetry-reading-2026-10-12-candidate/README.md) preserve the revision. See [layout behavior and acceptance scope](POETRY_LAYOUT.md).

## Native drawer correction

Branch `fix/native-drawer-surface` extends the connected UI with native clipping. The complete pre-correction source is retained at `checkpoint/design-integration-2026-10-12-candidate`; its separate `译刻-新版界面.exe` and [archive](../../TranslatorApp/archives/design-integration-2026-10-12-candidate/README.md) are untouched. Exit the tray instance before switching executables. There is no config migration; legacy business data and the same three-style design preferences remain compatible. See [behavior and native limitations](NATIVE_DRAWER.md).

The completed correction is tagged `checkpoint/native-drawer-2026-10-12-candidate`, with the executable, complete-history Git bundle and identity manifest in the [native drawer archive](../../TranslatorApp/archives/native-drawer-2026-10-12-candidate/README.md). Run the previous `译刻-新版界面.exe` after tray exit to restore the preceding UI behavior. Source inspection can use a new detached worktree at the pre-correction tag; avoid resetting a checkout containing changes.

## Connected candidate rollback

`ui/design-integration` in `E:/TranslatorApp-icon-update` connects the approved designs to real handlers. `译刻-新版界面.exe` is a separate local candidate; the original, repair and prior workbench binaries are not overwritten. The prior icon-only checkpoint `checkpoint/clay-icon-2026-10-12` and Demo checkpoint `checkpoint/design-demo-v3.2-candidate` remain intact. The merge base before controller integration is `19548cf`. Commit `a51f70e` contains the connected implementation. Tag `checkpoint/design-integration-2026-10-12-candidate` and the [source/binary archive](../../TranslatorApp/archives/design-integration-2026-10-12-candidate/README.md) preserve the delivery candidate.

Within the candidate, Settings > General > Interface layout > Classic retains input and running jobs while switching presentation. To restore the exact earlier software, exit through the tray and run `E:/TranslatorApp/译刻-工作台版.exe` or `译刻-修复版.exe`. Shared resources stay in place. Old binaries may remove optional `settings.design` and per-channel language fields when saving; see [configuration compatibility](INTERFACE_INTEGRATION.md). The runtime configuration was not inspected or included in the source archive. Native visual/device acceptance remains pending.


## Independent design demo

Branch `ui/prototype-demo` is checked out separately at `E:/TranslatorApp-ui-demo`. It has no changes to the production controller, Rust commands or installed executables. Stop the demo server to return to the existing application. Do not copy `dist-demo/` over the production assets. The prior `ui/workbench-redesign` checkout and both existing checkpoint tags remain intact. See [preview setup and acceptance gate](DESIGN_DEMO.md).

`checkpoint/design-demo-v1.1` retains the previously browser-reviewed demo. `checkpoint/design-demo-v2-candidate` retains the next iteration, with compilation/startup checks but **pending visual acceptance**. To inspect V1 without replacing the current checkout:

```powershell
git worktree add --detach E:/TranslatorApp-demo-v1-review checkpoint/design-demo-v1.1
```

Run `npm ci` and `npm run demo` in that new directory after stopping the other demo's server (both use port 1431). The complete-history bundle and build of V1.1 remain at `E:/TranslatorApp/archives/design-demo-v1.1/`. The V2 candidate archive is `E:/TranslatorApp/archives/design-demo-v2-candidate/`; it is an implementation checkpoint, not a visually accepted release. No tags were moved and neither version was merged into production.

`checkpoint/design-demo-before-drawers` retains commit `a4cabcc`, including the audio source relocation, before navigation/workspace drawers. `checkpoint/design-demo-v3-candidate` and `E:/TranslatorApp/archives/design-demo-v3-candidate/` retain the drawer candidate with the same pending visual acceptance. Inspect the pre-drawer layout in a new checkout without resetting current work:

```powershell
git worktree add --detach E:/TranslatorApp-demo-before-drawers checkpoint/design-demo-before-drawers
```

`checkpoint/design-demo-before-brand-lock` retains the previous V3 commit `4b25131`, before navigation pinning and supplied branding. `checkpoint/design-demo-v3.1-candidate` records the revised candidate, with a [complete-history/build archive](../../TranslatorApp/archives/design-demo-v3.1-candidate/README.md). The later `checkpoint/design-demo-folded-selection-fix` preserves the correction that clears navigation highlights when content is folded; the V3.1 archive contains the preceding base revision. The subsequent `checkpoint/design-demo-hover-focus-fix` preserves the correction for mouse-focused buttons preventing hover collapse. All prior tags/archives remain unchanged. To inspect the previous behavior without resetting current work:

```powershell
git worktree add --detach E:/TranslatorApp-demo-before-brand-lock checkpoint/design-demo-before-brand-lock
```

The stable repair checkpoint is the Git tag `checkpoint/core-repairs-2026-10-08` and branch `archive/core-repairs-2026-10-08`. It includes the eight audited logic repairs, theme-aware scrollbars, regression tests and developer documentation. These references are local; no changes have been pushed to GitHub.

The repair commit is `994ddfa73ffc825e28b212b6c86695389264cdf8`. An independent complete-history Git bundle is stored at `E:/TranslatorApp/archives/core-repairs-2026-10-08/source.bundle`. Its refs were verified with `git bundle verify`.

## Icon-only installation

The approved clay Windows file icons are installed with original executables preserved under `E:/TranslatorApp/archives/clay-icon-2026-10-12/originals/`. The earlier checksum below applies to the pre-icon repair build; use the icon archive manifest for current hashes. Source assets live on the isolated `ui/clay-app-icon` branch. See [icon scope, validation and rollback](ICONS.md).

`checkpoint/design-demo-before-recognition-split` preserves commit `756fab3`, before the screenshot/video source relocation, independent audio-channel cards and removal of Capsule floating previews. `checkpoint/design-demo-v3.2-candidate` preserves the new candidate, with its [source/build archive](../../TranslatorApp/archives/design-demo-v3.2-candidate/README.md). Both are implementation checkpoints; browser/visual acceptance remains pending. To inspect the previous candidate without resetting current work:

```powershell
git worktree add --detach E:/TranslatorApp-demo-before-recognition-split checkpoint/design-demo-before-recognition-split
```

Run the old demo on a different port or stop the current server first. Old Capsule floating behavior remains recoverable through this checkpoint and earlier archives. Only demo appearance storage is normalized in the new candidate; no production settings are migrated.

## Switch the UI only

In `译刻-工作台版.exe`, click **Classic interface** in the title bar (or Settings > General > Interface layout > Classic). Input, translations and settings are retained. Click **Workbench interface** to return. This does not require restarting or replacing files. See [the workbench guide](WORKBENCH.md).

## Run the stable repair build

Exit YiKe through its tray menu first (the application enforces one instance), then run `E:/TranslatorApp/译刻-修复版.exe`. Keep it beside the existing runtime resources. Its SHA-256 is `02E8179D578C3516C4A8092982BA015A70E6087268C9F52289FD6E0474D0C940`. The original `E:/TranslatorApp/译刻.exe` is also retained, but does not contain these repairs.

The portable executables share `config.json` and model resources in their directory. Do not delete or replace those resources to switch builds. Before editing configuration manually, make a private local backup; it can contain plaintext API keys and must not be committed.

## Restore or inspect the source checkpoint

From `E:/TranslatorApp-dev`, inspect the checkpoint without changing the current checkout:

```powershell
git show --stat checkpoint/core-repairs-2026-10-08
git diff checkpoint/core-repairs-2026-10-08
```

For a separate source checkout, leaving current work untouched:

```powershell
git worktree add --detach E:/TranslatorApp-repair-checkpoint checkpoint/core-repairs-2026-10-08
```

Install dependencies and build as described in [the developer guide](README.md). Avoid `git reset --hard` when the working tree contains changes you want to retain.

If the original checkout is unavailable, recover from the independent archive into a new directory:

```powershell
git clone -b archive/core-repairs-2026-10-08 E:/TranslatorApp/archives/core-repairs-2026-10-08/source.bundle E:/TranslatorApp-recovered
```

The archive contains source/history, not runtime models or private configuration. Those remain in the portable installation. The redesigned source is kept on the local `ui/workbench-redesign` branch and tagged `checkpoint/workbench-2026-10-08` after verification. Its independent Git bundle and executable checksum manifest are in `E:/TranslatorApp/archives/workbench-2026-10-08/`.

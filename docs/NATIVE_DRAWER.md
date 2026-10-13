# Native main-window drawers

The correction lives on isolated branch `fix/native-drawer-surface`. It addresses the connected candidate leaving an opaque, clickable empty desktop rectangle after folding its workspace. Existing binaries and `checkpoint/design-integration-2026-10-12-candidate` remain available for rollback.

## Application menu overlay

The follow-up [application context menu](CONTEXT_MENU.md) adds an optional popup rectangle to `set_main_surface`. While folded, its rounded region is unioned with navigation so the menu remains visible and clickable without exposing an empty desktop rectangle. Closing the menu removes only that extra region. The main window remains the only command target; Classic auxiliary windows are unaffected.

## Behavior

The later [style-size revision](POETRY_LAYOUT.md) makes Poetry's expanded window portrait by default and Workbench/Classic landscape. Folding itself still changes only the clipping region; it never records the clipped navigation silhouette as a custom expanded size.

| State | Visible and interactive desktop surface |
| --- | --- |
| Workspace open | Complete existing interface; navigation stays expanded |
| Workspace folded, persistent navigation | Poetry toolbar, Workbench rail, or Classic navigation strip only |
| Workspace folded, hover navigation revealed | The same navigation silhouette |
| Workspace folded, hover navigation hidden | The 42 CSS-pixel application logo only |

Select a function to pull out its workspace. Select the current function or use the workspace folding control to retract it. Folding preserves mounted task state and does not stop translation, recognition or audio. Hover departure can retract navigation only after the workspace is folded; keyboard-visible navigation focus keeps it accessible. Drag the logo/brand or blank navigation areas to move the main window; small brand presses remain buttons. When folded, full-window title buttons outside navigation are hidden by the native surface; use the tray to show or exit, or reopen the workspace for title controls. Classical translation/audio floating windows are unaffected.

## Implementation and compatibility

`useNativeSurface.ts` observes actual production navigation bounds and disclosure state. `SurfaceAnimator` serializes IPC, interrupts from its current frame and switches immediately for keyboard actions or reduced motion. Navigation retracts/reveals in 160 ms; workspace opening and closing use 240 ms, matching CSS. The [motion correction](MOTION.md) preserves that timing through repeated measurements and simultaneous context-menu removal. The easing follows CSS `cubic-bezier(.23,1,.32,1)`, including its time axis. Existing CSS animates the corresponding content. Failed native updates attempt to restore the full surface so controls remain recoverable.

Poetry now uses a stationary left-end logo anchor for both CSS and native clipping. The earlier centered-logo translation and its temporary click guard have been removed; no function slides under the logo pointer. See [window behavior](WINDOW_BEHAVIOR.md). Workbench uses its existing draggable topbar; the duplicate top drag overlay is noninteractive so it cannot intercept the drawer's folding button.

`main_surface.rs` applies a Windows `SetWindowRgn` region on the UI thread, scoped to the invoking main window. Windows clips both painting and hit testing outside that region: the hidden area exposes the desktop/underlying windows instead of an empty application panel. The original outer window and WebView canvas dimensions are deliberately retained, preserving responsive breakpoints, reading position, expanded placement and maximized state. This is a shaped native window, not an actual resize of its outer rectangle. Consequently taskbar thumbnails, snapping and third-party window managers may still use the saved full outer bounds; those integrations require further manual checking.

DOM bounds are converted using the native monitor scale and client-to-window frame offsets. This handles fractional DPI, negative monitor positions and maximized invisible frame offsets without relocating the main window. Native custom regions are Windows-specific, matching this application's existing Windows-only dependencies. The standalone browser Demo cannot reproduce operating-system window clipping. No configuration fields, private configuration file reads, provider requests or audio/capture commands are added by this correction.

## Verification

Run `npm test` and `npm run build` at the source root. Run `cargo test --lib --locked --offline` from `src-tauri`, with loopback requests excluded from any HTTP proxy. Produce the portable executable with `npm run tauri build -- --no-bundle --ci`, which embeds the current frontend.

New tests cover all three navigation shapes, logo bounds, superseding a pending native update, reduced motion, failure recovery, fractional DPI and invalid native geometry. Native visual acceptance must also check workspace fold/reopen, logo reveal/departure, blank-area dragging, Settings style changes, maximize/restore and clicks on windows exposed by folding. Automated geometry checks alone do not establish desktop appearance or pointer behavior.

The frontend has 61 passing checks; ten Rust tests and the Tauri release build pass. Native Computer Use inspection confirmed all three persistent silhouettes exposing the underlying desktop when folded, reopening from compact navigation, logo-only surfaces in all three styles, shared light/dark changes and Settings style switching. The quick Poetry-logo press was reproduced before protection and verified to reveal navigation without launching a task afterward. The final executable was also checked for Workbench folding-button activation, logo/rail reveal and restoring persistent navigation. These native checks use the locally built executable; they do not revisit the browser URL previously rejected by preview policy. Additional monitors/DPI settings, reduced-motion system settings, snapping/taskbar previews and device/API workflows remain outside this visual check.

The separate portable candidate is `E:/TranslatorApp/译刻-拉窗修正版.exe`. Existing `译刻-新版界面.exe` and the three earlier portable builds are retained. See [rollback](ROLLBACK.md) for source/binary checkpoints. Runtime `config.json` was not read by development tools; style/navigation/color preferences used during native checks were changed only through the app's existing Settings interface.

The final candidate is 54,167,552 bytes; SHA-256: `68f5ee6d0150f01052463552a0963408970d7a5d211e8d5d77d4796f4ea1d9e7`. The [candidate archive](../../TranslatorApp/archives/native-drawer-2026-10-12-candidate/README.md) records source/binary identity and verified scope.

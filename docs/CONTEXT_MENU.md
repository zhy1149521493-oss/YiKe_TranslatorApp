# Main-window context menu

Right-click non-editable content or navigation to open the themed application menu. Its colors follow the active shared theme and accent. Editable inputs retain WebView editing commands (copy, paste, selection); ordinary editing shortcuts remain available. Screenshot-overlay right-click cancellation and Classic auxiliary windows are unchanged. Interface-style selection remains only in Settings.

Available actions are Keep on top, fold/expand the current workspace, show/hide the existing Classic translation floating window, toggle light/dark, open Settings, minimize and close. Close uses the existing configured hide-to-tray/exit behavior. Keeping the main window on top is session-only and does not change the independent floating-window policy or portable configuration. The checkbox reads the actual Tauri window state; failed operations report an inline error instead of displaying success.

The menu fits inside the current WebView bounds. Up/Down, Home/End and Enter/Space operate its buttons. Escape or Tab dismisses it and restores prior focus; outside pointer presses, window blur, resizing and workspace/style changes dismiss it. Reduced-motion disables the brief appearance animation.

## Implementation

`ConnectedMain.tsx` owns invocation and dismissal. `AppContextMenu.tsx` renders semantic menu items and calls the existing application handlers; its pin action uses Tauri window APIs already permitted by the main capability. `contextMenu.ts` validates the placement and editing-target boundary. No package or configuration schema is added.

`useNativeSurface.ts` measures a visible menu and passes optional `popup` geometry alongside `bounds` to `set_main_surface`. The Windows backend unions the rounded navigation and menu regions, rather than exposing the entire bounding rectangle between them. The expanded canvas remains unchanged. Menu changes invalidate an unchanged native navigation target and are applied immediately. Both rectangles are validated before GDI allocation; temporary regions are released after combining and Windows takes ownership only after a successful SetWindowRgn call.

## Verification

Run `npm test`, `npm run build` and `cargo test --lib --locked --offline` from `src-tauri` (cached Rust dependencies required), then build the portable release with `npm run tauri build -- --no-bundle --ci`. Tests cover placement, editing-target exceptions, actual pin-state reads/writes, native-error feedback, keyboard dismissal, listener cleanup, popup-triggered surface refresh and Poetry per-channel source/result ordering. Native visual acceptance must also check the folded menu region, placement at window edges, both theme tones, pin toggling and single/dual audio. See [Poetry layout](POETRY_LAYOUT.md) and [rollback](ROLLBACK.md).

The side-by-side `E:/TranslatorApp/译刻-右键与音频修正版.exe` passes 76 frontend checks, ten Rust tests and the embedded release build. Native checks covered single/dual Poetry audio in the remembered portrait window, scrolling to the second channel, both theme tones, real pin on/off, bottom-right menu placement, menu access/reopening from the folded logo, and Escape closing only the menu. Dark theme, computer-only source and unpinned main state were restored. No recording or capture was started. Additional native style/size/monitor combinations and live ASR accuracy remain to be checked. The [archive](../../TranslatorApp/archives/context-menu-audio-2026-10-12-candidate/README.md) retains the checkpoint.

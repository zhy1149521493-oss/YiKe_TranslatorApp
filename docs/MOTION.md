# Main-interface motion

The three production layouts keep their drawer and scroll-shell instances mounted when changing task or entering/leaving Settings. Switching function no longer restarts the whole drawer entrance or reintroduces its fixed toolbar. Changing the active view resets that page's scroll position, matching the preceding remounted-page behavior; business state remains owned by MainWindow.

Task/Settings switches are frequent navigation, so their transition is deliberately subtle: an opacity-only 180ms entrance from 0.78 to 1 with the existing `--ease-out` token. It bridges the content replacement without translating text, animating dimensions or delaying the active controls. Task progress, streaming output and other updates within the same view never replay the transition.

`useViewMotion.ts` owns the stable page ref and view identity. `viewMotion.ts` reads an interrupted animation's displayed opacity before cancellation, then continues from that value with Web Animations. No library is added. Keyboard actions and reduced-motion preference changes cancel in-flight fades; keyboard-initiated navigation and reduced-motion mode show the new content immediately. Unmount detaches listeners and cancels animation. Older engines without Web Animations use immediate content.

The CSS drawer's transform/opacity/clip-path and native window-region interpolation share the existing strong ease-out and 240ms duration for both workspace opening and closing. Native geometry measurements during a workspace transition keep that duration instead of shortening the exit to the 160ms navigation timing. Removing a context menu at the same time as folding must not turn the fold into an instant native cut. Standalone navigation/logo reveal retains 160ms; existing quick-logo click protection and focus/pointer semantics remain.

## Verification and limits

Run `npm test` and `npm run build` from the repository root; build the embedded Windows executable using `npm run tauri build -- --no-bundle --ci`. Motion tests exercise actual page-transition interruption order, unchanged-view suppression, keyboard/reduced-motion cancellation, unsupported-engine fallback and cleanup. An adapter test exercises the actual native-surface hook's opening/closing durations, menu removal during folding and keyboard-immediate behavior.

79 frontend checks and TypeScript/Vite compilation pass. The native backend is unchanged from the ten-test menu/audio checkpoint. The final side-by-side `E:/TranslatorApp/译刻-动画优化版-v2.exe` passes the embedded Tauri release build. Native checks of the preceding motion build covered all four Poetry pages, task/Settings navigation in all three styles, Poetry menu-fold and Classic fold/navigation recovery. Fixed toolbars remain stable across task switches. Original Poetry/dark/hover preferences were restored, with computer audio and no recording. The final Workbench control-card correction still requires a native recheck. These checks are scoped visual/interaction observations, not a claim of perfect animation feel. Wider monitor/DPI and reduced-motion system configurations require broader acceptance.

A native check also exposed an existing Workbench card constraint: the left control card could shrink and clip source/start buttons at the default landscape height. Control cards now keep their intrinsic height, real audio meters are compact, and source choices wrap. Short windows use the existing page scroll instead of clipping controls; business actions and channel identities are unchanged.

The implementation is isolated on `fix/fluid-interface-motion`, based on `checkpoint/context-menu-audio-2026-10-12-candidate`. See [rollback](ROLLBACK.md). The retained right-click/audio candidate remains runnable independently.

# Window dragging, docking and pinning

The correction is developed on `fix/window-drag-docking-startup`. It retains the three main layouts, native drawer clipping, mounted task controllers and independent Classic floating windows.

## Main window

The logo and brand text act as both a button and a drag handle. A left-button movement of at least five screen pixels starts native dragging; releasing a drag does not trigger collapse/expand. Small movement and keyboard activation remain ordinary clicks. Navigation actions and editable controls do not start a drag.

The frontend passes the original client-space press position. Native dragging converts it with the current client origin and monitor scale, so IPC latency does not discard a fast drag's first movement or turn a released drag into zero displacement. Calls without these optional coordinates retain the legacy cursor-sampling behavior.

Maximized main-window dragging uses the Windows native caption restore/move operation. Normal windows and auxiliary windows use the custom transparent-window move loop. Exact responsive Poetry logo anchoring during maximized restore requires native acceptance.

Poetry contracts to the actual logo at the left end of its toolbar. The logo does not translate to the toolbar center. CSS clipping and the native hit-test region use that same measured logo rectangle, so invisible content does not intercept desktop input.

**Keep on top** uses a main-only native Z-order operation. It does not resize, center, restore, reconstruct window styles or replace the drawer region. The preference is stored in `settings.design.alwaysOnTop` (default `false`) and restored at startup and after native show/focus/resize operations. A failed save restores the preceding pin state and reports an error. This replaces the prior session-only pin behavior.

## Auxiliary windows

See [shared floating appearance and retained controls](FLOATING_WINDOWS.md). Their headers use the same native drag implementation as the main brand; buttons and form controls remain interactive. The lower-right resize handle also carries its original client-space press position and applies the final displacement before checking button release. Fast gestures therefore retain their resize delta even if IPC arrives after release. Minimum dimensions remain 280 by 160 logical pixels; resize calls are restricted to the matching auxiliary caller.

During dragging, a visible translation, computer-audio or microphone window can attach flush to another auxiliary window's left, right, top or bottom edge within 12 logical pixels (scaled to physical pixels for that drag). Actual outer rectangles are used; different widths and heights remain intact. Nearby corresponding corners align, while larger perpendicular offsets remain available. Hidden and minimized peers are excluded. Placements overlapping a third window are rejected.

The windows remain independently movable. Pull farther than the threshold to detach. Docking does not create a persistent group or force neighboring windows to resize/move together. Arbitrary arrangements and sizes are allowed; docking coordinates are not saved across sessions. Additional monitor/DPI combinations require native acceptance.

Rectangular native regions follow auxiliary resizing and are cached by HWND/size to avoid redundant region updates. Their square CSS corners and zero outside gutter make visible edges meet the snapping geometry.

## Verification

```powershell
npm test
npm run build
cd src-tauri
cargo test --lib --locked --offline
```

Gesture tests distinguish jitter, dragging and click suppression. Disclosure/native-surface tests verify the stationary Poetry anchor. Pure Rust docking tests cover horizontal/vertical arrangements, unequal dimensions, negative coordinates, collision rejection and nearest edges. Native pin and drag checks remain separate from these tests; unit tests do not establish Windows geometry or visual acceptance.

### Candidate acceptance

The `译刻-窗口协同修正版.exe` candidate passes 120 frontend tests, 38 Rust library tests and the TypeScript/Vite/Tauri embedded release build. The loopback API fixture requires proxy bypass for localhost; a run with inherited proxy settings returned 502, and the corrected test environment passed. The existing MSVC debug test linker warning about LIBCMT remains.

Native checks on the available 150% scale display established:

- Brand dragging changes position without changing size or click-folding in Poetry, Workbench and Classic. The folded Poetry icon also moves (a 14-logical-pixel drag produced a 21-physical-pixel displacement); its toolbar anchor remains stationary during folding.
- Saved pinning survives restart. Toggling it in a normal window preserves position/size; cancelling it in a maximized window preserves maximization. Normal restore returns the prior portrait dimensions.
- All three auxiliary types have the same rectangular chrome in light and dark themes. Changing translation opacity to 92% appears in both audio windows and all auxiliary Settings sliders; restoring 68% survives normal exit/restart.
- A fast microphone resize changes 380 by 220 logical pixels to 330 by 180. The smaller window snaps below the 380 by 220 computer-audio window while retaining its dimensions; translation snaps to its right, producing an L-shaped arrangement. Physical origins were audio `(266, 266)`, microphone `(266, 596)`, and translation `(836, 266)` at scale 1.5, matching their actual edges.
- Normal direct exit removes all four visible application windows after preference flush. Relaunch restores the chosen Classic/light theme and simultaneous-audio preference without starting capture. The final test state restores Poetry/dark/hover navigation, computer audio, unpinned state, 68% shared opacity and hide-to-tray on close.

No text, capture, recording or external inference request was started. Additional monitor/DPI combinations, maximized fast brand dragging, OS restart/shutdown and formal cold-start timing remain unverified. Docking remains independent-window edge alignment, not saved groups or linked group movement.

Build candidates using the Tauri CLI as described in the [documentation entry point](README.md). Keep the previous executable alongside the candidate and preserve the source checkpoint before replacing an installation. Runtime configuration and recognition/model resources must not be included in source/binary rollback archives.

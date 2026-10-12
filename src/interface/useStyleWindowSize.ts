import { useEffect, useRef } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { currentMonitor, getCurrentWindow, LogicalSize, PhysicalPosition } from "@tauri-apps/api/window";
import type { MainStyle } from "./model";
import { StyleWindowSizing, restoreWindowSizes, WINDOW_SIZE_KEY } from "./windowSizing";

export function useStyleWindowSize(style: MainStyle, ready: boolean) {
  const manager = useRef<StyleWindowSizing | null>(null);
  useEffect(() => {
    if (!ready || !isTauri()) return;
    const window = getCurrentWindow();
    let stopped = false;
    let unlisten: (() => void) | undefined;
    let saved = null;
    try { saved = localStorage.getItem(WINDOW_SIZE_KEY); } catch { /* Memory-only if storage is unavailable. */ }
    const sizing = new StyleWindowSizing({
      async snapshot() {
        const [size, scale, maximized, minimized, monitor] = await Promise.all([
          window.innerSize(), window.scaleFactor(), window.isMaximized(), window.isMinimized(), currentMonitor(),
        ]);
        return { size: size.toLogical(scale), maximized: maximized || minimized,
          area: monitor?.workArea.size.toLogical(monitor.scaleFactor) };
      },
      async apply(plan, snapshot) {
        await window.setMinSize(new LogicalSize(plan.minimum.width, plan.minimum.height));
        if (snapshot.maximized) return;
        await window.setSize(new LogicalSize(plan.size.width, plan.size.height));
        // Keep the enlarged page on its current monitor without centering on every switch.
        try {
          const [monitor, position, outer] = await Promise.all([currentMonitor(), window.outerPosition(), window.outerSize()]);
          if (!monitor) return;
          const { position: origin, size } = monitor.workArea;
          const x = Math.max(origin.x, Math.min(position.x, origin.x + size.width - outer.width));
          const y = Math.max(origin.y, Math.min(position.y, origin.y + size.height - outer.height));
          if (x !== position.x || y !== position.y) await window.setPosition(new PhysicalPosition(x, y));
        } catch (error) { console.error("窗口位置调整失败", error); }
      },
      save(sizes) { try { localStorage.setItem(WINDOW_SIZE_KEY, JSON.stringify(sizes)); } catch { /* Keep session sizes. */ } },
      error(error) { console.error("窗口尺寸调整失败", error); },
    }, restoreWindowSizes(saved));
    manager.current = sizing;
    void window.onResized(() => sizing.resized()).then(stop => { if (stopped) stop(); else unlisten = stop; }).catch(console.error);
    return () => { stopped = true; unlisten?.(); sizing.dispose(); manager.current = null; };
  }, [ready]);
  useEffect(() => { if (ready) void manager.current?.select(style); }, [style, ready]);
}

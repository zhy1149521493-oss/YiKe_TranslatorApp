import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

/** Hidden windows acknowledge their mounted listeners without waiting for paint. */
export function useFrontendReady(ready: boolean, afterPaint = false) {
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    let first = 0;
    let second = 0;
    const notify = () => { if (!cancelled) void invoke("frontend_ready").catch(() => {}); };
    if (afterPaint) first = requestAnimationFrame(() => { second = requestAnimationFrame(notify); });
    else notify();
    return () => { cancelled = true; cancelAnimationFrame(first); cancelAnimationFrame(second); };
  }, [ready, afterPaint]);
}

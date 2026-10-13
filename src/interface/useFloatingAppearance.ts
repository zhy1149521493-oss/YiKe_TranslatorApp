import { useEffect, useRef, useState, type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FloatingOpacityWriter, floatingThemeVariables, restoreFloatingAppearance, withFloatingOpacity, type AppearanceMap, type FloatingAppearance, type SurfaceKey } from "./floatingAppearance";

export function useFloatingAppearance(surface: SurfaceKey, defaults: AppearanceMap, listenersReady: boolean) {
  const [state, setState] = useState<FloatingAppearance>(() => restoreFloatingAppearance({}, defaults));
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const saveSequence = useRef(0);
  const pendingOpacity = useRef<number | null>(null);
  const [writer] = useState(() => new FloatingOpacityWriter((key, value) => invoke("update_appearance", { surface: key, patch: { opacity: value } })));
  const [systemDark, setSystemDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  useEffect(() => {
    const target = window as unknown as {
      __flushFloatingSettings?: () => Promise<unknown>;
      __flushAudioSettings?: () => Promise<unknown>;
    };
    const flush = () => Promise.all([writer.flush(), target.__flushAudioSettings?.()]);
    target.__flushFloatingSettings = flush;
    return () => { if (target.__flushFloatingSettings === flush) delete target.__flushFloatingSettings; };
  }, [writer]);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const change = () => setSystemDark(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    let active = true;
    let broadcastReceived = false;
    const target = window as unknown as { __applyAppSettings?: (settings: unknown) => void };
    const apply = (settings: unknown) => {
      if (!active) return;
      const next = restoreFloatingAppearance(settings, defaults);
      if (pendingOpacity.current !== null) next.appearance = withFloatingOpacity(next.appearance, pendingOpacity.current);
      setState(next);
      setReady(true);
    };
    const handler = (settings: unknown) => { broadcastReceived = true; apply(settings); };
    target.__applyAppSettings = handler;
    invoke<{ settings?: unknown }>("load_app_config").then(config => {
      if (!broadcastReceived) apply(config?.settings);
    }).catch(() => { if (active) setReady(true); });
    return () => {
      active = false;
      if (target.__applyAppSettings === handler) delete target.__applyAppSettings;
    };
  }, [defaults]);
  const tone = state.theme === "system" ? (systemDark ? "dark" : "light") : state.theme;
  useEffect(() => { document.documentElement.dataset.theme = tone; }, [tone]);
  useEffect(() => {
    if (!ready || !listenersReady) return;
    // Hidden WebViews throttle animation frames; use a task after listener effects install.
    const timer = setTimeout(() => { invoke("frontend_ready").catch(() => {}); }, 0);
    return () => clearTimeout(timer);
  }, [ready, listenersReady]);
  const setOpacity = (value: number) => {
    const sequence = ++saveSequence.current;
    pendingOpacity.current = value;
    setError("");
    setState(previous => ({ ...previous, appearance: withFloatingOpacity(previous.appearance, value) }));
    writer.update(surface, value).then(() => {
      if (sequence === saveSequence.current) pendingOpacity.current = null;
    }).catch(cause => {
      if (sequence === saveSequence.current) {
        pendingOpacity.current = null;
        setError(`外观未保存：${cause instanceof Error ? cause.message : String(cause)}`);
      }
    });
  };
  return {
    ready, tone, error, opacity: state.appearance.floating.opacity, setOpacity,
    style: floatingThemeVariables(state, surface, systemDark) as CSSProperties,
  };
}

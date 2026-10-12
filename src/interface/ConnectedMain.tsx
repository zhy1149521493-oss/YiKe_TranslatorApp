import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type MouseEvent } from "react";
import { actionInk } from "./preferences";
import { MainLayout } from "./Layouts";
import type { InterfaceController } from "./controller";
import type { MainStyle, Mode, Preferences } from "./model";
import "./theme.css";
import "./layouts.css";
import "./reading.css";
import "./disclosure.css";
import "./connected.css";

export function ConnectedMain(props: {
  style: MainStyle; navigation: Preferences["navigation"];
  theme: "light" | "dark" | "system"; accent: string; background: string; opacity: number;
  foreground: string; fontSize: number; controller: InterfaceController;
  settings: ReactNode; settingsOpen: boolean; onSettings: () => void;
  onBack: () => void; onMode: (mode: Mode) => void; onTheme: () => void;
  onFloating: () => void; floatingOpen: boolean;
  onCapture: (mode: "screenshot" | "subtitle") => void;
  onMinimize: () => void; onMaximize: () => void; onClose: () => void;
  onDrag: (event: MouseEvent) => void; notice: string; classicTask?: ReactNode; ignoreEscape?: boolean;
}) {
  const [open, setOpen] = useState(true);
  const [systemDark, setSystemDark] = useState(() => matchMedia("(prefers-color-scheme: dark)").matches);
  const [motion, setMotion] = useState("pointer");
  const root = useRef<HTMLDivElement>(null);
  const previousMode = useRef(props.controller.state.mode);
  const previousSettings = useRef(props.settingsOpen);
  useEffect(() => {
    const q = matchMedia("(prefers-color-scheme: dark)");
    const change = () => setSystemDark(q.matches);
    q.addEventListener("change", change);
    return () => q.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    if (props.settingsOpen !== previousSettings.current) setOpen(true);
    previousSettings.current = props.settingsOpen;
  }, [props.settingsOpen]);
  useEffect(() => {
    if (previousMode.current !== props.controller.state.mode) setOpen(true);
    previousMode.current = props.controller.state.mode;
  }, [props.controller.state.mode]);
  const tone = props.theme === "system" ? (systemDark ? "dark" : "light") : props.theme;
  const accent = props.accent || (tone === "dark" ? "#D9987F" : "#C8886D");
  const fold = () => {
    root.current?.querySelector<HTMLButtonElement>(".navigation-brand")?.focus({ preventScroll: true });
    setOpen(false);
  };
  const style = {
    "--paper": (props.background ? `color-mix(in srgb, ${props.background} ${Math.max(0, Math.min(100, props.opacity))}%, transparent)` : "") || (tone === "dark" ? "#1A1816" : "#F9F7F4"),
    "--ink": props.foreground || (tone === "dark" ? "#E8E6E3" : "#2A2826"),
    "--accent": accent, "--action-ink": actionInk(accent), "--reading-size": `${props.fontSize}px`,
    "--ios-blue": accent, "--ios-label": "var(--ink)",
    "--ios-text": "var(--ink)", "--ios-secondary": "var(--muted)", "--ios-separator": "var(--line)",
    "--ios-accent-rgb": accent.replace("#", "").match(/../g)?.map(v => parseInt(v, 16)).join(", "),
    "--ios-bg": "var(--paper)", "--ios-bg2": "var(--panel-solid)",
  } as CSSProperties;
  return <div ref={root} className="connected-ui" data-style={props.style}
    data-tone={tone} data-navigation={props.navigation} data-workspace-open={open}
    data-motion-input={motion} style={style}
    onKeyDownCapture={() => setMotion("keyboard")} onPointerDownCapture={() => setMotion("pointer")} onPointerMoveCapture={() => setMotion("pointer")}
    onKeyDown={e => { if (e.key === "Escape" && !e.defaultPrevented && !props.ignoreEscape) {
      if (props.settingsOpen) props.onBack(); else fold();
    } }}>
    <div className="native-drag-strip" onMouseDown={props.onDrag} onDoubleClick={props.onMaximize} aria-hidden="true" />
    <MainLayout style={props.style} controller={props.controller} tone={tone}
      navigation={props.navigation} drawerOpen={open} settingsOpen={props.settingsOpen}
      floatingOpen={props.floatingOpen} onFloating={props.onFloating}
      onBrand={() => open ? fold() : setOpen(true)} onCloseDrawer={fold}
      onMode={mode => { const same = props.controller.state.mode === mode && !props.settingsOpen; props.onMode(mode); setOpen(same ? !open : true); }}
      onSettings={() => { if (props.settingsOpen && open) fold(); else { props.onSettings(); setOpen(true); } }}
      onTheme={props.onTheme} onCapture={props.onCapture}
      onMinimize={props.onMinimize} onMaximize={props.onMaximize} onClose={props.onClose}
      onDrag={props.onDrag} classicTask={props.classicTask}>
      {props.settings}
    </MainLayout>
    {props.controller.extra && <div className="connected-feedback">{props.controller.extra}</div>}
    <div className="connected-notice" role="status" aria-live="polite">{props.notice}</div>
  </div>;
}

import { useLayoutEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { Icon } from "./Icon";
import { menuPosition } from "./contextMenu";
import "./context-menu.css";

export function AppContextMenu({ x, y, open, floatingOpen, onDismiss, onToggleDrawer, onFloating, onSettings, onTheme, onMinimize, onClose }: {
  x: number; y: number; open: boolean; floatingOpen: boolean;
  onDismiss: (restoreFocus?: boolean) => void; onToggleDrawer: () => void;
  onFloating: () => void; onSettings: () => void; onTheme: () => void; onMinimize: () => void; onClose: () => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  const [pinned, setPinned] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useLayoutEffect(() => {
    const element = menu.current!;
    const place = () => setPosition(menuPosition(x, y, element.offsetWidth, element.offsetHeight, innerWidth, innerHeight));
    place();
    const size = new ResizeObserver(place); size.observe(element);
    element.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => { if (!element.contains(event.target as Node)) onDismiss(); };
    const dismiss = () => onDismiss();
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("blur", dismiss); window.addEventListener("resize", dismiss);
    let disposed = false;
    if (isTauri()) void invoke<boolean>("get_main_pinned").then(value => { if (!disposed) setPinned(value); })
      .catch(() => { if (!disposed) setError("无法读取置顶状态"); });
    return () => { disposed = true; size.disconnect(); document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("blur", dismiss); window.removeEventListener("resize", dismiss); };
  }, [x, y, onDismiss]);
  const run = (action: () => void) => { onDismiss(); action(); };
  const togglePin = async () => {
    if (pinned === null || busy) return;
    setBusy(true); setError("");
    try { setPinned(await invoke<boolean>("set_main_pinned", { pinned: !pinned })); }
    catch { setError("置顶操作失败，请重试"); }
    finally { setBusy(false); }
  };
  const item = (label: string, icon: string, action: () => void) => <button role="menuitem" onClick={() => run(action)}><Icon name={icon} size={17} /><span>{label}</span></button>;
  return <div ref={menu} className="app-context-menu" data-context-menu="true" role="menu" aria-label="译刻窗口操作" style={position}
    onContextMenu={e => e.preventDefault()} onKeyDown={e => {
      if (e.key === "Escape" || e.key === "Tab") { e.preventDefault(); e.stopPropagation(); onDismiss(true); return; }
      const buttons = [...menu.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
        e.preventDefault(); e.stopPropagation();
        buttons[e.key === "Home" ? 0 : e.key === "End" ? buttons.length - 1 : (index + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
      }
    }}>
    <div className="context-menu-heading">译刻 · 窗口</div>
    <button role="menuitemcheckbox" aria-checked={pinned === true} disabled={pinned === null || busy} onClick={() => void togglePin()}>
      <Icon name="pin" size={17} /><span>{busy ? "正在设置…" : "保持置顶"}</span>{pinned && <Icon name="check" size={15} />}
    </button>
    {error && <div className="context-menu-error" role="alert">{error}</div>}
    {item(open ? "收起工作面板" : "展开工作面板", open ? "minus" : "expand", onToggleDrawer)}
    {item(floatingOpen ? "隐藏经典悬浮窗" : "打开经典悬浮窗", "windows", onFloating)}
    <div role="separator" />
    {item("切换深浅主题", "sun", onTheme)}
    {item("设置中心", "settings", onSettings)}
    <div role="separator" />
    {item("最小化", "minus", onMinimize)}
    {item("关闭窗口", "close", onClose)}
  </div>;
}

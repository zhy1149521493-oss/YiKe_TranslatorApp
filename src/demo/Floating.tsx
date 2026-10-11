import {
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type KeyboardEvent,
} from "react";
import { Icon, IconButton } from "./Icon";
import { clampPanel, modes, type Mode, type Preferences } from "./model";
import type { PreviewController } from "./usePreview";
import { ResultBody, TextEditor } from "./Translation";
import { FeatureControls } from "./Features";

function usePanelDrag() {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({
    x: Math.max(8, window.innerWidth - 510),
    y: 165,
  });
  const drag = useRef<{
    id: number;
    x: number;
    y: number;
    startX: number;
    startY: number;
  } | null>(null);
  const [dragging, setDragging] = useState(false);
  const move = (x: number, y: number) => {
    const rect = ref.current?.getBoundingClientRect();
    setPosition(
      clampPanel(x, y, rect?.width ?? 480, rect?.height ?? 380, {
        width: window.innerWidth,
        height: window.innerHeight,
      }),
    );
  };
  useEffect(() => {
    const bound = () => {
      const rect = ref.current?.getBoundingClientRect();
      if (rect)
        setPosition((p) =>
          clampPanel(p.x, p.y, rect.width, rect.height, {
            width: window.innerWidth,
            height: window.innerHeight,
          }),
        );
    };
    window.addEventListener("resize", bound);
    const observer = new ResizeObserver(bound);
    if (ref.current) observer.observe(ref.current);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", bound);
    };
  }, []);
  return {
    ref,
    position,
    dragging,
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (
        drag.current ||
        event.button !== 0 ||
        (event.target as HTMLElement).closest("button,input,select,a")
      )
        return;
      drag.current = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        startX: position.x,
        startY: position.y,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      setDragging(true);
      event.preventDefault();
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      const current = drag.current;
      if (current?.id === event.pointerId)
        move(
          current.startX + event.clientX - current.x,
          current.startY + event.clientY - current.y,
        );
    },
    onPointerUp: () => {
      drag.current = null;
      setDragging(false);
    },
    onLostPointerCapture: () => {
      drag.current = null;
      setDragging(false);
    },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (event.target !== event.currentTarget) return;
      const delta: Record<string, [number, number]> = {
        ArrowLeft: [-10, 0],
        ArrowRight: [10, 0],
        ArrowUp: [0, -10],
        ArrowDown: [0, 10],
      };
      if (delta[event.key]) {
        event.preventDefault();
        move(
          position.x + delta[event.key][0],
          position.y + delta[event.key][1],
        );
      }
    },
  };
}
function FloatingPanel({
  mode,
  controller,
  onClose,
  onSettings,
  onCapture,
  classic,
}: {
  mode: Mode;
  controller: PreviewController;
  onClose: () => void;
  onSettings: () => void;
  onCapture: (mode: "screenshot" | "subtitle") => void;
  classic: boolean;
}) {
  const drag = usePanelDrag();
  const [collapsed, setCollapsed] = useState(false);
  const meta = modes.find((m) => m.id === mode)!;
  const task = controller.state.tasks[mode];
  return (
    <div
      ref={drag.ref}
      className={`floating-panel${collapsed ? " collapsed" : ""}${classic ? " classic-floating-panel" : ""}${drag.dragging ? " dragging" : ""}`}
      style={{ left: drag.position.x, top: drag.position.y }}
      role="region"
      aria-label={`${meta.label}悬浮演示面板`}
    >
      <header
        className="floating-panel-header"
        tabIndex={0}
        aria-label="移动面板，方向键调整位置"
        onPointerDown={drag.onPointerDown}
        onPointerMove={drag.onPointerMove}
        onPointerUp={drag.onPointerUp}
        onPointerCancel={drag.onPointerUp}
        onLostPointerCapture={drag.onLostPointerCapture}
        onKeyDown={drag.onKeyDown}
      >
        <span>
          <Icon name={meta.icon} size={16} />
          {meta.label}
          <small>演示</small>
        </span>
        <div className="inline-actions">
          <IconButton icon="settings" label="悬浮窗设置" onClick={onSettings} />
          <IconButton
            icon={collapsed ? "expand" : "minus"}
            label={collapsed ? "展开面板" : "收起面板（任务继续）"}
            onClick={() => setCollapsed(!collapsed)}
          />
          <IconButton
            icon="close"
            label={mode === "audio" ? "关闭面板并停止音频演示" : "关闭面板"}
            onClick={onClose}
          />
        </div>
      </header>
      {!collapsed && (
        <div className="floating-panel-content">
          {mode === "text" ? (
            <>
              <div className="floating-section-label">原文</div>
              <TextEditor controller={controller} compact />
            </>
          ) : (
            <>
              <FeatureControls
                mode={mode}
                controller={controller}
                onCapture={onCapture}
              />
              <div className="floating-source" dir="auto">
                {task.source || "开始演示后，原文会显示在这里。"}
              </div>
            </>
          )}
          <div className="floating-result">
            <div className="floating-section-label">译文</div>
            <ResultBody task={task} />
          </div>
          <footer>
            <span>
              {task.running ? "演示任务运行中" : "仅预览 · 无真实设备访问"}
            </span>
            <IconButton
              icon="copy"
              label="复制到 Demo 剪贴板"
              disabled={!task.result}
              onClick={() => controller.copy(task.result)}
            />
          </footer>
        </div>
      )}
    </div>
  );
}
export function FloatingPreview({
  prefs,
  controller,
  onSettings,
  onCapture,
  onClose,
}: {
  prefs: Preferences;
  controller: PreviewController;
  onSettings: () => void;
  onCapture: (mode: "screenshot" | "subtitle") => void;
  onClose: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [panelMode, setPanelMode] = useState<Mode | null>(
    prefs.floatingStyle === "classic" ? "text" : null,
  );
  const closePanel = () => {
    if (panelMode === "audio") controller.stop("audio");
    setPanelMode(null);
  };
  return (
    <div className="floating-preview">
      {prefs.floatingStyle === "capsule" && (
        <nav
          className={`floating-capsule${expanded ? "" : " folded"}`}
          aria-label="悬浮胶囊功能"
        >
          <button
            className="capsule-brand"
            aria-expanded={expanded}
            aria-label={expanded ? "收起功能胶囊" : "展开功能胶囊"}
            onClick={() => setExpanded(!expanded)}
          >
            <Icon name="book" size={21} />
            <span>译刻</span>
          </button>
          {expanded && (
            <>
              <span className="capsule-separator" />
              {modes.map((mode) => (
                <button
                  key={mode.id}
                  className={panelMode === mode.id ? "active" : ""}
                  aria-pressed={panelMode === mode.id}
                  onClick={() => setPanelMode(mode.id)}
                >
                  <Icon name={mode.icon} size={16} />
                  <span>{mode.short}</span>
                </button>
              ))}
              <span className="capsule-separator" />
              <IconButton
                icon="settings"
                label="悬浮窗设置"
                onClick={onSettings}
              />
              <IconButton
                icon="close"
                label="关闭悬浮窗演示"
                onClick={() => {
                  closePanel();
                  onClose();
                }}
              />
            </>
          )}
        </nav>
      )}
      {prefs.floatingStyle === "classic" && (
        <nav className="classic-floating-modes" aria-label="经典悬浮窗演示功能">
          {modes.map((mode) => (
            <button
              key={mode.id}
              aria-pressed={panelMode === mode.id}
              className={panelMode === mode.id ? "active" : ""}
              onClick={() => setPanelMode(mode.id)}
            >
              <Icon name={mode.icon} size={15} />
              {mode.short}
            </button>
          ))}
          <IconButton
            icon="close"
            label="关闭悬浮窗演示"
            onClick={() => {
              closePanel();
              onClose();
            }}
          />
        </nav>
      )}
      {panelMode && (
        <FloatingPanel
          key={panelMode}
          mode={panelMode}
          controller={controller}
          onClose={closePanel}
          onSettings={onSettings}
          onCapture={onCapture}
          classic={prefs.floatingStyle === "classic"}
        />
      )}
      <div className="floating-preview-caption">
        <Icon name="windows" size={13} />
        桌面浮窗交互预览 · 可拖动、缩放、收起
      </div>
    </div>
  );
}

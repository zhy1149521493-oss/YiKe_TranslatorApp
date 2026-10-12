import {
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type KeyboardEvent,
} from "react";
import { Icon, IconButton } from "./Icon";
import { BrandMark } from "./BrandMark";
import { clampPanel, modes, type Mode, type Preferences } from "./model";
import { dockSide } from "./floatingGeometry";
import type { PreviewController } from "./usePreview";
import { ResultBody, TextEditor } from "./Translation";
import { FeatureControls } from "./Features";

function usePanelDrag(
  initial = { x: Math.max(8, window.innerWidth - 510), y: 165 },
) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(initial);
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
    move,
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
        startX: ref.current?.getBoundingClientRect().left ?? position.x,
        startY: ref.current?.getBoundingClientRect().top ?? position.y,
      };
      move(drag.current.startX, drag.current.startY);
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
          (ref.current?.getBoundingClientRect().left ?? position.x) +
            delta[event.key][0],
          (ref.current?.getBoundingClientRect().top ?? position.y) +
            delta[event.key][1],
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
}: {
  mode: Mode;
  controller: PreviewController;
  onClose: () => void;
  onSettings: () => void;
  onCapture: (mode: "screenshot" | "subtitle") => void;
}) {
  const drag = usePanelDrag();
  const [collapsed, setCollapsed] = useState(false);
  const meta = modes.find((m) => m.id === mode)!;
  const task = controller.state.tasks[mode];
  return (
    <div
      ref={drag.ref}
      className={`floating-panel${collapsed ? " collapsed" : ""}${drag.dragging ? " dragging" : ""}`}
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
  const [panelMode, setPanelMode] = useState<Mode | null>(
    prefs.floatingStyle === "classic" ? "text" : null,
  );
  const closePanel = () => {
    if (panelMode === "audio") controller.stop("audio");
    setPanelMode(null);
  };
  return (
    <div
      className="floating-preview"
      role="region"
      aria-label="独立桌面悬浮窗预览"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          closePanel();
          onClose();
        }
      }}
    >
      <header className="desktop-preview-header">
        <div>
          <Icon name="monitor" size={17} />
          <span>
            桌面浮窗预览<small>浏览器模拟桌面边界 · 未创建系统窗口</small>
          </span>
        </div>
        <button
          className="quiet-button"
          onClick={() => {
            closePanel();
            onClose();
          }}
        >
          <Icon name="back" size={15} />
          返回应用
        </button>
      </header>
      <div className="desktop-reading-card" aria-hidden="true">
        <small>A LITTLE ROOM FOR WORDS</small>
        <h2>
          让工具退后，
          <br />
          让文字走近。
        </h2>
        <div />
        <p>
          把胶囊拖到左边或右边，
          <br />
          需要时，再从边缘轻轻唤出。
        </p>
      </div>
      {prefs.floatingStyle === "capsule" && (
        <CapsuleLauncher
          panelMode={panelMode}
          onSelect={setPanelMode}
          onSettings={onSettings}
          onClose={() => {
            closePanel();
            onClose();
          }}
        />
      )}
      {prefs.floatingStyle === "classic" && (
        <ClassicFloating
          controller={controller}
          onCapture={onCapture}
          onClose={onClose}
        />
      )}
      {prefs.floatingStyle === "capsule" && panelMode && (
        <FloatingPanel
          key={panelMode}
          mode={panelMode}
          controller={controller}
          onClose={closePanel}
          onSettings={onSettings}
          onCapture={onCapture}
        />
      )}
      <div className="floating-preview-caption">
        <Icon name="windows" size={13} />
        {prefs.floatingStyle === "capsule"
          ? "拖动胶囊的握柄贴边 · 点击边缘书签唤出 · 面板独立移动"
          : "经典窗内按钮 · 拖动标题移动 · 右下角缩放"}
      </div>
    </div>
  );
}

function CapsuleLauncher({
  panelMode,
  onSelect,
  onSettings,
  onClose,
}: {
  panelMode: Mode | null;
  onSelect: (mode: Mode) => void;
  onSettings: () => void;
  onClose: () => void;
}) {
  const drag = usePanelDrag({
    x: Math.max(8, window.innerWidth - 175),
    y: 145,
  });
  const [expanded, setExpanded] = useState(false);
  const [dock, setDock] = useState<"left" | "right" | null>(null);
  const [peek, setPeek] = useState(false);
  const hidden = !!dock && !peek;
  const edgeRef = useRef<HTMLButtonElement>(null);
  const keyboardPeek = useRef(false);
  useEffect(() => {
    if (hidden) edgeRef.current?.focus();
    else if (peek && keyboardPeek.current)
      drag.ref.current?.querySelector<HTMLElement>(".capsule-grip")?.focus();
  }, [hidden, peek]);
  const dockAt = (side: "left" | "right") => {
    setDock(side);
    setPeek(false);
  };
  return (
    <>
      {hidden && (
        <button
          ref={edgeRef}
          className={`capsule-edge-tab ${dock}`}
          style={{
            top: Math.min(
              drag.position.y,
              Math.max(8, window.innerHeight - 110),
            ),
          }}
          aria-label="唤出贴边胶囊"
          onClick={(event) => {
            keyboardPeek.current = event.detail === 0;
            setPeek(true);
            setExpanded(true);
          }}
        >
          <BrandMark size={20} />
          <span>译刻</span>
        </button>
      )}
      <div
        ref={drag.ref}
        className={`floating-capsule${expanded ? "" : " folded"}${drag.dragging ? " dragging" : ""}`}
        style={{
          left:
            dock === "left" ? 8 : dock === "right" ? "auto" : drag.position.x,
          right: dock === "right" ? 8 : undefined,
          top: drag.position.y,
          visibility: hidden ? "hidden" : undefined,
        }}
        inert={hidden ? true : undefined}
        onMouseLeave={(event) => {
          if (
            dock &&
            !drag.dragging &&
            !event.currentTarget.contains(document.activeElement)
          )
            setPeek(false);
        }}
      >
        <span
          className="capsule-grip"
          role="button"
          tabIndex={0}
          aria-label="拖动胶囊，靠近左右边缘后贴边；方向键移动"
          onPointerDown={(e) => {
            setDock(null);
            setPeek(false);
            drag.onPointerDown(e);
          }}
          onPointerMove={drag.onPointerMove}
          onPointerUp={() => {
            drag.onPointerUp();
            const rect = drag.ref.current?.getBoundingClientRect();
            if (rect) {
              const side = dockSide(rect.left, rect.width, window.innerWidth);
              if (side) dockAt(side);
            }
          }}
          onPointerCancel={drag.onPointerUp}
          onLostPointerCapture={drag.onLostPointerCapture}
          onKeyDown={(e) => {
            if (e.key.startsWith("Arrow")) setDock(null);
            drag.onKeyDown(e);
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              dockAt("right");
            }
          }}
        >
          <Icon name="grip" size={16} />
        </span>
        <button
          className="capsule-brand"
          aria-label={expanded ? "收起功能胶囊" : "展开功能胶囊"}
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          <BrandMark size={24} />
          <span>译刻</span>
        </button>
        {expanded && (
          <nav className="capsule-functions" aria-label="悬浮胶囊功能">
            <span className="capsule-separator" />
            {modes.map((mode) => (
              <button
                key={mode.id}
                aria-label={mode.label}
                aria-pressed={panelMode === mode.id}
                className={panelMode === mode.id ? "active" : ""}
                onClick={() => {
                  onSelect(mode.id);
                  if (dock) setPeek(false);
                }}
              >
                <Icon name={mode.icon} size={16} />
                <span>{mode.short}</span>
              </button>
            ))}
            <span className="capsule-separator" />
            <IconButton
              icon="back"
              label="胶囊贴靠右侧边缘"
              onClick={() => dockAt("right")}
            />
            <IconButton
              icon="settings"
              label="悬浮窗设置"
              onClick={onSettings}
            />
            <IconButton icon="close" label="关闭悬浮窗演示" onClick={onClose} />
          </nav>
        )}
      </div>
    </>
  );
}

function ClassicFloating({
  controller,
  onCapture,
  onClose,
}: {
  controller: PreviewController;
  onCapture: (mode: "screenshot" | "subtitle") => void;
  onClose: () => void;
}) {
  const drag = usePanelDrag({
    x: Math.max(8, window.innerWidth - 440),
    y: 180,
  });
  const [mode, setMode] = useState<"text" | "subtitle" | "screenshot">("text");
  const [settings, setSettings] = useState(false);
  const [opacity, setOpacity] = useState(92);
  const screenshot = controller.state.tasks.screenshot;
  const displayMode =
    mode === "screenshot" && !screenshot.source && screenshot.phase === "idle"
      ? "text"
      : mode;
  const task = controller.state.tasks[displayMode];
  const subtitle = controller.state.tasks.subtitle;
  return (
    <div
      ref={drag.ref}
      className="floating-panel restored-classic"
      style={
        {
          left: drag.position.x,
          top: drag.position.y,
          "--float-opacity": `${opacity}%`,
        } as React.CSSProperties
      }
      role="region"
      aria-label="经典翻译悬浮窗"
    >
      <header
        className="floating-panel-header"
        tabIndex={0}
        aria-label="移动经典悬浮窗，方向键调整位置"
        onPointerDown={drag.onPointerDown}
        onPointerMove={drag.onPointerMove}
        onPointerUp={drag.onPointerUp}
        onPointerCancel={drag.onPointerUp}
        onLostPointerCapture={drag.onLostPointerCapture}
        onKeyDown={drag.onKeyDown}
      >
        <strong>{mode === "subtitle" ? "字幕" : "翻译"}</strong>
        <div className="inline-actions">
          <IconButton
            icon="film"
            label={subtitle.running ? "停止视频字幕演示" : "开始视频字幕演示"}
            aria-pressed={subtitle.running}
            onClick={() => {
              if (subtitle.running) {
                controller.stop("subtitle");
                setMode("text");
              } else {
                setMode("subtitle");
                if (subtitle.region) controller.run("subtitle");
                else {
                  controller.setNotice("请先用窗内选区按钮选择示例字幕区域");
                  onCapture("subtitle");
                }
              }
            }}
          />
          <IconButton
            icon="target"
            label="调整字幕区域"
            onClick={() => {
              onCapture("subtitle");
            }}
          />
          <IconButton
            icon="camera"
            label="截图翻译"
            onClick={() => {
              setMode("screenshot");
              onCapture("screenshot");
            }}
          />
          <IconButton
            icon="settings"
            label="浮窗透明度设置"
            aria-pressed={settings}
            onClick={() => setSettings(!settings)}
          />
          <IconButton icon="close" label="关闭经典悬浮窗" onClick={onClose} />
        </div>
      </header>
      {settings && (
        <label className="classic-opacity">
          透明度
          <input
            type="range"
            aria-label="浮窗透明度"
            min="35"
            max="100"
            value={opacity}
            onChange={(e) => setOpacity(Number(e.target.value))}
          />
          <small>{opacity}%</small>
        </label>
      )}
      <div className="restored-classic-body">
        {task.source ? (
          <>
            <div className="restored-classic-source" dir="auto">
              {task.source}
            </div>
            <div className="restored-classic-divider" />
            <ResultBody task={task} />
          </>
        ) : task.phase === "loading" || task.phase === "error" ? (
          <ResultBody task={task} />
        ) : (
          <div className="result-message">
            <p>{mode === "subtitle" ? "视频字幕" : "复制即译"}</p>
            <small>
              {mode === "subtitle"
                ? "选好区域后，点击窗内字幕按钮开始演示"
                : "这里显示演示内容，未监听系统剪贴板"}
            </small>
          </div>
        )}
      </div>
    </div>
  );
}

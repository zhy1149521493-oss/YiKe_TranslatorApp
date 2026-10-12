import {
  useEffect,
  useRef,
  useState,
  useReducer,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import {
  defaults,
  normalizePreferences,
  STORAGE_KEY,
  themeColors,
  type Preferences,
  type Tone,
} from "./model";
import { MainLayout } from "./Layouts";
import { Settings, type SettingsPage } from "./Settings";
import { CaptureDialog } from "./Features";
import { FloatingPreview } from "./Floating";
import { Icon } from "./Icon";
import { usePreview } from "./usePreview";
import { workspaceReducer } from "./workspace";

function readPreferences(): Preferences {
  try {
    return normalizePreferences(
      JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null"),
    );
  } catch {
    return { ...defaults };
  }
}
export function DemoApp() {
  const controller = usePreview();
  const [prefs, setPrefs] = useState(readPreferences);
  const [systemDark, setSystemDark] = useState(
    () => matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const [workspace, dispatchWorkspace] = useReducer(workspaceReducer, {
    open: false,
    view: "task",
  });
  const settingsOpen = workspace.view === "settings";
  const [motionInput, setMotionInput] = useState<"pointer" | "keyboard">(
    "pointer",
  );
  const [settingsPage, setSettingsPage] = useState<SettingsPage>("general");
  const [floatingOpen, setFloatingOpen] = useState(false);
  const [capture, setCapture] = useState<"screenshot" | "subtitle" | null>(
    null,
  );
  const root = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const previousFloatingFocus = useRef<HTMLElement | null>(null);
  const tone: Tone =
    prefs.theme === "system" ? (systemDark ? "dark" : "light") : prefs.theme;
  const colors = themeColors(prefs, tone);
  useEffect(() => {
    const query = matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch {
      /* Preview remains usable with storage disabled. */
    }
  }, [prefs]);
  useEffect(() => {
    document.documentElement.dataset.theme = tone;
    document.documentElement.style.colorScheme = tone;
  }, [tone]);
  useEffect(() => {
    if (!capture) return;
    previousFocus.current = document.activeElement as HTMLElement;
    root.current
      ?.querySelector<HTMLButtonElement>('[role="dialog"] button')
      ?.focus();
    return () => {
      if (previousFocus.current?.isConnected) previousFocus.current.focus();
    };
  }, [capture]);
  useEffect(() => {
    if (!floatingOpen) return;
    root.current
      ?.querySelector<HTMLButtonElement>(".desktop-preview-header button")
      ?.focus();
    return () => {
      if (previousFloatingFocus.current?.isConnected)
        previousFloatingFocus.current.focus();
      else
        root.current
          ?.querySelector<HTMLButtonElement>(
            'button[aria-label="打开悬浮窗演示"]',
          )
          ?.focus();
    };
  }, [floatingOpen]);
  useEffect(() => {
    if (workspace.open && !capture && !floatingOpen)
      root.current
        ?.querySelector<HTMLElement>("[data-drawer-focus]")
        ?.focus({ preventScroll: true });
  }, [
    workspace.open,
    workspace.view,
    controller.state.mode,
    capture,
    floatingOpen,
  ]);
  const closeDrawer = () => {
    root.current
      ?.querySelector<HTMLButtonElement>(".navigation-brand")
      ?.focus({ preventScroll: true });
    dispatchWorkspace({ type: "close" });
  };
  const keyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      if (capture) setCapture(null);
      else if (settingsOpen && workspace.open)
        dispatchWorkspace({ type: "back" });
      else if (floatingOpen) {
        setFloatingOpen(false);
      } else if (workspace.open) closeDrawer();
    }
    if (capture && event.key === "Tab") {
      const buttons = root.current?.querySelectorAll<HTMLButtonElement>(
        '[role="dialog"] button:not(:disabled)',
      );
      if (!buttons?.length) return;
      const first = buttons[0],
        last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  };
  const showFloating = () => {
    previousFloatingFocus.current = document.activeElement as HTMLElement;
    setFloatingOpen((open) => !open);
  };
  const style = {
    "--accent": colors.accent,
    "--action-ink": colors.actionInk,
    "--paper": colors.background,
    "--ink": colors.foreground,
    "--reading-size": `${prefs.fontSize}px`,
  } as CSSProperties;
  return (
    <div
      ref={root}
      className="design-demo"
      data-style={prefs.mainStyle}
      data-tone={tone}
      data-navigation={prefs.navigation}
      data-workspace-open={workspace.open}
      data-motion-input={motionInput}
      style={style}
      onKeyDown={keyDown}
      onKeyDownCapture={() => setMotionInput("keyboard")}
      onPointerDownCapture={() => setMotionInput("pointer")}
      onPointerOverCapture={() => setMotionInput("pointer")}
    >
      <div className="main-surface" inert={capture ? true : undefined}>
        <div className="layout-surface" inert={floatingOpen ? true : undefined}>
          <MainLayout
            style={prefs.mainStyle}
            controller={controller}
            tone={tone}
            settingsOpen={settingsOpen}
            navigation={prefs.navigation}
            drawerOpen={workspace.open}
            onCloseDrawer={closeDrawer}
            onBrand={() =>
              dispatchWorkspace(
                workspace.open
                  ? { type: "close" }
                  : { type: settingsOpen ? "show-settings" : "back" },
              )
            }
            onSettings={() => {
              setSettingsPage("general");
              setFloatingOpen(false);
              dispatchWorkspace({ type: "settings" });
            }}
            onTheme={() =>
              setPrefs((p) => ({
                ...p,
                theme: tone === "dark" ? "light" : "dark",
              }))
            }
            floatingOpen={floatingOpen}
            onFloating={showFloating}
            onMode={(mode) => {
              dispatchWorkspace({
                type: "task",
                sameMode: controller.state.mode === mode,
              });
              controller.dispatch({ type: "mode", mode });
            }}
            onCapture={setCapture}
          >
            <Settings
              prefs={prefs}
              tone={tone}
              onChange={setPrefs}
              controller={controller}
              initialPage={settingsPage}
              onBack={() => dispatchWorkspace({ type: "back" })}
              onFloating={showFloating}
            />
          </MainLayout>
        </div>
        {floatingOpen && (
          <FloatingPreview
            key={prefs.floatingStyle}
            controller={controller}
            onSettings={() => {
              setSettingsPage("floating");
              setFloatingOpen(false);
              dispatchWorkspace({ type: "show-settings" });
            }}
            onCapture={setCapture}
            onClose={() => setFloatingOpen(false)}
          />
        )}
      </div>
      {capture && (
        <CaptureDialog
          mode={capture}
          onClose={() => setCapture(null)}
          onConfirm={() => {
            const mode = capture;
            setCapture(null);
            if (mode === "subtitle")
              controller.dispatch({
                type: "task",
                mode,
                patch: { region: true },
              });
            else controller.run("screenshot");
          }}
        />
      )}
      <div className="preview-badge">
        <Icon name="flask" size={12} />
        <span>设计 Demo · 示例数据 · 未接真实功能</span>
      </div>
      <div className="preview-notice" role="status" aria-live="polite">
        {controller.notice}
      </div>
    </div>
  );
}

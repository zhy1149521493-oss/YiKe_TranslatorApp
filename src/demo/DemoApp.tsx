import {
  useEffect,
  useRef,
  useState,
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
  const [settingsOpen, setSettingsOpen] = useState(false);
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
  const keyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      if (capture) setCapture(null);
      else if (settingsOpen) setSettingsOpen(false);
      else if (floatingOpen) {
        setFloatingOpen(false);
      }
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
    setSettingsOpen(false);
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
      style={style}
      onKeyDown={keyDown}
    >
      <div className="main-surface" inert={capture ? true : undefined}>
        <div className="layout-surface" inert={floatingOpen ? true : undefined}>
          <MainLayout
            style={prefs.mainStyle}
            controller={controller}
            tone={tone}
            settingsOpen={settingsOpen}
            onSettings={() => {
              setSettingsPage("general");
              setFloatingOpen(false);
              setSettingsOpen((open) => !open);
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
              controller.dispatch({ type: "mode", mode });
              setSettingsOpen(false);
            }}
            onCapture={setCapture}
          >
            <Settings
              prefs={prefs}
              tone={tone}
              onChange={setPrefs}
              controller={controller}
              initialPage={settingsPage}
              onBack={() => setSettingsOpen(false)}
              onFloating={showFloating}
            />
          </MainLayout>
        </div>
        {floatingOpen && (
          <FloatingPreview
            key={prefs.floatingStyle}
            prefs={prefs}
            controller={controller}
            onSettings={() => {
              setSettingsPage("floating");
              setFloatingOpen(false);
              setSettingsOpen(true);
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

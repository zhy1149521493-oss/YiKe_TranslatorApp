import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import "./App.css";

const appWindow = getCurrentWebviewWindow();

/* ============ 主窗口(软件模式) ============ */
function MainWindow() {
  const [floatingOpen, setFloatingOpen] = useState(false);

  useEffect(() => {
    const unlisten = appWindow.listen("floating-closed", () =>
      setFloatingOpen(false)
    );
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  const openFloating = async () => {
    try {
      await invoke("open_floating_window");
      setFloatingOpen(true);
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="app-main">
      <header className="app-header">
        <h1>本地翻译助手</h1>
        <span className="mode-badge">软件模式</span>
      </header>

      <main className="app-body">
        <div className="placeholder-card">
          <h2>🚧 开发中</h2>
          <p>翻译 / 对话界面将在这里呈现(第 0.3 步起逐步完善)</p>
        </div>

        <div className="actions">
          <button className="btn-primary" onClick={openFloating}>
            打开悬浮窗
          </button>
          <span className="hint">
            {floatingOpen
              ? "悬浮窗已打开,注意屏幕右下角的小窗口"
              : "点击后屏幕右下角会出现一个圆角小窗"}
          </span>
        </div>
      </main>
    </div>
  );
}

/* ============ 悬浮窗 ============ */
function FloatingWindow() {
  const closeFloating = async () => {
    await appWindow.emit("floating-closed");
    await appWindow.close();
  };

  return (
    <div className="floating-root">
      <div className="floating-card">
        <div className="floating-bar">
          <span className="floating-title">悬浮窗</span>
          <button
            className="floating-close"
            title="关闭"
            onClick={closeFloating}
          >
            ✕
          </button>
        </div>
        <div className="floating-body">
          <p>这里是划词翻译结果浮窗</p>
          <p className="floating-sub">(功能开发中, 第 2 波上线)</p>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [label, setLabel] = useState<string>("main");

  useEffect(() => {
    setLabel(appWindow.label);
  }, []);

  return label === "floating" ? <FloatingWindow /> : <MainWindow />;
}

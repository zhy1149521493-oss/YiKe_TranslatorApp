import type { LayoutProps } from "./Layouts";
import { Icon, IconButton } from "./Icon";
import { modes } from "./model";
import {
  EnginePicker,
  LanguageSelect,
  TextEditor,
  ResultBody,
} from "./Translation";
import { FeatureView } from "./Features";
import type { InterfaceController } from "./controller";
import { ContentDrawer, NavigationCapsule } from "./Disclosure";

function ReadingDesk({ controller }: { controller: InterfaceController }) {
  const task = controller.state.tasks.text;
  return (
    <>
      <div className="reading-language-bar">
        <span>从</span>
        <LanguageSelect side="src" controller={controller} />
        <IconButton
          icon="swap"
          label="交换语言方向"
          disabled={controller.state.src === "auto"}
          onClick={() => controller.dispatch({ type: "swap" })}
        />
        <span>到</span>
        <LanguageSelect side="tgt" controller={controller} />
      </div>
      <div className="reading-book">
        <header className="reading-page-heading">
          <span>
            <Icon name="pen" size={16} />
            原文
          </span>
          <small>SOURCE</small>
        </header>
        <header className="reading-page-heading">
          <span>
            <Icon name="book" size={16} />
            译文
          </span>
          <small>TRANSLATION</small>
        </header>
        <div className="reading-page"><TextEditor controller={controller} /></div>
        <div className="reading-page"><ResultBody task={task} /></div>
        <footer className="reading-page-footer">
          <button className="quiet-button" onClick={controller.paste}>
            <Icon name="paste" size={14} />
            粘贴
          </button>
          <button
            className="quiet-button"
            disabled={!task.source}
            onClick={() => controller.edit("")}
          >
            <Icon name="trash" size={14} />
            清空
          </button>
          <small>{Array.from(task.source).length.toLocaleString()} 字符</small>
        </footer>
        <footer className="reading-page-footer">
          <small>
            {task.phase === "loading" ? "正在翻译" : task.result ? "译文支持选中复制" : "等待原文"}
          </small>
          <button
            className="quiet-button"
            disabled={!task.result}
            onClick={() => controller.copy(task.result)}
          >
            <Icon name="copy" size={14} />
            复制译文
          </button>
        </footer>
      </div>
      <footer className="reading-bottom-bar">
        <span>
          停笔 0.6 秒后自动翻译
        </span>
        <button
          className="primary-button"
          disabled={!task.source.trim()}
          onClick={() =>
            task.phase === "loading"
              ? controller.stop("text")
              : controller.run("text", task.source)
          }
        >
          <Icon
            name={task.phase === "loading" ? "stop" : "refresh"}
            size={16}
          />
          {task.phase === "loading" ? "取消翻译" : "重新翻译"}
          <kbd>Ctrl ↵</kbd>
        </button>
      </footer>
    </>
  );
}

export function ReadingWorkbench(props: LayoutProps) {
  const { controller } = props;
  const meta = modes.find((m) => m.id === controller.state.mode)!;
  const task = controller.state.tasks[meta.id];
  return (
    <div className="reading-shell">
      <NavigationCapsule
        variant="workbench"
        behavior={props.navigation}
        brand={
          <>
            <b>译刻</b>
            <small>YIKE TRANSLATOR</small>
          </>
        }
        workspaceOpen={props.drawerOpen}
        onBrand={props.onBrand}
      >
        <p className="reading-rail-caption">翻译工作台</p>
        <nav aria-label="翻译功能">
          {modes.map((mode) => (
            <button
              key={mode.id}
              aria-label={mode.label}
              title={mode.label}
              aria-current={
                props.drawerOpen &&
                !props.settingsOpen &&
                controller.state.mode === mode.id
                  ? "page"
                  : undefined
              }
              onClick={() => props.onMode(mode.id)}
            >
              <Icon name={mode.icon} size={20} />
              <span>{mode.label}</span>
            </button>
          ))}
        </nav>
        <div className="reading-rail-bottom">
          <button onClick={props.onFloating}>
            <Icon name="windows" size={20} />
            <span>划词悬浮窗</span>
          </button>
          <button
            aria-label="设置中心"
            aria-pressed={props.drawerOpen && props.settingsOpen}
            onClick={props.onSettings}
          >
            <Icon name="settings" size={20} />
            <span>设置中心</span>
          </button>
          <p>让理解，少一点距离。</p>
        </div>
      </NavigationCapsule>
      <ContentDrawer
        key={props.settingsOpen ? "settings" : meta.id}
        open={props.drawerOpen}
        direction="right"
        className="reading-main"
        onClose={props.onCloseDrawer}
      >
        <header className="reading-topbar" onMouseDown={props.onDrag} onDoubleClick={e => { if (!(e.target as HTMLElement).closest("button, select, input, label")) props.onMaximize(); }}>
          <EnginePicker controller={controller} />
          <div className="reading-top-actions">
            <IconButton
              icon="windows"
              label="打开经典悬浮窗"
              onClick={props.onFloating}
            />
            <IconButton
              icon={props.tone === "dark" ? "sun" : "moon"}
              label="切换深浅主题"
              onClick={props.onTheme}
            />
            <IconButton
              icon="settings"
              label="打开设置"
              onClick={props.onSettings}
            />
            <span className="reading-native-controls">
              <IconButton icon="minus" label="最小化" onClick={props.onMinimize} />
              <IconButton icon="expand" label="最大化或还原" onClick={props.onMaximize} />
              <IconButton icon="close" label="关闭窗口" onClick={props.onClose} />
            </span>
          </div>
        </header>
        <main
          className={`reading-workspace${props.settingsOpen ? " reading-settings" : ""}`}
          key={props.settingsOpen ? "settings" : meta.id}
          tabIndex={-1}
          data-drawer-focus
        >
          {props.settingsOpen ? (
            props.children
          ) : (
            <>
              <header className="reading-intro">
                <div>
                  <small>WORDS, SIDE BY SIDE</small>
                  <h1>{meta.label}</h1>
                  <p>
                    {meta.id === "text"
                      ? "一页原文，一页译文。让理解，自然发生。"
                      : meta.hint}
                  </p>
                </div>
                <span className="reading-status">
                  <i />
                  {task.phase === "loading"
                    ? "正在处理"
                    : task.running
                      ? "运行中"
                      : "就绪"}
                </span>
              </header>
              {meta.id === "text" ? (
                <ReadingDesk controller={controller} />
              ) : (
                <div className="reading-feature">
                  <FeatureView
                    mode={meta.id}
                    controller={controller}
                    onCapture={props.onCapture}
                    card
                  />
                </div>
              )}
            </>
          )}
        </main>
      </ContentDrawer>
    </div>
  );
}

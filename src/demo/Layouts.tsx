import type { ReactNode } from "react";
import { Icon, IconButton } from "./Icon";
import { modes, type MainStyle, type Mode, type Tone } from "./model";
import type { PreviewController } from "./usePreview";
import { EnginePicker, TextFlow, TranslationCards } from "./Translation";
import { FeatureView } from "./Features";

export type LayoutProps = {
  controller: PreviewController;
  settingsOpen: boolean;
  tone: Tone;
  onSettings: () => void;
  onTheme: () => void;
  onFloating: () => void;
  floatingOpen: boolean;
  onMode: (mode: Mode) => void;
  onCapture: (mode: "screenshot" | "subtitle") => void;
  children?: ReactNode;
};
function ModeNav({
  controller,
  settingsOpen,
  onMode,
  short = false,
}: Pick<LayoutProps, "controller" | "settingsOpen" | "onMode"> & {
  short?: boolean;
}) {
  return (
    <nav className="mode-nav" aria-label="翻译功能">
      {modes.map((mode) => (
        <button
          key={mode.id}
          aria-label={mode.label}
          title={mode.label}
          className={
            !settingsOpen && controller.state.mode === mode.id ? "active" : ""
          }
          aria-current={
            !settingsOpen && controller.state.mode === mode.id
              ? "page"
              : undefined
          }
          onClick={() => onMode(mode.id)}
        >
          <Icon name={mode.icon} size={16} />
          <span>{short ? mode.short : mode.label}</span>
        </button>
      ))}
    </nav>
  );
}
function ToolbarActions(props: LayoutProps) {
  return (
    <div className="toolbar-actions">
      <IconButton
        icon="windows"
        label="打开悬浮窗演示"
        aria-pressed={props.floatingOpen}
        onClick={props.onFloating}
      />
      <IconButton
        icon="settings"
        label="设置中心"
        aria-pressed={props.settingsOpen}
        onClick={props.onSettings}
      />
      <IconButton
        icon={props.tone === "dark" ? "sun" : "moon"}
        label="切换深浅主题"
        onClick={props.onTheme}
      />
    </div>
  );
}
function WindowControls() {
  return (
    <div className="window-controls" aria-label="桌面窗口控件，预览中未接入">
      <IconButton icon="minus" label="最小化（桌面版接入）" disabled />
      <IconButton icon="expand" label="最大化（桌面版接入）" disabled />
      <IconButton icon="close" label="关闭（桌面版接入）" disabled />
    </div>
  );
}
function Content({
  props,
  card = false,
}: {
  props: LayoutProps;
  card?: boolean;
}) {
  if (props.settingsOpen) return <>{props.children}</>;
  const mode = props.controller.state.mode;
  return mode === "text" ? (
    card ? (
      <TranslationCards controller={props.controller} />
    ) : (
      <TextFlow controller={props.controller} />
    )
  ) : (
    <FeatureView
      mode={mode}
      controller={props.controller}
      onCapture={props.onCapture}
      card={card}
    />
  );
}
export function PoetryLayout(props: LayoutProps) {
  return (
    <>
      <WindowControls />
      <header className="poetry-toolbar">
        <div className="brand">
          <Icon name="book" size={28} />
          <span>译刻</span>
        </div>
        <ModeNav {...props} short />
        <ToolbarActions {...props} />
      </header>
      <main
        key={props.settingsOpen ? "settings" : props.controller.state.mode}
        className={`poetry-workspace${props.settingsOpen ? " showing-settings" : ""}`}
      >
        <Content props={props} />
      </main>
    </>
  );
}
export function WorkbenchLayout(props: LayoutProps) {
  return (
    <>
      <div className="ambient-background" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <WindowControls />
      <div className="workbench-frame">
        <header className="workbench-toolbar">
          <div className="brand">
            <span className="brand-tile">
              <Icon name="book" size={24} />
            </span>
            <span>译刻</span>
          </div>
          <ModeNav {...props} />
          <ToolbarActions {...props} />
        </header>
        <main
          key={props.settingsOpen ? "settings" : props.controller.state.mode}
          className="workbench-workspace"
        >
          <Content props={props} card />
        </main>
      </div>
    </>
  );
}
export function ClassicLayout(props: LayoutProps) {
  const { controller } = props;
  const meta = modes.find((mode) => mode.id === controller.state.mode)!;
  return (
    <>
      <header className="classic-toolbar">
        <div className="brand">译刻</div>
        <EnginePicker controller={controller} />
        <ToolbarActions {...props} />
      </header>
      <WindowControls />
      <main
        key={props.settingsOpen ? "settings" : props.controller.state.mode}
        className="classic-workspace"
      >
        {props.settingsOpen ? (
          props.children
        ) : (
          <>
            <button className="classic-float-toggle" onClick={props.onFloating}>
              <Icon name="windows" size={15} />
              {props.floatingOpen ? "收起悬浮窗演示" : "打开悬浮窗演示"}
            </button>
            <div className="classic-mode-grid">
              {modes.map((mode) => (
                <button
                  key={mode.id}
                  aria-label={mode.label}
                  title={mode.label}
                  className={controller.state.mode === mode.id ? "active" : ""}
                  aria-pressed={controller.state.mode === mode.id}
                  onClick={() => props.onMode(mode.id)}
                >
                  <Icon name={mode.icon} size={22} />
                  <b>{mode.label}</b>
                  <small>{mode.hint}</small>
                </button>
              ))}
            </div>
            <section className="classic-task">
              <header>
                <span>
                  <Icon name={meta.icon} />
                  {meta.label}
                </span>
                <small>演示状态</small>
              </header>
              {controller.state.mode === "text" ? (
                <TextFlow controller={controller} />
              ) : (
                <FeatureView
                  mode={controller.state.mode}
                  controller={controller}
                  onCapture={props.onCapture}
                />
              )}
            </section>
          </>
        )}
      </main>
    </>
  );
}
export function MainLayout({
  style,
  ...props
}: LayoutProps & { style: MainStyle }) {
  return style === "poetry" ? (
    <PoetryLayout {...props} />
  ) : style === "workbench" ? (
    <WorkbenchLayout {...props} />
  ) : (
    <ClassicLayout {...props} />
  );
}

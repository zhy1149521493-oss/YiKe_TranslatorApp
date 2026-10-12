import type { ReactNode, MouseEvent } from "react";
import { Icon, IconButton } from "./Icon";
import {
  modes,
  type MainStyle,
  type Mode,
  type Tone,
  type Preferences,
} from "./model";
import type { InterfaceController } from "./controller";
import { EnginePicker, TextFlow } from "./Translation";
import { FeatureView } from "./Features";
import { ReadingWorkbench } from "./ReadingWorkbench";
import { ContentDrawer, NavigationCapsule } from "./Disclosure";

export type LayoutProps = {
  controller: InterfaceController;
  settingsOpen: boolean;
  tone: Tone;
  onSettings: () => void;
  onTheme: () => void;
  onFloating: () => void;
  floatingOpen: boolean;
  onMode: (mode: Mode) => void;
  onCapture: (mode: "screenshot" | "subtitle") => void;
  navigation: Preferences["navigation"];
  drawerOpen: boolean;
  onCloseDrawer: () => void;
  onBrand: () => void;
  children?: ReactNode;
  onMinimize: () => void;
  onMaximize: () => void;
  onClose: () => void;
  onDrag: (event: MouseEvent) => void;
  classicTask?: ReactNode;
};
function ModeNav({
  controller,
  settingsOpen,
  drawerOpen,
  onMode,
  short = false,
}: Pick<
  LayoutProps,
  "controller" | "settingsOpen" | "drawerOpen" | "onMode"
> & {
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
            drawerOpen && !settingsOpen && controller.state.mode === mode.id
              ? "active"
              : ""
          }
          aria-current={
            drawerOpen && !settingsOpen && controller.state.mode === mode.id
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
        label="打开经典悬浮窗"
        aria-pressed={props.floatingOpen}
        onClick={props.onFloating}
      />
      <IconButton
        icon="settings"
        label="设置中心"
        aria-pressed={props.drawerOpen && props.settingsOpen}
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
function WindowControls(props: LayoutProps) {
  return (
    <div className="window-controls" aria-label="桌面窗口控件">
      <IconButton icon="minus" label="最小化" onClick={props.onMinimize} />
      <IconButton icon="expand" label="最大化或还原" onClick={props.onMaximize} />
      <IconButton icon="close" label="关闭窗口" onClick={props.onClose} />
    </div>
  );
}
function Content({ props }: { props: LayoutProps }) {
  if (props.settingsOpen) return <>{props.children}</>;
  const mode = props.controller.state.mode;
  return mode === "text" ? (
    <TextFlow controller={props.controller} />
  ) : (
    <FeatureView
      mode={mode}
      book
      controller={props.controller}
      onCapture={props.onCapture}
    />
  );
}
export function PoetryLayout(props: LayoutProps) {
  return (
    <>
      <WindowControls {...props} />
      <NavigationCapsule
        variant="poetry"
        behavior={props.navigation}
        brand="译刻"
        workspaceOpen={props.drawerOpen}
        onBrand={props.onBrand}
      >
        <ModeNav {...props} short />
        <ToolbarActions {...props} />
      </NavigationCapsule>
      <ContentDrawer
        key={props.settingsOpen ? "settings" : props.controller.state.mode}
        open={props.drawerOpen}
        direction="down"
        className="poetry-drawer"
        onClose={props.onCloseDrawer}
      >
        <main
          key={props.settingsOpen ? "settings" : props.controller.state.mode}
          className={`poetry-workspace${props.settingsOpen ? " showing-settings" : ""}`}
          tabIndex={-1}
          data-drawer-focus
        >
          <Content props={props} />
        </main>
      </ContentDrawer>
    </>
  );
}
export function WorkbenchLayout(props: LayoutProps) {
  return <>{!props.drawerOpen && <WindowControls {...props} />}<ReadingWorkbench {...props} /></>;
}
export function ClassicLayout(props: LayoutProps) {
  const { controller } = props;
  const meta = modes.find((mode) => mode.id === controller.state.mode)!;
  return (
    <div className="classic-shell">
      <NavigationCapsule
        variant="classic"
        behavior={props.navigation}
        brand="译刻"
        workspaceOpen={props.drawerOpen}
        onBrand={props.onBrand}
      >
        <div className="classic-navigation-top">
          <EnginePicker controller={controller} />
          <ToolbarActions {...props} />
        </div>
        <div className="classic-navigation-body">
          <button className="classic-float-toggle" onClick={props.onFloating}>
            <Icon name="windows" size={15} />
            打开经典悬浮窗
          </button>
          <nav className="classic-mode-grid" aria-label="翻译功能">
            {modes.map((mode) => (
              <button
                key={mode.id}
                aria-label={mode.label}
                title={mode.label}
                className={
                  props.drawerOpen &&
                  !props.settingsOpen &&
                  controller.state.mode === mode.id
                    ? "active"
                    : ""
                }
                aria-pressed={
                  props.drawerOpen &&
                  !props.settingsOpen &&
                  controller.state.mode === mode.id
                }
                onClick={() => props.onMode(mode.id)}
              >
                <Icon name={mode.icon} size={22} />
                <b>{mode.label}</b>
                <small>{mode.hint}</small>
              </button>
            ))}
          </nav>
        </div>
      </NavigationCapsule>
      <WindowControls {...props} />
      <ContentDrawer
        key={props.settingsOpen ? "settings" : controller.state.mode}
        open={props.drawerOpen}
        direction="down"
        className="classic-content"
        onClose={props.onCloseDrawer}
      >
        <main
          key={props.settingsOpen ? "settings" : props.controller.state.mode}
          className="classic-workspace"
          tabIndex={-1}
          data-drawer-focus
        >
          {props.settingsOpen ? (
            props.children
          ) : (
            <>
              <section className="classic-task">
                <header>
                  <span>
                    <Icon name={meta.icon} />
                    {meta.label}
                  </span>
                  <small>实时翻译</small>
                </header>
                {controller.state.mode === "text" ? (
                  props.classicTask ?? <TextFlow controller={controller} />
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
      </ContentDrawer>
    </div>
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

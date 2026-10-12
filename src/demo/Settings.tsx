import { useState } from "react";
import { Icon, IconButton } from "./Icon";
import { BrandMark } from "./BrandMark";
import {
  defaults,
  modes,
  themeColors,
  type Preferences,
  type Tone,
} from "./model";
import type { PreviewController } from "./usePreview";

const pages = [
  ["general", "常规", "settings"],
  ["translate", "翻译", "pen"],
  ["audio", "音频", "mic"],
  ["subtitle", "字幕", "film"],
  ["floating", "悬浮窗", "windows"],
  ["providers", "模型", "book"],
  ["shortcuts", "快捷键", "target"],
  ["about", "关于", "flask"],
  ["demo", "演示场景", "play"],
] as const;
export type SettingsPage = (typeof pages)[number][0];
export function Settings({
  prefs,
  tone,
  onChange,
  onBack,
  onFloating,
  controller,
  initialPage = "general",
}: {
  prefs: Preferences;
  tone: Tone;
  onChange: (prefs: Preferences) => void;
  onBack: () => void;
  onFloating: () => void;
  controller: PreviewController;
  initialPage?: SettingsPage;
}) {
  const [page, setPage] = useState<SettingsPage>(initialPage);
  const update = (patch: Partial<Preferences>) =>
    onChange({ ...prefs, ...patch });
  const colors = themeColors(prefs, tone);
  return (
    <div className="settings-shell">
      <aside className="settings-sidebar">
        <div className="settings-brand">
          <Icon name="settings" size={17} />
          偏好设置
        </div>
        <nav aria-label="设置分类">
          {pages.map(([id, label, icon]) => (
            <button
              key={id}
              aria-label={label}
              title={label}
              aria-current={page === id ? "page" : undefined}
              className={page === id ? "active" : ""}
              onClick={() => setPage(id)}
            >
              <Icon name={icon} size={16} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <button className="settings-back" onClick={onBack}>
          <Icon name="back" size={16} />
          返回翻译
        </button>
      </aside>
      <section className="settings-main">
        <header className="settings-heading">
          <div>
            <span className="eyebrow">MAKE IT YOURS</span>
            <h1>{pages.find((p) => p[0] === page)?.[1]}</h1>
          </div>
          <IconButton icon="close" label="关闭设置" onClick={onBack} />
        </header>
        {page === "general" && (
          <>
            <div className="settings-section">
              <h2>界面风格</h2>
              <p>三种阅读方式，同一份文字。只在设置中切换。</p>
              <div className="style-picker">
                {(
                  [
                    ["poetry", "诗集式", "像翻开一本书"],
                    ["workbench", "工作台式", "原文译文，并肩而读"],
                    ["classic", "经典款", "熟悉的排列方式"],
                  ] as const
                ).map(([id, label, caption]) => (
                  <button
                    key={id}
                    aria-pressed={prefs.mainStyle === id}
                    className={`style-choice${prefs.mainStyle === id ? " selected" : ""}`}
                    onClick={() => update({ mainStyle: id })}
                  >
                    <span className={`style-miniature ${id}`}>
                      <i />
                      <i />
                      <i />
                      <i />
                    </span>
                    <span className="choice-title">
                      {label}
                      {prefs.mainStyle === id && (
                        <Icon name="check" size={15} />
                      )}
                    </span>
                    <small>{caption}</small>
                  </button>
                ))}
              </div>
            </div>
            <div className="settings-section">
              <h2>导航展开方式</h2>
              <p>
                三套界面共用。点击功能展开工作区，再次点击当前功能可收起；收起不停止任务。
              </p>
              <div className="theme-picker">
                <button
                  aria-pressed={prefs.navigation === "persistent"}
                  className={
                    prefs.navigation === "persistent" ? "selected" : ""
                  }
                  onClick={() => update({ navigation: "persistent" })}
                >
                  <Icon name="monitor" size={20} />
                  常驻导航
                </button>
                <button
                  aria-pressed={prefs.navigation === "hover"}
                  className={prefs.navigation === "hover" ? "selected" : ""}
                  onClick={() => update({ navigation: "hover" })}
                >
                  <BrandMark size={20} />
                  悬停展开
                </button>
              </div>
              <p className="setting-note">
                悬停模式在工作区收起时只留译刻图标，移入或聚焦可展开导航。工作区打开时导航始终展开，保留完整布局；收起工作区并移开鼠标后才缩回图标。触屏可点击图标展开。
              </p>
            </div>
            <div className="settings-section">
              <h2>主题与配色</h2>
              <p>三套主界面和悬浮窗共享配色，切换风格不会重置。</p>
              <div className="theme-picker">
                {(
                  [
                    ["light", "浅色", "sun"],
                    ["dark", "深色", "moon"],
                    ["system", "跟随系统", "monitor"],
                  ] as const
                ).map(([id, label, icon]) => (
                  <button
                    key={id}
                    className={prefs.theme === id ? "selected" : ""}
                    aria-pressed={prefs.theme === id}
                    onClick={() => update({ theme: id })}
                  >
                    <Icon name={icon} size={20} />
                    {label}
                  </button>
                ))}
              </div>
              <div className="settings-row">
                <label>强调色</label>
                <div className="swatches">
                  {(
                    [
                      ["clay", "#C8886D", "陶土"],
                      ["ocean", "#7A9299", "雾蓝"],
                      ["forest", "#70866C", "苔绿"],
                    ] as const
                  ).map(([id, color, label]) => (
                    <button
                      key={id}
                      aria-label={label}
                      title={label}
                      aria-pressed={prefs.accent === id}
                      className={prefs.accent === id ? "selected" : ""}
                      style={{ background: color }}
                      onClick={() => update({ accent: id })}
                    >
                      {prefs.accent === id && <Icon name="check" size={13} />}
                    </button>
                  ))}
                  <label className="custom-swatch" title="自定义强调色">
                    <input
                      type="color"
                      aria-label="自定义强调色"
                      value={prefs.customAccent}
                      onChange={(e) =>
                        update({
                          accent: "custom",
                          customAccent: e.target.value,
                        })
                      }
                    />
                    <span>自定义</span>
                  </label>
                </div>
              </div>
              <div className="settings-row">
                <label htmlFor="background-color">
                  {tone === "dark" ? "深色" : "浅色"}背景
                </label>
                <input
                  id="background-color"
                  type="color"
                  value={colors.background}
                  onChange={(e) =>
                    update({
                      background: {
                        ...prefs.background,
                        [tone]: e.target.value,
                      },
                    })
                  }
                />
                <label htmlFor="text-color">文字</label>
                <input
                  id="text-color"
                  type="color"
                  value={colors.foreground}
                  onChange={(e) =>
                    update({
                      foreground: {
                        ...prefs.foreground,
                        [tone]: e.target.value,
                      },
                    })
                  }
                />
                <button
                  className="quiet-button"
                  onClick={() =>
                    update({
                      background: { ...defaults.background },
                      foreground: { ...defaults.foreground },
                      accent: defaults.accent,
                    })
                  }
                >
                  恢复配色
                </button>
              </div>
              <div className="settings-row">
                <label htmlFor="font-size">阅读字号</label>
                <input
                  id="font-size"
                  type="range"
                  min="14"
                  max="22"
                  value={prefs.fontSize}
                  onChange={(e) => update({ fontSize: Number(e.target.value) })}
                />
                <span>{prefs.fontSize} px</span>
              </div>
            </div>
          </>
        )}
        {page === "floating" && (
          <div className="settings-section">
            <h2>经典悬浮窗</h2>
            <p>
              三套主界面统一使用经典悬浮窗，共享主题颜色。浏览器预览尚未创建系统窗口。
            </p>
            <button className="primary-button" onClick={onFloating}>
              <Icon name="windows" size={17} />
              试用经典悬浮窗
            </button>
            <div className="setting-note">
              截图、字幕、选区、透明度和关闭按钮保留在经典翻译窗内。音频使用独立窗口，双路文本分别显示；收起音频窗不停止任务，关闭会停止音频演示。
            </div>
          </div>
        )}
        {page === "demo" && (
          <div className="settings-section">
            <h2>检查每一种状态</h2>
            <p>全部为固定示例，无真实翻译、截图、音频或系统剪贴板访问。</p>
            <div className="settings-row">
              <label htmlFor="demo-mode">演示功能</label>
              <select
                id="demo-mode"
                value={controller.state.mode}
                onChange={(e) =>
                  controller.dispatch({
                    type: "mode",
                    mode: e.target.value as typeof controller.state.mode,
                  })
                }
              >
                {modes.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="scenario-picker">
              {(
                [
                  ["sample", "示例内容"],
                  ["empty", "空白状态"],
                  ["loading", "加载中"],
                  ["error", "连接失败"],
                  ["long", "长文本"],
                ] as const
              ).map(([id, label]) => (
                <button
                  className="quiet-button"
                  key={id}
                  onClick={() => {
                    controller.scenario(id);
                    onBack();
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="setting-note">
              文字编辑后 600 ms 生成固定演示结果；Ctrl+Enter
              可立即开始。复制与粘贴使用独立的 Demo 剪贴板。
            </div>
            <button
              className="quiet-button"
              onClick={() => {
                onChange({
                  ...defaults,
                  background: { ...defaults.background },
                  foreground: { ...defaults.foreground },
                });
                controller.scenario("sample");
              }}
            >
              恢复 Demo 外观
            </button>
          </div>
        )}
        {page === "about" && (
          <div className="settings-section">
            <h2>译刻 · 设计预览</h2>
            <p>诗集式、工作台式、经典款，以及可切换的悬浮窗样式。</p>
            <div className="setting-note">
              本预览独立于正式应用。只有外观偏好保存在当前浏览器，不读写便携版配置，不连接翻译服务。
            </div>
            <h2>原始设计参考</h2>
            <div className="reference-links">
              <a
                href="/demo-reference/poetry.html"
                target="_blank"
                rel="noreferrer"
              >
                诗集式 HTML
                <Icon name="expand" size={14} />
              </a>
              <a
                href="/demo-reference/workbench.html"
                target="_blank"
                rel="noreferrer"
              >
                工作台 HTML
                <Icon name="expand" size={14} />
              </a>
              <a
                href="/demo-reference/canvas.html"
                target="_blank"
                rel="noreferrer"
              >
                画布 HTML
                <Icon name="expand" size={14} />
              </a>
            </div>
            <p>原始 HTML 保留其原有行为；Demo 已修复页面与主题切换。</p>
          </div>
        )}
        {!["general", "floating", "demo", "about"].includes(page) && (
          <div className="settings-section deferred-settings">
            <Icon name={pages.find((p) => p[0] === page)![2]} size={32} />
            <h2>现有设置，保留接入位置</h2>
            <p>
              {page === "providers"
                ? "本地模型、API 供应商、识别组件的安装与管理"
                : page === "audio"
                  ? "识别语言、断句灵敏度、双音源与降噪"
                  : page === "subtitle"
                    ? "识别引擎、区域、频率与字幕外观"
                    : page === "shortcuts"
                      ? "全局快捷键录制、冲突检测与禁用"
                      : "翻译行为、语言独立配置与剪贴板选项"}
            </p>
            <div className="setting-note">
              此页未接入真实配置。完整功能保留在现有软件中，将在设计验收后逐项连接。
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

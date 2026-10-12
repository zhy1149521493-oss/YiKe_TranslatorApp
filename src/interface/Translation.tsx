import { useLayoutEffect, useRef, type ReactNode } from "react";
import { Icon, IconButton } from "./Icon";
import {
  languages,
  type Mode,
  type TaskState,
  type AudioChannel,
} from "./model";
import type { InterfaceController } from "./controller";

export function LanguageSelect({
  side,
  controller,
  audioChannel,
}: {
  side: "src" | "tgt";
  controller: InterfaceController;
  audioChannel?: AudioChannel;
}) {
  return (
    <select
      className="language-select"
      aria-label={`${audioChannel ? (audioChannel === "system" ? "电脑音频" : "麦克风") : ""}${side === "src" ? "源语言" : "目标语言"}`}
      disabled={!!audioChannel && side === "src" && (controller.state.audioChannels[audioChannel].running || controller.audioControlsBusy)}
      title={audioChannel && side === "src" && controller.state.audioChannels[audioChannel].running ? "停止此路监听后可调整识别语言" : undefined}
      value={
        audioChannel
          ? controller.state.audioChannels[audioChannel][side]
          : controller.state[side]
      }
      onChange={(e) =>
        controller.dispatch(
          audioChannel
            ? {
                type: "audio-language",
                channel: audioChannel,
                side,
                value: e.target.value,
              }
            : { type: "language", side, value: e.target.value },
        )
      }
    >
      {languages
        .filter((l) => side === "src" || l[0] !== "auto")
        .map(([code, name]) => (
          <option value={code} key={code}>
            {name}
          </option>
        ))}
    </select>
  );
}
export function EnginePicker({
  controller,
}: {
  controller: InterfaceController;
}) {
  return (
    <select
      className="engine-select"
      aria-label="翻译模型"
      value={controller.state.model}
      onChange={(e) =>
        controller.dispatch({ type: "model", model: e.target.value })
      }
    >
      {controller.models.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  );
}
export function SectionHeading({
  children,
  side,
  controller,
  audioChannel,
}: {
  children: ReactNode;
  side?: "src" | "tgt";
  controller?: InterfaceController;
  audioChannel?: AudioChannel;
}) {
  return (
    <div className="section-heading">
      <span>{children}</span>
      {side && controller && (
        <LanguageSelect
          side={side}
          controller={controller}
          audioChannel={audioChannel}
        />
      )}
      <span className="heading-line" />
    </div>
  );
}
export function Ornament() {
  return (
    <div className="ornament">
      <span />
      <Icon name="ornament" size={13} />
      <span />
    </div>
  );
}
export function TextEditor({
  controller,
  flowing = false,
}: {
  controller: InterfaceController;
  flowing?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const source = controller.state.tasks.text.source;
  useLayoutEffect(() => {
    const editor = ref.current;
    if (!editor || !flowing) return;
    let active = true;
    const fit = () => {
      if (!active) return;
      // Let the document grow with real text, rather than a large empty minimum.
      editor.style.height = "0px";
      editor.style.height = `${editor.scrollHeight}px`;
    };
    let width = editor.parentElement?.clientWidth;
    const observer = new ResizeObserver(() => {
      const nextWidth = editor.parentElement?.clientWidth;
      if (nextWidth !== width) { width = nextWidth; fit(); }
    });
    if (editor.parentElement) observer.observe(editor.parentElement);
    fit();
    window.addEventListener("resize", fit);
    void document.fonts.ready.then(fit);
    return () => {
      active = false;
      observer.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, [source, flowing]);
  return (
    <textarea
      ref={ref}
      className="source-editor"
      dir="auto"
      aria-label="待翻译原文"
      value={source}
      placeholder="在此输入或粘贴文本…"
      onChange={(e) => controller.edit(e.target.value)}
      onCompositionStart={() => controller.setComposing(true)}
      onCompositionEnd={() => controller.setComposing(false)}
      onKeyDown={(e) => {
        if (
          e.ctrlKey &&
          e.key === "Enter" &&
          !e.nativeEvent.isComposing &&
          !controller.composing &&
          source.trim()
        ) {
          e.preventDefault();
          controller.run("text", source);
        }
      }}
    />
  );
}
export function ResultBody({ task }: { task: TaskState }) {
  if (task.phase === "error")
    return (
      <div className="result-message error-message">
        <Icon name="warn" size={23} />
        <strong>暂时没有连接成功</strong>
        <p>{task.error || task.status || task.result || "请求失败，请检查模型、网络或识别组件。"}</p>
      </div>
    );
  if (task.phase === "loading" && !task.result)
    return (
      <div className="result-message" role="status">
        <span className="loading-dots">
          <i />
          <i />
          <i />
        </span>
        <p>{task.status || "正在翻译…"}</p>
        <small>译文会随处理进度更新</small>
      </div>
    );
  if (!task.result)
    return (
      <div className="result-message">
        <Icon name="book" size={28} />
        <p>译文会在这里，慢慢展开。</p>
        <small>输入文字，或开始识别</small>
      </div>
    );
  return (
    <div className="translation-text" dir="auto">
      {task.result}
    </div>
  );
}
export function SourceActions({
  controller,
}: {
  controller: InterfaceController;
}) {
  const task = controller.state.tasks.text;
  return (
    <div className="block-footer">
      <span>{Array.from(task.source).length.toLocaleString()} 字符</span>
      <div className="inline-actions">
        <IconButton
          icon="paste"
          label="粘贴剪贴板文本"
          onClick={controller.paste}
        />
        <IconButton
          icon="swap"
          label="交换语言方向"
          disabled={controller.state.src === "auto"}
          onClick={() => controller.dispatch({ type: "swap" })}
        />
        <button
          className="quiet-button"
          disabled={!task.source}
          onClick={() => controller.edit("")}
        >
          <Icon name="trash" size={14} />
          清空
        </button>
        <IconButton
          icon={task.phase === "loading" ? "stop" : "refresh"}
          label={task.phase === "loading" ? "取消翻译" : "重新翻译"}
          disabled={!task.source.trim()}
          onClick={() =>
            task.phase === "loading"
              ? controller.stop("text")
              : controller.run("text", task.source)
          }
        />
      </div>
    </div>
  );
}
export function ResultActions({
  controller,
  mode,
}: {
  controller: InterfaceController;
  mode: Mode;
}) {
  const task = controller.state.tasks[mode];
  return (
    <div className="block-footer">
      <EnginePicker controller={controller} />
      <button
        className="quiet-button"
        disabled={!task.result}
        onClick={() => controller.copy(task.result)}
      >
        <Icon name="copy" size={14} />
        复制
      </button>
    </div>
  );
}
export function TextFlow({ controller }: { controller: InterfaceController }) {
  return (
    <div className="document-flow">
      <section className="text-block">
        <SectionHeading side="src" controller={controller}>
          Source Text
        </SectionHeading>
        <div className="text-content">
          <TextEditor controller={controller} flowing />
        </div>
        <SourceActions controller={controller} />
      </section>
      <Ornament />
      <section className="text-block">
        <SectionHeading side="tgt" controller={controller}>
          Translation
        </SectionHeading>
        <div className="text-content" role="region" aria-label="译文内容" tabIndex={0}>
          <ResultBody task={controller.state.tasks.text} />
        </div>
        <ResultActions controller={controller} mode="text" />
      </section>
    </div>
  );
}

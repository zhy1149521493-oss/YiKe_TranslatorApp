import { Icon } from "./Icon";
import { modes, selectedAudioChannels, audioLabels, type Mode } from "./model";
import { AudioRecognized, AudioTranslations } from "./AudioTranscript";
import type { PreviewController } from "./usePreview";
import {
  Ornament,
  ResultActions,
  ResultBody,
  SectionHeading,
} from "./Translation";

export function FeatureControls({
  mode,
  controller,
  onCapture,
}: {
  mode: Exclude<Mode, "text">;
  controller: PreviewController;
  onCapture: (mode: "screenshot" | "subtitle") => void;
}) {
  const task = controller.state.tasks[mode];
  const isRunning = task.running || task.phase === "loading";
  const unsupported = selectedAudioChannels(
    controller.state.audioSource,
  ).filter(
    (channel) =>
      !["auto", "zh", "en", "ja", "ko"].includes(
        controller.state.audioChannels[channel].src,
      ),
  );
  const supportedAudio = unsupported.length === 0;
  return (
    <>
      {mode === "audio" && (
        <div className="audio-sources" role="group" aria-label="音频来源">
          {(
            [
              ["system", "电脑音频", "monitor"],
              ["mic", "麦克风", "mic"],
              ["both", "同时监听", "volume"],
            ] as const
          ).map(([value, label, icon]) => (
            <button
              key={value}
              aria-pressed={controller.state.audioSource === value}
              onClick={() => controller.selectAudioSource(value)}
            >
              <Icon name={icon} size={17} />
              {label}
            </button>
          ))}
        </div>
      )}
      <div className="feature-controls">
        {mode === "screenshot" ? (
          <button
            className="primary-button"
            onClick={() => onCapture("screenshot")}
          >
            <Icon name="camera" />
            框选演示画面
          </button>
        ) : (
          <>
            {mode === "subtitle" && (
              <button
                className="quiet-button"
                onClick={() => onCapture("subtitle")}
              >
                <Icon name="target" />
                {task.region ? "调整示例区域" : "选择示例区域"}
              </button>
            )}
            <button
              className={isRunning ? "quiet-button" : "primary-button"}
              disabled={
                !isRunning &&
                ((mode === "subtitle" && !task.region) ||
                  (mode === "audio" && !supportedAudio))
              }
              onClick={() =>
                isRunning ? controller.stop(mode) : controller.run(mode)
              }
            >
              <Icon name={isRunning ? "stop" : "play"} size={16} />
              {isRunning
                ? "停止演示"
                : mode === "audio"
                  ? "开始监听演示"
                  : "开始字幕演示"}
            </button>
          </>
        )}
        {mode === "subtitle" && (
          <label className="fps-field">
            识别频率
            <select aria-label="演示字幕识别频率" defaultValue="5">
              <option value="2">2 FPS</option>
              <option value="5">5 FPS</option>
              <option value="10">10 FPS</option>
            </select>
          </label>
        )}
      </div>
      {mode === "audio" && !supportedAudio && (
        <p className="mode-warning">
          {unsupported.map((channel) => audioLabels[channel]).join("、")}
          的识别语言不受支持。请选择自动检测、中文、英语、日语或韩语。
        </p>
      )}
    </>
  );
}
export function FeatureStage({
  mode,
  controller,
}: {
  mode: Exclude<Mode, "text">;
  controller: PreviewController;
}) {
  const task = controller.state.tasks[mode];
  if (mode === "audio")
    return (
      <div className="audio-stage">
        <div
          className={`level-meter${task.running ? " listening" : ""}`}
          aria-label={task.running ? "模拟音量，未采集设备" : "未监听"}
        >
          {Array.from({ length: 37 }, (_, i) => (
            <i
              key={i}
              style={{
                height: `${8 + ((i * 17 + 13) % 50)}px`,
                animationDelay: `${i * 35}ms`,
              }}
            />
          ))}
        </div>
        <p>{task.running ? "监听中 · 模拟音量" : "让声音，在这里变成文字。"}</p>
        <small>Demo 不访问麦克风或电脑音频</small>
      </div>
    );
  const hasCapture = mode === "screenshot" ? !!task.source : task.region;
  return (
    <div className={`capture-stage${hasCapture ? " has-capture" : ""}`}>
      {hasCapture ? (
        <div className="sample-frame">
          <span>示例画面 · 非真实截图</span>
          <blockquote>
            The best way to predict the future
            <br />
            is to invent it.
          </blockquote>
          <div className="selection-corners" />
        </div>
      ) : (
        <>
          <Icon name={mode === "screenshot" ? "camera" : "target"} size={42} />
          <p>
            {mode === "screenshot"
              ? "框选之后，把文字留在纸上。"
              : "先选择视频字幕所在的区域。"}
          </p>
          <small>选择示例区域，体验识别与翻译流程</small>
        </>
      )}
    </div>
  );
}
function RecognizedText({
  mode,
  controller,
}: {
  mode: Exclude<Mode, "text">;
  controller: PreviewController;
}) {
  const task = controller.state.tasks[mode];
  return (
    <>
      <SectionHeading side="src" controller={controller}>
        {mode === "audio" ? "听见的原文" : "识别文本"}
      </SectionHeading>
      <div className="recognized-source" dir="auto">
        {task.source ||
          (task.phase === "loading"
            ? "正在识别示例内容…"
            : "识别到的原文会显示在这里。")}
      </div>
    </>
  );
}

export function FeatureView({
  mode,
  controller,
  onCapture,
  card = false,
}: {
  mode: Exclude<Mode, "text">;
  controller: PreviewController;
  onCapture: (mode: "screenshot" | "subtitle") => void;
  card?: boolean;
}) {
  const meta = modes.find((m) => m.id === mode)!;
  const task = controller.state.tasks[mode];
  const sourceOnLeft = card;
  const controlCard = (
    <section
      className={
        card ? "glass-card feature-control-card" : "feature-control-card"
      }
    >
      <div className="feature-intro">
        <span className="feature-emblem">
          <Icon name={meta.icon} size={25} />
        </span>
        <div>
          <h2>{meta.label}</h2>
          <p>{meta.hint}</p>
        </div>
      </div>
      <FeatureStage mode={mode} controller={controller} />
      <FeatureControls
        mode={mode}
        controller={controller}
        onCapture={onCapture}
      />
    </section>
  );
  return (
    <div
      className={`feature-document${card ? " feature-card-layout feature-recognition-layout" : ""}`}
    >
      {sourceOnLeft ? (
        <div className="feature-left-column">
          {controlCard}
          {mode === "audio" ? (
            <AudioRecognized controller={controller} card />
          ) : (
            <section
              className="glass-card feature-recognized-source"
              aria-label="识别文本"
            >
              <RecognizedText mode={mode} controller={controller} />
            </section>
          )}
        </div>
      ) : (
        controlCard
      )}
      {!card && <Ornament />}
      {mode === "audio" ? (
        <>
          {!sourceOnLeft && <AudioRecognized controller={controller} />}
          <AudioTranslations controller={controller} card={card} />
        </>
      ) : (
        <section
          className={card ? "glass-card feature-results" : "feature-results"}
        >
          {!sourceOnLeft && (
            <RecognizedText mode={mode} controller={controller} />
          )}
          <SectionHeading side="tgt" controller={controller}>
            Translation
          </SectionHeading>
          <ResultBody task={task} />
          <ResultActions controller={controller} mode={mode} />
        </section>
      )}
    </div>
  );
}
export function CaptureDialog({
  mode,
  onClose,
  onConfirm,
}: {
  mode: "screenshot" | "subtitle";
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="modal-shade"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className="capture-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="capture-title"
      >
        <header>
          <h2 id="capture-title">
            {mode === "screenshot" ? "截图流程演示" : "字幕区域演示"}
          </h2>
          <button className="quiet-button" onClick={onClose}>
            取消
          </button>
        </header>
        <p>以下是固定示例画面，不会截取你的屏幕。</p>
        <div className="sample-frame capture-dialog-frame">
          <span>示例选区</span>
          <blockquote>
            The best way to predict the future
            <br />
            is to invent it.
          </blockquote>
          <div className="selection-corners" />
        </div>
        <footer>
          <span>实际框选将在验收后接入</span>
          <button className="primary-button" onClick={onConfirm}>
            <Icon name="check" size={16} />
            使用示例选区
          </button>
        </footer>
      </section>
    </div>
  );
}

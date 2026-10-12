import { Icon } from "./Icon";
import { modes, selectedAudioChannels, audioLabels, type Mode } from "./model";
import { AudioRecognized, AudioTranslations } from "./AudioTranscript";
import type { InterfaceController } from "./controller";
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
  controller: InterfaceController;
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
              disabled={controller.audioControlsBusy}
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
            截图翻译
          </button>
        ) : (
          <>
            {mode === "subtitle" && (
              <button
                className="quiet-button"
                onClick={() => onCapture("subtitle")}
              >
                <Icon name="target" />
                {task.region ? "调整字幕区域" : "选择字幕区域"}
              </button>
            )}
            <button
              className={isRunning ? "quiet-button" : "primary-button"}
              disabled={
                mode === "audio" && (controller.audioControlsBusy || (!isRunning && !supportedAudio))
              }
              onClick={() =>
                isRunning ? controller.stop(mode) : controller.run(mode)
              }
            >
              <Icon name={isRunning ? "stop" : "play"} size={16} />
              {mode === "audio" && controller.audioControlsBusy ? "正在切换监听…" : isRunning
                ? "停止识别"
                : mode === "audio"
                  ? "开始音频翻译"
                  : "开始视频字幕"}
            </button>
          </>
        )}
        {mode === "subtitle" && (
          <label className="fps-field">
            识别频率
            <select aria-label="字幕识别频率" value={controller.subtitleFps} onChange={e => controller.setSubtitleFps(Number(e.target.value))}>
              <option value="2">2 FPS</option>
              <option value="5">5 FPS</option>
              <option value="1">1 FPS</option>
              <option value="3">3 FPS</option>
              <option value="4">4 FPS</option>
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
  controller: InterfaceController;
}) {
  const task = controller.state.tasks[mode];
  if (mode === "audio") return <div className="audio-stage live-audio-stage">
    {selectedAudioChannels(controller.state.audioSource).map(channel => {
      const audio = controller.state.audioChannels[channel];
      return <div className="live-level" key={channel}>
        <span><Icon name={channel === "system" ? "monitor" : "mic"} />{audioLabels[channel]}</span>
        <meter aria-label={`${audioLabels[channel]}实时音量`} min={-100} max={0} value={Math.max(-100, Math.min(0, audio.level))} />
        <small>{audio.running ? audio.status || "正在监听" : audio.status || "未监听"}</small>
      </div>;
    })}
  </div>;
  return <div className="capture-summary">
    <small role="status">{task.phase !== "error" && task.status === task.source && task.source ? "识别完成" : task.status || (mode === "subtitle" ? task.region ? "字幕区域已就绪" : "未选区域时使用默认字幕区域" : "框选后识别并翻译；Esc 或右键取消选区")}</small>
    {mode === "subtitle" && <button className="quiet-button" onClick={controller.testOcr}><Icon name="flask" size={14} />系统 OCR 测试</button>}
  </div>;
}

function RecognizedText({
  mode,
  controller,
}: {
  mode: Exclude<Mode, "text">;
  controller: InterfaceController;
}) {
  const task = controller.state.tasks[mode];
  return (
    <div className="recognized-text-block">
      <SectionHeading side="src" controller={controller}>
        {mode === "audio" ? "听见的原文" : "识别文本"}
      </SectionHeading>
      <div className="recognized-source" dir="auto" role="region" aria-label="识别原文内容" tabIndex={0}>
        {task.source ||
          (task.phase === "loading"
            ? "正在识别文字…"
            : "识别到的原文会显示在这里。")}
      </div>
    </div>
  );
}

export function FeatureView({
  mode,
  controller,
  onCapture,
  card = false,
  book = false,
}: {
  mode: Exclude<Mode, "text">;
  controller: InterfaceController;
  onCapture: (mode: "screenshot" | "subtitle") => void;
  card?: boolean;
  book?: boolean;
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
      data-feature={mode}
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
      {!card && mode === "audio" && <Ornament />}
      {mode === "audio" ? (
        !book ? <>{!sourceOnLeft && <AudioRecognized controller={controller} />}<AudioTranslations controller={controller} card={card} /></> :
          <div className="audio-passages" data-channels={selectedAudioChannels(controller.state.audioSource).length}>
            {selectedAudioChannels(controller.state.audioSource).map(channel =>
              <section className="audio-passage" key={channel} aria-label={`${audioLabels[channel]}原文与译文`}>
                <AudioRecognized controller={controller} channel={channel} />
                <AudioTranslations controller={controller} channel={channel} />
              </section>)}
          </div>
      ) : (
        <section
          className={card ? "glass-card feature-results" : "feature-results"}
        >
          {!sourceOnLeft && (
            <RecognizedText mode={mode} controller={controller} />
          )}
          <div className="feature-translation-block">
            <SectionHeading side="tgt" controller={controller}>
              Translation
            </SectionHeading>
            <div className="feature-result-content" role="region" aria-label="译文内容" tabIndex={0}>
              <ResultBody task={task} />
            </div>
            <ResultActions controller={controller} mode={mode} />
          </div>
        </section>
      )}
    </div>
  );
}

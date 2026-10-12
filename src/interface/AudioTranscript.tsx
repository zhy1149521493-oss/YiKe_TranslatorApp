import { Icon } from "./Icon";
import { audioLabels, selectedAudioChannels, type AudioChannel } from "./model";
import type { InterfaceController } from "./controller";
import { EnginePicker, ResultBody, SectionHeading } from "./Translation";

function AudioBadge({ channel }: { channel: AudioChannel }) {
  return (
    <span className="audio-channel-badge">
      <Icon name={channel === "system" ? "monitor" : "mic"} size={15} />
      {audioLabels[channel]}
    </span>
  );
}

export function AudioRecognized({
  controller,
  card = false,
}: {
  controller: InterfaceController;
  card?: boolean;
}) {
  const channels = selectedAudioChannels(controller.state.audioSource);
  return (
    <div
      className={`audio-source-cards${card ? " feature-source-cards" : ""}`}
      data-channels={channels.length}
    >
      {channels.map((channel) => {
        const task = controller.state.audioChannels[channel];
        return (
          <section
            key={channel}
            className={
              card
                ? "glass-card feature-recognized-source"
                : "audio-source-block"
            }
            aria-label={`${audioLabels[channel]}识别原文`}
            data-audio-source={channel}
          >
            <SectionHeading
              side="src"
              controller={controller}
              audioChannel={channel}
            >
              <AudioBadge channel={channel} />
            </SectionHeading>
            <div className="recognized-source" dir="auto">
              {task.source ||
                (task.phase === "loading"
                  ? "正在识别此路音频…"
                  : "此路识别原文会显示在这里。")}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export function AudioTranslations({
  controller,
  card = false,
}: {
  controller: InterfaceController;
  card?: boolean;
}) {
  const channels = selectedAudioChannels(controller.state.audioSource);
  return (
    <div className="audio-results-stack" data-channels={channels.length}>
      {channels.map((channel) => {
        const task = controller.state.audioChannels[channel];
        return (
          <section
            key={channel}
            className={
              card
                ? "glass-card feature-results audio-channel-result"
                : "audio-channel-result"
            }
            aria-label={`${audioLabels[channel]}译文`}
            data-audio-result={channel}
          >
            <SectionHeading
              side="tgt"
              controller={controller}
              audioChannel={channel}
            >
              <AudioBadge channel={channel} />
            </SectionHeading>
            <ResultBody task={task} />
            <div className="block-footer">
              <EnginePicker controller={controller} />
              <button
                className="quiet-button"
                aria-label={`复制${audioLabels[channel]}译文`}
                disabled={!task.result}
                onClick={() => controller.copy(task.result)}
              >
                <Icon name="copy" size={14} />
                复制
              </button>
            </div>
          </section>
        );
      })}
    </div>
  );
}

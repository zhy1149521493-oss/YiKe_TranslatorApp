export type MainStyle = "poetry" | "workbench" | "classic";
export type Mode = "text" | "screenshot" | "subtitle" | "audio";
export type Tone = "light" | "dark";
export type Phase = "idle" | "loading" | "success" | "error";
export type AudioSource = "system" | "mic" | "both";
export type AudioChannel = "system" | "mic";
export const audioLabels = { system: "电脑音频", mic: "麦克风" } as const;
export const selectedAudioChannels = (source: AudioSource): readonly AudioChannel[] => source === "both" ? ["system", "mic"] : [source];
export type Preferences = { navigation: "persistent" | "hover" };
export type TaskState = { source: string; result: string; phase: Phase; running: boolean; region: boolean; status?: string; error?: string };
export const modes = [
  {
    id: "text",
    label: "文本翻译",
    short: "文本",
    icon: "pen",
    hint: "输入文字，静静等待理解发生。",
  },
  {
    id: "screenshot",
    label: "截图翻译",
    short: "截图",
    icon: "camera",
    hint: "框选一处，把画面里的文字带到这里。",
  },
  {
    id: "subtitle",
    label: "视频字幕",
    short: "字幕",
    icon: "film",
    hint: "让屏幕上的对白，成为读得懂的文字。",
  },
  {
    id: "audio",
    label: "音频翻译",
    short: "音频",
    icon: "mic",
    hint: "听见声音，也听懂声音。",
  },
] as const;
export const languages = [
  ["auto", "自动检测"],
  ["zh", "中文"],
  ["en", "English"],
  ["ja", "日本語"],
  ["ko", "한국어"],
  ["fr", "Français"],
  ["de", "Deutsch"],
  ["es", "Español"],
  ["ru", "Русский"],
  ["ar", "العربية"],
  ["pt", "Português"],
  ["it", "Italiano"],
  ["th", "ไทย"],
  ["vi", "Tiếng Việt"],
  ["sv", "Svenska"],
  ["hi", "हिन्दी"],
  ["tr", "Türkçe"],
  ["nl", "Nederlands"],
  ["pl", "Polski"],
] as const;

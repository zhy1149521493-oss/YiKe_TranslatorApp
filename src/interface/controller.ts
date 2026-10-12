import type { ReactNode } from "react";
import type { AudioChannel, AudioSource, Mode, TaskState } from "./model";

export type LanguagePair = { src: string; tgt: string };
export type InterfaceAction =
  | { type: "language"; side: "src" | "tgt"; value: string }
  | { type: "audio-language"; channel: AudioChannel; side: "src" | "tgt"; value: string }
  | { type: "model"; model: string }
  | { type: "swap" };

/** Read-only presentation state and explicit commands; never starts fixture jobs. */
export type InterfaceController = {
  state: {
    mode: Mode; src: string; tgt: string; model: string; audioSource: AudioSource;
    tasks: Record<Mode, TaskState>;
    audioChannels: Record<AudioChannel, TaskState & LanguagePair & { level: number }>;
  };
  audioControlsBusy: boolean;
  models: { value: string; label: string }[];
  dispatch: (action: InterfaceAction) => void;
  edit: (text: string) => void;
  run: (mode: Mode, source?: string) => void;
  stop: (mode: Mode) => void;
  copy: (text: string) => void;
  paste: () => void;
  composing: boolean;
  setComposing: (value: boolean) => void;
  selectAudioSource: (source: AudioSource) => void;
  subtitleFps: number;
  setSubtitleFps: (value: number) => void;
  testOcr: () => void;
  extra?: ReactNode;
};

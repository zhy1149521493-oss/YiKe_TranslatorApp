import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  createPreviewState,
  previewReducer,
  sampleResult,
  sampleSource,
  audioChannels,
  audioFixtures,
  selectedAudioChannels,
  type AudioChannel,
  type AudioSource,
  type Mode,
  type Scenario,
} from "./model";

/** Deterministic preview adapter. No fetch, Tauri IPC, device or clipboard access. */
export function usePreview() {
  const [state, dispatch] = useReducer(
    previewReducer,
    undefined,
    createPreviewState,
  );
  const [notice, setNotice] = useState("");
  const [composing, setComposing] = useState(false);
  const timers = useRef<Partial<Record<Mode, ReturnType<typeof setTimeout>>>>(
    {},
  );
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const previousText = useRef(sampleSource);
  const clipboard = useRef(sampleSource);
  const audioChoice = useRef(state.audioSource);
  audioChoice.current = state.audioSource;
  const audioTimers = useRef<
    Partial<Record<AudioChannel, ReturnType<typeof setTimeout>>>
  >({});
  const invalidate = useCallback((mode: Mode) => {
    if (mode === "audio") {
      Object.values(audioTimers.current).forEach(clearTimeout);
      audioTimers.current = {};
    }
    clearTimeout(timers.current[mode]);
    delete timers.current[mode];
  }, []);
  const startAudio = useCallback(
    (source: AudioSource, preserve = false) => {
      invalidate("audio");
      dispatch({ type: "audio-start", source, preserve });
      for (const channel of selectedAudioChannels(source)) {
        audioTimers.current[channel] = setTimeout(
          () => {
            dispatch({
              type: "audio-task",
              channel,
              patch: { ...audioFixtures[channel], phase: "success" },
            });
            delete audioTimers.current[channel];
          },
          channel === "system" ? 900 : 1300,
        );
      }
    },
    [invalidate],
  );
  const run = useCallback(
    (mode: Mode, source?: string) => {
      if (mode === "audio") {
        startAudio(audioChoice.current);
        return;
      }
      if (mode === "text") clearTimeout(debounce.current);
      invalidate(mode);
      dispatch({
        type: "task",
        mode,
        patch: {
          phase: "loading",
          result: "",
          running: mode === "subtitle",
        },
      });
      timers.current[mode] = setTimeout(() => {
        const fixtureSource =
          mode === "text"
            ? (source ?? "")
            : "The best way to predict the future is to invent it.";
        const result =
          mode === "text"
            ? fixtureSource === sampleSource
              ? sampleResult
              : "这是一段固定演示译文，用于检查排版与交互。\n\n真实翻译将在 Demo 验收后接入；现在输入的文字不会发送到模型或外部服务。"
            : "预测未来的最好方法就是创造它。";
        dispatch({
          type: "task",
          mode,
          patch: { source: fixtureSource, result, phase: "success" },
        });
        delete timers.current[mode];
      }, 900);
    },
    [invalidate, startAudio],
  );
  const edit = (text: string) => {
    invalidate("text");
    dispatch({ type: "edit", text });
  };
  useEffect(() => {
    if (composing || previousText.current === state.tasks.text.source) return;
    previousText.current = state.tasks.text.source;
    if (!state.tasks.text.source.trim()) return;
    debounce.current = setTimeout(
      () => run("text", state.tasks.text.source),
      600,
    );
    return () => clearTimeout(debounce.current);
  }, [state.tasks.text.source, composing, run]);
  useEffect(
    () => () => {
      clearTimeout(debounce.current);
      Object.values(timers.current).forEach(clearTimeout);
      for (const channel of audioChannels)
        clearTimeout(audioTimers.current[channel]);
    },
    [],
  );
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 3600);
    return () => clearTimeout(timer);
  }, [notice]);
  const stop = (mode: Mode) => {
    if (mode === "text") clearTimeout(debounce.current);
    invalidate(mode);
    if (mode === "audio") {
      dispatch({ type: "audio-stop" });
      return;
    }
    dispatch({ type: "task", mode, patch: { running: false, phase: "idle" } });
  };
  const scenario = (value: Scenario) => {
    clearTimeout(debounce.current);
    invalidate(state.mode);
    // Fixture selection must not trigger the input debounce or a paid/native request.
    previousText.current =
      value === "empty"
        ? ""
        : value === "long"
          ? Array(12).fill(sampleSource).join("\n\n")
          : sampleSource;
    dispatch({ type: "scenario", scenario: value });
  };
  return {
    state,
    dispatch,
    notice,
    setNotice,
    edit,
    run,
    selectAudioSource: (source: AudioSource) => {
      audioChoice.current = source;
      if (state.tasks.audio.running) startAudio(source, true);
      else dispatch({ type: "audio", source });
    },
    stop,
    scenario,
    composing,
    setComposing,
    copy: (text: string) => {
      clipboard.current = text;
      setNotice("已复制到 Demo 剪贴板；未修改系统剪贴板");
    },
    paste: () => edit(clipboard.current),
  };
}
export type PreviewController = ReturnType<typeof usePreview>;

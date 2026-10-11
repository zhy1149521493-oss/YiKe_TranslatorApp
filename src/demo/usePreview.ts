import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  createPreviewState,
  previewReducer,
  sampleResult,
  sampleSource,
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
  const invalidate = useCallback((mode: Mode) => {
    clearTimeout(timers.current[mode]);
    delete timers.current[mode];
  }, []);
  const run = useCallback(
    (mode: Mode, source?: string) => {
      if (mode === "text") clearTimeout(debounce.current);
      invalidate(mode);
      dispatch({
        type: "task",
        mode,
        patch: {
          phase: "loading",
          result: "",
          running: mode === "audio" || mode === "subtitle",
        },
      });
      timers.current[mode] = setTimeout(() => {
        const fixtureSource =
          mode === "text"
            ? (source ?? "")
            : mode === "audio"
              ? "Good design makes everyday things feel effortless."
              : "The best way to predict the future is to invent it.";
        const result =
          mode === "text"
            ? fixtureSource === sampleSource
              ? sampleResult
              : "这是一段固定演示译文，用于检查排版与交互。\n\n真实翻译将在 Demo 验收后接入；现在输入的文字不会发送到模型或外部服务。"
            : mode === "audio"
              ? "好的设计，让日常之事变得轻松自然。"
              : "预测未来的最好方法就是创造它。";
        dispatch({
          type: "task",
          mode,
          patch: { source: fixtureSource, result, phase: "success" },
        });
        delete timers.current[mode];
      }, 900);
    },
    [invalidate],
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

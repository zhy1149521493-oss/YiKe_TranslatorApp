const { test } = require("node:test");
const assert = require("node:assert/strict");
const load = require("./load-ts.cjs");
const {
  defaults,
  normalizePreferences,
  themeColors,
  previewReducer,
  createPreviewState,
  sampleSource,
  clampPanel,
} = load("demo/model");

test("preview preferences reject corrupt persisted fields and keep the real config separate", () => {
  for (const corrupt of [null, false, 42, "classic", []])
    assert.deepEqual(normalizePreferences(corrupt), defaults);
  const prefs = normalizePreferences({
    mainStyle: "unknown",
    floatingStyle: "unknown",
    theme: "system",
    accent: "custom",
    customAccent: "red",
    fontSize: NaN,
    background: { light: "#112233", dark: "url(fake)" },
  });
  assert.equal(prefs.mainStyle, "poetry");
  assert.equal(prefs.theme, "system");
  assert.equal(prefs.customAccent, defaults.customAccent);
  assert.equal(prefs.fontSize, 16);
  assert.deepEqual(prefs.background, { light: "#112233", dark: null });
});

test("all three layouts and both floating styles share custom theme colors", () => {
  const custom = {
    ...defaults,
    accent: "custom",
    customAccent: "#123456",
    background: { light: "#ABCDE0", dark: "#102030" },
    foreground: { light: "#203040", dark: "#F0E0D0" },
  };
  for (const tone of ["light", "dark"]) {
    const expected = themeColors(custom, tone);
    for (const mainStyle of ["poetry", "workbench", "classic"])
      for (const floatingStyle of ["classic", "capsule"]) {
        assert.deepEqual(
          themeColors({ ...custom, mainStyle, floatingStyle }, tone),
          expected,
        );
      }
  }
  assert.equal(
    themeColors({ ...custom, customAccent: "#FFFFFF" }, "light").actionInk,
    "#1A1816",
  );
  assert.equal(
    themeColors({ ...custom, customAccent: "#000000" }, "dark").actionInk,
    "#FFFFFF",
  );
});

test("mode changes preserve text, in-flight audio and the simultaneous source choice", () => {
  let state = createPreviewState();
  state = previewReducer(state, { type: "edit", text: "keep my text" });
  state = previewReducer(state, { type: "audio", source: "both" });
  state = previewReducer(state, {
    type: "task",
    mode: "audio",
    patch: { running: true, phase: "loading" },
  });
  const tasks = state.tasks;
  state = previewReducer(state, { type: "mode", mode: "subtitle" });
  assert.equal(state.tasks, tasks);
  assert.equal(state.tasks.text.source, "keep my text");
  assert.equal(state.tasks.audio.running, true);
  assert.equal(state.audioSource, "both");
});

test("fixture state affects only the chosen mode and does not fabricate a result while loading", () => {
  const initial = createPreviewState();
  const selected = previewReducer(initial, {
    type: "mode",
    mode: "screenshot",
  });
  const loading = previewReducer(selected, {
    type: "scenario",
    scenario: "loading",
  });
  assert.equal(loading.tasks.text, initial.tasks.text);
  assert.equal(loading.tasks.text.source, sampleSource);
  assert.equal(loading.tasks.screenshot.phase, "loading");
  assert.equal(loading.tasks.screenshot.result, "");
  const empty = previewReducer(loading, {
    type: "scenario",
    scenario: "empty",
  });
  assert.equal(empty.tasks.screenshot.source, "");
  assert.equal(empty.tasks.screenshot.running, false);
});

test("panel bounds include resizing the viewport and very large resize requests", () => {
  assert.deepEqual(
    clampPanel(-100, -10, 480, 290, { width: 720, height: 480 }),
    { x: 8, y: 8 },
  );
  assert.deepEqual(
    clampPanel(1000, 1000, 480, 290, { width: 720, height: 480 }),
    { x: 232, y: 182 },
  );
  const large = clampPanel(400, 400, 704, 900, { width: 720, height: 480 });
  assert.deepEqual(large, { x: 8, y: 8 });
});

test("stopping one audio preview preserves the other task data", () => {
  let state = createPreviewState();
  state = previewReducer(state, {
    type: "task",
    mode: "audio",
    patch: { running: true, result: "final text", phase: "success" },
  });
  const text = state.tasks.text;
  state = previewReducer(state, {
    type: "task",
    mode: "audio",
    patch: { running: false, phase: "idle" },
  });
  assert.equal(state.tasks.audio.result, "final text");
  assert.equal(state.tasks.text, text);
});

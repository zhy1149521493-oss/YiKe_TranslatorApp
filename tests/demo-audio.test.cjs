const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const model = require("./load-ts.cjs")("demo/model");

// Actual preview callbacks/reducer with hook state and controlled timers.
// Effects and DOM rendering are intentionally outside this unit harness.
function preview() {
  let cursor = 0;
  const slots = [];
  const hooks = {
    useState(initial) {
      const slot = cursor++;
      if (!(slot in slots))
        slots[slot] = typeof initial === "function" ? initial() : initial;
      return [
        slots[slot],
        (value) => {
          slots[slot] =
            typeof value === "function" ? value(slots[slot]) : value;
        },
      ];
    },
    useReducer(reducer, initial, init) {
      const slot = cursor++;
      if (!(slot in slots)) slots[slot] = init ? init(initial) : initial;
      return [
        slots[slot],
        (action) => {
          slots[slot] = reducer(slots[slot], action);
        },
      ];
    },
    useRef(initial) {
      const slot = cursor++;
      return (slots[slot] ??= { current: initial });
    },
    useCallback: (callback) => callback,
    useEffect: () => {},
  };
  const filename = path.resolve(__dirname, "../src/demo/usePreview.ts");
  const loaded = new Module(filename, module);
  loaded.require = (id) =>
    id === "react" ? hooks : id === "./model" ? model : require(id);
  loaded._compile(
    ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText,
    filename,
  );
  return () => {
    cursor = 0;
    return loaded.exports.usePreview();
  };
}

test("simultaneous audio callbacks keep independent source and translation data", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const render = preview();
  render().selectAudioSource("both");
  render().run("audio");
  t.mock.timers.tick(900);
  let channels = render().state.audioChannels;
  assert.equal(channels.system.result, model.audioFixtures.system.result);
  assert.equal(channels.mic.result, "");
  assert.equal(channels.mic.phase, "loading");
  const system = channels.system;
  t.mock.timers.tick(400);
  channels = render().state.audioChannels;
  assert.equal(channels.system, system);
  assert.equal(channels.mic.result, model.audioFixtures.mic.result);
  assert.notEqual(channels.system.source, channels.mic.source);
});

test("stopping dual audio cancels both pending callbacks and preserves completed content", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const render = preview();
  render().selectAudioSource("both");
  render().run("audio");
  t.mock.timers.tick(900);
  render().stop("audio");
  t.mock.timers.tick(2000);
  const state = render().state;
  assert.equal(
    state.audioChannels.system.result,
    model.audioFixtures.system.result,
  );
  assert.equal(state.audioChannels.mic.result, "");
  assert.equal(state.audioChannels.system.running, false);
  assert.equal(state.audioChannels.mic.running, false);
  assert.equal(state.tasks.text.source, model.sampleSource);
});

test("switching an active audio source cancels inactive callbacks and retains channel content", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const render = preview();
  render().selectAudioSource("both");
  render().run("audio");
  t.mock.timers.tick(900);
  render().selectAudioSource("system");
  t.mock.timers.tick(400);
  assert.equal(render().state.audioChannels.mic.result, "");
  assert.equal(
    render().state.audioChannels.system.result,
    model.audioFixtures.system.result,
  );
  render().stop("audio");
  render().selectAudioSource("mic");
  assert.equal(
    render().state.audioChannels.system.result,
    model.audioFixtures.system.result,
  );
  assert.equal(render().state.tasks.audio.result, "");
});

test("audio languages and copy callbacks remain separate for each channel", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const render = preview();
  render().dispatch({
    type: "audio-language",
    channel: "mic",
    side: "src",
    value: "ja",
  });
  render().dispatch({
    type: "audio-language",
    channel: "mic",
    side: "tgt",
    value: "en",
  });
  const state = render().state;
  assert.equal(state.audioChannels.system.src, "auto");
  assert.equal(state.audioChannels.system.tgt, "zh");
  assert.equal(state.audioChannels.mic.src, "ja");
  assert.equal(state.audioChannels.mic.tgt, "en");
  assert.equal(state.src, "auto");
  render().selectAudioSource("both");
  render().run("audio");
  t.mock.timers.tick(1300);
  const channels = render().state.audioChannels;
  render().copy(channels.mic.result);
  render().paste();
  assert.equal(render().state.tasks.text.source, channels.mic.result);
  assert.equal(
    render().state.audioChannels.system.result,
    channels.system.result,
  );
});

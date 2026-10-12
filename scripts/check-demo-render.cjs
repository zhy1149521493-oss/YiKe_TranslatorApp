// Startup crash check only. This is not browser or visual acceptance.
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const cache = new Map();
function readModule(filename) {
  if (cache.has(filename)) return cache.get(filename).exports;
  const loaded = new Module(filename, module);
  cache.set(filename, loaded);
  const normalRequire = Module.createRequire(filename);
  loaded.require = (id) => {
    if (id.startsWith(".")) {
      for (const extension of [".ts", ".tsx"]) {
        const target = path.resolve(path.dirname(filename), id + extension);
        if (fs.existsSync(target)) return readModule(target);
      }
    }
    return normalRequire(id);
  };
  loaded._compile(
    ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText,
    filename,
  );
  return loaded.exports;
}
global.window = { innerWidth: 960, innerHeight: 640 };
const demo = path.resolve(__dirname, "../src/demo");
const { MainLayout } = readModule(path.join(demo, "Layouts.tsx"));
const { FloatingPreview } = readModule(path.join(demo, "Floating.tsx"));
const { createPreviewState, previewReducer, defaults } = readModule(
  path.join(demo, "model.ts"),
);
const noop = () => {};
let count = 0;
for (const style of ["poetry", "workbench", "classic"]) {
  for (const mode of ["text", "screenshot", "subtitle", "audio"]) {
    for (const scenario of ["sample", "empty", "loading", "error", "long"]) {
      const state = previewReducer(
        previewReducer(createPreviewState(), { type: "mode", mode }),
        { type: "scenario", scenario },
      );
      const controller = {
        state,
        dispatch: noop,
        edit: noop,
        run: noop,
        stop: noop,
        copy: noop,
        paste: noop,
        setComposing: noop,
      };
      renderToStaticMarkup(
        React.createElement(MainLayout, {
          style,
          controller,
          tone: "light",
          settingsOpen: false,
          onSettings: noop,
          onTheme: noop,
          onFloating: noop,
          floatingOpen: false,
          onMode: noop,
          onCapture: noop,
        }),
      );
      count++;
    }
  }
}
for (const floatingStyle of ["classic", "capsule"]) {
  renderToStaticMarkup(
    React.createElement(FloatingPreview, {
      prefs: { ...defaults, floatingStyle },
      controller: { state: createPreviewState() },
      onSettings: noop,
      onCapture: noop,
      onClose: noop,
    }),
  );
  count++;
}
console.log(
  `${count} component startup renders passed; this does not validate layout, effects or pointer behavior.`,
);

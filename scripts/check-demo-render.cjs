// Startup crash check only. This is not browser or visual acceptance.
const fs = require("node:fs");
const assert = require("node:assert/strict");
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
const { createPreviewState, previewReducer, defaults, modes } = readModule(
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
      for (const navigation of ["persistent", "hover"])
        for (const drawerOpen of [false, true])
          for (const settingsOpen of [false, true]) {
            const markup = renderToStaticMarkup(
              React.createElement(MainLayout, {
                style,
                controller,
                tone: "light",
                settingsOpen,
                onSettings: noop,
                onTheme: noop,
                onFloating: noop,
                floatingOpen: false,
                onMode: noop,
                onCapture: noop,
                navigation,
                drawerOpen,
                onCloseDrawer: noop,
                onBrand: noop,
              }),
            );
            // An open task must pin navigation, even without hover/focus effects.
            const navigationTag = markup.match(
              /<(?:aside|header)[^>]*class="navigation-capsule[^>]*>/,
            )?.[0];
            assert.ok(navigationTag, `${style}: missing navigation`);
            assert.ok(
              navigationTag.includes(
                `data-expanded="${navigation === "persistent" || drawerOpen}"`,
              ),
              `${style}: navigation must remain expanded while its workspace is open`,
            );
            assert.ok(
              markup.includes('class="brand-mark"'),
              `${style}: missing YiKe brand`,
            );
            const buttons =
              markup.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];
            for (const task of modes) {
              const button = buttons.find((button) =>
                button.includes(`aria-label="${task.label}"`),
              );
              assert.ok(button, `${style}: missing task button ${task.id}`);
              const tag = button.slice(0, button.indexOf(">") + 1);
              const selected =
                /aria-current="page"|aria-pressed="true"|class="active"/.test(
                  tag,
                );
              assert.equal(
                selected,
                drawerOpen && !settingsOpen && mode === task.id,
                `${style}/${mode}: folded or inactive task must not appear selected`,
              );
            }
            const settingsButtons = buttons.filter((button) =>
              button.includes('aria-label="设置中心"'),
            );
            assert.ok(
              settingsButtons.length,
              `${style}: missing settings button`,
            );
            for (const button of settingsButtons)
              assert.equal(
                button.includes('aria-pressed="true"'),
                drawerOpen && settingsOpen,
                `${style}: folded settings must not appear selected`,
              );
            count++;
          }
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

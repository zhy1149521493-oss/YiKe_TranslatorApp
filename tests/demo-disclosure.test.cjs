const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

// Exercise the actual component callbacks with hook state and focus semantics
// supplied by the test. This is not DOM/effect, CSS, or browser acceptance.
function disclosure(variant) {
  let cursor = 0;
  const slots = [];
  const hooks = {
    useState(initial) {
      const slot = cursor++;
      if (!(slot in slots)) slots[slot] = initial;
      return [
        slots[slot],
        (next) => {
          slots[slot] = typeof next === "function" ? next(slots[slot]) : next;
        },
      ];
    },
    useRef(initial) {
      const slot = cursor++;
      return (slots[slot] ??= { current: initial });
    },
    useId: () => "test-navigation",
    useEffect: () => {},
  };
  const filename = path.resolve(__dirname, "../src/interface/Disclosure.tsx");
  const loaded = new Module(filename, module);
  loaded.require = (id) => {
    if (id === "react") return hooks;
    if (id === "./Icon") return { IconButton: () => null };
    if (id === "./BrandMark") return { BrandMark: () => null };
    if (id === "@tauri-apps/api/core") return { isTauri: () => false, invoke: () => Promise.resolve() };
    if (id === "./brandDrag") return require('./load-ts.cjs')('interface/brandDrag');
    return require(id);
  };
  loaded._compile(
    ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText,
    filename,
  );
  return (workspaceOpen = false) => {
    cursor = 0;
    return loaded.exports.NavigationCapsule({
      variant,
      behavior: "hover",
      workspaceOpen,
      brand: "译刻",
      children: null,
      onBrand: () => {},
    }).props;
  };
}

function focusTarget(keyboard) {
  return {
    matches: (selector) => selector === ":focus-visible" && keyboard,
    classList: { contains: () => false },
  };
}
global.matchMedia = () => ({ matches: true });

test("Poetry brand keeps the same position while revealing and folding", () => {
  const render = disclosure("poetry");
  let nav = render();
  assert.equal(nav.children[0].props.style?.transform, undefined);
  nav.children[0].props.onPointerEnter();
  nav = render();
  assert.equal(nav.children[0].props.style?.transform, undefined);
  assert.match(nav.style.clipPath, /round 64px/);
});

test("mouse-focused task buttons do not pin folded navigation after pointer departure", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (const variant of ["poetry", "workbench", "classic"]) {
    const render = disclosure(variant);
    let nav = render();
    nav.children[0].props.onPointerEnter();
    nav = render();
    nav.onPointerDownCapture();
    nav.onFocusCapture({ target: focusTarget(false) });
    assert.equal(render(true)["data-expanded"], true);
    nav = render(false); // Click the current task to fold its content.
    nav.onPointerLeave();
    t.mock.timers.tick(180);
    assert.equal(render()["data-expanded"], false, variant);
  }
});

test("keyboard focus retains navigation until focus leaves", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (const variant of ["poetry", "workbench", "classic"]) {
    const render = disclosure(variant);
    const nav = render();
    nav.onFocusCapture({ target: focusTarget(true) });
    nav.onPointerLeave();
    t.mock.timers.tick(180);
    assert.equal(render()["data-expanded"], true, variant);
    nav.onBlurCapture({
      currentTarget: { contains: () => false },
      relatedTarget: null,
    });
    assert.equal(render()["data-expanded"], false, variant);
  }
});

test("pointer presses clear a preexisting keyboard pin without a new focus event", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (const variant of ["poetry", "workbench", "classic"]) {
    const render = disclosure(variant);
    const nav = render();
    nav.onFocusCapture({ target: focusTarget(true) });
    nav.onPointerDownCapture(); // Press an already-focused button.
    nav.onPointerLeave();
    t.mock.timers.tick(180);
    assert.equal(render(true)["data-expanded"], true, variant);
    assert.equal(render(false)["data-expanded"], false, variant);
  }
});

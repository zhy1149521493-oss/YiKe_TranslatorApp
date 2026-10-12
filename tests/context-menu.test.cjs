const { test } = require('node:test');
const assert = require('node:assert/strict');
const { menuPosition, keepsEditingMenu } = require('./load-ts.cjs')('interface/contextMenu');

test('application menu stays inside narrow windows and avoids browser editing menus', () => {
  assert.deepEqual(menuPosition(550, 475, 224, 350, 560, 480), { left: 328, top: 122 });
  assert.deepEqual(menuPosition(-20, -30, 224, 350, 560, 480), { left: 8, top: 8 });
  assert.equal(keepsEditingMenu(null), false);
  assert.equal(keepsEditingMenu({ closest: selector => selector.includes('textarea') ? {} : null }), true);
  assert.equal(keepsEditingMenu({ closest: () => null }), false);
});

test('menu reads and changes real pin state, handles errors, keyboard dismissal and listener cleanup', async t => {
  const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
  const previous = { window: global.window, document: global.document, ResizeObserver: global.ResizeObserver, innerWidth: global.innerWidth, innerHeight: global.innerHeight };
  t.after(() => Object.assign(global, previous));
  const events = new Map(), values = [], calls = [];
  let effect, index = 0, pin = false, fail = false, disconnected = false;
  const buttons = [{ focus: () => calls.push('focus-first') }, { focus: () => calls.push('focus-last') }];
  const element = { offsetWidth: 224, offsetHeight: 350, contains: target => target === element,
    querySelector: () => buttons[0], querySelectorAll: () => buttons };
  global.window = { addEventListener: (k, f) => events.set(k, f), removeEventListener: k => events.delete(k) };
  global.document = { ...global.window, activeElement: buttons[0] };
  global.innerWidth = 560; global.innerHeight = 480;
  global.ResizeObserver = class { observe() {} disconnect() { disconnected = true; } };
  const filename = path.resolve(__dirname, '../src/interface/AppContextMenu.tsx');
  const loaded = new Module(filename, module); loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded.require = id => id === 'react' ? {
    useRef: () => ({ current: element }), useLayoutEffect: fn => { effect = fn; },
    useState: initial => { const i = index++; if (!(i in values)) values[i] = initial; return [values[i], next => { values[i] = next; }]; },
  } : id === '@tauri-apps/api/core' ? { isTauri: () => true }
    : id === '@tauri-apps/api/window' ? { getCurrentWindow: () => ({ isAlwaysOnTop: async () => pin,
      setAlwaysOnTop: async value => { calls.push(['pin', value]); if (fail) throw Error('native failure'); pin = value; } }) }
    : require(id.startsWith('.') ? path.resolve(path.dirname(filename), id) : id);
  loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, filename);
  const props = { x: 550, y: 475, open: true, floatingOpen: false, onDismiss: restore => calls.push(['dismiss', restore]),
    onToggleDrawer: () => calls.push('drawer'), onFloating() {}, onSettings() {}, onTheme() {}, onMinimize() {}, onClose() {} };
  const render = () => { index = 0; return loaded.exports.AppContextMenu(props); };
  const button = tree => tree.props.children.find(child => child?.props?.role === 'menuitemcheckbox');
  const cleanup = (render(), effect()); await Promise.resolve();
  assert.equal(button(render()).props['aria-checked'], false);
  await button(render()).props.onClick(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(pin, true); assert.equal(button(render()).props['aria-checked'], true);
  fail = true; await button(render()).props.onClick(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(button(render()).props['aria-checked'], true, 'failure cannot fabricate a changed native state');
  assert.equal(values[3], '置顶操作失败，请重试');
  render().props.onKeyDown({ key: 'End', preventDefault() {}, stopPropagation() {} });
  assert.equal(calls.at(-1), 'focus-last');
  render().props.onKeyDown({ key: 'Escape', preventDefault() {}, stopPropagation() {} });
  assert.deepEqual(calls.at(-1), ['dismiss', true]);
  events.get('pointerdown')({ target: {} }); assert.deepEqual(calls.at(-1), ['dismiss', undefined]);
  cleanup(); assert.equal(events.size, 0); assert.equal(disconnected, true);
});

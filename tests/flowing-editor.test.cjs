const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
require('./load-ts.cjs');

test('flowing editor remeasures wrapping, viewport and fonts, shrinks, and detaches on unmount', async t => {
  const previous = { window: global.window, document: global.document, ResizeObserver: global.ResizeObserver };
  t.after(() => Object.assign(global, previous));
  const parent = { clientWidth: 800 };
  let contentHeight = 80, observe, cleanup, effect, fontReady;
  const events = new Map();
  const editor = { parentElement: parent, style: {}, get scrollHeight() {
    assert.equal(this.style.height, '0px', 'measure after releasing the previous height');
    return contentHeight;
  } };
  global.window = { addEventListener: (type, fn) => events.set(type, fn), removeEventListener: type => events.delete(type) };
  global.document = { fonts: { ready: new Promise(resolve => { fontReady = resolve; }) } };
  let disconnected = false;
  global.ResizeObserver = class {
    constructor(fn) { observe = fn; }
    observe(element) { assert.equal(element, parent); }
    disconnect() { disconnected = true; }
  };
  const filename = path.resolve(__dirname, '../src/interface/Translation.tsx');
  const loaded = new Module(filename, module);
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded.require = id => id === 'react' ? {
    useRef: () => ({ current: editor }), useLayoutEffect: fn => { effect = fn; },
  } : require(id.startsWith('.') ? path.resolve(path.dirname(filename), id) : id);
  loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, filename);
  loaded.exports.TextEditor({ controller: { state: { tasks: { text: { source: 'test passage' } } } }, flowing: true });
  cleanup = effect();
  assert.equal(editor.style.height, '80px');
  parent.clientWidth = 400; contentHeight = 160; observe();
  assert.equal(editor.style.height, '160px');
  parent.clientWidth = 800; contentHeight = 80; observe();
  assert.equal(editor.style.height, '80px');
  contentHeight = 64; events.get('resize')();
  assert.equal(editor.style.height, '64px');
  contentHeight = 96; fontReady(); await Promise.resolve();
  assert.equal(editor.style.height, '96px');
  cleanup(); contentHeight = 500; observe();
  assert.equal(editor.style.height, '96px');
  assert.equal(disconnected, true);
  assert.equal(events.size, 0);
});

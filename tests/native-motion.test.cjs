const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
const { navigationSurface } = require('./load-ts.cjs')('interface/nativeSurface');

test('actual native hook keeps both drawer directions at 240ms, including folding from a popup', async t => {
  const keys = ['requestAnimationFrame', 'cancelAnimationFrame', 'MutationObserver', 'ResizeObserver', 'matchMedia', 'window', 'document', 'performance', 'innerWidth', 'innerHeight'];
  const old = Object.fromEntries(keys.map(key => [key, global[key]]));
  t.after(() => Object.assign(global, old));
  let effect, mutation, frame, time = 0, popup = null;
  const updates = [];
  global.requestAnimationFrame = fn => { frame = fn; return 1; }; global.cancelAnimationFrame = () => {};
  global.performance = { now: () => time }; global.innerWidth = 960; global.innerHeight = 640;
  global.MutationObserver = class { constructor(fn) { mutation = fn; } observe() {} disconnect() {} };
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  global.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  global.window = { addEventListener() {}, removeEventListener() {} };
  global.document = { fonts: { ready: Promise.resolve() } };
  const logo = { getBoundingClientRect: () => ({ x: 150, y: 37, width: 42, height: 42 }) };
  const nav = { dataset: { expanded: 'true', variant: 'poetry' }, querySelector: () => logo,
    getBoundingClientRect: () => ({ x: 110, y: 24, width: 740, height: 68 }) };
  const root = { dataset: { workspaceOpen: 'true', motionInput: 'pointer' }, querySelector: selector => selector.includes('navigation') ? nav : popup };
  const filename = path.resolve(__dirname, '../src/interface/useNativeSurface.ts');
  const loaded = new Module(filename, module); loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded.require = id => id === 'react' ? { useEffect: fn => { effect = fn; } }
    : id === '@tauri-apps/api/core' ? { isTauri: () => true, invoke: async () => {} }
    : id === './nativeSurface' ? { navigationSurface, SurfaceAnimator: class {
      update(...args) { updates.push(args); } dispose() {} } } : require(id);
  loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, filename);
  loaded.exports.useNativeSurface({ current: root }); const cleanup = effect(); await Promise.resolve(); frame();
  const measure = () => { mutation(); frame(); return updates.at(-1)[2]; };
  popup = { getBoundingClientRect: () => ({ x: 100, y: 80, width: 224, height: 320 }) };
  assert.equal(measure(), 0, 'showing a menu alone refreshes immediately');
  popup = null; root.dataset.workspaceOpen = 'false';
  assert.equal(measure(), 240, 'menu removal must not snap a simultaneous drawer fold');
  time = 180; assert.equal(measure(), 240, 'subsequent measurements do not shorten a drawer exit');
  time = 250; assert.equal(measure(), 160, 'standalone navigation hover retains its faster timing');
  root.dataset.workspaceOpen = 'true'; assert.equal(measure(), 240);
  root.dataset.motionInput = 'keyboard'; root.dataset.workspaceOpen = 'false'; assert.equal(measure(), 0);
  cleanup();
});

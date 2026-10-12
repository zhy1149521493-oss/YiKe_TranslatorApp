const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
const { animateView } = require('./load-ts.cjs')('interface/viewMotion');

test('rapid page switches continue displayed opacity before cancel; instant paths never animate', t => {
  const original = global.getComputedStyle;
  t.after(() => { global.getComputedStyle = original; });
  const calls = [];
  global.getComputedStyle = () => { calls.push('read-frame'); return { opacity: '.91', getPropertyValue: () => 'cubic-bezier(0.23, 1, 0.32, 1)' }; };
  const previous = { playState: 'running', cancel: () => calls.push('cancel') };
  const next = { playState: 'running', cancel() {} };
  const element = { animate: (frames, options) => { calls.push([frames, options]); return next; } };
  assert.equal(animateView(element, previous, false), next);
  assert.deepEqual(calls.slice(0, 2), ['read-frame', 'cancel']);
  assert.equal(calls[2][0][0].opacity, '.91'); assert.equal(calls[2][1].duration, 180);
  calls.length = 0;
  assert.equal(animateView(element, previous, true), null);
  assert.deepEqual(calls, ['read-frame', 'cancel']);
  assert.equal(animateView({}, null, false), null, 'older engines fall back to immediate content');
});

test('page motion runs only on navigation, skips keyboard/reduced motion, and disposes listeners', t => {
  const saved = { document: global.document, matchMedia: global.matchMedia };
  t.after(() => Object.assign(global, saved));
  const events = new Map(), slots = [], animations = [];
  let cursor = 0, layout, effect, reduced = false, keyboard = false, cancelled = 0;
  global.document = { addEventListener: (key, fn) => events.set(key, fn), removeEventListener: key => events.delete(key) };
  global.matchMedia = () => ({ get matches() { return reduced; }, addEventListener: (key, fn) => events.set(key, fn), removeEventListener: key => events.delete(key) });
  const element = { scrollTop: 70, closest: () => ({ dataset: { motionInput: keyboard ? 'keyboard' : 'pointer' } }) };
  const filename = path.resolve(__dirname, '../src/interface/useViewMotion.ts');
  const loaded = new Module(filename, module); loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded.require = id => id === 'react' ? {
    useRef: initial => { const i = cursor++; return slots[i] ??= { current: i === 0 ? element : initial }; },
    useLayoutEffect: fn => { layout = fn; }, useEffect: fn => { effect = fn; },
  } : id === './viewMotion' ? { animateView: (node, previous, instant) => {
    previous?.cancel(); animations.push(instant); return instant ? null : { cancel: () => cancelled++ };
  } } : require(id);
  loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, filename);
  const render = view => { cursor = 0; loaded.exports.useViewMotion(view); layout(); };
  render('text'); const cleanup = effect(); assert.deepEqual(animations, []);
  render('audio'); assert.deepEqual(animations, [false]); assert.equal(element.scrollTop, 0);
  render('audio'); assert.equal(animations.length, 1, 'streaming task updates do not replay navigation');
  render('subtitle'); assert.equal(cancelled, 1);
  events.get('keydown')(); assert.equal(cancelled, 2);
  keyboard = true; render('settings'); assert.equal(animations.at(-1), true);
  keyboard = false; reduced = true; render('text'); assert.equal(animations.at(-1), true);
  reduced = false; render('audio'); reduced = true; events.get('change')(); assert.equal(cancelled, 3);
  cleanup(); assert.equal(events.size, 0);
});

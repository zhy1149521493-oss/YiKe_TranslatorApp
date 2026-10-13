const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const appearance = require('./load-ts.cjs')('interface/floatingAppearance');
const defaults = Object.fromEntries(['main', 'floating', 'audio', 'audioMic', 'subtitle'].map(key => [key, { bg: '', opacity: key === 'main' ? 100 : 88, textColor: '', fontSize: 14 }]));

test('rapid opacity changes serialize native writes and coalesce to the final slider position', async () => {
  const calls = []; const completions = [];
  const writer = new appearance.FloatingOpacityWriter((surface, value) => {
    calls.push({ surface, value });
    return new Promise(resolve => completions.push(resolve));
  });
  const first = writer.update('floating', 70);
  writer.update('floating', 62); writer.update('subtitle', 51);
  assert.deepEqual(calls, [{ surface: 'floating', value: 70 }]);
  completions.shift()(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls[1], { surface: 'subtitle', value: 51 });
  assert.equal(calls.length, 2);
  completions.shift()(); await first;
});

test('opacity write errors reject and allow a later user adjustment to retry', async () => {
  let failing = true; const saved = [];
  const writer = new appearance.FloatingOpacityWriter(async (_, value) => { if (failing) throw Error('disk full'); saved.push(value); });
  await assert.rejects(writer.update('audio', 55), /disk full/);
  failing = false; await writer.update('audioMic', 57);
  assert.deepEqual(saved, [57]);
});

test('a failed final opacity stays dirty and a later exit flush retries the same value', async () => {
  let failing = true; const attempts = [];
  const writer = new appearance.FloatingOpacityWriter(async (_, value) => {
    attempts.push(value); if (failing) throw Error('disk full');
  });
  await assert.rejects(writer.update('audio', 55), /disk full/);
  await assert.rejects(writer.flush(), /disk full/);
  failing = false; await writer.flush();
  assert.deepEqual(attempts, [55, 55, 55]);
});

test('a newer queued opacity replaces a failed older value before exit retries', async () => {
  const attempts = []; let failFirst;
  const writer = new appearance.FloatingOpacityWriter(async (_, value) => {
    attempts.push(value);
    if (attempts.length === 1) await new Promise((_, reject) => { failFirst = reject; });
  });
  const first = writer.update('floating', 80);
  writer.update('audioMic', 44);
  failFirst(Error('temporary failure')); await assert.rejects(first, /temporary failure/);
  await writer.flush();
  assert.deepEqual(attempts, [80, 44]);
});

test('legacy floats share translation opacity without overwriting individual colors, fonts or main opacity', () => {
  const previous = structuredClone(defaults);
  previous.floating.opacity = 73; previous.audio.opacity = 12; previous.audioMic.opacity = 99;
  previous.audio.bg = '#123456'; previous.audioMic.textColor = '#ABCDEF'; previous.subtitle.fontSize = 20;
  const next = appearance.normalizeFloatingAppearance(previous);
  for (const key of appearance.FLOATING_SURFACES) assert.equal(next[key].opacity, 73);
  assert.equal(next.main.opacity, 100); assert.equal(next.audio.bg, '#123456');
  assert.equal(next.audioMic.textColor, '#ABCDEF'); assert.equal(next.subtitle.fontSize, 20);
  assert.equal(previous.audio.opacity, 12);
});

test('following the shared theme clears only four auxiliary color overrides', () => {
  const previous = structuredClone(defaults);
  for (const [index, key] of Object.keys(previous).entries()) {
    previous[key] = { bg: '#123456', textColor: '#ABCDEF', fontSize: 14 + index, opacity: 65 + index };
  }
  const next = appearance.followFloatingTheme(previous);
  assert.equal(next.main, previous.main);
  for (const key of appearance.FLOATING_SURFACES) {
    assert.equal(next[key].bg, ''); assert.equal(next[key].textColor, '');
    assert.equal(next[key].fontSize, previous[key].fontSize); assert.equal(next[key].opacity, previous[key].opacity);
    assert.equal(previous[key].bg, '#123456'); assert.equal(previous[key].textColor, '#ABCDEF');
  }
});

test('shared opacity clamps invalid values and restore tolerates damaged optional appearance fields', () => {
  assert.equal(appearance.withFloatingOpacity(defaults, -10).audio.opacity, 0);
  assert.equal(appearance.withFloatingOpacity(defaults, 150).audioMic.opacity, 100);
  assert.equal(appearance.withFloatingOpacity(defaults, NaN).floating.opacity, 88);
  const state = appearance.restoreFloatingAppearance({ theme: 'system', accentColor: 'invalid', appearance: { floating: { opacity: 63 }, audio: { bg: 42, fontSize: Infinity, textColor: '#FFF000' } } }, defaults);
  assert.equal(state.theme, 'system'); assert.equal(state.accent, '');
  assert.equal(state.appearance.audio.bg, ''); assert.equal(state.appearance.audio.fontSize, 14);
  assert.equal(state.appearance.audio.textColor, '#FFF000'); assert.equal(state.appearance.audio.opacity, 63);
});

test('all float types share warm theme tokens and follow the system tone without losing customization', () => {
  const state = appearance.restoreFloatingAppearance({ theme: 'system', accentColor: '#AABBCC' }, defaults);
  for (const dark of [false, true]) {
    const reference = appearance.floatingThemeVariables(state, 'floating', dark);
    for (const key of appearance.FLOATING_SURFACES) assert.deepEqual(appearance.floatingThemeVariables(state, key, dark), reference);
    assert.equal(reference['--ios-blue'], '#AABBCC');
    assert.equal(reference['--floating-card-bg'], dark ? 'rgba(40, 38, 36, 0.88)' : 'rgba(249, 247, 244, 0.88)');
  }
  const custom = appearance.restoreFloatingAppearance({ theme: 'dark', appearance: { audio: { bg: '#123456', textColor: '#ABCDEF', fontSize: 20 } } }, defaults);
  const vars = appearance.floatingThemeVariables(custom, 'audio', false);
  assert.equal(vars['--floating-card-bg'], 'rgba(18, 52, 86, 0.88)');
  assert.equal(vars['--ios-text'], '#ABCDEF'); assert.equal(vars['--w-font'], '20px');
});

// Run the actual configuration-subscription effect with a delayed IPC fixture.
const source = fs.readFileSync(path.resolve(__dirname, '../src/interface/useFloatingAppearance.ts'), 'utf8');
const ast = ts.createSourceFile('hook.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
let subscription;
function walk(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect' && node.arguments[0].getText(ast).includes('"load_app_config"')) subscription = node.arguments[0].getText(ast);
  ts.forEachChild(node, walk);
}
walk(ast);
assert.ok(subscription);
function harness() {
  let resolve;
  const states = [];
  const ctx = { ...appearance, defaults, pendingOpacity: { current: null }, window: {}, setState: value => states.push(value), setReady: value => states.push({ ready: value }),
    invoke: () => new Promise(done => { resolve = done; }),
  };
  vm.createContext(ctx);
  vm.runInContext(ts.transpileModule(`var subscribe = ${subscription}`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, ctx);
  return { ctx, states, cleanup: ctx.subscribe(), load: async value => { resolve(value); await new Promise(done => setImmediate(done)); } };
}

test('an old config response cannot overwrite a newer cross-window theme/opacity broadcast', async () => {
  const h = harness();
  h.ctx.window.__applyAppSettings({ theme: 'dark', appearance: { floating: { opacity: 52 } } });
  await h.load({ settings: { theme: 'light', appearance: { floating: { opacity: 88 } } } });
  const state = h.states.find(value => value.theme);
  assert.equal(state.theme, 'dark'); assert.equal(state.appearance.audioMic.opacity, 52);
  assert.equal(h.states.filter(value => value.theme).length, 1);
});

test('an older in-flight opacity broadcast cannot move the active slider backwards', () => {
  const h = harness(); h.ctx.pendingOpacity.current = 43;
  h.ctx.window.__applyAppSettings({ theme: 'dark', appearance: { floating: { opacity: 80 } } });
  assert.equal(h.states.find(value => value.theme).appearance.floating.opacity, 43);
  h.cleanup();
});

test('unmounted float subscriptions discard late config and preserve a newer broadcast owner', async () => {
  const h = harness();
  const replacement = () => {};
  h.ctx.window.__applyAppSettings = replacement;
  h.cleanup();
  await h.load({ settings: { theme: 'dark' } });
  assert.equal(h.states.length, 0); assert.equal(h.ctx.window.__applyAppSettings, replacement);
});

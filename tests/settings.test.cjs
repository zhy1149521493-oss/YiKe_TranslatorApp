const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const preferences = require("./load-ts.cjs")("interface/preferences");
const { ConfigWriter, mergeConfig } = require('./load-ts.cjs')('config-writer');

// Exercise the actual hydration effect with asynchronous IPC and setter spies.
const source = fs.readFileSync(path.resolve(__dirname, '../src/App.tsx'), 'utf8');
const ast = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const main = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'MainWindow');
let effect;
function walk(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect' && node.arguments[0].getText(ast).includes('"load_app_config"')) effect = node.arguments[0];
  else ts.forEachChild(node, walk);
}
walk(main);
assert.ok(effect, 'configuration hydration effect exists');
const code = ts.transpileModule(`var hydrate = ${effect.getText(ast)};`, {
  compilerOptions: { target: ts.ScriptTarget.ES2020 },
}).outputText;
function harness(config) {
  let resolve, reject;
  const states = {};
  const saves = [];
  const ctx = { ...preferences, configWriter: new ConfigWriter(async patch => { saves.push(patch); }, error => { throw error; }), normalizeFloatingAppearance: value => value, configLoadedRef: { current: false }, subRegionRef: { current: null }, DEFAULT_APPEARANCE: {}, DEFAULT_SHORTCUTS: {}, mergeAppearance: (_, saved) => saved ?? {},
    invoke: (cmd, args) => {
      if (cmd === 'load_app_config') return new Promise((r, e) => { resolve = r; reject = e; });
      if (cmd === 'save_app_config') saves.push(args.config);
      return Promise.resolve();
    },
  };
  for (const name of ['WindowSizingReady', 'ConfigReadError', 'ActionNotice', 'EngineMode', 'MainClose', 'UiLayout', 'Navigation', 'AudioChannelLanguages', 'Theme', 'AccentColor', 'Appearance', 'Shortcuts', 'ConflictHint', 'SourceLang', 'TargetLang', 'StreamOn', 'NumCtx', 'IndependentLang', 'ModeLangs', 'ClipAuto', 'AudioDenoise', 'AudioMode', 'Model', 'Providers', 'ActiveProviderId', 'SubFps', 'SubMode', 'SubEngine', 'SubRegion']) ctx['set' + name] = v => { states[name] = v; };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  const cleanup = ctx.hydrate();
  return { ctx, states, saves, cleanup, fail: async () => { reject(Error('fixture')); await new Promise(r => setImmediate(r)); }, load: async () => { resolve(config); await new Promise(r => setImmediate(r)); } };
}

test('native sizing waits for restored Poetry style and still starts after missing or failed config', async () => {
  const h = harness({ configVersion: 3, settings: { design: { mainStyle: 'poetry' } } });
  assert.equal(h.states.WindowSizingReady, undefined);
  await h.load();
  assert.equal(h.states.UiLayout, 'poetry');
  assert.equal(h.states.WindowSizingReady, true);
  const missing = harness(null); await missing.load();
  assert.equal(missing.states.WindowSizingReady, true);
  const failed = harness(null); await failed.fail();
  assert.equal(failed.states.WindowSizingReady, true);
  assert.match(failed.states.ConfigReadError, /无法读取设置/);
  assert.equal(failed.ctx.configWriter.persistenceBlocked, true);
  await assert.rejects(failed.ctx.configWriter.update({ settings: { theme: 'light' } }));
  assert.deepEqual(failed.saves, [], 'failed hydration cannot overwrite the existing file with defaults');
});

test('subtitle settings hydrate after IPC resolves, including the saved region', async () => {
  const h = harness({ configVersion: 3, settings: { subtitle: { fps: 5, mode: 'ocr-first', engine: 'rapid', region: { x: 20, y: 30, w: 400, h: 100 } } } });
  assert.equal(h.states.SubFps, undefined);
  await h.load();
  assert.equal(h.states.SubFps, 5);
  assert.equal(h.states.SubMode, 'ocr-first');
  assert.equal(h.states.SubEngine, 'rapid');
  assert.equal(JSON.stringify(h.ctx.subRegionRef.current), JSON.stringify({ x: 20, y: 30, w: 400, h: 100 }));
});

test('classic layout restores after restart and older configs default to studio', async () => {
  const classic = harness({ configVersion: 3, settings: { uiLayout: 'classic' } });
  await classic.load();
  assert.equal(classic.states.UiLayout, 'classic');
  const old = harness({ configVersion: 3, settings: {} });
  await old.load();
  assert.equal(old.states.UiLayout, 'studio');
});

test('an unmounted window ignores late config hydration and migration', async () => {
  const h = harness({ configVersion: 2, providers: [], settings: {} });
  h.cleanup();
  await h.load();
  assert.deepEqual(h.states, {});
  assert.deepEqual(h.saves, []);
});

test('provider migration preserves audio, subtitle region, and per-mode languages', async () => {
  const settings = { audio: { denoise: true }, subtitle: { region: { x: 1, y: 2, w: 100, h: 30 } }, translate: { modeLangs: { audio: { src: 'ja', tgt: 'zh' } } } };
  const h = harness({ configVersion: 2, providers: [{ id: 'mock', model: 'chosen', models: ['chosen', 'other'] }], settings });
  await h.load();
  assert.equal(h.saves.length, 0, 'hydration does not write a stale full snapshot');
  await h.ctx.configWriter.update({ configVersion: 3, providers: h.states.Providers });
  const stored = mergeConfig({ configVersion: 2, settings }, h.saves[0]);
  assert.equal(stored.configVersion, 3);
  assert.equal(JSON.stringify(stored.settings), JSON.stringify(settings));
  assert.equal(JSON.stringify(stored.providers[0].models), '["chosen"]');
});

test('local model and audio-source preference restore independently of task startup', async () => {
  const h = harness({ configVersion: 3, settings: { translate: { model: 'fixture:small' }, audio: { mode: 'both' } } });
  await h.load();
  assert.equal(h.states.Model, 'fixture:small');
  assert.equal(h.states.AudioMode, 'both');
});

test('actual quit hook waits for saves, reports failures, and allows protected read-failure exit', async () => {
  let quitEffect;
  function find(node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect' && node.arguments[0].getText(ast).includes('__requestAppQuit')) quitEffect = node.arguments[0];
    else ts.forEachChild(node, find);
  }
  find(main); assert.ok(quitEffect);
  const script = ts.transpileModule(`var mountQuit = ${quitEffect.getText(ast)};`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  const calls = []; let finish; let finishSensitivity;
  const ctx = { window: {}, configWriter: { persistenceBlocked: false, flush: () => new Promise(resolve => { finish = resolve; }) },
    sensitivityWriter: { flush: () => new Promise(resolve => { finishSensitivity = resolve; }) },
    invoke: async command => { calls.push(command); }, setActionNotice: text => calls.push(text), errorMessage: error => error.message,
    appWindow: { show: async () => { calls.push('show'); }, setFocus: async () => {} },
  };
  vm.createContext(ctx); vm.runInContext(script, ctx); const cleanup = ctx.mountQuit();
  const quitting = ctx.window.__requestAppQuit();
  assert.deepEqual(calls, []);
  finish(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, [], 'main exit also waits for sensitivity persistence');
  finishSensitivity(); await quitting;
  assert.deepEqual(calls, ['quit_app']);
  calls.length = 0;
  ctx.sensitivityWriter.flush = async () => {};
  ctx.configWriter.flush = async () => { throw Error('fixture denied'); };
  await ctx.window.__requestAppQuit();
  assert.equal(calls.includes('quit_app'), false);
  assert.match(calls[0], /fixture denied/); assert.equal(calls[1], 'show');
  calls.length = 0; ctx.configWriter.persistenceBlocked = true;
  await ctx.window.__requestAppQuit();
  assert.deepEqual(calls, ['quit_app']);
  cleanup(); assert.equal(ctx.window.__requestAppQuit, undefined);
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

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
  let resolve;
  const states = {};
  const saves = [];
  const ctx = { configLoadedRef: { current: false }, subRegionRef: { current: null }, DEFAULT_APPEARANCE: {}, DEFAULT_SHORTCUTS: {}, mergeAppearance: (_, saved) => saved ?? {},
    invoke: (cmd, args) => {
      if (cmd === 'load_app_config') return new Promise(r => { resolve = r; });
      if (cmd === 'save_app_config') saves.push(args.config);
      return Promise.resolve();
    },
  };
  for (const name of ['EngineMode', 'MainClose', 'UiLayout', 'Theme', 'AccentColor', 'Appearance', 'Shortcuts', 'ConflictHint', 'SourceLang', 'TargetLang', 'StreamOn', 'NumCtx', 'IndependentLang', 'ModeLangs', 'ClipAuto', 'AudioDenoise', 'Providers', 'ActiveProviderId', 'SubFps', 'SubMode', 'SubEngine', 'SubRegion']) ctx['set' + name] = v => { states[name] = v; };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  const cleanup = ctx.hydrate();
  return { ctx, states, saves, cleanup, load: async () => { resolve(config); await new Promise(r => setImmediate(r)); } };
}

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
  assert.equal(h.saves.length, 1);
  assert.equal(h.saves[0].configVersion, 3);
  assert.equal(JSON.stringify(h.saves[0].settings), JSON.stringify(settings));
  assert.equal(JSON.stringify(h.saves[0].providers[0].models), '["chosen"]');
});

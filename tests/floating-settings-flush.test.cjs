const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const load = require('./load-ts.cjs');
const { FloatingOpacityWriter } = load('interface/floatingAppearance');
const { AudioSensitivityWriter } = load('audio-sensitivity');

function effect(file, marker) {
  const source = fs.readFileSync(path.resolve(__dirname, '../src', file), 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  let callback;
  function walk(node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect' && node.arguments[0].getText(ast).includes(marker)) callback = node.arguments[0].getText(ast);
    ts.forEachChild(node, walk);
  }
  walk(ast); assert.ok(callback, marker);
  return context => {
    vm.createContext(context);
    vm.runInContext(ts.transpileModule(`var mount = ${callback};`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, context);
    return context.mount();
  };
}
const floatEffect = effect('interface/useFloatingAppearance.ts', '__flushFloatingSettings');
const audioEffect = effect('App.tsx', '__flushAudioSettings');
const tick = () => new Promise(resolve => setImmediate(resolve));

test('the actual floating exit boundary waits for both opacity and audio settings', async () => {
  let finishOpacity, finishAudio, done = false;
  const ctx = { window: { __flushAudioSettings: () => new Promise(resolve => { finishAudio = resolve; }) },
    writer: { flush: () => new Promise(resolve => { finishOpacity = resolve; }) },
  };
  const cleanup = floatEffect(ctx);
  const pending = ctx.window.__flushFloatingSettings().then(() => { done = true; });
  finishOpacity(); await tick(); assert.equal(done, false);
  finishAudio(); await pending; assert.equal(done, true);
  cleanup(); assert.equal(ctx.window.__flushFloatingSettings, undefined);
});

test('floating and audio flush cleanup preserve a newer mounted handler', () => {
  const completion = Promise.resolve();
  const replacement = () => completion;
  const floating = { window: {}, writer: { flush: replacement } };
  const cleanupFloating = floatEffect(floating);
  floating.window.__flushFloatingSettings = replacement;
  cleanupFloating(); assert.equal(floating.window.__flushFloatingSettings, replacement);
  const audio = { window: {}, sensitivityWriter: { flush: replacement } };
  const cleanupAudio = audioEffect(audio);
  assert.equal(audio.window.__flushAudioSettings(), completion);
  audio.window.__flushAudioSettings = replacement;
  cleanupAudio(); assert.equal(audio.window.__flushAudioSettings, replacement);
});

test('opacity flush does not acknowledge until the final coalesced position is saved', async () => {
  const writes = []; const finish = []; let done = false;
  const writer = new FloatingOpacityWriter((_, value) => { writes.push(value); return new Promise(resolve => finish.push(resolve)); });
  writer.update('floating', 80); writer.update('audio', 60); writer.update('audioMic', 44);
  const pending = writer.flush().then(() => { done = true; });
  finish.shift()(); await tick();
  assert.deepEqual(writes, [80, 44]); assert.equal(done, false);
  finish.shift()(); await pending; assert.equal(done, true);
});

test('the actual audio flush boundary includes native apply completion after the final sensitivity write', async () => {
  let finishApply, done = false;
  const writer = new AudioSensitivityWriter(async name => {
    if (name === 'audio_apply_sensitivity') await new Promise(resolve => { finishApply = resolve; });
  });
  writer.update('en', 1.7, true);
  const ctx = { window: {}, sensitivityWriter: writer };
  const cleanup = audioEffect(ctx);
  const pending = ctx.window.__flushAudioSettings().then(() => { done = true; });
  await tick(); assert.equal(done, false);
  finishApply(); await pending; assert.equal(done, true);
  cleanup(); assert.equal(ctx.window.__flushAudioSettings, undefined);
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { commitAudioSensitivity, AudioSensitivityWriter } = require('./load-ts.cjs')('audio-sensitivity');

test('final audio sensitivity is committed before the running recognizer is rebuilt', async () => {
  const calls = []; let finishWrite;
  const command = async (name, args) => {
    calls.push([name, args]);
    if (name === 'audio_set_sensitivity') await new Promise(resolve => { finishWrite = resolve; });
  };
  const pending = commitAudioSensitivity(command, 'en', 1.7);
  assert.deepEqual(calls, [['audio_set_sensitivity', { lang: 'en', value: 1.7 }]]);
  finishWrite(); await pending;
  assert.deepEqual(calls[1], ['audio_apply_sensitivity', { lang: 'en' }]);
});

test('a failed final sensitivity write does not apply the stale previous value', async () => {
  const calls = [];
  await assert.rejects(commitAudioSensitivity(async name => { calls.push(name); throw Error('write failed'); }, 'ja', 2.3), /write failed/);
  assert.deepEqual(calls, ['audio_set_sensitivity']);
});

test('an in-flight live write cannot overwrite a later final sensitivity commit', async () => {
  const calls = []; let completeFirst;
  const writer = new AudioSensitivityWriter(async (name, args) => {
    calls.push([name, args]);
    if (calls.length === 1) await new Promise(resolve => { completeFirst = resolve; });
  });
  writer.update('en', 1.2, false);
  const final = writer.update('en', 1.7, true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 1);
  completeFirst(); await final;
  assert.deepEqual(calls, [
    ['audio_set_sensitivity', { lang: 'en', value: 1.2 }],
    ['audio_set_sensitivity', { lang: 'en', value: 1.7 }],
    ['audio_apply_sensitivity', { lang: 'en' }],
  ]);
});

test('failed sensitivity remains dirty even when a different language later saves successfully', async () => {
  const attempts = []; let failing = true;
  const writer = new AudioSensitivityWriter(async (name, args) => {
    attempts.push([name, args]);
    if (name === 'audio_set_sensitivity' && args.lang === 'en' && failing) throw Error('disk full');
  });
  await assert.rejects(writer.update('en', 1.7, true), /disk full/);
  await writer.update('ja', 2.3, true);
  await assert.rejects(writer.flush(), /disk full/);
  failing = false; await writer.flush();
  assert.deepEqual(attempts.slice(-2), [
    ['audio_set_sensitivity', { lang: 'en', value: 1.7 }],
    ['audio_apply_sensitivity', { lang: 'en' }],
  ]);
});

test('retrying sensitivity after a failed old request uses the latest value for that language', async () => {
  const attempts = []; let failFirst;
  const writer = new AudioSensitivityWriter(async (name, args) => {
    attempts.push([name, args]);
    if (attempts.length === 1) await new Promise((_, reject) => { failFirst = reject; });
  });
  const first = writer.update('en', 1.2, true);
  await new Promise(resolve => setImmediate(resolve));
  const latest = writer.update('en', 1.7, true);
  failFirst(Error('temporary failure')); await assert.rejects(first, /temporary failure/);
  await latest; await writer.flush();
  assert.deepEqual(attempts, [
    ['audio_set_sensitivity', { lang: 'en', value: 1.2 }],
    ['audio_set_sensitivity', { lang: 'en', value: 1.7 }],
    ['audio_apply_sensitivity', { lang: 'en' }],
  ]);
});

test('the audio floating live throttle keeps the most recent displayed value and final apply uses it', async () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/App.tsx'), 'utf8');
  const ast = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const audio = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'AudioFloatingWindow');
  const declarations = audio.body.statements.filter(ts.isVariableStatement).flatMap(statement => [...statement.declarationList.declarations]);
  const change = declarations.find(node => node.name.getText(ast) === 'changeSens').initializer.getText(ast);
  const apply = declarations.find(node => node.name.getText(ast) === 'applySens').initializer.getText(ast);
  const calls = [];
  const ctx = { Date: { now: () => 50 }, sensThrottleRef: { current: 0 }, displayed: {}, errorMessage: String,
    setSens: update => { ctx.displayed = update(ctx.displayed); }, setSensitivityError() {},
    invoke: async (name, args) => calls.push([name, args]),
  };
  ctx.sensitivityWriter = new AudioSensitivityWriter(ctx.invoke);
  vm.createContext(ctx);
  vm.runInContext(ts.transpileModule(`var change = ${change}; var apply = ${apply};`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, ctx);
  ctx.change('en', 1.7);
  assert.equal(ctx.displayed.en, 1.7); assert.equal(calls.length, 0);
  ctx.apply('en', 1.7); await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls[0][0], 'audio_set_sensitivity'); assert.equal(calls[0][1].value, 1.7);
  assert.equal(calls[1][0], 'audio_apply_sensitivity');
});

test('main Settings persists a throttled final value in order before applying it', async () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/App.tsx'), 'utf8');
  const ast = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const main = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'MainWindow');
  const declarations = main.body.statements.filter(ts.isVariableStatement).flatMap(statement => [...statement.declarationList.declarations]);
  const change = declarations.find(node => node.name.getText(ast) === 'setSensitivityForLang').initializer.getText(ast);
  const apply = declarations.find(node => node.name.getText(ast) === 'applySensitivityForLang').initializer.getText(ast);
  const calls = []; let completeFirst; let now = 200;
  const ctx = { Date: { now: () => now }, sensitivityThrottleRef: { current: 0 }, displayed: {}, errorMessage: String,
    setSensitivities: update => { ctx.displayed = update(ctx.displayed); }, setActionNotice() {},
    invoke: async (name, args) => {
      calls.push([name, args]);
      if (calls.length === 1) await new Promise(resolve => { completeFirst = resolve; });
    },
  };
  ctx.sensitivityWriter = new AudioSensitivityWriter(ctx.invoke);
  vm.createContext(ctx);
  vm.runInContext(ts.transpileModule(`var change = ${change}; var apply = ${apply};`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, ctx);
  ctx.change('ja', 1.2); await new Promise(resolve => setImmediate(resolve));
  now = 250; ctx.change('ja', 1.7); ctx.apply('ja', 1.7);
  assert.equal(ctx.displayed.ja, 1.7);
  assert.equal(calls.length, 1);
  completeFirst(); await ctx.sensitivityWriter.flush();
  assert.equal(calls[1][0], 'audio_set_sensitivity'); assert.equal(calls[1][1].value, 1.7);
  assert.equal(calls[2][0], 'audio_apply_sensitivity');
});

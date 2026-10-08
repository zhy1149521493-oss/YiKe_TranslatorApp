const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const load = require('./load-ts.cjs');
const { AudioTaskQueue, updateAudioLine, applyAudioResult } = load('audio-tasks');
const { boundedRequest } = load('request');
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const job = (id, text, isFinal = false, source = 'system', session = 1) => ({ id, text, isFinal, source, session });

test('queued final is retained when the next utterance produces partials', async () => {
  const queue = new AudioTaskQueue();
  const gate = deferred(); const calls = [];
  queue.enqueue(job('1:0', 'first'), async () => { await gate.promise; });
  const run = async value => { calls.push([value.id, value.text, value.isFinal]); };
  queue.enqueue(job('1:0', 'first complete', true), run);
  queue.enqueue(job('1:1', 'next'), run);
  queue.enqueue(job('1:1', 'next complete'), run);
  gate.resolve(); await flush();
  assert.deepEqual(calls, [['1:0', 'first complete', true], ['1:1', 'next complete', false]]);
});

test('history matches source/utterance IDs even when both sources say identical text', () => {
  let history = [];
  const system = job('1:0', 'same', true);
  const mic = job('2:0', 'same', false, 'mic', 2);
  history = updateAudioLine(history, system);
  history = updateAudioLine(history, mic);
  history = applyAudioResult(history, system, 'system translation');
  assert.equal(history.find(line => line.id === '1:0').result, 'system translation');
  assert.equal(history.find(line => line.id === '2:0').result, '');
  assert.deepEqual(updateAudioLine(history, system), history, 'duplicate final cannot roll history again');
  const outdated = job('2:0', 'sa');
  assert.deepEqual(applyAudioResult(history, outdated, 'outdated'), history);
  assert.deepEqual(applyAudioResult(history, job('1:0', 'same'), 'partial'), history, 'partial cannot overwrite a finalized line');
});

test('invalidating a session discards pending work and rejects late writes', async () => {
  const queue = new AudioTaskQueue(); const gate = deferred(); const writes = [];
  queue.enqueue(job('1:0', 'old'), async (value, context) => {
    await gate.promise;
    if (context.isCurrent()) writes.push(value.text);
  });
  queue.enqueue(job('1:1', 'queued final', true), async value => { writes.push(value.text); });
  queue.invalidate();
  queue.enqueue(job('2:0', 'new', true, 'system', 2), async value => { writes.push(value.text); });
  gate.resolve(); await flush();
  assert.deepEqual(writes, ['new']);
});

test('queue remains bounded while preserving the newest final markers', async () => {
  const queue = new AudioTaskQueue(); const gate = deferred(); const calls = [];
  queue.enqueue(job('0', 'running'), async () => { await gate.promise; });
  for (let i = 1; i <= 10; i++) queue.enqueue(job(String(i), String(i), true), async value => { calls.push(value.id); });
  gate.resolve(); await flush();
  assert.deepEqual(calls, ['8', '9', '10']);
});

// Exercise the real MainWindow submit callback, not a copy of its implementation.
const source = fs.readFileSync(path.resolve(__dirname, '../src/App.tsx'), 'utf8');
const ast = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback;
function walk(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'submitAudioSubtitle') callback = node.initializer.arguments[0];
  ts.forEachChild(node, walk);
}
walk(ast);
assert.ok(callback);
const code = ts.transpileModule('var submit = ' + callback.getText(ast) + ';', { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;

test('real audio callback forwards the final identity and updates its own history line', async () => {
  const gate = deferred(); const forwarded = []; const states = { history: [], status: {} };
  let first = true;
  const ctx = {
    audioQueues: { system: new AudioTaskQueue(), mic: new AudioTaskQueue() },
    audioDesiredRef: { current: { system: true, mic: true } }, audioSessionsRef: { current: { system: 1, mic: 2 } },
    langFor: () => ({ src: 'en', tgt: 'zh' }), model: 'mock', numCtx: 1024,
    translateFull: async (_model, _src, _tgt, text, _ctx, signal) => boundedRequest(async () => { if (first) { first = false; await gate.promise; } return 'translated ' + text; }, signal),
    invoke: async (_cmd, payload) => { forwarded.push(payload); },
    applyAudioResult, errorMessage: String,
    setAudioHist: fn => { states.history = fn(states.history); }, setAudioStatus: fn => { states.status = fn(states.status); },
  };
  vm.createContext(ctx); vm.runInContext(code, ctx);
  const firstPartial = job('1:0', 'first'); ctx.submit(firstPartial);
  const final = job('1:0', 'first complete', true); states.history = updateAudioLine(states.history, final); ctx.submit(final);
  const next = job('1:1', 'next'); states.history = updateAudioLine(states.history, next); ctx.submit(next);
  gate.resolve(); await flush();
  assert.equal(states.history.find(line => line.id === final.id).result, 'translated first complete');
  const finalForward = forwarded.find(value => value.id === final.id && value.role === 'prev');
  assert.equal(finalForward.text, final.text); assert.equal(finalForward.session, 1);
  assert.equal(states.history.find(line => line.id === next.id).result, 'translated next');
});

let eventEffect;
let controlEffect;
function findEffects(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect') {
    const text = node.arguments[0].getText(ast);
    if (text.includes('"audio-status"')) eventEffect = node.arguments[0];
    if (text.includes('appWindow.listen("subtitle-start"')) controlEffect = node.arguments[0];
  }
  ts.forEachChild(node, findEffects);
}
findEffects(ast);

test('real audio event listeners ignore stopped/old sessions and isolate both sources', async () => {
  const listeners = {}; const submitted = []; const states = { history: [], status: {}, on: {} };
  const ctx = {
    appWindow: { listen: async (name, handler) => { listeners[name] = handler; return () => { delete listeners[name]; }; } },
    audioDesiredRef: { current: { system: true, mic: true } }, audioSessionsRef: { current: {} }, audioAcceptRef: { current: {} },
    invalidateAudio: source => { ctx.audioAcceptRef.current[source] = false; },
    submitAudioRef: { current: value => submitted.push(value) }, updateAudioLine,
    setAudioHist: fn => { states.history = fn(states.history); },
    setAudioStatus: fn => { states.status = fn(states.status); }, setAudioSubOn: fn => { states.on = fn(states.on); },
    setAudioPartial: () => {}, setAudioLevel: () => {}, invoke: async () => {},
  };
  vm.createContext(ctx);
  vm.runInContext(ts.transpileModule('var start = ' + eventEffect.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, ctx);
  const cleanup = ctx.start();
  listeners['audio-status']({ payload: { source: 'system', session: 2, status: 'loading' } });
  listeners['audio-status']({ payload: { source: 'system', session: 2, status: 'ready' } });
  listeners['audio-status']({ payload: { source: 'mic', session: 3, status: 'loading' } });
  listeners['audio-partial']({ payload: job('2:0', 'system', false, 'system', 2) });
  listeners['audio-final']({ payload: job('3:0', 'mic', true, 'mic', 3) });
  listeners['audio-status']({ payload: { source: 'system', session: 1, status: 'stopped' } });
  assert.equal(states.on.system, true, 'old stop event cannot stop a new session');
  listeners['audio-partial']({ payload: job('1:0', 'old', false, 'system', 1) });
  assert.equal(submitted.length, 2);
  assert.equal(submitted[1].isFinal, true);
  ctx.audioDesiredRef.current.system = false;
  listeners['audio-final']({ payload: job('2:0', 'late', true, 'system', 2) });
  listeners['audio-status']({ payload: { source: 'system', session: 4, status: 'ready' } });
  assert.equal(submitted.length, 2, 'explicit stop prevents further work');
  cleanup(); await flush();
  assert.deepEqual(Object.keys(listeners), []);
});

test('floating subtitle start/stop controls remain registered after OCR event removal', async () => {
  const listeners = {}; const calls = [];
  const ctx = {
    appWindow: { listen: async (name, handler) => { listeners[name] = handler; return () => { delete listeners[name]; }; } },
    startSubtitleRef: { current: () => calls.push('start') }, stopSubtitleRef: { current: () => calls.push('stop') },
  };
  vm.createContext(ctx);
  vm.runInContext(ts.transpileModule('var start = ' + controlEffect.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, ctx);
  const cleanup = ctx.start();
  listeners['subtitle-start'](); listeners['subtitle-stop']();
  assert.deepEqual(calls, ['start', 'stop']);
  cleanup(); await flush(); assert.deepEqual(Object.keys(listeners), []);
});

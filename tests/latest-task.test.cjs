const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

// Execute the same TypeScript module that Vite builds, without a new runner.
const filename = path.resolve(__dirname, '../src/latest-task.ts');
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;
const loaded = new Module(filename, module);
loaded._compile(compiled, filename);
const { LatestTask, errorMessage } = loaded.exports;
const deferred = () => {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
};

test('clearing input aborts and rejects late output even if transport ignores abort', async () => {
  const queue = new LatestTask();
  const gate = deferred();
  let output = '';
  let signal;
  const request = queue.submit('old', async (value, context) => {
    signal = context.signal;
    await gate.promise;
    if (context.isCurrent()) output = value;
  });
  queue.invalidate();
  assert.equal(signal.aborted, true);
  gate.resolve();
  await request;
  assert.equal(output, '');
});

test('one request in flight; only the newest queued text and settings run', async () => {
  const queue = new LatestTask();
  const gate = deferred();
  const calls = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const first = queue.submit('A', async () => {
    maxInFlight = Math.max(maxInFlight, ++inFlight);
    await gate.promise;
    inFlight--;
  });
  const superseded = queue.submit('B', async value => { calls.push([value, 'old settings']); });
  const newest = queue.submit('C', async value => {
    maxInFlight = Math.max(maxInFlight, ++inFlight);
    calls.push([value, 'new settings']);
    inFlight--;
  });
  gate.resolve();
  await Promise.all([first, superseded, newest]);
  assert.deepEqual(calls, [['C', 'new settings']]);
  assert.equal(maxInFlight, 1);
});

test('clearing input also removes a queued request', async () => {
  const queue = new LatestTask();
  const gate = deferred();
  let queuedRan = false;
  const first = queue.submit('A', async () => { await gate.promise; });
  const second = queue.submit('B', async () => { queuedRan = true; });
  queue.invalidate();
  gate.resolve();
  await Promise.all([first, second]);
  assert.equal(queuedRan, false);
});

test('a rejected request releases the queue for the newest request', async () => {
  const queue = new LatestTask();
  const gate = deferred();
  const first = queue.submit('A', async () => { await gate.promise; throw 'API 401'; });
  const rejection = assert.rejects(first, error => error === 'API 401');
  let ran = false;
  const second = queue.submit('B', async () => { ran = true; });
  gate.resolve();
  await Promise.all([rejection, second]);
  assert.equal(ran, true);
});

test('UI preserves Tauri string errors and browser Error messages', () => {
  assert.equal(errorMessage('API 401: invalid key'), 'API 401: invalid key');
  assert.equal(errorMessage(new Error('connection failed')), 'connection failed');
});

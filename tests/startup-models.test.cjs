const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startupModels } = require('./load-ts.cjs')('startup-models');

test('cold local service retries failures then accepts the real model list', async () => {
  let calls = 0; let pauses = 0;
  const list = await startupModels(async () => { if (++calls < 3) throw Error('not listening'); return ['fixture']; }, new AbortController().signal, async () => { pauses++; });
  assert.deepEqual(list, ['fixture']); assert.equal(calls, 3); assert.equal(pauses, 2);
});

test('an installed service with no models is not mistaken for a startup failure', async () => {
  let calls = 0;
  assert.deepEqual(await startupModels(async () => { calls++; return []; }, new AbortController().signal, async () => { throw Error('unexpected retry'); }), []);
  assert.equal(calls, 1);
});

test('model startup is bounded and ignores cancelled startup work', async () => {
  let calls = 0;
  await assert.rejects(startupModels(async () => { calls++; throw Error('offline'); }, new AbortController().signal, async () => {}, 3), /offline/);
  assert.equal(calls, 3);
  const controller = new AbortController();
  await assert.rejects(startupModels(async () => { controller.abort(); throw Error('cancelled'); }, controller.signal, async () => { throw Error('unexpected retry'); }));
  calls = 0; controller.abort();
  await assert.rejects(startupModels(async () => { calls++; return []; }, controller.signal));
  assert.equal(calls, 0);
});

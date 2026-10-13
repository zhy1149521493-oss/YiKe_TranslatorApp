const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ConfigWriter, configChanges, mergeConfig } = require('./load-ts.cjs')('config-writer');

test('changed-field patches preserve other windows and allow array removal and null clearing', () => {
  const stored = { providers: [{ id: 'one' }], settings: { appearance: { floating: { opacity: 60 } }, translate: { futureOption: true, model: 'a' }, subtitle: { region: { x: 1 } } } };
  const patch = configChanges(stored, { providers: [], settings: { translate: { model: 'b' }, subtitle: { region: null } } });
  assert.deepEqual(patch, { providers: [], settings: { translate: { model: 'b' }, subtitle: { region: null } } });
  assert.deepEqual(mergeConfig(stored, patch), {
    providers: [], settings: { appearance: { floating: { opacity: 60 } }, translate: { futureOption: true, model: 'b' }, subtitle: { region: null } },
  });
});

test('a preference change starts saving immediately and serializes rapid edits', async () => {
  const writes = []; let release;
  const writer = new ConfigWriter(patch => { writes.push(patch); return new Promise(resolve => { release = resolve; }); }, () => {});
  writer.hydrate({ settings: { theme: 'light' } });
  const saving = writer.update({ settings: { theme: 'dark' } });
  assert.equal(writes.length, 1, 'no timer waits before the first IPC write');
  writer.update({ settings: { theme: 'system' } });
  writer.update({ settings: { theme: 'light', translate: { model: 'fixture' } } });
  assert.equal(writes.length, 1, 'only one write may be in flight');
  release(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(writes[1], { settings: { theme: 'light', translate: { model: 'fixture' } } });
  release(); await saving;
  await writer.flush();
  assert.equal(writes.length, 2);
});

test('external shared opacity rebases pending state rather than being echoed by unrelated edits', async () => {
  const writes = [];
  const writer = new ConfigWriter(async patch => { writes.push(patch); }, () => {});
  writer.hydrate({ settings: { theme: 'light', appearance: { floating: { opacity: 88 } } } });
  writer.acceptExternal({ settings: { appearance: { floating: { opacity: 45 } } } });
  await writer.update({ settings: { theme: 'dark', appearance: { floating: { opacity: 45 } } } });
  assert.deepEqual(writes, [{ settings: { theme: 'dark' } }]);
});

test('save failure remains dirty, reports failure and can be retried before closing', async () => {
  let fail = true; const errors = []; const writes = [];
  const writer = new ConfigWriter(async patch => { if (fail) throw Error('fixture denied'); writes.push(patch); }, error => errors.push(error));
  writer.hydrate({ settings: { theme: 'light' } });
  await assert.rejects(writer.update({ settings: { theme: 'dark' } }), /fixture denied/);
  assert.equal(errors.length, 1);
  fail = false;
  await writer.flush();
  assert.deepEqual(writes, [{ settings: { theme: 'dark' } }]);
});

test('a partial floating broadcast preserves an unrelated main appearance edit in flight', async () => {
  const writes = []; let release;
  const writer = new ConfigWriter(patch => { writes.push(patch); return new Promise(resolve => { release = resolve; }); }, () => {});
  writer.hydrate({ settings: { appearance: { main: { fontSize: 22 }, floating: { opacity: 88 } } } });
  const saving = writer.update({ settings: { appearance: { main: { fontSize: 28 } } } });
  writer.acceptExternal({ settings: { appearance: { floating: { opacity: 45 }, audio: { opacity: 45 } } } });
  release(); await saving;
  await writer.update({ settings: { appearance: { main: { fontSize: 28 }, floating: { opacity: 45 }, audio: { opacity: 45 } } } });
  assert.deepEqual(writes, [{ settings: { appearance: { main: { fontSize: 28 } } } }]);
});

test('a no-change microtask cannot swallow a new update and failed loads block writes', async () => {
  const writes = []; const writer = new ConfigWriter(async patch => { writes.push(patch); }, () => {});
  writer.hydrate({ settings: { theme: 'light' } });
  const idle = writer.flush();
  const changed = writer.update({ settings: { theme: 'dark' } });
  await Promise.all([idle, changed]);
  assert.deepEqual(writes, [{ settings: { theme: 'dark' } }]);
  writer.block(Error('unreadable configuration'));
  await assert.rejects(writer.update({ settings: { theme: 'light' } }), /unreadable configuration/);
  assert.equal(writes.length, 1);
});

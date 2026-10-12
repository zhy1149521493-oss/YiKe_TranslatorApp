const { test } = require('node:test');
const assert = require('node:assert/strict');
const { StyleWindowSizing, windowSizePlan, restoreWindowSizes } = require('./load-ts.cjs')('interface/windowSizing');
const pause = () => new Promise(resolve => setTimeout(resolve, 340));
function fixture(saved = {}) {
  const f = { state: { size: { width: 960, height: 640 }, maximized: false, area: { width: 1707, height: 1019 } }, applied: [], saved: [], errors: [] };
  f.manager = new StyleWindowSizing({
    snapshot: async () => ({ ...f.state, size: { ...f.state.size } }),
    apply: async (plan, snapshot) => { f.applied.push(plan); if (!snapshot.maximized) f.state.size = plan.size; },
    save: sizes => f.saved.push(sizes), error: error => f.errors.push(error),
  }, saved);
  return f;
}
test('style defaults use portrait Poetry, landscape alternatives and monitor work-area limits', () => {
  assert.deepEqual(windowSizePlan('poetry').size, { width: 640, height: 860 });
  for (const style of ['workbench', 'classic']) assert.deepEqual(windowSizePlan(style).size, { width: 960, height: 640 });
  const small = windowSizePlan('poetry', undefined, { width: 900, height: 700 });
  assert.equal(small.size.height, 668);
  assert.ok(small.size.width < small.size.height);
  const tiny = windowSizePlan('classic', undefined, { width: 600, height: 450 });
  assert.ok(tiny.size.width <= 568 && tiny.size.height <= 418);
});
test('saved dimensions are validated and custom portrait/landscape choices are respected', () => {
  assert.deepEqual(restoreWindowSizes('{bad'), {});
  assert.deepEqual(restoreWindowSizes('{"poetry":{"width":640.4,"height":900},"classic":{"width":-1,"height":0},"unknown":{"width":800,"height":600}}'), { poetry: { width: 640, height: 900 } });
  assert.deepEqual(windowSizePlan('poetry', { width: 1000, height: 600 }).size, { width: 1000, height: 600 });
});
test('manual normal sizes are independent and programmatic default resize is not saved as customization', async () => {
  const f = fixture();
  await f.manager.select('poetry');
  f.manager.resized(); await pause();
  assert.equal(f.saved.length, 0);
  f.state.size = { width: 680, height: 920 };
  await f.manager.select('workbench');
  f.state.size = { width: 1100, height: 700 };
  await f.manager.select('poetry');
  assert.deepEqual(f.state.size, { width: 680, height: 920 });
  await f.manager.select('workbench');
  assert.deepEqual(f.state.size, { width: 1100, height: 700 });
  f.manager.dispose();
});
test('maximized switching preserves maximization and restores the incoming normal size without saving fullscreen dimensions', async () => {
  const f = fixture();
  await f.manager.select('workbench');
  f.state = { ...f.state, maximized: true, size: { width: 1707, height: 1019 } };
  await f.manager.select('poetry');
  assert.equal(f.state.maximized, true);
  assert.equal(f.saved.length, 0);
  f.state = { ...f.state, maximized: false, size: { width: 960, height: 640 } };
  f.manager.resized(); await pause();
  assert.deepEqual(f.state.size, { width: 640, height: 860 });
  assert.equal(f.saved.length, 0);
  f.manager.dispose();
});
test('rapid switches discard stale snapshots and disposed managers cannot apply delayed work', async () => {
  let resolveSnapshot;
  const applied = [];
  const manager = new StyleWindowSizing({ snapshot: () => new Promise(resolve => { resolveSnapshot = resolve; }), apply: async plan => applied.push(plan), save() {}, error: assert.fail }, {});
  const first = manager.select('poetry'); await Promise.resolve();
  const last = manager.select('classic');
  resolveSnapshot({ size: { width: 960, height: 640 }, maximized: false });
  await first; await Promise.resolve();
  manager.dispose();
  resolveSnapshot({ size: { width: 960, height: 640 }, maximized: false });
  await last;
  assert.equal(applied.length, 0);
});
test('failed native sizing reports once and subsequent style switches recover', async () => {
  const f = fixture();
  let broken = true;
  f.manager = new StyleWindowSizing({ snapshot: async () => f.state, apply: async plan => { if (broken) throw Error('native failure'); f.state.size = plan.size; }, save() {}, error: error => f.errors.push(error) }, {});
  await f.manager.select('poetry'); broken = false;
  await f.manager.select('classic');
  assert.equal(f.errors.length, 1);
  assert.deepEqual(f.state.size, { width: 960, height: 640 });
  f.manager.dispose();
});

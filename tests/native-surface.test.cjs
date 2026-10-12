const { test } = require('node:test');
const assert = require('node:assert/strict');
const { navigationSurface, SurfaceAnimator } = require('./load-ts.cjs')('interface/nativeSurface');
const rect = (x, y, width, height) => ({ x, y, width, height });
const full = { ...rect(0, 0, 960, 640), radius: 0 };
const tick = () => new Promise(resolve => setImmediate(resolve));

test('opening or closing a popup refreshes an unchanged folded native surface', async () => {
  const calls = [];
  const animator = new SurfaceAnimator(async bounds => calls.push(bounds), async () => 0, () => 0, error => { throw error; });
  const nav = { ...rect(100, 24, 740, 68), radius: 34 };
  animator.update(nav, full, 0, 'no-menu'); await tick();
  animator.update(nav, full, 0, 'menu-visible'); await tick();
  animator.update(nav, full, 0, 'no-menu'); await tick();
  assert.equal(calls.length, 3);
  assert.deepEqual(calls, [nav, nav, nav]);
});

test('folded desktop bounds fit each original navigation silhouette and logo', () => {
  const rail = rect(0, 0, 198, 640);
  const poetry = rect(110, 24, 740, 68);
  const classic = rect(0, 0, 960, 230);
  assert.deepEqual(navigationSurface(rail, rect(20, 30, 42, 42), true, false), { ...rail, radius: 10 });
  assert.deepEqual(navigationSurface(poetry, rect(142, 37, 42, 42), true, true), { ...poetry, radius: 34 });
  assert.deepEqual(navigationSurface(classic, rect(24, 8, 42, 42), true, false), { ...classic, radius: 10 });
  assert.deepEqual(navigationSurface(poetry, rect(142, 37, 42, 42), false, true), { ...rect(459, 37, 42, 42), radius: 21 });
  assert.deepEqual(navigationSurface(rail, rect(20, 30, 42, 42), false, false), { ...rect(20, 30, 42, 42), radius: 21 });
});

test('rapid reopen supersedes an in-flight fold without overlapping native calls', async () => {
  const calls = []; let release; let time = 0; let active = 0; let maxActive = 0;
  const animator = new SurfaceAnimator(async bounds => {
    active++; maxActive = Math.max(maxActive, active); calls.push(bounds);
    if (calls.length === 1) await new Promise(resolve => { release = resolve; });
    active--;
  }, async () => (time += 120), () => time, error => { throw error; });
  animator.update({ ...rect(0, 0, 198, 640), radius: 10 }, full, 240);
  animator.update(null, full, 0);
  release(); await tick();
  assert.equal(maxActive, 1);
  assert.equal(calls.at(-1), null);
  assert.equal(calls.length, 2);
});

test('reduced-motion updates are immediate and failures restore the whole surface', async () => {
  const calls = []; const errors = [];
  const animator = new SurfaceAnimator(async bounds => {
    calls.push(bounds); if (bounds) throw Error('native error');
  }, () => { throw Error('unexpected animated frame'); }, () => 0, e => errors.push(e.message));
  animator.update({ ...rect(0, 0, 198, 640), radius: 10 }, full, 0);
  await tick();
  assert.deepEqual(errors, ['native error']);
  assert.equal(calls.at(-1), null);
  animator.dispose();
  animator.update(null, full, 0);
  assert.equal(calls.length, 2);
});

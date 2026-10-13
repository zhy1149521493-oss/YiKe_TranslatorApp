const { test } = require('node:test');
const assert = require('node:assert/strict');
const { BrandDragGesture } = require('./load-ts.cjs')('interface/brandDrag');

test('brand jitter remains a click; deliberate drag starts once and consumes its click', () => {
  const gesture = new BrandDragGesture();
  gesture.press(100, 80);
  assert.equal(gesture.move(102, 82), false);
  gesture.release();
  assert.equal(gesture.consumeClick(), false);
  gesture.press(100, 80);
  assert.equal(gesture.move(105, 80), true);
  assert.equal(gesture.move(150, 80), false);
  gesture.release();
  assert.equal(gesture.consumeClick(), true);
  assert.equal(gesture.consumeClick(), false);
  gesture.press(100, 80);
  assert.equal(gesture.consumeClick(), false);
});

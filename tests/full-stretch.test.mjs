import test from 'node:test';
import assert from 'node:assert/strict';
import { playerViewport } from '../website/player/viewport.js';
import { displayConfig, displayMarkup } from '../website/player/display.js';
import { initialRenderBudget, installPerformance } from '../website/player/performance.js';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
test('stretch fills every screen edge with no letterbox offsets', () => {
  for (const [w, h] of [
    [2016, 1232],
    [390, 844],
    [1920, 1080],
    [844, 390],
  ]) {
    const value = playerViewport(w, h, 'full', 0, null, null, true, 16 / 9);
    assert.equal(value.left, 0);
    assert.equal(value.top, 0);
    assert.ok(Math.abs(value.width * value.scaleX - w) < 0.001);
    assert.ok(Math.abs(value.height * value.scaleY - h) < 0.001);
    assert.ok(value.width >= w - 1 && value.height >= h - 1);
    assert.ok(Math.abs(value.width / value.height - 16 / 9) < 0.005);
  }
  const fixed = playerViewport(2016, 1232, 'full', 0, null, { width: 960, height: 600 }, true);
  assert.equal(fixed.width * fixed.scaleX, 2016);
  assert.equal(fixed.height * fixed.scaleY, 1232);
});
test('full-resolution mode does not cap native pixel density or force WebGL quality reductions', () => {
  const context = vm.createContext({ devicePixelRatio: 3, window: { devicePixelRatio: 3 } });
  vm.runInContext('(' + installPerformance.toString() + ')("full")', context);
  assert.equal(context.window.devicePixelRatio, 3);
  assert.equal(context.__timebombPerformanceMode, 'full');
  assert.equal(initialRenderBudget('full', 2, 2), 0);
});
test('Display keeps ratio only, defaults to 16:9, and ignores legacy fit/zoom choices', () => {
  assert.equal(displayConfig(true).ratio, '16:9');
  assert.equal(displayConfig({ mode: 'fit' }).mode, 'stretch');
  assert.equal(displayConfig({ mode: 'zoom' }).mode, 'stretch');
  assert.ok(displayMarkup.includes('data-display-ratio'));
  assert.ok(!displayMarkup.includes('data-display-mode'));
  for (const word of ['Fit', 'Stretch', 'Zoom', 'Scaling'])
    assert.ok(!displayMarkup.includes(word));
  const boot = readFileSync(new URL('../website/player/boot.js', import.meta.url), 'utf8');
  assert.match(boot, /let performanceMode\s*=\s*'auto'/);
  assert.ok(!boot.includes('data-display-mode'));
  assert.ok(!boot.includes('Game enhancement'));
});

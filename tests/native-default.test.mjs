import test from 'node:test';
import assert from 'node:assert/strict';
import { playerViewport } from '../website/player/viewport.js';
test('full resolution ignores fixed author dimensions without squishing the outer frame', () => {
  for (const [w, h] of [
    [2016, 1232],
    [390, 844],
    [1920, 1080],
  ]) {
    const layout = playerViewport(w, h, 'full', 0, null, { width: 960, height: 600 }, true);
    assert.equal(layout.width, w);
    assert.equal(layout.height, h);
    assert.equal(layout.scaleX, 1);
    assert.equal(layout.scaleY, 1);
  }
});

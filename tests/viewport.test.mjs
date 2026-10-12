import test from 'node:test';
import assert from 'node:assert/strict';
import { playerViewport, fixedGameViewport } from '../website/player/viewport.js';
test('a 960 by 600 fixed game fits the screenshot viewport without cropping or a bottom gap', () => {
  const value = playerViewport(2016, 1232, 'auto', 1280, null, { width: 960, height: 600 });
  assert.ok(Math.abs(value.height * value.scale - 1232) < 0.01);
  assert.equal(value.top, 0);
  assert.ok(value.left > 0);
  assert.ok(value.width * value.scale <= 2016);
});
test('fixed pages and casting are centered without exceeding the screen on phones or desktops', () => {
  for (const [w, h] of [
    [390, 844],
    [844, 390],
    [1920, 1080],
    [2016, 1232],
  ]) {
    for (const [cast, fixed] of [
      [null, { width: 960, height: 600 }],
      [[1920, 1080], null],
    ]) {
      const value = playerViewport(w, h, 'auto', 800, cast, fixed);
      assert.ok(value.width * value.scale <= w + 0.001);
      assert.ok(value.height * value.scale <= h + 0.001);
      assert.ok(value.left >= 0);
      assert.ok(value.top >= 0);
      assert.ok(Math.abs(2 * value.left + value.width * value.scale - w) < 0.001);
      assert.ok(Math.abs(2 * value.top + value.height * value.scale - h) < 0.001);
    }
  }
});
const node = (tag, id, width, height) => ({
  tagName: tag,
  id,
  className: '',
  style: { width, height },
  getAttribute: () => null,
  hasAttribute: () => false,
  querySelector: () => null,
});
test('fixed game containers are detected before the canvas is created, without game-name rules', () => {
  const container = node('DIV', 'gameContainer', '960px', '600px');
  assert.deepEqual(
    fixedGameViewport({
      querySelectorAll: () => [container],
      defaultView: { innerWidth: 1280, innerHeight: 800 },
    }),
    { width: 960, height: 600 },
  );
});
test('responsive canvases, debug overlays, and unrelated fixed-size panels are not expanded', () => {
  const responsive = node('CANVAS', 'unity-canvas', '100%', '100%'),
    debug = node('CANVAS', 'fps', '960px', '600px'),
    modal = node('DIV', 'modal', '960px', '600px');
  assert.equal(fixedGameViewport({ querySelectorAll: () => [responsive, debug, modal] }), null);
  const native = node('CANVAS', 'canvas', '800px', '600px');
  assert.equal(
    fixedGameViewport({
      querySelectorAll: () => [native],
      defaultView: { innerWidth: 800, innerHeight: 600 },
    }),
    null,
  );
});
test('automatic render budgets and original desktop compatibility are preserved for responsive games', () => {
  assert.equal(playerViewport(390, 844, 'native', 0).width, 1280);
  for (const [w, h, budget] of [
    [390, 844, 800],
    [1920, 1080, 640],
    [3840, 2160, 1280],
  ]) {
    const value = playerViewport(w, h, 'auto', budget);
    assert.ok(Math.max(value.width, value.height) <= budget + 2);
    assert.ok(Math.abs(value.width / value.height - w / h) < 0.005);
  }
  assert.equal(playerViewport(0, 0, 'auto', 800), null);
});

test('a responsive stylesheet-sized canvas is not mistaken for its high-DPI buffer', () => {
  const canvas = node('CANVAS', 'canvas', '', '');
  canvas.getAttribute = (name) => (name === 'width' ? '1920' : '1080');
  canvas.getBoundingClientRect = () => ({ width: 800, height: 500 });
  assert.equal(
    fixedGameViewport({
      querySelectorAll: () => [canvas],
      defaultView: { innerWidth: 800, innerHeight: 500 },
    }),
    null,
  );
});

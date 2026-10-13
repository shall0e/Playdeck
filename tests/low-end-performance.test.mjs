import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { installPerformance, initialRenderBudget, adaptiveRenderBudget } from '../website/player/performance.js';
import { validateProfile } from '../website/player/profiles.js';

function runtime(mode) {
  const messages = [];
  let scheduled, surfaceReads = 0;
  class Canvas {
    get width() { surfaceReads++; return 800; }
    get height() { surfaceReads++; return 600; }
    getContext() { return {}; }
    addEventListener() {}
  }
  const nativeRAF = callback => { scheduled = callback; return 42; };
  const context = vm.createContext({
    HTMLCanvasElement: Canvas,
    document: { hidden: false },
    requestAnimationFrame: nativeRAF,
    BroadcastChannel: class {
      postMessage(value) { messages.push(value); }
      close() {}
    },
  });
  vm.runInContext('(' + installPerformance.toString() + ')(' + JSON.stringify(mode) + ',"test")', context);
  const canvas = new Canvas();
  canvas.getContext('webgl2');
  return { context, messages, nativeRAF, surfaceReads: () => surfaceReads,
    frame(now) { let timestamp; assert.equal(context.requestAnimationFrame(value => { timestamp = value; }), 42); scheduled(now); assert.equal(timestamp, now); },
  };
}

test('new profiles choose automatic performance while explicit quality choices survive', () => {
  assert.equal(validateProfile().performance, 'auto');
  for (const mode of ['full', 'native', 'fast']) assert.equal(validateProfile({ performance: mode }).performance, mode);
  assert.equal(initialRenderBudget('auto', 4, 8), 800);
  assert.equal(initialRenderBudget('auto', 8, 2), 800);
  assert.equal(initialRenderBudget('auto', 8, 8), 1280);
});

test('33fps game cadence lowers the low-end budget without changing frame scheduling', () => {
  const game = runtime('auto');
  for (let now = 30; now <= 6120; now += 30) game.frame(now);
  const samples = game.messages.filter(value => value.type === 'cadence');
  assert.ok(samples.length >= 2);
  assert.equal(samples[0].fps, 33);
  assert.equal(adaptiveRenderBudget(800, samples[0], 800), 640);
  // Two canvas dimensions inspected every three seconds, rather than each frame.
  assert.ok(game.surfaceReads() <= 6);
});

test('static quality modes keep native frame callbacks even when failure reporting is enabled', () => {
  for (const mode of ['full', 'native', 'fast']) {
    const game = runtime(mode);
    assert.equal(game.context.requestAnimationFrame, game.nativeRAF);
    game.frame(16);
    assert.equal(game.messages.length, 0);
  }
});

test('automatic resolution recovery waits for sustained headroom and respects the device cap', () => {
  const healthy = { count: 120, slowRatio: 0, p90: 16 };
  assert.equal(adaptiveRenderBudget(640, healthy, 800, false), 640);
  assert.equal(adaptiveRenderBudget(640, healthy, 800, true), 704);
  assert.equal(adaptiveRenderBudget(800, healthy, 800, true), 800);
});

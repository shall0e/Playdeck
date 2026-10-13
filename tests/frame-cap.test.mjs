import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { installFrameCap, adaptiveRenderBudget } from '../website/player/performance.js';
import { createSession, proxyContext, canonicalGameURL } from '../website/player/session.js';
import { readLaunchOptions } from '../website/player/launch-options.js';
import { validateProfile } from '../website/player/profiles.js';
import { bootstrap } from '../website/player/proxy-core.js';

function realm(fps) {
  let id = 0;
  const pending = new Map(), errors = [];
  const native = callback => { pending.set(++id, callback); return id; };
  const context = vm.createContext({
    requestAnimationFrame: native,
    cancelAnimationFrame: id => pending.delete(id),
    reportError: error => errors.push(error),
  });
  vm.runInContext('(' + installFrameCap.toString() + ')(' + fps + ')', context);
  return { context, pending, native, errors, tick(now) {
    const batch = [...pending.values()];
    pending.clear();
    for (const callback of batch) callback(now);
  } };
}

test('caps from 15 through 120 limit callback rate in both page and worker realms', () => {
  for (const fps of [15,30,45,60,75,90,105,120]) {
    const game = realm(fps), timestamps = [];
    const loop = now => { timestamps.push(now); game.context.requestAnimationFrame(loop); };
    game.context.requestAnimationFrame(loop);
    for (let frame = 1; frame <= 240; frame++) game.tick(frame * 1000 / 240);
    assert.ok(Math.abs(timestamps.length - fps) <= 1, fps + ': ' + timestamps.length);
    assert.ok(timestamps.every(now => Math.abs(now * 240 / 1000 - Math.round(now * 240 / 1000)) < 1e-6));
    assert.equal(game.pending.size, 1);
  }
  const uncapped = realm(0);
  assert.equal(uncapped.context.requestAnimationFrame, uncapped.native);
});

test('caps cannot create frames faster than the actual display refresh', () => {
  const game = realm(120);
  let frames = 0;
  const loop = () => { frames++; game.context.requestAnimationFrame(loop); };
  game.context.requestAnimationFrame(loop);
  for (let frame = 1; frame <= 60; frame++) game.tick(frame * 1000 / 60);
  assert.equal(frames, 60);
});

test('frame batching preserves cancellation, next-frame requests and callback exceptions', () => {
  const game = realm(30), calls = [];
  game.context.requestAnimationFrame(() => {
    calls.push('first');
    game.context.cancelAnimationFrame(second);
    game.context.requestAnimationFrame(() => calls.push('next'));
    throw new Error('engine error');
  });
  const second = game.context.requestAnimationFrame(() => calls.push('cancelled'));
  game.context.requestAnimationFrame(() => calls.push('third'));
  game.tick(0);
  assert.deepEqual(calls, ['first','third']);
  assert.equal(game.errors.length, 1);
  game.tick(16.7);
  assert.deepEqual(calls, ['first','third']);
  game.tick(33.4);
  assert.deepEqual(calls, ['first','third','next']);
  assert.equal(game.pending.size, 0);
  const handle = game.context.requestAnimationFrame(() => calls.push('cancelled'));
  game.context.cancelAnimationFrame(handle);
  assert.equal(game.pending.size, 0);
});

test('frame caps survive session routes, profiles and launch URLs without duplicating cached assets', () => {
  for (const fps of [0,15,30,45,60,75,90,105,120]) {
    const session = createSession('https://game.example/', 'auto', {}, fps);
    const context = proxyContext(session.prefix + 'game.example/main.js');
    assert.equal(context.frameCap, fps);
    assert.equal(context.prefix, session.prefix);
    assert.equal(canonicalGameURL('https://player.example' + session.prefix + 'game.example/main.js').pathname, '/player/games/game.example/main.js');
    assert.equal(validateProfile({ frameCap: fps }).frameCap, fps);
    assert.equal(readLaunchOptions(new URLSearchParams('frameCap=' + fps)).frameCap, fps);
    const injected = bootstrap('https://game.example/', 'https://player.example', true, session.prefix);
    assert.ok(injected.includes('installFrameCap'));
    assert.ok(injected.includes('context.frameCap'));
  }
  for (const fps of [-1,1,14,121,Infinity]) {
    assert.throws(() => validateProfile({ frameCap: fps }));
    assert.throws(() => createSession('https://game.example/', 'auto', {}, fps));
    assert.throws(() => readLaunchOptions(new URLSearchParams('frameCap=' + fps)));
  }
});

test('intentional 30 and 45fps cadence does not trigger automatic resolution reduction', () => {
  for (const fps of [30,45]) {
    assert.equal(adaptiveRenderBudget(800, { count:120, slowRatio:0.5, p90:33.4, targetFPS:fps }, 800), 800);
  }
});

test('generated blob workers inherit the game frame cap before executing engine code', async () => {
  const origin = 'https://player.example', blobs = new Map();
  class URLs extends URL {
    static createObjectURL(blob) { const url = 'blob:' + origin + '/' + (blobs.size + 1); blobs.set(url, blob); return url; }
    static revokeObjectURL(url) { blobs.delete(url); }
  }
  class Worker { constructor(url) { this.url = url; } }
  const session = createSession('https://game.example/', 'auto', {}, 30);
  const parent = vm.createContext({ URL: URLs, Blob, Request, Worker, fetch: async () => new Response('ok') });
  vm.runInContext(bootstrap('https://game.example/', origin, true, session.prefix), parent);
  const child = new parent.Worker(parent.URL.createObjectURL(new Blob(['globalThis.engineSawCap = globalThis.__playdeckFrameCapInstalled;'], { type:'text/javascript' })));
  const native = () => 1;
  const runtime = vm.createContext({ URL: URLs, Blob, Request, fetch: async () => new Response('ok'), requestAnimationFrame: native, cancelAnimationFrame() {} });
  vm.runInContext(await blobs.get(child.url).text(), runtime);
  assert.equal(runtime.engineSawCap, true);
  assert.notEqual(runtime.requestAnimationFrame, native);
});

test('FPS limit sits inside Compatibility and Uncapped is the final option', () => {
  const boot = readFileSync(new URL('../website/player/boot.js', import.meta.url), 'utf8');
  const deck = readFileSync(new URL('../website/player/deck.js', import.meta.url), 'utf8');
  assert.match(boot, /\[15,30,45,60,75,90,105,120,0\]/);
  assert.match(deck, /compatibility\.append\(frameCapControl\)/);
});

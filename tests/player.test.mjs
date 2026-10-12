import { iconMarkup as toolbarIcon } from '../website/player/toolbar-icons.js';
import { playerViewport, fixedGameViewport } from '../website/player/viewport.js';
import { initialRenderBudget, reduceRenderBudget } from '../website/player/performance.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import worker, {
  bootstrap,
  DESKTOP_UA,
  rewriteCSS,
  rewriteGameCompatibility,
  installPointerCompatibility,
  installMobilePerformance,
} from '../website/_worker.js';

const boot = readFileSync(new URL('../website/player/boot.js', import.meta.url), 'utf8');
test('blocked mobile storage still mounts the game through the online proxy', async () => {
  const start = boot.slice(
    boot.indexOf('async function start()'),
    boot.indexOf('\ninstallSettings('),
  );
  for (const serviceWorker of [
    undefined,
    {
      getRegistrations: async () => {
        throw new Error('Storage blocked');
      },
    },
  ]) {
    const elements = new Map();
    const calls = [];
    const context = {
      toolbarIcon,
      gameURL: {},
      navigator: { serviceWorker },
      window: { caches: {} },
      worker: undefined,
      location: { origin: 'https://playdeck-1z1.pages.dev' },
      LOCAL: '/player/games/',
      $: (id) => {
        if (!elements.has(id)) elements.set(id, {});
        return elements.get(id);
      },
      gamePath: (prefix) => prefix + 'game.example/',
      mount: (url) => calls.push(url),
      refreshStats: () => calls.push('stats'),
    };
    vm.createContext(context);
    vm.runInContext(start, context);
    await context.start();
    assert.deepEqual(calls, ['/player/games/game.example/']);
    assert.equal(elements.get('#clear').disabled, true);
  }
});

test('sandbox desktop identity is installed before URL hooks, including in workers', async () => {
  const context = vm.createContext({
    navigator: { userAgent: 'Mobile Android', platform: 'Linux', maxTouchPoints: 5 },
    URL,
    Request,
    fetch: () => Promise.resolve(new Response('ok')),
  });
  vm.runInContext(
    bootstrap(
      'https://game.example/',
      'https://playdeck-1z1.pages.dev',
      true,
      '/player/games/',
      'native',
    ),
    context,
  );
  assert.equal(context.navigator.userAgent, DESKTOP_UA);
  assert.equal(context.navigator.platform, 'Win32');
  assert.equal(context.navigator.maxTouchPoints, 0);
  const hints = await context.navigator.userAgentData.getHighEntropyValues([
    'architecture',
    'model',
  ]);
  assert.equal(hints.mobile, false);
  assert.equal(hints.architecture, 'x86');
  assert.equal(hints.model, '');
  const legacy = vm.createContext({
    navigator: { userAgent: 'Mobile Android' },
    URL,
    Request,
    fetch: () => {},
  });
  vm.runInContext(
    bootstrap('https://game.example/', 'https://playdeck-1z1.pages.dev', true),
    legacy,
  );
  assert.equal(legacy.navigator.userAgent, 'Mobile Android');
});
test('sandbox upstream requests present desktop UA and consistent client hints', async () => {
  const previous = globalThis.fetch;
  let sent;
  globalThis.fetch = async (url, options) => {
    sent = options.headers;
    return new Response('data', { headers: { 'Content-Type': 'application/octet-stream' } });
  };
  try {
    const response = await worker.fetch(
      new Request('https://playdeck-1z1.pages.dev/player/games/game.example/data.bin', {
        headers: { 'User-Agent': 'Mobile Android', 'Sec-CH-UA-Mobile': '?1' },
      }),
      {},
    );
    assert.equal(sent.get('user-agent'), DESKTOP_UA);
    assert.equal(sent.get('sec-ch-ua-mobile'), '?0');
    assert.equal(sent.get('sec-ch-ua-platform'), '"Windows"');
    assert.equal(response.headers.get('X-Timebomb-Desktop'), '7');
  } finally {
    globalThis.fetch = previous;
  }
});
test('desktop pointer media queries change only in sandbox styles', () => {
  const css = '@media (pointer:coarse){a{color:red}} @media (hover:hover){a{color:blue}}';
  const sandbox = rewriteCSS(
    css,
    'https://game.example/',
    'https://playdeck-1z1.pages.dev',
    '/player/games/',
  );
  assert.ok(sandbox.includes('(max-width: -1px)'));
  assert.ok(sandbox.includes('(min-width: 0px)'));
  assert.equal(rewriteCSS(css, 'https://game.example/', 'https://playdeck-1z1.pages.dev'), css);
});
test('games without display options show the normal desktop page without canvas enhancement', () => {
  const apply = boot.slice(
    boot.indexOf('function applyDisplay()'),
    boot.indexOf('function setupDisplay('),
  );
  let restored = 0;
  const frame = { style: {} };
  const context = vm.createContext({
    frame,
    gameDisplay: null,
    mobileDevice: false,
    performanceMode: 'native',
    renderBudget: 0,
    innerWidth: 390,
    innerHeight: 844,
    restoreExpandedCanvas: () => restored++,
  });
  Object.assign(context, { playerViewport, fixedGameViewport, fixedViewportDocs: new WeakMap() });
  vm.runInContext(apply, context);
  context.applyDisplay();
  assert.equal(restored, 1);
  assert.equal(frame.style.opacity, '1');
  assert.equal(frame.style.pointerEvents, 'auto');
  assert.equal(frame.style.width, '1280px');
  const expected = playerViewport(390, 844, 'native', 0, null, null, true);
  assert.equal(frame.style.transform, 'scale(' + expected.scaleX + ',' + expected.scaleY + ')');
});

test('Shared device policy is bypassed while genuine capability failures remain', async () => {
  const source = `async function checkCapabilities() {
    if (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))
      return { kind: 'mobile', message: 'Desktop only' };
    if (!isSecureContext) return {kind:'secure'};
    if (!crossOriginIsolated) return {kind:'browser'};
    return null;
  }`;
  const patched = rewriteGameCompatibility(
    source,
    'https://vel.gg/bo1z/capabilities.js',
    '/player/games/',
  );
  for (const [secure, isolated, expected] of [
    [false, false, 'secure'],
    [true, false, 'browser'],
    [true, true, null],
  ]) {
    const context = vm.createContext({
      navigator: { userAgent: 'Android Mobile' },
      isSecureContext: secure,
      crossOriginIsolated: isolated,
    });
    vm.runInContext(patched, context);
    assert.equal((await context.checkCapabilities())?.kind || null, expected);
  }
  assert.equal(
    rewriteGameCompatibility(source, 'https://other.example/capabilities.js', '/player/games/'),
    patched,
  );
  assert.equal(
    rewriteGameCompatibility(source, 'https://other.example/capabilities.js', '/__game/v4/'),
    source,
  );
});
test('renderer selection is preserved instead of being forced by device type', async () => {
  const source =
    "let choicePromise; function rendererChoice(){return choicePromise ??= chooseRenderer(sessionStorage.getItem('kisak-renderer'));}";
  const patched = rewriteGameCompatibility(
    source,
    'https://vel.gg/bo1z/engine.js',
    '/player/games/',
  );
  for (const [mobile, expected] of [
    [true, 'webgpu'],
    [false, 'webgpu'],
  ]) {
    const context = vm.createContext({
      __timebombNativeMobile: mobile,
      chooseRenderer: async (value) => value,
      sessionStorage: { getItem: () => 'webgpu' },
    });
    vm.runInContext(patched, context);
    assert.equal(await context.rendererChoice(), expected);
  }
});
test('virtual pointer capture supports mapper input and releases on Escape', async () => {
  class TestDocument extends EventTarget {}
  class TestElement {}
  const document = new TestDocument();
  let changes = 0;
  document.addEventListener('pointerlockchange', () => changes++);
  const context = vm.createContext({
    document,
    Document: TestDocument,
    Element: TestElement,
    Event,
  });
  vm.runInContext('(' + installPointerCompatibility.toString() + ')()', context);
  const canvas = new TestElement();
  await canvas.requestPointerLock();
  assert.equal(document.pointerLockElement, canvas);
  const event = new Event('keydown');
  Object.defineProperty(event, 'key', { value: 'Escape' });
  document.dispatchEvent(event);
  assert.equal(document.pointerLockElement, null);
  assert.equal(changes, 2);
});

test('automatic viewport bounds both dimensions while preserving aspect and original compatibility', () => {
  const apply = boot.slice(
    boot.indexOf('function applyDisplay()'),
    boot.indexOf('function setupDisplay('),
  );
  for (const [performanceMode, renderBudget, screenWidth, screenHeight] of [
    ['auto', 800, 390, 844],
    ['fast', 640, 1920, 1080],
    ['auto', 1280, 3840, 2160],
    ['native', 0, 390, 844],
  ]) {
    const frame = { style: {} };
    const context = vm.createContext({
      frame,
      gameDisplay: null,
      performanceMode,
      renderBudget,
      innerWidth: screenWidth,
      innerHeight: screenHeight,
      restoreExpandedCanvas() {},
    });
    Object.assign(context, { playerViewport, fixedGameViewport, fixedViewportDocs: new WeakMap() });
    vm.runInContext(apply, context);
    context.applyDisplay();
    const width = parseFloat(frame.style.width),
      height = parseFloat(frame.style.height);
    if (performanceMode === 'native') assert.equal(width, 1280);
    else assert.ok(Math.max(width, height) <= renderBudget + 2);
    assert.ok(Math.abs(width / height - screenWidth / screenHeight) < 0.005);
  }
});
test('performance profiles affect WebGL in page and worker contexts and preserve fixed input dimensions', () => {
  for (const [mode, dpr] of [
    ['auto', 1],
    ['fast', 0.75],
    ['native', 3],
  ]) {
    const calls = [];
    class Canvas {
      constructor() {
        this.width = 800;
        this.height = 600;
      }
      getContext(...args) {
        calls.push(args);
        return {};
      }
    }
    const native = Canvas.prototype.getContext;
    const context = vm.createContext({
      devicePixelRatio: 3,
      HTMLCanvasElement: Canvas,
      addEventListener() {},
    });
    vm.runInContext(
      'globalThis.window=globalThis;(' +
        installMobilePerformance.toString() +
        ')(' +
        JSON.stringify(mode) +
        ')',
      context,
    );
    assert.equal(context.devicePixelRatio, dpr);
    const canvas = new Canvas(),
      options = { alpha: false, depth: true, antialias: true };
    canvas.getContext('2d', options);
    assert.equal(calls[0][1], options);
    canvas.getContext('webgl2', options);
    assert.equal(calls[1][1].alpha, false);
    assert.equal(calls[1][1].depth, true);
    assert.equal(calls[1][1].antialias, mode === 'native');
    if (mode !== 'native') assert.equal(calls[1][1].powerPreference, 'high-performance');
    else assert.equal(Canvas.prototype.getContext, native);
    assert.equal(canvas.width, 800);
    assert.equal(canvas.height, 600);
  }
  class Offscreen {
    getContext(type, options) {
      return options;
    }
  }
  const worker = vm.createContext({ OffscreenCanvas: Offscreen });
  vm.runInContext('(' + installMobilePerformance.toString() + ')()', worker);
  assert.equal(new Offscreen().getContext('webgl2').antialias, false);
});
test('performance mode preserves real device detection in both mobile and desktop worker realms', () => {
  for (const userAgent of ['Android Mobile', 'Firefox/157 desktop']) {
    const context = vm.createContext({
      navigator: { userAgent, platform: 'actual', maxTouchPoints: 5 },
      URL,
      Request,
      fetch: () => {},
    });
    vm.runInContext(
      bootstrap('https://game.example/', 'https://playdeck-1z1.pages.dev', true, '/player/games/'),
      context,
    );
    assert.equal(context.navigator.userAgent, userAgent);
    assert.equal(context.navigator.platform, 'actual');
    assert.equal(context.navigator.maxTouchPoints, 5);
  }
});

test('automatic resolution reacts to persistent slow callbacks without resizing healthy sessions', () => {
  assert.equal(initialRenderBudget('auto', 4, 8), 800);
  assert.equal(initialRenderBudget('auto', 8, 16), 1280);
  assert.equal(initialRenderBudget('fast', 8, 16), 640);
  assert.equal(initialRenderBudget('native', 4, 2), 0);
  assert.equal(reduceRenderBudget(1280, { count: 90, slowRatio: 0.05, p90: 16.7 }), 1280);
  assert.equal(reduceRenderBudget(1280, { count: 5, slowRatio: 1, p90: 80 }), 1280);
  assert.equal(reduceRenderBudget(1280, { count: 90, slowRatio: 0.5, p90: 80 }), 1024);
  assert.equal(reduceRenderBudget(640, { count: 90, slowRatio: 1, p90: 80 }), 640);
});
test('WebGPU preference and descriptors survive performance hooks', async () => {
  const calls = [],
    device = {};
  const adapter = {
    requestDevice: async (value) => {
      calls.push(value);
      return device;
    },
  };
  const context = vm.createContext({
    navigator: {
      gpu: {
        requestAdapter: async (value) => {
          calls.push(value);
          return adapter;
        },
      },
    },
  });
  vm.runInContext('(' + installMobilePerformance.toString() + ')()', context);
  const selected = await context.navigator.gpu.requestAdapter({
    forceFallbackAdapter: true,
    featureLevel: 'core',
  });
  assert.equal(calls[0].forceFallbackAdapter, true);
  assert.equal(calls[0].featureLevel, 'core');
  assert.equal(calls[0].powerPreference, 'high-performance');
  const descriptor = {
    requiredFeatures: ['texture-compression-bc'],
    requiredLimits: { maxBufferSize: 1000 },
  };
  assert.equal(await selected.requestDevice(descriptor), device);
  assert.equal(calls[1], descriptor);
});
test('frame telemetry never delays callbacks or changes animation request IDs', () => {
  const reports = [],
    callbacks = [];
  let next = 0;
  class Channel {
    postMessage(data) {
      reports.push(data);
    }
    close() {}
  }
  class Canvas {
    width = 800;
    height = 600;
    getContext() {
      return {};
    }
  }
  const context = vm.createContext({
    BroadcastChannel: Channel,
    HTMLCanvasElement: Canvas,
    requestAnimationFrame: (callback) => {
      callbacks.push(callback);
      return ++next;
    },
  });
  vm.runInContext(
    '(' +
      installMobilePerformance.toString() +
      ')(' +
      JSON.stringify('auto') +
      ',' +
      JSON.stringify('test') +
      ')',
    context,
  );
  new Canvas().getContext('webgl2');
  let count = 0;
  for (let i = 1; i < 130; i++) {
    const id = context.requestAnimationFrame(() => count++);
    assert.equal(id, i);
    callbacks.shift()(i * 40);
  }
  assert.equal(count, 129);
  assert.ok(reports.length > 0);
  assert.equal(reports[0].fps, 25);
  assert.equal(reports[0].slowRatio, 1);
});

test('memory diagnostics preserve constructor limits and ignore small capability probes', () => {
  const reports = [],
    descriptors = [];
  class Channel {
    postMessage(data) {
      reports.push(data);
    }
  }
  class Memory {
    constructor(descriptor) {
      descriptors.push(descriptor);
      if (descriptor.initial !== 10) throw new RangeError('could not allocate');
      this.buffer = { byteLength: descriptor.initial * 65536 };
    }
  }
  const context = vm.createContext({ BroadcastChannel: Channel, WebAssembly: { Memory } });
  vm.runInContext(
    '(' +
      installMobilePerformance.toString() +
      ')(' +
      JSON.stringify('auto') +
      ',' +
      JSON.stringify('test') +
      ')',
    context,
  );
  const descriptor = { initial: 10, maximum: 65536, shared: true };
  const memory = new context.WebAssembly.Memory(descriptor);
  assert.equal(memory.buffer.byteLength, 10 * 65536);
  assert.equal(descriptors[0], descriptor);
  assert.throws(() => new context.WebAssembly.Memory({ initial: 1 }));
  assert.equal(reports.length, 0);
  assert.throws(
    () => new context.WebAssembly.Memory({ initial: 16384, maximum: 65536, shared: true }),
  );
  assert.equal(reports[0].type, 'allocation-failure');
  assert.ok(reports[0].detail.includes('1024 MiB'));
});

// Shared by every sandbox game. No game names or engine-specific tuning.
export function initialRenderBudget(mode, memory, cores) {
  if (mode === 'native' || mode === 'full') return 0;
  if (mode === 'fast') return 640;
  return (memory > 0 && memory <= 4) || (cores > 0 && cores <= 4) ? 800 : 1280;
}
export function reduceRenderBudget(budget, sample) {
  if (!sample || sample.count < 30 || sample.slowRatio < 0.15 || sample.p90 < 35) return budget;
  return Math.max(640, Math.round((budget * 0.8) / 16) * 16);
}

export function adaptiveRenderBudget(budget,sample,maximum=1280) {
  const reduced=reduceRenderBudget(budget,sample);
  if(reduced!==budget)return reduced;
  if(sample?.count>=90 && sample.slowRatio<.03 && sample.p90<20)return Math.min(maximum,Math.max(budget,Math.round(budget*1.1/16)*16));
  return budget;
}

// Serialized into both page and worker realms by the proxy.
export function installPerformance(mode = 'auto', channelName = '') {
  if (globalThis.__timebombPerformanceInstalled) return;
  globalThis.__timebombPerformanceInstalled = true;
  globalThis.__timebombPerformanceMode = mode;
  const reduceQuality=mode==='auto' || mode==='fast';
  const canvasTypes = ['HTMLCanvasElement', 'OffscreenCanvas'];
  const canvases = new Set();
  const telemetry = { renderer: '', fps: 0, p90: 0, slowRatio: 0, count: 0 };
  let channel = null;
  try {
    if (channelName && typeof BroadcastChannel === 'function')
      channel = new BroadcastChannel(channelName);
  } catch {}
  if(!reduceQuality && !channel)return;
  const report = (data) => {
    try {
      channel?.postMessage(data);
    } catch {}
  };
  if (typeof window !== 'undefined') {
    const nativeDPR = window.devicePixelRatio || 1;
    const cap = mode === 'fast' ? 0.75 : 1;
    try {if(reduceQuality){
      Object.defineProperty(window, 'devicePixelRatio', {
        configurable: true,
        get: () => Math.min(nativeDPR, cap),
      });
    }} catch {}
    window.addEventListener('pagehide', () => channel?.close(), { once: true });
  }
  // Request the faster adapter without fabricating capabilities or limits.
  const gpu = globalThis.navigator?.gpu;
  if (gpu?.requestAdapter) {
    const native = gpu.requestAdapter.bind(gpu);
    try {
      gpu.requestAdapter = async (options) => {
        const adapter = await native(reduceQuality?{ ...options, powerPreference: 'high-performance' }:options);
        if (adapter?.requestDevice && channel) {
          const request = adapter.requestDevice.bind(adapter);
          try {
            adapter.requestDevice = async (descriptor) => {
              const device = await request(descriptor);
              device.lost?.then((info) => {
                if (info.reason !== 'destroyed')
                  report({
                    type: 'graphics-failure',
                    detail: String(info.message || 'WebGPU device lost').slice(0, 300),
                  });
              });
              return device;
            };
          } catch {}
        }
        return adapter;
      };
    } catch {}
  }
  for (const name of canvasTypes) {
    const proto = globalThis[name]?.prototype;
    if (!proto?.getContext) continue;
    const native = proto.getContext;
    proto.getContext = function (type, options, ...rest) {
      const webgl = /^(webgl2?|experimental-webgl)$/.test(type);
      const attributes = webgl && reduceQuality
        ? { ...options, powerPreference: 'high-performance', antialias: false }
        : options;
      const context = native.call(this, type, attributes, ...rest);
      if (context && (webgl || type === 'webgpu' || type==='2d')) {
        if (!canvases.has(this) && webgl && channel)
          this.addEventListener?.('webglcontextlost', () => {
            if (this.width * this.height >= 65536)
              report({ type: 'graphics-failure', detail: 'WebGL graphics context lost' });
          });
        canvases.add(this);
        telemetry.renderer = type;
      }
      return context;
    };
  }
  // Preserve compiled memory limits; capture allocation failures in worker realms
  // instead of changing their sizes and causing WebAssembly import errors.
  if (channel && globalThis.WebAssembly?.Memory) {
    const Memory = WebAssembly.Memory;
    try {
      WebAssembly.Memory = new Proxy(Memory, {
        construct(target, args, newTarget) {
          try {
            return Reflect.construct(target, args, newTarget);
          } catch (error) {
            if (Number(args[0]?.initial || 0) >= 4096)
              report({
                type: 'allocation-failure',
                detail:
                  'WebAssembly memory allocation failed (' +
                  Math.round(Number(args[0]?.initial || 0) / 16) +
                  ' MiB initial): ' +
                  String(error.message).slice(0, 200),
              });
            throw error;
          }
        },
      });
    } catch {}
  }
  // Measure the engine's own frame callbacks; never change scheduling or input.
  // This is frame cadence, not a claim that each callback drew a frame.
  if (channel && typeof requestAnimationFrame === 'function') {
    const native = requestAnimationFrame.bind(globalThis);
    let last = 0,
      sent = 0;
    const gaps = [];
    globalThis.requestAnimationFrame = (callback) =>
      native(function (now) {
        const visible = typeof document === 'undefined' || !document.hidden;
        if (visible && now !== last) {
          let rendering = false;
          for (const canvas of canvases)
            if (canvas.width * canvas.height >= 65536) {
              rendering = true;
              break;
            }
          if (last && now - last < 500 && rendering) gaps.push(now - last);
          last = now;
          if (now - sent > 3000 && gaps.length >= 30) {
            const sorted = gaps.slice().sort((a, b) => a - b),
              sum = gaps.reduce((a, b) => a + b, 0);
            telemetry.fps = Math.round((1000 * gaps.length) / sum);
            telemetry.p90 = sorted[Math.floor(sorted.length * 0.9)];
            telemetry.slowRatio = gaps.filter((gap) => gap > 35).length / gaps.length;
            telemetry.count = gaps.length;
            report({ type: 'cadence', ...telemetry });
            gaps.length = 0;
            sent = now;
          }
          if (gaps.length > 240) gaps.shift();
        }
        return callback.call(this, now);
      });
  }
}


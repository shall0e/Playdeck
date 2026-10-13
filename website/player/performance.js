// Shared by every sandbox game. No game names or engine-specific tuning.
export function initialRenderBudget(mode, memory, cores) {
  if (mode === 'native' || mode === 'full') return 0;
  if (mode === 'fast') return 640;
  return (memory > 0 && memory <= 4) || (cores > 0 && cores <= 4) ? 800 : 1280;
}
export function reduceRenderBudget(budget, sample) {
  const slowLimit = Math.max(28, sample?.targetFPS > 0 ? 1600 / sample.targetFPS : 0);
  if (!sample || sample.count < 30 || sample.slowRatio < 0.15 || sample.p90 < slowLimit) return budget;
  return Math.max(640, Math.round((budget * 0.8) / 16) * 16);
}

export function adaptiveRenderBudget(budget,sample,maximum=1280,allowRecovery=true) {
  const reduced=reduceRenderBudget(budget,sample);
  if(reduced!==budget)return reduced;
  if(allowRecovery && sample?.count>=90 && sample.slowRatio<.03 && sample.p90<Math.max(20,sample.targetFPS>0?1600/sample.targetFPS:0))return Math.min(maximum,Math.max(budget,Math.round(budget*1.1/16)*16));
  return budget;
}

// Serialized into game page and worker realms. Opt-in: some games update
// physics once per callback, so a lower cap can also slow their simulation.
export function installFrameCap(fps = 0) {
  if (![15, 30, 45, 60, 75, 90, 105, 120].includes(Number(fps)) || globalThis.__playdeckFrameCapInstalled ||
      typeof globalThis.requestAnimationFrame !== 'function' ||
      typeof globalThis.cancelAnimationFrame !== 'function') return;
  globalThis.__playdeckFrameCapInstalled = true;
  const request = globalThis.requestAnimationFrame.bind(globalThis);
  const cancel = globalThis.cancelAnimationFrame.bind(globalThis);
  const interval = 1000 / Number(fps);
  const callbacks = new Map();
  let handle = 0, scheduled = null, deadline = -Infinity, previousNative = null, refreshInterval = 0;
  function schedule() {
    if (scheduled === null && callbacks.size) scheduled = request(tick);
  }
  function tick(now) {
    if(previousNative!==null && now>previousNative && now-previousNative<100){refreshInterval=refreshInterval?Math.min(refreshInterval,now-previousNative):now-previousNative;globalThis.__playdeckRefreshInterval=refreshInterval;}
    previousNative=now;
    scheduled = null;
    if (now >= deadline - 0.5) {
      deadline = Number.isFinite(deadline) && now - deadline < interval ? deadline + interval : now + interval;
      // Cancellation during a frame must still cancel later callbacks in it.
      // Requests made by callbacks belong to the next frame, not this batch.
      for (const id of [...callbacks.keys()]) {
        const callback = callbacks.get(id);
        if (!callback) continue;
        callbacks.delete(id);
        try { callback.call(globalThis, now); }
        catch (error) {
          if (typeof globalThis.reportError === 'function') globalThis.reportError(error);
          else queueMicrotask(() => { throw error; });
        }
      }
    }
    schedule();
  }
  globalThis.requestAnimationFrame = callback => {
    if (typeof callback !== 'function') throw new TypeError('Animation frame callback must be a function');
    const id = ++handle;
    callbacks.set(id, callback);
    schedule();
    return id;
  };
  globalThis.cancelAnimationFrame = id => {
    callbacks.delete(id);
    if (!callbacks.size && scheduled !== null) {
      cancel(scheduled);
      scheduled = null;
    }
  };
}

// Serialized into both page and worker realms by the proxy.
export function installPerformance(mode = 'auto', channelName = '', frameCap = 0) {
  if (globalThis.__timebombPerformanceInstalled) return;
  globalThis.__timebombPerformanceInstalled = true;
  globalThis.__timebombPerformanceMode = mode;
  const reduceQuality=mode==='auto' || mode==='fast';
  const canvasTypes = ['HTMLCanvasElement', 'OffscreenCanvas'];
  const seenCanvases = new WeakSet();
  const canvases = new Set();
  const telemetry = { renderer: '', fps: 0, p90: 0, slowRatio: 0, count: 0, targetFPS: Number(frameCap) || 0 };
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
        if (!seenCanvases.has(this) && webgl && channel)
          this.addEventListener?.('webglcontextlost', () => {
            if (this.width * this.height >= 65536)
              report({ type: 'graphics-failure', detail: 'WebGL graphics context lost' });
          });
        if (!seenCanvases.has(this)) {
          seenCanvases.add(this);
          // Do not retain discarded engine canvases/texture surfaces for the whole session.
          if (mode === 'auto' && typeof WeakRef === 'function') canvases.add(new WeakRef(this));
        }
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
  if (mode === 'auto' && channel && typeof requestAnimationFrame === 'function') {
    const native = requestAnimationFrame.bind(globalThis);
    let last = 0,
      sent = 0,
      inspected = -Infinity,
      rendering = false;
    const gaps = [];
    globalThis.requestAnimationFrame = (callback) =>
      native(function (now) {
        const visible = typeof document === 'undefined' || !document.hidden;
        if (visible && now !== last) {
          // Inspect surfaces once per sample window, not on every engine frame.
          if (now - inspected >= 3000) {
            rendering = false;
            for (const reference of canvases) {
              const canvas = reference.deref();
              if (!canvas) canvases.delete(reference);
              else if (canvas.width * canvas.height >= 4096) rendering = true;
            }
            inspected = now;
          }
          if (last && now - last < 500 && rendering) gaps.push(now - last);
          else gaps.length = 0;
          last = now;
          if (now - sent > 3000 && gaps.length >= 30) {
            const sorted = gaps.slice().sort((a, b) => a - b),
              sum = gaps.reduce((a, b) => a + b, 0);
            telemetry.fps = Math.round((1000 * gaps.length) / sum);
            telemetry.p90 = sorted[Math.floor(sorted.length * 0.9)];
            telemetry.refreshInterval=globalThis.__playdeckRefreshInterval || 1000/60;
            const targetPeriod=1000/(telemetry.targetFPS || 60);
            const expected=Math.ceil(targetPeriod/telemetry.refreshInterval-.02)*telemetry.refreshInterval;
            const slowLimit = Math.max(25,expected*1.25);
            telemetry.slowRatio = gaps.filter((gap) => gap > slowLimit).length / gaps.length;
            telemetry.count = gaps.length;
            report({ type: 'cadence', ...telemetry });
            gaps.length = 0;
            sent = now;
          }
          if (gaps.length > 240) gaps.shift();
        } else if (!visible) {
          last = 0;
          gaps.length = 0;
        }
        return callback.call(this, now);
      });
  }
}


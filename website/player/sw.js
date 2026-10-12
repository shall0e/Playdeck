import { PERFORMANCE_MODES } from './options.js';
const PREFIX = '/player/games/';
const CACHE = 'timebomb-local-games-v1';
const SHELL = 'playdeck-local-shell-v30';
const METADATA = 'playdeck-local-hashes-v1';
const SHELL_FILES = [
  '/',
  '/home.css',
  '/home.js',
  '/player-ui.css',
  '/player/',
  '/player/boot.js',
  '/player/controller.js',
  '/player/performance.js',
  '/player/settings.js',
  '/player/toolbar.js',
  '/player/toolbar-icons.js',
  '/player/display.js',
  '/player/viewport.js',
  '/player/launch-options.js',
  '/player/s3tc.js',
  '/player/options.js',
];
const OLD_PREFIX = '/__sandbox/games/';

export class DownloadActivity {
  constructor(notify = () => {}, now = () => Date.now()) {
    this.active = 0;
    this.lastDownload = now();
    this.notify = notify;
    this.now = now;
  }
  snapshot() {
    return { type: 'sandbox:downloads', active: this.active, lastDownload: this.lastDownload };
  }
  changed() {
    this.lastDownload = this.now();
    this.notify(this.snapshot());
  }
  start() {
    this.active++;
    this.changed();
    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      this.active--;
      this.changed();
    };
  }
  idle(now = this.now()) {
    return this.active === 0 && now - this.lastDownload >= 2000;
  }
}
export const downloads = new DownloadActivity((message) => {
  if (typeof self !== 'undefined') void inform(message);
});
export async function networkFetch(request, event) {
  const end = downloads.start();
  let response;
  try {
    // The proxy must leave SRI-protected bytes unchanged on every upstream.
    const headers = new Headers(request.headers);
    headers.set('X-Playdeck-Destination', request.destination || 'empty');
    if (request.integrity) headers.set('X-Playdeck-Integrity', request.integrity);
    response = await fetch(new Request(request, { headers }));
  } catch (error) {
    end();
    throw error;
  }
  if (!response.body) {
    end();
    return response;
  }
  const reader = response.body.getReader();
  let finish;
  const done = new Promise((resolve) => {
    finish = () => {
      end();
      resolve();
    };
  });
  event.waitUntil(done);
  const body = new ReadableStream({
    async pull(controller) {
      try {
        const result = await reader.read();
        if (result.done) {
          finish();
          controller.close();
          return;
        }
        downloads.lastDownload = Date.now();
        if (Date.now() - lastActivityNotification >= 500) {
          lastActivityNotification = Date.now();
          void inform(downloads.snapshot());
        }
        controller.enqueue(result.value);
      } catch (error) {
        finish();
        controller.error(error);
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
      } finally {
        finish();
      }
    },
  });
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

export function isAsset(request) {
  const url = new URL(request.url);
  return (
    url.pathname.startsWith(PREFIX) &&
    ['GET', 'HEAD'].includes(request.method) &&
    !/(^|\/)api(\/|$)/i.test(url.pathname) &&
    !request.headers.has('authorization')
  );
}
// Retained for callers; downloads have no per-file size limit.
export const MAX_CACHE_BYTES = 8 * 1024 * 1024;
let lastActivityNotification = 0;
export function canStore(request, response) {
  return (
    isAsset(request) &&
    request.method === 'GET' &&
    response.status === 200 &&
    response.type !== 'opaque' &&
    !response.headers.has('Content-Range') &&
    !request.headers.has('Range')
  );
}
export async function cachedRange(
  response,
  range,
  head = false,
  size = Number(response.headers.get('Content-Length') || 0),
) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(range || '');
  if (!match || (!match[1] && !match[2])) return null;
  if (!size) {
    const blob = await response.blob();
    if (!blob.size) {
      const headers = new Headers(response.headers);
      headers.set('Content-Range', 'bytes */0');
      return new Response(null, { status: 416, headers });
    }
    return cachedRange(new Response(blob, { headers: response.headers }), range, head, blob.size);
  }
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  let end = match[1] ? (match[2] ? Number(match[2]) : size - 1) : size - 1;
  const headers = new Headers(response.headers);
  headers.delete('content-encoding');
  if (start >= size || end < start) {
    headers.set('Content-Range', 'bytes */' + size);
    return new Response(null, { status: 416, headers });
  }
  end = Math.min(end, size - 1);
  headers.set('Content-Range', 'bytes ' + start + '-' + end + '/' + size);
  headers.set('Content-Length', String(end - start + 1));
  headers.set('Accept-Ranges', 'bytes');
  if (head) return new Response(null, { status: 206, headers });
  const reader = response.body.getReader();
  let offset = 0;
  const body = new ReadableStream({
    async pull(controller) {
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) {
            controller.close();
            return;
          }
          const before = offset;
          offset += next.value.byteLength;
          if (offset <= start) continue;
          controller.enqueue(
            next.value.subarray(
              Math.max(0, start - before),
              Math.min(next.value.byteLength, end + 1 - before),
            ),
          );
          if (offset > end) {
            await reader.cancel();
            controller.close();
          }
          return;
        }
      } catch (error) {
        controller.error(error);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
  return new Response(body, { status: 206, headers });
}

export function gameCacheScope(gameURL, origin) {
  try {
    const url = new URL(gameURL),
      base = new URL(origin);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    const folder = url.pathname.endsWith('/')
      ? url.pathname
      : url.pathname.slice(0, url.pathname.lastIndexOf('/') + 1);
    return { origin: base.origin, path: PREFIX + url.host + folder };
  } catch {
    return null;
  }
}
export function matchesGameCache(request, scope) {
  if (!scope) return false;
  try {
    const url = new URL(typeof request === 'string' ? request : request.url);
    return (
      url.origin === scope.origin &&
      (url.pathname.startsWith(scope.path) ||
        url.pathname.startsWith(scope.path.replace(PREFIX, OLD_PREFIX)))
    );
  } catch {
    return false;
  }
}
export async function clearGameCache(cache, scope) {
  if (!scope) throw new Error('Missing game cache scope');
  const files = (await cache.keys()).filter((key) => matchesGameCache(key, scope));
  await Promise.all(files.map((key) => cache.delete(key)));
  return files.length;
}
let cacheRevision = 0;
const clearHistory = [];
const pendingSaves = new Map();
async function inform(message) {
  if (typeof self === 'undefined') return;
  for (const client of await self.clients.matchAll({ type: 'window' })) {
    if (new URL(client.url).pathname === '/player/') client.postMessage(message);
  }
}
export function cacheAsset(cache, key, response, event, metadata) {
  if (!canStore(key, response) || !response.body) return response;
  // One reader feeds disk and the game with backpressure. Response.clone() on a
  // multi-GB stream can otherwise queue the entire slower branch in memory.
  const reader = response.body.getReader(),
    pipe = new TransformStream(),
    writer = pipe.writable.getWriter();
  const startedAt = cacheRevision;
  let bytes = 0,
    writing = true;
  const cleared = () =>
    clearHistory.some(
      (entry) => entry.revision > startedAt && (!entry.scope || matchesGameCache(key, entry.scope)),
    );
  const saving = cache
    .put(
      key,
      new Response(pipe.readable, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      }),
    )
    .then(async () => {
      if (cleared()) {
        await cache.delete(key);
        return;
      }
      if (metadata) {
        await metadata.put(key, Response.json({ bytes }));
        if (cleared()) {
          await cache.delete(key);
          await metadata.delete(key);
          return;
        }
      }
      return inform({ type: 'sandbox:saved' });
    })
    .catch((error) => {
      writing = false;
      void writer.abort(error).catch(() => {});
      return inform({
        type: 'sandbox:storage-error',
        message:
          error.name === 'QuotaExceededError'
            ? 'Browser storage is full. New files will stream until space is cleared.'
            : 'Some files could not be saved; the game will keep streaming.',
      });
    });
  pendingSaves.set(key.url, saving);
  event.waitUntil(
    saving.finally(() => {
      if (pendingSaves.get(key.url) === saving) pendingSaves.delete(key.url);
    }),
  );
  const body = new ReadableStream({
    async pull(controller) {
      try {
        const next = await reader.read();
        if (next.done) {
          if (writing)
            try {
              await writer.close();
            } catch {}
          controller.close();
          return;
        }
        bytes += next.value.byteLength;
        if (writing)
          try {
            await writer.write(next.value);
          } catch {
            writing = false;
          }
        controller.enqueue(next.value);
      } catch (error) {
        if (writing) void writer.abort(error).catch(() => {});
        controller.error(error);
      }
    },
    async cancel(reason) {
      await Promise.allSettled([reader.cancel(reason), writer.abort(reason)]);
    },
  });
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
export function localKey(request, range = false) {
  const url = new URL(request.url);
  for (const name of [...url.searchParams.keys()]) {
    if (/^(?:_+|cache[-_]?bust(?:er)?|timestamp|nocache)$/i.test(name))
      url.searchParams.delete(name);
  }
  if (request.integrity) url.searchParams.set('__playdeck_integrity', request.integrity);
  if (range) url.searchParams.set('__playdeck_range', request.headers.get('Range'));
  return new Request(url.href);
}
export function needsAssetRefresh(request, response) {
  const transform = response.headers.get('X-Playdeck-Transform');
  const type = response.headers.get('Content-Type') || '';
  // Refresh only rewritten source files affected by earlier proxy bugs.
  // Raw Wasm, archives, textures, and other downloaded data remain local.
  if (transform?.startsWith('hash-cache-1:')) return true;
  if (/text\/html|text\/css/i.test(type) && !transform) return true;
  if (['worker', 'sharedworker'].includes(request.destination) && !request.integrity) {
    return !transform?.endsWith(':' + request.destination);
  }
  return false;
}
export async function localFetch(request, event) {
  if (!isAsset(request)) return networkFetch(request, event);
  let cache;
  try {
    cache = await caches.open(CACHE);
  } catch {
    return networkFetch(request, event);
  }
  const key = localKey(request),
    range = request.headers.get('Range');
  let cached = await cache.match(key);
  if (!cached && pendingSaves.has(key.url)) {
    await pendingSaves.get(key.url);
    cached = await cache.match(key);
  }
  if (cached && needsAssetRefresh(request, cached)) {
    await cache.delete(key);
    cached = undefined;
  }
  // Cache-busting query strings must not cause another download of a saved
  // static file. Documents and API/manifest responses retain query semantics.
  if (!cached && request.mode !== 'navigate') {
    // Preserve semantic queries such as asset IDs, language and level numbers.
    for (const savedKey of (await cache.keys?.(key, { ignoreSearch: true })) || []) {
      if (localKey(savedKey).url !== key.url) continue;
      const candidate = await cache.match(savedKey);
      if (
        candidate &&
        !needsAssetRefresh(request, candidate) &&
        !/html|json|xml/i.test(candidate.headers.get('Content-Type') || '') &&
        !candidate.headers.has('X-Playdeck-Stored-Status')
      ) {
        cached = candidate;
        break;
      }
    }
  }
  if (!cached) {
    const oldURL = new URL(key.url);
    oldURL.pathname = oldURL.pathname.replace(PREFIX, OLD_PREFIX);
    const old = await cache.match(new Request(oldURL.href));
    if (old && !/html|css|javascript|ecmascript/i.test(old.headers.get('Content-Type') || ''))
      cached = old;
  }
  if (cached) {
    if (range) {
      let size = Number(cached.headers.get('Content-Length') || 0);
      if (!size)
        try {
          size = (await (await (await caches.open(METADATA)).match(key))?.json())?.bytes || 0;
        } catch {}
      const partial = await cachedRange(cached, range, request.method === 'HEAD', size);
      if (partial) return partial;
    } else {
      if (request.method === 'HEAD')
        return new Response(null, { status: 200, headers: cached.headers });
      return cached;
    }
  }
  const rangeKey = range ? localKey(request, true) : null;
  if (rangeKey) {
    if (pendingSaves.has(rangeKey.url)) await pendingSaves.get(rangeKey.url);
    const partial = await cache.match(rangeKey);
    if (partial) {
      const headers = new Headers(partial.headers);
      headers.set('Content-Range', headers.get('X-Playdeck-Content-Range'));
      headers.delete('X-Playdeck-Stored-Status');
      headers.delete('X-Playdeck-Content-Range');
      return new Response(request.method === 'HEAD' ? null : partial.body, {
        status: 206,
        headers,
      });
    }
  }
  try {
    const response = await networkFetch(request, event);
    let metadata;
    try {
      metadata = await caches.open(METADATA);
    } catch {}
    if (rangeKey && request.method === 'GET' && response.status === 206) {
      // CacheStorage rejects 206 entries. Store the complete requested range
      // under its own key as 200, then restore 206 when serving it to the game.
      const headers = new Headers(response.headers);
      headers.set('X-Playdeck-Stored-Status', '206');
      headers.set('X-Playdeck-Content-Range', headers.get('Content-Range'));
      const storedHeaders = new Headers(headers);
      storedHeaders.delete('Content-Range');
      const input = new Response(response.body, { status: 200, headers: storedHeaders });
      const saved = cacheAsset(cache, rangeKey, input, event, metadata);
      return new Response(saved.body, {
        status: 206,
        statusText: response.statusText,
        headers: response.headers,
      });
    }
    return cacheAsset(cache, key, response, event, metadata);
  } catch (error) {
    return new Response('This file has not been downloaded. Reconnect to import it.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain', 'Cross-Origin-Resource-Policy': 'cross-origin' },
    });
  }
}
export async function shellFetch(request, event) {
  const url = new URL(request.url),
    key = url.origin + url.pathname;
  // Player updates are independent of the permanently local-first game store.
  try {
    const response = await fetch(new Request(request, { cache: 'no-cache' }));
    if (response.ok) {
      const copy = response.clone();
      event.waitUntil(
        caches
          .open(SHELL)
          .then((cache) => cache.put(key, copy))
          .catch(() => {}),
      );
      return response;
    }
    return (await (await caches.open(SHELL)).match(key)) || response;
  } catch (error) {
    const saved = await (await caches.open(SHELL)).match(key);
    if (saved) return saved;
    throw error;
  }
}
if (typeof self !== 'undefined' && self.addEventListener) {
  self.addEventListener('install', (event) =>
    event.waitUntil(
      (async () => {
        const cache = await caches.open(SHELL);
        await cache.addAll(SHELL_FILES);
        await self.skipWaiting();
      })(),
    ),
  );
  self.addEventListener('activate', (event) =>
    event.waitUntil(
      (async () => {
        for (const name of await caches.keys())
          if (
            (name.startsWith('timebomb-local-shell-') ||
              name.startsWith('playdeck-local-shell-')) &&
            name !== SHELL
          )
            await caches.delete(name);
        await self.clients.claim();
      })(),
    ),
  );
  self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    if (url.origin !== self.location.origin) return;
    if (url.pathname.startsWith(PREFIX)) event.respondWith(localFetch(event.request, event));
    else if (url.pathname.startsWith('/__game/v4/'))
      event.respondWith(networkFetch(event.request, event));
    else if (SHELL_FILES.includes(url.pathname))
      event.respondWith(shellFetch(event.request, event));
  });
  self.addEventListener('message', (event) => {
    if (!event.source || new URL(event.source.url).pathname !== '/player/') return;
    const port = event.ports[0];
    event.waitUntil(
      (async () => {
        const sourceURL = new URL(event.source.url);
        const scope = gameCacheScope(sourceURL.searchParams.get('url'), sourceURL.origin);
        if (event.data?.type === 'sandbox:config') {
          if (!PERFORMANCE_MODES.includes(event.data.performance))
            throw new Error('Invalid cache configuration');
          port?.postMessage({ ok: true });
        } else if (event.data?.type === 'sandbox:activity') {
          port?.postMessage({ ok: true, ...downloads.snapshot() });
        } else if (event.data?.type === 'sandbox:clear') {
          clearHistory.push({ revision: ++cacheRevision, scope: null });
          await Promise.all([caches.delete(CACHE), caches.delete(METADATA)]);
          port?.postMessage({ ok: true, files: 0 });
        } else if (event.data?.type === 'sandbox:clear-game') {
          if (!scope) throw new Error('Invalid game scope');
          clearHistory.push({ revision: ++cacheRevision, scope });
          const cache = await caches.open(CACHE);
          const cleared = await clearGameCache(cache, scope);
          await clearGameCache(await caches.open(METADATA), scope);
          port?.postMessage({ ok: true, cleared });
        } else if (event.data?.type === 'sandbox:stats') {
          const cache = await caches.open(CACHE);
          const keys = await cache.keys();
          port?.postMessage({
            ok: true,
            files: keys.length,
            gameFiles: keys.filter((key) => matchesGameCache(key, scope)).length,
          });
        }
      })().catch((error) => port?.postMessage({ ok: false, error: error.message })),
    );
  });
}

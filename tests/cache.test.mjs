import test from 'node:test';
import assert from 'node:assert/strict';
import {
  localFetch,
  cacheAsset,
  MAX_CACHE_BYTES,
  cachedRange,
  shellFetch,
} from '../website/player/sw.js';
const origin = 'https://player.example',
  url = origin + '/player/games/game.example/game.bin';
class MemoryCache {
  constructor() {
    this.entries = new Map();
  }
  async match(key, options = {}) {
    const address = typeof key === 'string' ? key : key.url;
    let value = this.entries.get(address);
    if (!value && options.ignoreSearch) {
      const pathname = new URL(address);
      pathname.search = '';
      for (const [stored, candidate] of this.entries) {
        const other = new URL(stored);
        other.search = '';
        if (other.href === pathname.href) {
          value = candidate;
          break;
        }
      }
    }
    return value
      ? new Response(value.body.slice(), { status: value.status, headers: value.headers })
      : undefined;
  }
  async put(key, response) {
    assert.notEqual(response.status, 206);
    this.entries.set(typeof key === 'string' ? key : key.url, {
      body: new Uint8Array(await response.arrayBuffer()),
      status: response.status,
      headers: new Headers(response.headers),
    });
  }
  async delete(key) {
    return this.entries.delete(typeof key === 'string' ? key : key.url);
  }
  async keys(key, options = {}) {
    const target = new URL(typeof key === 'string' ? key : key.url);
    return [...this.entries.keys()]
      .filter((address) => {
        const other = new URL(address);
        return options.ignoreSearch
          ? other.origin === target.origin && other.pathname === target.pathname
          : other.href === target.href;
      })
      .map((address) => new Request(address));
  }
}
async function fixture(run) {
  const previousFetch = globalThis.fetch,
    previousCaches = globalThis.caches,
    waits = [];
  const data = new MemoryCache(),
    metadata = new MemoryCache(),
    calls = [];
  globalThis.caches = {
    open: async (name) => (name === 'playdeck-local-hashes-v1' ? metadata : data),
  };
  let upstream = async () =>
    new Response('saved asset', { headers: { 'Content-Type': 'application/octet-stream' } });
  globalThis.fetch = async (request) => {
    calls.push(request);
    return upstream(request);
  };
  const event = { waitUntil: (promise) => waits.push(promise) };
  const finish = async () => {
    while (waits.length) await Promise.all(waits.splice(0));
  };
  try {
    await run({ data, metadata, calls, event, finish, setUpstream: (value) => (upstream = value) });
    await finish();
  } finally {
    globalThis.fetch = previousFetch;
    if (previousCaches === undefined) delete globalThis.caches;
    else globalThis.caches = previousCaches;
  }
}
test('saved files load locally on reload, no-cache and no-store without any online checks', async () =>
  fixture(async ({ calls, metadata, event, finish, setUpstream }) => {
    await (await localFetch(new Request(url), event)).text();
    await finish();
    await metadata.put(url, Response.json({ checkedAt: 0, savedAt: 0, bytes: 11 }));
    setUpstream(async () => {
      throw new Error('No online checks allowed');
    });
    for (const cache of ['default', 'reload', 'no-cache', 'no-store']) {
      assert.equal(
        await (await localFetch(new Request(url, { cache }), event)).text(),
        'saved asset',
      );
    }
    assert.equal(calls.length, 1);
  }));
test('saved launch pages and outdated rewrites are returned immediately without a download', async () =>
  fixture(async ({ data, metadata, event, calls }) => {
    for (const [path, type] of [
      ['/index.html', 'text/html'],
      ['/engine.js', 'text/javascript'],
      ['/style.css', 'text/css'],
      ['/manifest.json', 'application/json'],
    ]) {
      const address = origin + '/player/games/game.example' + path;
      await data.put(
        address,
        new Response('saved ' + path, {
          headers: {
            'Content-Type': type,
            'X-Timebomb-Desktop': 'old',
            'X-Playdeck-Transform': 'old:full:asset',
          },
        }),
      );
      await metadata.put(address, Response.json({ checkedAt: 0 }));
      assert.equal(
        await (await localFetch(new Request(address, { cache: 'reload' }), event)).text(),
        'saved ' + path,
      );
    }
    assert.equal(calls.length, 0);
  }));
test('cache-busting queries reuse saved static files, while documents retain query semantics', async () =>
  fixture(async ({ data, event, calls, finish }) => {
    const script = origin + '/player/games/game.example/engine.js';
    await data.put(
      script + '?cacheBust=old',
      new Response('local engine', { headers: { 'Content-Type': 'text/javascript' } }),
    );
    assert.equal(
      await (await localFetch(new Request(script + '?cacheBust=new'), event)).text(),
      'local engine',
    );
    assert.equal(calls.length, 0);
    const document = origin + '/player/games/game.example/index.html';
    await data.put(
      document + '?level=1',
      new Response('level 1', { headers: { 'Content-Type': 'text/html' } }),
    );
    assert.equal(
      await (await localFetch(new Request(document + '?level=2'), event)).text(),
      'saved asset',
    );
    await finish();
    assert.equal(calls.length, 1);
    await data.put(
      url + '?assetId=1',
      new Response('asset 1', { headers: { 'Content-Type': 'application/octet-stream' } }),
    );
    assert.equal(
      await (await localFetch(new Request(url + '?assetId=2'), event)).text(),
      'saved asset',
    );
    await finish();
    assert.equal(calls.length, 2);
  }));
test('large saved files and large byte ranges use local storage without online checks', async () =>
  fixture(async ({ calls, event, finish, setUpstream }) => {
    const size = MAX_CACHE_BYTES + 1024;
    setUpstream(
      async () =>
        new Response(new Uint8Array(size).fill(42), {
          headers: { 'Content-Length': String(size) },
        }),
    );
    assert.equal(
      (await (await localFetch(new Request(url, { cache: 'no-store' }), event)).arrayBuffer())
        .byteLength,
      size,
    );
    await finish();
    const range = await localFetch(
      new Request(url, { headers: { Range: 'bytes=8388607-8388610' } }),
      event,
    );
    assert.equal(range.status, 206);
    assert.deepEqual([...new Uint8Array(await range.arrayBuffer())], [42, 42, 42, 42]);
    assert.equal(calls.length, 1);
    const sparse = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(4));
          controller.close();
        },
      }),
      { headers: { 'Content-Length': '1000000000' } },
    );
    sparse.blob = () => {
      throw new Error('Do not buffer a large cached file');
    };
    assert.equal((await (await cachedRange(sparse, 'bytes=0-3')).arrayBuffer()).byteLength, 4);
    assert.equal((await cachedRange(new Response(''), 'bytes=0-3')).status, 416);
  }));
test('ranged downloads are retained and repeat range requests preserve their 206 headers locally', async () =>
  fixture(async ({ event, finish, calls, setUpstream }) => {
    setUpstream(
      async () =>
        new Response('part', {
          status: 206,
          headers: { 'Content-Range': 'bytes 10-13/100', 'Content-Length': '4' },
        }),
    );
    const request = () => new Request(url, { headers: { Range: 'bytes=10-13' } });
    const first = await localFetch(request(), event);
    assert.equal(first.status, 206);
    assert.equal(await first.text(), 'part');
    await finish();
    setUpstream(async () => {
      throw new Error('Range must load locally');
    });
    const second = await localFetch(request(), event);
    assert.equal(second.status, 206);
    assert.equal(second.headers.get('Content-Range'), 'bytes 10-13/100');
    assert.equal(await second.text(), 'part');
    assert.equal(calls.length, 1);
  }));
test('a request arriving during a save waits for local bytes instead of starting a second download', async () =>
  fixture(async ({ calls, event, finish }) => {
    const first = await localFetch(new Request(url), event);
    const duplicate = localFetch(new Request(url), event);
    assert.equal(await first.text(), 'saved asset');
    await finish();
    assert.equal(await (await duplicate).text(), 'saved asset');
    assert.equal(calls.length, 1);
  }));
test('storage errors and interrupted transfers leave the live game stream working without saving corrupt files', async () => {
  const request = new Request(url),
    waits = [],
    event = { waitUntil: (p) => waits.push(p) };
  const full = cacheAsset(
    {
      put: async () => {
        throw new DOMException('Full', 'QuotaExceededError');
      },
    },
    request,
    new Response('live game bytes'),
    event,
  );
  assert.equal(await full.text(), 'live game bytes');
  await Promise.all(waits);
  const data = new MemoryCache();
  waits.length = 0;
  let count = 0;
  const broken = new Response(
    new ReadableStream({
      pull(controller) {
        if (count++ === 0) controller.enqueue(new Uint8Array([1, 2]));
        else controller.error(new Error('Connection lost'));
      },
    }),
  );
  await assert.rejects(cacheAsset(data, request, broken, event).arrayBuffer(), /Connection lost/);
  await Promise.all(waits);
  assert.equal(await data.match(request), undefined);
});

test('player code updates replace old UI cache while saved game bytes stay local', async () =>
  fixture(async ({ data, event, finish, calls, setUpstream }) => {
    const script = origin + '/player/boot.js';
    await data.put(script, new Response('old UI'));
    await data.put(url, new Response('saved game'));
    setUpstream(async (request) => {
      assert.equal(request.cache, 'no-cache');
      return new Response('new UI with icons');
    });
    assert.equal(
      await (await shellFetch(new Request(script + '?v=player-updates-1'), event)).text(),
      'new UI with icons',
    );
    await finish();
    assert.equal(await (await data.match(script)).text(), 'new UI with icons');
    assert.equal(
      await (await localFetch(new Request(url, { cache: 'reload' }), event)).text(),
      'saved game',
    );
    assert.equal(calls.length, 1);
  }));
test('player UI still works offline and failed updates cannot replace its last good files', async () =>
  fixture(async ({ data, event, setUpstream }) => {
    const script = origin + '/player/boot.js';
    await data.put(script, new Response('working UI'));
    setUpstream(async () => {
      throw new Error('Offline');
    });
    assert.equal(await (await shellFetch(new Request(script), event)).text(), 'working UI');
    setUpstream(async () => new Response('server error', { status: 503 }));
    assert.equal(await (await shellFetch(new Request(script), event)).text(), 'working UI');
    assert.equal(await (await data.match(script)).text(), 'working UI');
  }));

test('integrity-protected assets keep original bytes separate from rewritten downloads', async () =>
  fixture(async ({ data, calls, event, finish, setUpstream }) => {
    const script = origin + '/player/games/game.example/engine.js';
    await data.put(
      script,
      new Response('rewritten script', { headers: { 'Content-Type': 'text/javascript' } }),
    );
    const integrity = 'sha256-' + Buffer.from('digest').toString('base64');
    setUpstream(async (request) => {
      assert.equal(request.headers.get('X-Playdeck-Integrity'), integrity);
      return new Response('original script', { headers: { 'Content-Type': 'text/javascript' } });
    });
    const request = new Request(script, { integrity });
    assert.equal(await (await localFetch(request, event)).text(), 'original script');
    await finish();
    setUpstream(async () => {
      throw Error('Should read locally');
    });
    assert.equal(await (await localFetch(request, event)).text(), 'original script');
    assert.equal(await (await localFetch(new Request(script), event)).text(), 'rewritten script');
    assert.equal(calls.length, 1);
  }));

test('removed portable rewrites refresh once while downloaded binary data stays local', async () =>
  fixture(async ({ data, event, calls, finish, setUpstream }) => {
    const page = origin + '/player/games/game.example/index.html';
    await data.put(
      page,
      new Response('old spoofed page', {
        headers: { 'Content-Type': 'text/html', 'X-Playdeck-Transform': 'hash-cache-1:full:asset' },
      }),
    );
    await data.put(url, new Response('saved binary'));
    setUpstream(
      async () =>
        new Response('native page', {
          headers: {
            'Content-Type': 'text/html',
            'X-Playdeck-Transform': 'native-location-1:full:asset',
          },
        }),
    );
    assert.equal(await (await localFetch(new Request(page), event)).text(), 'native page');
    await finish();
    assert.equal(await (await localFetch(new Request(page), event)).text(), 'native page');
    assert.equal(await (await localFetch(new Request(url), event)).text(), 'saved binary');
    assert.equal(calls.length, 1);
  }));

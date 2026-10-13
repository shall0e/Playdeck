import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {recoverGameRequest} from '../website/player/session.js';
import {recoverAssetRequest} from '../website/player/sw.js';
import worker, {
  bootstrap,
  proxyURL,
  rewriteJS,
  targetFromProxy,
  cookiePrefix,
  scopedCookie,
} from '../website/_worker.js';
const origin = 'https://playdeck-1z1.pages.dev';
function hook(base, documentBase = origin + '/__game/v4/vel.gg/bo1z/') {
  const calls = [];
  const context = vm.createContext({
    URL,
    Request,
    document: { baseURI: documentBase },
    fetch: (...args) => {
      calls.push(args);
      return Promise.resolve(new Response('ok'));
    },
  });
  vm.runInContext(bootstrap(base, origin, true), context);
  return { context, calls };
}
test('runtime requests use the current document base, including a trailing slash', async () => {
  const { context, calls } = hook('https://vel.gg/bo1z');
  await context.fetch('art/mapselect-row-kino.webp');
  assert.equal(calls[0][0], origin + '/__game/v4/vel.gg/bo1z/art/mapselect-row-kino.webp');
  context.document.baseURI = origin + '/__game/v4/vel.gg/bo1z/changed/';
  await context.fetch('asset.bin');
  assert.equal(calls[1][0], origin + '/__game/v4/vel.gg/bo1z/changed/asset.bin');
});
test('already-proxied pathnames and URLs are never proxied twice', async () => {
  const { context, calls } = hook('https://vel.gg/bo1z');
  for (const value of [
    '/__game/v4/vel.gg/bo1z/engine-download-worker.js?map=kino',
    origin + '/__game/v4/vel.gg/bo1z/maps.js',
  ])
    await context.fetch(value);
  assert.equal(calls[0][0], origin + '/__game/v4/vel.gg/bo1z/engine-download-worker.js?map=kino');
  assert.equal(calls[1][0], origin + '/__game/v4/vel.gg/bo1z/maps.js');
});
test('location.origin-based URLs map to the remote root, and Request bodies survive', async () => {
  const { context, calls } = hook('https://vel.gg/bo1z');
  await context.fetch(origin + '/bo1z/manifest.json');
  assert.equal(calls[0][0], origin + '/__game/v4/vel.gg/bo1z/manifest.json');
  await context.fetch(new Request('https://vel.gg/api', { method: 'POST', body: 'payload' }));
  assert.equal(calls[1][0].url, origin + '/__game/v4/vel.gg/api');
  assert.equal(await calls[1][0].text(), 'payload');
});
test('module imports are rewritten without changing ordinary origin literals', () => {
  const source = `const origin='https://vel.gg'; import x from '/bo1z/maps.js'; import('https://vel.gg/bo1z/engine.js');`;
  const result = rewriteJS(source, 'https://vel.gg/bo1z/play.js', origin);
  assert.ok(result.includes("const origin='https://vel.gg'"));
  assert.ok(result.includes("from '" + origin + "/__game/v4/vel.gg/bo1z/maps.js'"));
  assert.ok(result.includes("import('" + origin + "/__game/v4/vel.gg/bo1z/engine.js')"));
  assert.equal(
    proxyURL('blob:https://vel.gg/123', 'https://vel.gg', origin),
    'blob:https://vel.gg/123',
  );
});
test('queries are retained when converting proxy requests back upstream', () => {
  assert.equal(
    targetFromProxy(new URL(origin + '/__game/v4/vel.gg/bo1z/file.bin?a=1&b=2')).href,
    'https://vel.gg/bo1z/file.bin?a=1&b=2',
  );
});
test('proxy keeps integrity-checked script bytes and scopes isolation to the proxy host', async () => {
  const originalFetch = globalThis.fetch;
  const source = `const upstream='https://kerbalspaceprogram.pages.dev';`;
  globalThis.fetch = async (url) =>
    String(url).includes('raw.githubusercontent.com')
      ? Response.json({
          games: [
            { playUrl: 'https://kerbalspaceprogram.pages.dev/' },
            { playUrl: 'https://irv77.github.io/hd_fnaf/3/' },
          ],
        })
      : new Response(source, { headers: { 'Content-Type': 'application/javascript' } });
  try {
    const response = await worker.fetch(
      new Request(origin + '/__game/v4/any-game.example/core.js', {
        headers: { 'X-Playdeck-Integrity': 'sha256-test' },
      }),
      {},
    );
    assert.equal(await response.text(), source);
    assert.equal(response.headers.get('Cross-Origin-Embedder-Policy'), 'credentialless');
    assert.equal(response.headers.get('Cross-Origin-Resource-Policy'), 'cross-origin');
    assert.equal(
      (await worker.fetch(new Request(origin + '/__game/v4/new-cdn.example/core.js'), {})).status,
      200,
    );
    assert.equal(
      (await worker.fetch(new Request('https://timebomb.lol/__game/v4/vel.gg/bo1z'), {})).status,
      403,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test('archive HEAD requests retry transient errors and preserve original byte counts', async () => {
  const originalFetch = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = async (url, options) => {
    assert.equal(options.headers.get('accept-encoding'), 'identity');
    if (++attempts === 1) return new Response('temporary not found', { status: 404 });
    assert.equal(options.headers.get('cache-control'), 'no-cache');
    return new Response(null, {
      headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': '9530244' },
    });
  };
  try {
    const response = await worker.fetch(
      new Request(origin + '/__game/v4/irv77.github.io/hd_fnaf/3/src/resources.zip.part6', {
        method: 'HEAD',
      }),
      {},
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Content-Length'), '9530244');
    assert.equal(attempts, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('asset reads recover after two transient upstream failures', async () => {
  const originalFetch = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = async () =>
    ++attempts < 3 ? new Response('temporary', { status: 404 }) : new Response('verified asset');
  try {
    const response = await worker.fetch(
      new Request(origin + '/__game/v4/irv77.github.io/game/data.bin'),
      {},
    );
    assert.equal(await response.text(), 'verified asset');
    assert.equal(attempts, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('KSP admission POST reaches upstream once and preserves its rate limit', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(url, 'https://kerbalspaceprogram.pages.dev/api/offline-admission');
    assert.equal(options.method, 'POST');
    return Response.json(
      { allowed: false, retryAfterSeconds: 3600 },
      { status: 429, headers: { 'Retry-After': '3600' } },
    );
  };
  try {
    const response = await worker.fetch(
      new Request(origin + '/__game/v4/kerbalspaceprogram.pages.dev/api/offline-admission', {
        method: 'POST',
      }),
      {},
    );
    assert.equal(response.status, 429);
    assert.equal(response.headers.get('Retry-After'), '3600');
    assert.equal((await response.json()).allowed, false);
    assert.equal(calls, 1);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('custom game download markers are preserved for approved dependencies', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(options.headers.get('X-KSP-Offline-Download'), '1');
    return new Response('pack', { headers: { 'Content-Type': 'application/octet-stream' } });
  };
  try {
    for (const host of ['kerbalspaceprogram.pages.dev', 'irv77.github.io']) {
      const response = await worker.fetch(
        new Request(origin + '/__game/v4/' + host + '/standard-0000.pack', {
          headers: { 'X-KSP-Offline-Download': '1' },
        }),
        {},
      );
      assert.equal(response.status, 200);
      assert.equal(await response.text(), 'pack');
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('game API bodies and content types survive without replaying failed writes', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.get('content-type'), 'application/json');
    assert.equal(options.headers.get('X-Game-Version'), '7');
    assert.equal(options.headers.get('authorization'), null);
    assert.equal(await new Response(options.body).text(), '{"start":true}');
    return Response.json({ error: 'unavailable' }, { status: 503 });
  };
  try {
    const response = await worker.fetch(
      new Request(origin + '/__game/v4/irv77.github.io/api/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Game-Version': '7',
          authorization: 'launcher-secret',
        },
        body: '{"start":true}',
      }),
      {},
    );
    assert.equal(response.status, 503);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('cookies retain upstream paths, expiry and separation between game hosts', () => {
  const target = new URL('https://irv77.github.io/game/api/start');
  const cookie = scopedCookie(
    'session=abc; Domain=github.io; Path=/game/; Max-Age=60; HttpOnly; SameSite=Strict',
    target,
  );
  assert.ok(cookie.startsWith(cookiePrefix(target.hostname) + 'session=abc;'));
  assert.match(cookie, /Path=\/__game\/v4\/irv77.github.io\/game\//);
  assert.match(cookie, /Max-Age=60; HttpOnly/);
  assert.ok(!cookie.includes('Domain='));
  assert.notEqual(cookiePrefix('irv77.github.io'), cookiePrefix('kerbalspaceprogram.pages.dev'));
});

test('document cookies use original names while browser storage stays namespaced', () => {
  let raw =
    cookiePrefix('irv77.github.io') +
    'session=ok; ' +
    cookiePrefix('kerbalspaceprogram.pages.dev') +
    'secret=hidden';
  const document = { baseURI: origin + '/__game/v4/irv77.github.io/game/' };
  Object.defineProperty(document, 'cookie', {
    configurable: true,
    get: () => raw,
    set: (value) => {
      raw = value;
    },
  });
  class Element {
    setAttribute() {}
  }
  const context = vm.createContext({
    URL,
    Request,
    document,
    Element,
    fetch: () => {},
    navigator: {},
    history: { pushState() {}, replaceState() {} },
    addEventListener() {},
  });
  context.window = context;
  vm.runInContext(bootstrap('https://irv77.github.io/game/', origin, true), context);
  assert.equal(document.cookie, 'session=ok');
  document.cookie = 'save=123; Path=/game/; Domain=github.io; Max-Age=60';
  assert.ok(raw.startsWith(cookiePrefix('irv77.github.io') + 'save=123;'));
  assert.match(raw, /Path=\/__game\/v4\/irv77.github.io\/game\//);
  assert.ok(!raw.includes('Domain='));
  assert.match(raw, /SameSite=None; Partitioned/);
});

test('redirects preserve admission cookies and browser method semantics', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(null, {
      status: 303,
      headers: { Location: '/next', 'Set-Cookie': 'session=ok; Path=/; HttpOnly' },
    });
  try {
    const response = await worker.fetch(
      new Request(origin + '/__game/v4/irv77.github.io/start', { method: 'POST' }),
      {},
    );
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), origin + '/__game/v4/irv77.github.io/next');
    assert.ok(
      response.headers
        .get('set-cookie')
        .startsWith(cookiePrefix('irv77.github.io') + 'session=ok;'),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('KSP admission cookie is partitioned, scoped and sent only to its packs', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (options.method === 'POST')
      return Response.json(
        { allowed: true },
        {
          headers: {
            'Set-Cookie':
              'ksp_offline_pack=123.abc; Path=/OfflinePacks/; Secure; HttpOnly; SameSite=Strict',
          },
        },
      );
    assert.equal(
      options.headers.get('cookie'),
      String(url).includes('kerbalspaceprogram.pages.dev/') ? 'ksp_offline_pack=123.abc' : null,
    );
    return new Response('pack');
  };
  try {
    const response = await worker.fetch(
      new Request(origin + '/__game/v4/kerbalspaceprogram.pages.dev/api/offline-admission', {
        method: 'POST',
      }),
      {},
    );
    assert.match(
      response.headers.get('set-cookie'),
      /Path=\/__game\/v4\/kerbalspaceprogram.pages.dev\/OfflinePacks\/; Secure; SameSite=None; Partitioned/,
    );
    assert.match(response.headers.get('set-cookie'), /HttpOnly/);
    for (const route of [
      'kerbalspaceprogram.pages.dev/OfflinePacks/standard-0000.pack',
      'irv77.github.io/OfflinePacks/standard-0000.pack',
      'kerbalspaceprogram.pages.dev/core.js',
    ]) {
      await worker.fetch(
        new Request(origin + '/__game/v4/' + route, {
          headers: {
            cookie:
              'launcher_secret=secret; ' +
              cookiePrefix('kerbalspaceprogram.pages.dev') +
              'ksp_offline_pack=123.abc',
          },
        }),
        {},
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('new dependency hosts and changing CDN redirects work without catalog configuration', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url) === 'https://old-assets.example/pack.bin')
      return new Response(null, {
        status: 307,
        headers: { Location: 'https://new-assets.example/pack.bin' },
      });
    return new Response('game asset', { headers: { 'Content-Type': 'application/octet-stream' } });
  };
  try {
    for (const prefix of ['/__game/v4/', '/player/games/']) {
      const asset = await worker.fetch(
        new Request(origin + prefix + 'new-assets.example/data.bin'),
        {},
      );
      assert.equal(await asset.text(), 'game asset');
      const redirect = await worker.fetch(
        new Request(origin + prefix + 'old-assets.example/pack.bin'),
        {},
      );
      assert.equal(redirect.status, 307);
      assert.equal(
        redirect.headers.get('Location'),
        origin + prefix + 'new-assets.example/pack.bin',
      );
      const next = await worker.fetch(new Request(redirect.headers.get('Location')), {});
      assert.equal(await next.text(), 'game asset');
    }
    assert(calls.every((url) => !url.includes('raw.githubusercontent.com')));
    for (const host of [
      '127.0.0.1',
      'localhost',
      'private.internal',
      new URL(origin).hostname,
      'timebomb.lol',
    ]) {
      assert.equal(
        (await worker.fetch(new Request(origin + '/__game/v4/' + host + '/asset'), {})).status,
        403,
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('escaped root asset requests recover through the requesting game sandbox', async () => {
  const originalFetch=globalThis.fetch, calls=[];
  globalThis.fetch=async url=>{calls.push(String(url));return Response.json({packs:[]});};
  try {
    const referrer=origin+'/player/games/.launch/12345678-abcd/full/101/gameid/zombies.mdelworkstation.cc/index.html';
    const response=await worker.fetch(new Request(origin+'/packs/zm_transit/dist/manifest.json',{headers:{referer:referrer}}),{ASSETS:{fetch(){throw Error('Game assets must not hit the Playdeck website');}}});
    assert.deepEqual(await response.json(),{packs:[]});
    assert.equal(calls[0],'https://zombies.mdelworkstation.cc/packs/zm_transit/dist/manifest.json');
  } finally {globalThis.fetch=originalFetch;}
});

test('native root asset requests recover using referrer when client is launcher or worker', () => {
  const request=new Request(origin+'/packs/zm_transit/dist/manifest.json');
  const client=origin+'/player/';
  const game=origin+'/player/games/.launch/12345678-abcd/full/101/gameid/zombies.mdelworkstation.cc/index.html';
  const routed=recoverGameRequest(request,[client,game]);
  assert.equal(new URL(routed.url).pathname,'/player/games/.launch/12345678-abcd/full/101/gameid/zombies.mdelworkstation.cc/packs/zm_transit/dist/manifest.json');
});
test('unrelated source requests remain untouched without game context', () => {
  const request=new Request(origin+'/packs/zm_transit/dist/manifest.json');
  assert.equal(recoverGameRequest(request,[origin+'/player/',origin+'/']).url,request.url);
});
test('asset fetch fallback uses only the initiating launcher session and keeps player shell local', () => {
  const session={
    session:'12345678-abcd',game:'gameid',
    prefix:'/player/games/.launch/12345678-abcd/full/101/gameid/',
    sourceURL:'https://zombies.mdelworkstation.cc/'
  };
  const request=new Request(origin+'/packs/zm_transit/dist/manifest.json');
  const routed=recoverAssetRequest(request,{clientURL:origin+'/player/?url=https%3A%2F%2Fzombies.mdelworkstation.cc%2F',session});
  assert.equal(new URL(routed.url).pathname,session.prefix+'zombies.mdelworkstation.cc/packs/zm_transit/dist/manifest.json');
  const unrelated=recoverAssetRequest(new Request(origin+'/player/version.js'),{clientURL:origin+'/player/',session});
  assert.equal(new URL(unrelated.url).pathname,'/player/version.js');
  const invalid=recoverAssetRequest(request,{clientURL:origin+'/player/',session:{...session,game:'another'}});
  assert.equal(invalid.url,request.url);
});

test('launcher URL recovers root JSON and binary assets after service worker loses session state', () => {
  const launcher=origin+'/player/?url='+encodeURIComponent('https://zombies.mdelworkstation.cc/');
  for (const file of ['/packs/zm_transit/dist/manifest.json','/packs/zm_transit/dist/level.data']) {
    const request=new Request(origin+file);
    const recovered=recoverAssetRequest(request,{clientURL:launcher});
    assert.equal(new URL(recovered.url).pathname,'/player/games/zombies.mdelworkstation.cc'+file);
    assert.equal(recoverGameRequest(request,[launcher]).url,recovered.url);
  }
  assert.equal(recoverGameRequest(new Request(origin+'/player/version.js'),[launcher]).url,origin+'/player/version.js');
  assert.equal(recoverGameRequest(new Request(origin+'/games.json'),[launcher]).url,origin+'/games.json');
  assert.equal(recoverGameRequest(new Request(origin+'/packs/zm_transit/dist/manifest.json'),[origin+'/player/?url=http%3A%2F%2Funsafe.test%2F']).url,origin+'/packs/zm_transit/dist/manifest.json');
});

test('server proxy recovers root manifest from launcher referrer if service worker is absent', async () => {
  const originalFetch=globalThis.fetch,calls=[];
  globalThis.fetch=async url=>{calls.push(String(url));return Response.json({packs:[]});};
  try {
    const launcher=origin+'/player/?url='+encodeURIComponent('https://zombies.mdelworkstation.cc/');
    const response=await worker.fetch(
      new Request(origin+'/packs/zm_transit/dist/manifest.json',{headers:{referer:launcher}}),
      {ASSETS:{fetch(){throw Error('Missing game assets must not hit Pages HTML fallback');}}}
    );
    assert.deepEqual(await response.json(),{packs:[]});
    assert.equal(calls[0],'https://zombies.mdelworkstation.cc/packs/zm_transit/dist/manifest.json');
  } finally {globalThis.fetch=originalFetch;}
});

test('generated blob workers rewrite engine network requests before fetching packs',async()=>{
  const blobs=new Map(),calls=[];
  class MockURL extends URL {
    static createObjectURL(blob){const url='blob:'+origin+'/'+(blobs.size+1);blobs.set(url,blob);return url;}
    static revokeObjectURL(url){blobs.delete(url);}
  }
  class MockWorker {
    constructor(url){this.url=url;this.script=blobs.get(url);}
  }
  const realm=vm.createContext({URL:MockURL,Blob,Request,Worker:MockWorker,fetch:()=>Promise.resolve(new Response('ok'))});
  vm.runInContext(bootstrap('https://zombies.mdelworkstation.cc/',origin,true),realm);
  const source=realm.URL.createObjectURL(new Blob(["fetch('/packs/zm_transit/dist/manifest.json')"],{type:'text/javascript'}));
  const instance=new realm.Worker(source);
  const script=await instance.script.text();
  assert.ok(script.includes('__playdeckMap'));
  const runtime=vm.createContext({URL:MockURL,Blob,Request,fetch:value=>{calls.push(value);return Promise.resolve(new Response('ok'));}});
  vm.runInContext(script,runtime);
  assert.equal(calls[0],origin+'/__game/v4/zombies.mdelworkstation.cc/packs/zm_transit/dist/manifest.json');
});

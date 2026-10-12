import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { rewriteGameCompatibility, rewriteJS, bootstrap } from '../website/_worker.js';

test('module and worker compatibility applies across arbitrary hosts and folders', () => {
  for (const base of [
    'https://alpha.example/game/engine.mjs',
    'https://beta.example/other/capability-worker.js',
    'https://gamma.example/download.worker.js',
  ]) {
    const result = rewriteGameCompatibility('globalThis.started=true;', base, '/player/games/');
    assert.ok(result.includes('installS3TC'));
    assert.ok(result.endsWith('globalThis.started=true;'));
  }
  assert.equal(
    rewriteGameCompatibility('const x=1;', 'https://alpha.example/game/ui.js', '/player/games/'),
    'const x=1;',
  );
});

test('integrity scripts stay byte-identical without leaking proxy metadata upstream', async () => {
  const originalFetch = globalThis.fetch;
  const source = "import x from './engine.mjs'; const path=location.pathname;";
  globalThis.fetch = async (url, options) => {
    assert.equal(options.headers.get('X-Playdeck-Integrity'), null);
    return new Response(source, {
      headers: { 'Content-Type': 'text/javascript', 'Content-Length': String(source.length) },
    });
  };
  try {
    for (const host of ['alpha.example', 'beta.example']) {
      const request = new Request('https://player.example/player/games/' + host + '/engine.mjs', {
        integrity: 'sha256-' + Buffer.from('digest').toString('base64'),
      });
      const response = await worker.fetch(request, {});
      assert.equal(response.status, 200);
      assert.equal(await response.text(), source);
      assert.equal(response.headers.get('X-Playdeck-Transform'), null);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('scripts fetched as data preserve bytes for custom checksum loaders', async () => {
  const previous = globalThis.fetch;
  const source = "import './engine.mjs'; const here=location.href;";
  globalThis.fetch = async () =>
    new Response(source, { headers: { 'Content-Type': 'text/javascript' } });
  try {
    const response = await worker.fetch(
      new Request('https://player.example/player/games/any-game.example/core.js', {
        headers: { 'sec-fetch-dest': 'empty' },
      }),
      {},
    );
    assert.equal(await response.text(), source);
    assert.equal(response.headers.get('X-Playdeck-Transform'), null);
  } finally {
    globalThis.fetch = previous;
  }
});

test('game scripts keep native browser location and no portable identity is injected', () => {
  const source =
    'const url=location.href; const origin=window.location.origin; const path=document.location.pathname;';
  assert.equal(
    rewriteJS(source, 'https://game.example/main.js', 'https://player.example', '/player/games/'),
    source,
  );
  assert.ok(
    !bootstrap('https://game.example/', 'https://player.example', true, '/player/games/').includes(
      '__playdeckSourceLocation',
    ),
  );
});

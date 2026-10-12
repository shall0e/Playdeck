import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateSettings,
  matchesBind,
  readSettings,
  readGameSettings,
  writeGameSettings,
} from '../website/player/settings.js';
import { displayConfig } from '../website/player/display.js';
import { readFileSync } from 'node:fs';
test('player settings reject executable or credential-bearing destinations', () => {
  for (const panicURL of [
    'javascript:alert(1)',
    'http://example.com',
    'https://user:secret@example.com',
  ])
    assert.throws(() => validateSettings({ panicURL }));
  const value = validateSettings({
    forceController: true,
    panicURL: 'https://docs.google.com',
    panicBind: { code: 'KeyP', ctrl: true },
  });
  assert.equal(value.panicURL, 'https://docs.google.com/');
  assert.equal(value.forceController, true);
  assert.equal(
    matchesBind(
      {
        code: 'KeyP',
        ctrlKey: true,
        altKey: false,
        shiftKey: false,
        metaKey: false,
        repeat: false,
      },
      value.panicBind,
    ),
    true,
  );
  assert.equal(matchesBind({ code: 'KeyP', ctrlKey: false }, value.panicBind), false);
});
test('existing Playdeck preferences win over catalog migration and storage failures use defaults', () => {
  const old = globalThis.localStorage;
  try {
    let saved = JSON.stringify(
      validateSettings({ forceController: true, panicURL: 'https://example.com/' }),
    );
    globalThis.localStorage = { getItem: () => saved, setItem: (_key, value) => (saved = value) };
    assert.equal(
      readSettings({ panicURL: 'https://other.example/' }).panicURL,
      'https://example.com/',
    );
    saved = null;
    assert.equal(readSettings({ forceController: true }).forceController, false);
    globalThis.localStorage = {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('blocked');
      },
    };
    assert.equal(readSettings({}).panicURL, 'https://docs.google.com/');
  } finally {
    if (old === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = old;
  }
});
test('display configuration accepts normalized catalog data without injecting markup', () => {
  assert.deepEqual(displayConfig({ ratios: ['1:1', '16:9'], ratio: '1:1', mode: 'fit' }), {
    ratios: ['1:1', '16:9'],
    ratio: '1:1',
    mode: 'stretch',
  });
  assert.equal(displayConfig(null), null);
  assert.equal(displayConfig(true).ratio, '16:9');
  assert.equal(displayConfig(true).mode, 'stretch');
  assert.throws(() => displayConfig({ ratios: ['bad'] }));
});
test('loading viewport clips overflow; settings retain their own scrolling', () => {
  const css = readFileSync(new URL('../website/player-ui.css', import.meta.url), 'utf8').replace(/\s+/g,'');
  assert.match(
    css,
    /#loading\.loading,#loading\{position:fixed!important[^}]*overflow:hidden!important/,
  );
  assert.match(css, /overflow:auto!important/);
  assert.match(css, /#game-menu-bar\{opacity:0;pointer-events:none/);
  const boot = readFileSync(new URL('../website/player/boot.js', import.meta.url), 'utf8');
  assert.ok(!boot.includes('Hide toolbar'));
  assert.ok(!boot.includes("$('#badge').textContent=`Local sandbox"));
  assert.ok(boot.includes("toolbarIcon('settings')"));
  assert.ok(boot.includes("register('/player/sw.js'"));
});

test('forced mapping is saved per game and does not leak into another game or global defaults', () => {
  const old = globalThis.localStorage,
    values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
  };
  try {
    writeGameSettings('https://game.example/a/', { forceController: true });
    assert.equal(readGameSettings('https://game.example/a/').forceController, true);
    assert.equal(readGameSettings('https://game.example/b/').forceController, false);
    assert.equal(readSettings({ forceController: true }).forceController, false);
  } finally {
    if (old === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = old;
  }
});

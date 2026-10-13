import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('every Playdeck menu shares an unfilled compact control system', () => {
  const css=readFileSync(new URL('../website/player/deck.css',import.meta.url),'utf8');
  const controller=readFileSync(new URL('../website/player/controller.js',import.meta.url),'utf8');
  const agents=readFileSync(new URL('../AGENTS.md',import.meta.url),'utf8');
  assert.match(css,/--playdeck-menu-width:\s*258px/);
  assert.match(css,/--playdeck-menu-border:\s*1px solid rgba\(255,255,255/);
  assert.match(css,/#game-menu-bar \.game-menu-panel/);
  assert.match(css,/#game-menu-bar \.display-panel/);
  assert.match(css,/body > #panel/);
  assert.match(css,/background:transparent!important/);
  assert.match(css,/select::picker\(select\)/);
  assert.match(controller,/--playdeck-menu-border/);
  assert.match(controller,/grid-template-columns:54px minmax\(0,1fr\) 68px/);
  assert.match(controller,/background:transparent!important/);
  assert.match(agents,/one change applies everywhere/i);
});
test('settings categories own their existing controls without breaking saved values',()=>{
  const settings=readFileSync(new URL('../website/player/settings.js',import.meta.url),'utf8');
  const deck=readFileSync(new URL('../website/player/deck.js',import.meta.url),'utf8');
  const css=readFileSync(new URL('../website/player/deck.css',import.meta.url),'utf8');
  const controller=readFileSync(new URL('../website/player/controller.js',import.meta.url),'utf8');
  assert.match(settings,/<details class="deck-section" data-misc-settings><summary>Misc<\/summary>/);
  assert.match(settings,/const forceControl = form.querySelector/);
  assert.match(deck,/compatibility.append\(forceMappingRow\)/);
  assert.match(deck,/\['\.download-row','#storage-note','#clear'\]/);
  assert.match(css,/--playdeck-menu-border: 1px solid rgba\(255,255,255,\.50\)/);
  assert.match(css,/#toolbar-edge::after \{display:none!important\}/);
  assert.match(css,/scrollbar-gutter:auto!important/);
  assert.match(controller,/#panel #keybind-options > summary::after \{content:none!important/);
});

test('glass buttons are filled, transparent mode remains unfilled, and anchored menus never scale',()=>{
  const css=readFileSync(new URL('../website/player/deck.css',import.meta.url),'utf8');
  const chrome=readFileSync(new URL('../website/player-ui.css',import.meta.url),'utf8');
  const shadow=readFileSync(new URL('../website/player/controller.js',import.meta.url),'utf8');
  const toolbar=readFileSync(new URL('../website/player/toolbar.js',import.meta.url),'utf8');
  assert.match(css,/--playdeck-control-bg: rgba\(255,255,255,\.095\)/);
  assert.match(css,/--playdeck-control-bg: transparent/);
  assert.match(css,/background: var\(--playdeck-control-bg\) !important/);
  assert.match(shadow,/var\(--playdeck-control-bg/);
  assert.doesNotMatch(chrome,/#game-menu-bar\.is-visible > \*\s*\{\s*animation:/);
  assert.doesNotMatch(css,/scale:\.955/);
  assert.doesNotMatch(shadow,/scale:\.955/);
  assert.match(toolbar,/doc\.addEventListener\('pointerdown', dismiss/);
});

test('open menus gate iframe hit testing and restore input after close', () => {
  const css=readFileSync(new URL('../website/player-ui.css',import.meta.url),'utf8');
  const ctrl=readFileSync(new URL('../website/player/controller.js',import.meta.url),'utf8');
  assert.match(css,/body:has\(#game-menu-bar \.game-menu\[open\]/);
  assert.match(css,/body\.playdeck-controller-menu-open > iframe/);
  assert.match(css,/pointer-events:none!important/);
  assert.match(ctrl,/document\.body\.classList\.toggle\('playdeck-controller-menu-open',value\)/);
});

test('viewport-sized pointer-transparent toolbar lets menus receive clicks beyond button row',()=>{
  const css=readFileSync(new URL('../website/player-ui.css',import.meta.url),'utf8');
  assert.match(css,/width:100vw!important;max-width:none!important/);
  assert.match(css,/height:100dvh!important/);
  assert.match(css,/#game-menu-bar > \* \{[\s\S]*?pointer-events:auto!important/);
  assert.match(css,/pointer-events:none!important/);
});

test('empty areas of visible fullscreen toolbar pass clicks through to game',()=>{
  const css=readFileSync(new URL('../website/player-ui.css',import.meta.url),'utf8');
  assert.match(css,/#game-menu-bar\.is-visible \{pointer-events:none!important\}/);
  assert.match(css,/#game-menu-bar\.is-visible > \* \{pointer-events:auto!important\}/);
});

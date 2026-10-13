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
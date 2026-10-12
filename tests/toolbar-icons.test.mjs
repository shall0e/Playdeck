import test from 'node:test';
import assert from 'node:assert/strict';
import { iconMarkup, installToolbarIcons } from '../website/player/toolbar-icons.js';
test('native Playdeck toolbar icons survive label replacements without duplicates', () => {
  const previous = globalThis.MutationObserver;
  let changed;
  globalThis.MutationObserver = class {
    constructor(fn) {
      changed = fn;
    }
    observe() {}
    disconnect() {}
  };
  class Control {
    constructor() {
      this.icons = [];
      this.classList = { add() {} };
    }
    querySelector(selector) {
      const name = selector.match(/data-playdeck-icon="([^"]+)"/)?.[1];
      return this.icons.find((icon) => icon.name === name);
    }
    querySelectorAll() {
      return this.icons;
    }
    insertAdjacentHTML(position, markup) {
      const name = markup.match(/data-playdeck-icon="([^"]+)"/)[1];
      const node = {
        name,
        remove: () => {
          this.icons = this.icons.filter((value) => value !== node);
        },
      };
      this.icons.push(node);
    }
  }
  const selectors = [
    '#badge',
    '.game-menu > summary',
    '.game-display > summary',
    '[data-action="return"]',
    '[data-action="reload"]',
    '[data-action="fullscreen"]',
    '[data-action="exit"]',
    '[data-action="cast"]',
  ];
  const controls = new Map(selectors.map((selector) => [selector, new Control()]));
  try {
    const stop = installToolbarIcons({ querySelector: (selector) => controls.get(selector) });
    assert.equal([...controls.values()].flatMap((control) => control.icons).length, 8);
    changed();
    assert.equal([...controls.values()].flatMap((control) => control.icons).length, 8);
    controls.get('#badge').icons = [];
    changed();
    assert.equal(controls.get('#badge').icons[0].name, 'settings');
    assert.match(iconMarkup('menu'), /xmlns="http:\/\/www.w3.org\/2000\/svg"/);
    stop();
  } finally {
    globalThis.MutationObserver = previous;
  }
});

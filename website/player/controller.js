import { iconMarkup } from './toolbar-icons.js';
// Generic gamepad -> DOM input bridge. Profiles contain bindings, never game names.
export function controllerRuntime({ getFrame, readConfig, isPaused } = {}) {
  if (window.__timebombController) return;
  window.__timebombController = true;
  let config = null,
    paused = false,
    previous = new Map(),
    last = performance.now();
  let cursorPosition = null,
    cursorMark = null;
  const watchedDocuments = new WeakSet();
  function positionFor(element) {
    const doc = element.ownerDocument,
      rect = element.getBoundingClientRect();
    if (cursorPosition?.element !== element) {
      cursorMark?.remove();
      cursorMark = null;
      cursorPosition = { element, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }
    if (!watchedDocuments.has(doc) && doc.addEventListener) {
      watchedDocuments.add(doc);
      doc.addEventListener(
        'mousemove',
        (event) => {
          if (event.isTrusted && cursorPosition?.element.ownerDocument === doc) {
            cursorPosition.x = event.clientX;
            cursorPosition.y = event.clientY;
          }
        },
        true,
      );
    }
    cursorPosition.x = Math.max(
      rect.left,
      Math.min(rect.left + Math.max(0, rect.width - 1), cursorPosition.x),
    );
    cursorPosition.y = Math.max(
      rect.top,
      Math.min(rect.top + Math.max(0, rect.height - 1), cursorPosition.y),
    );
    return cursorPosition;
  }
  function displayCursor(element, visible) {
    if (!visible) {
      if (cursorMark) cursorMark.hidden = true;
      return;
    }
    const doc = element.ownerDocument;
    if (!cursorMark && doc.createElement) {
      cursorMark = doc.createElement('div');
      cursorMark.setAttribute('aria-hidden', 'true');
      cursorMark.style.cssText =
        'position:fixed;width:12px;height:12px;border:2px solid white;border-radius:50%;background:#1118;box-shadow:0 0 0 1px #0008;pointer-events:none;z-index:2147483647;transform:translate(-50%,-50%)';
      doc.body.append(cursorMark);
    }
    if (cursorMark) {
      cursorMark.hidden = false;
      cursorMark.style.left = cursorPosition.x + 'px';
      cursorMark.style.top = cursorPosition.y + 'px';
    }
  }
  const nativePads = navigator.getGamepads?.bind(navigator);
  const disconnectedPads = new Set();
  window.addEventListener('gamepaddisconnected', (event) => {
    disconnectedPads.add(event.gamepad.index);
    release();
  });
  window.addEventListener('gamepadconnected', (event) => {
    disconnectedPads.delete(event.gamepad.index);
    last = performance.now();
  });
  function target() {
    let doc;
    try {
      doc = getFrame ? getFrame()?.contentDocument : document;
    } catch {
      return null;
    }
    if (!doc?.body) return null;
    for (let depth = 0; depth < 8; depth++) {
      const active = doc.activeElement;
      const nested =
        active?.tagName === 'IFRAME'
          ? active
          : !doc.querySelector('canvas')
            ? doc.querySelector('iframe')
            : null;
      try {
        if (nested?.contentDocument?.body) {
          doc = nested.contentDocument;
          continue;
        }
      } catch {}
      break;
    }
    return (
      doc.pointerLockElement ||
      (doc.activeElement && !['BODY', 'HTML', 'IFRAME'].includes(doc.activeElement.tagName)
        ? doc.activeElement
        : doc.querySelector('canvas') || doc.body)
    );
  }
  function inputEvent(win, type, options, properties = {}) {
    const EventType = type.startsWith('key') ? win.KeyboardEvent : win.MouseEvent;
    const event = new EventType(type, options);
    // Mouse movement and legacy key fields are not consistently accepted by
    // browser event constructors. Define the values engines actually read.
    for (const [name, value] of Object.entries(properties)) {
      if (event[name] !== value) Object.defineProperty(event, name, { value, configurable: true });
    }
    return event;
  }
  function emit(binding, down, element, clickOnRelease = true) {
    if (!element?.isConnected) return;
    const win = element.ownerDocument.defaultView;
    if (binding.kind === 'key') {
      const code = binding.code;
      const key =
        binding.key ||
        (/^Key[A-Z]$/.test(code)
          ? code.slice(3).toLowerCase()
          : /^Digit/.test(code)
            ? code.slice(5)
            : code === 'Space'
              ? ' '
              : code);
      const special = {
        Enter: 13,
        Escape: 27,
        Space: 32,
        Tab: 9,
        Backspace: 8,
        ArrowLeft: 37,
        ArrowUp: 38,
        ArrowRight: 39,
        ArrowDown: 40,
        ShiftLeft: 16,
        ShiftRight: 16,
        ControlLeft: 17,
        ControlRight: 17,
        AltLeft: 18,
        AltRight: 18,
      };
      const keyCode =
        special[code] ||
        (/^Key[A-Z]$/.test(code)
          ? code.charCodeAt(3)
          : /^Digit[0-9]$/.test(code)
            ? code.charCodeAt(5)
            : 0);
      element.dispatchEvent(
        inputEvent(
          win,
          down ? 'keydown' : 'keyup',
          { key, code, bubbles: true, cancelable: true },
          { keyCode, which: keyCode, charCode: 0 },
        ),
      );
    } else if (binding.kind === 'mouse') {
      const button = binding.button;
      const rect = element.getBoundingClientRect();
      const position = config?.look?.cursor
        ? positionFor(element)
        : { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      const options = {
        button,
        which: button + 1,
        detail: 1,
        view: win,
        buttons: down ? [1, 4, 2][button] : 0,
        clientX: position.x,
        clientY: position.y,
        bubbles: true,
        cancelable: true,
      };
      element.dispatchEvent(
        inputEvent(win, down ? 'mousedown' : 'mouseup', options, { which: button + 1 }),
      );
      if (win.PointerEvent)
        element.dispatchEvent(
          new win.PointerEvent(down ? 'pointerdown' : 'pointerup', {
            ...options,
            pointerId: 1,
            pointerType: 'mouse',
            isPrimary: true,
          }),
        );
      if (!down && clickOnRelease)
        element.dispatchEvent(new win.MouseEvent(button === 2 ? 'contextmenu' : 'click', options));
    }
  }
  function release() {
    for (const held of previous.values()) emit(held.binding, false, held.element, false);
    previous.clear();
    if (cursorMark) cursorMark.hidden = true;
  }
  window.addEventListener('message', (event) => {
    if (event.source !== parent || event.origin !== location.origin) return;
    if (event.data?.type === 'timebomb:controller') {
      release();
      config = event.data.config;
    }
    if (event.data?.type === 'playdeck:state') {
      paused = Boolean(event.data.paused);
      if (paused) release();
    }
  });
  window.addEventListener('blur', release);
  window.addEventListener('pagehide', release);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) release();
  });
  function tick(now) {
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    try {
      if (readConfig) config = readConfig();
      if (isPaused) paused = isPaused();
      const pads = nativePads?.() || [];
      const available = (pad) => pad && pad.connected !== false && !disconnectedPads.has(pad.index);
      const pad =
        config?.pad === 'auto'
          ? Array.from(pads).find(available)
          : available(pads[Number(config?.pad)])
            ? pads[Number(config?.pad)]
            : null;
      const element = config?.enabled && !paused && !document.hidden && pad ? target() : null;
      const editable = element?.matches?.('input,textarea,select,[contenteditable="true"]');
      if (
        !config?.enabled ||
        paused ||
        document.hidden ||
        !(document.hasFocus() || element?.ownerDocument.hasFocus?.()) ||
        !pad ||
        editable ||
        !element
      ) {
        release();
        return;
      }
      if (config.look?.cursor) positionFor(element);
      displayCursor(
        element,
        config.look?.enabled && config.look?.cursor && !element.ownerDocument.pointerLockElement,
      );
      const desired = new Map();
      const threshold = Number(config.moveDeadzone ?? config.deadzone);
      for (const [source, binding] of Object.entries(config.bindings || {})) {
        if (!binding || !['key', 'mouse'].includes(binding.kind)) continue;
        const parts = source.split(':');
        const pressed =
          parts[0] === 'button'
            ? (pad.buttons[Number(parts[1])]?.value || 0) > 0.5
            : (pad.axes[Number(parts[1])] || 0) * Number(parts[2]) > threshold;
        if (pressed)
          desired.set(binding.kind === 'key' ? 'key:' + binding.code : 'mouse:' + binding.button, {
            binding,
            element,
          });
      }
      // Aggregate shared bindings so releasing one source cannot cancel another.
      for (const [id, held] of previous)
        if (!desired.has(id) || desired.get(id).element !== held.element)
          emit(held.binding, false, held.element);
      for (const [id, held] of desired)
        if (!previous.has(id) || previous.get(id).element !== held.element)
          emit(held.binding, true, held.element);
      previous = desired;
      if (config.look?.enabled) {
        const curve = (value) =>
          Math.abs(value) <= Number(config.lookDeadzone ?? config.deadzone)
            ? 0
            : Math.sign(value) * Math.pow((Math.abs(value) - Number(config.lookDeadzone ?? config.deadzone)) / (1 - Number(config.lookDeadzone ?? config.deadzone)), Number(config.responseCurve) || 1.5);
        const aimScale =
          (pad.buttons[6]?.value || 0) > 0.5
            ? 1 - Math.min(100, Math.max(0, Number(config.aimSlowdown) || 0)) / 100
            : 1;
        const x = aimScale * curve(pad.axes[Number(config.look.x)] || 0) * config.sensitivity * dt;
        const y =
          aimScale *
          curve(pad.axes[Number(config.look.y)] || 0) *
          (config.separateAim ? config.sensitivityY : config.sensitivity) *
          dt *
          (config.look.invert ? -1 : 1);
        if (x || y) {
          const win = element.ownerDocument.defaultView,
            rect = element.getBoundingClientRect();
          let position = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
          if (config.look.cursor) {
            position = positionFor(element);
            position.x += x;
            position.y += y;
            positionFor(element);
            displayCursor(element, !element.ownerDocument.pointerLockElement);
          }
          const options = {
            bubbles: true,
            cancelable: true,
            clientX: position.x,
            clientY: position.y,
            movementX: x,
            movementY: y,
            buttons: [...previous.values()]
              .filter((held) => held.binding.kind === 'mouse')
              .reduce((mask, held) => mask | [1, 4, 2][held.binding.button], 0),
          };
          element.dispatchEvent(
            inputEvent(win, 'mousemove', options, { movementX: x, movementY: y }),
          );
        }
      }
    } finally {
      requestAnimationFrame(tick);
    }
  }
  requestAnimationFrame(tick);
  return {release,reset(){release();cursorMark?.remove();cursorMark=null;cursorPosition=null;}};
}

export function controllerDefaults() {
  return {
    defaultsVersion: 5,
    enabled: false,
    pad: 'auto',
    deadzone: 0.15,
    sensitivity: 1200,
    sensitivityY: 1200,
    separateAim: false,
    aimSlowdown: 50,
    look: { enabled: true, x: 2, y: 3, invert: false },
    bindings: {
      'button:0': {
        kind: 'key',
        code: 'Space',
      },
      'button:1': {
        kind: 'key',
        code: 'KeyF',
      },
      'button:2': {
        kind: 'key',
        code: 'KeyR',
      },
      'button:3': {
        kind: 'key',
        code: 'Digit1',
      },
      'button:4': {
        kind: 'key',
        code: 'KeyQ',
      },
      'button:5': {
        kind: 'key',
        code: 'KeyG',
      },
      'button:6': {
        kind: 'mouse',
        button: 2,
      },
      'button:7': {
        kind: 'mouse',
        button: 0,
      },
      'button:8': {
        kind: 'key',
        code: 'KeyM',
      },
      'button:9': {
        kind: 'key',
        code: 'Escape',
      },
      'button:10': {
        kind: 'key',
        code: 'ShiftLeft',
      },
      'button:11': {
        kind: 'key',
        code: 'KeyV',
      },
      'button:12': {
        kind: 'key',
        code: 'Digit1',
      },
      'button:13': {
        kind: 'key',
        code: 'Digit3',
      },
      'button:14': {
        kind: 'key',
        code: 'Digit4',
      },
      'button:15': {
        kind: 'key',
        code: 'Digit2',
      },
      'button:16': {
        kind: 'key',
        code: 'KeyM',
      },
      'button:17': {
        kind: 'key',
        code: 'Enter',
      },
      'axis:0:-1': {
        kind: 'key',
        code: 'KeyA',
      },
      'axis:0:1': {
        kind: 'key',
        code: 'KeyD',
      },
      'axis:1:-1': {
        kind: 'key',
        code: 'KeyW',
      },
      'axis:1:1': {
        kind: 'key',
        code: 'KeyS',
      },
    },
  };
}

export function installController({ profileId, getFrame, forceMapping = false }) {
  const storageKey = 'timebomb.controller.v1:' + profileId;
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(storageKey));
  } catch {}
  let config = controllerDefaults(),
    open = false,
    maxButtons = 18,
    maxAxes = 4,
    lastInfo = '',
    paused = false;
  if (saved?.bindings && saved.look && saved.defaultsVersion >= 3) {
    config = { ...config, ...saved, defaultsVersion: 5 };
    if (saved.defaultsVersion < 4) config.enabled = false;
    if (saved.defaultsVersion < 5 && config.look.x === 2 && config.look.y === 2)
      config.look = { ...config.look, y: 3 };
  } else if (saved?.pad) config.pad = saved.pad;

  config.deadzone = Math.min(0.8, Math.max(0.05, Number(config.deadzone) || 0.15));
  config.sensitivity = Math.min(2400, Math.max(50, Number(config.sensitivity) || 1200));
  try {
    localStorage.setItem(storageKey, JSON.stringify(config));
  } catch {}
  config.sensitivityY = config.separateAim
    ? Math.min(2400, Math.max(50, Number(config.sensitivityY) || config.sensitivity))
    : config.sensitivity;
  const host = document.createElement('div');
  (document.querySelector('#game-menu-bar') || document.body).prepend(host);
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>
    :host{position:relative;display:block;z-index:2147483646;font:15px system-ui,sans-serif;color:#e0e4dc;color-scheme:dark}
    *{box-sizing:border-box}button,input,select{font:inherit;color:inherit}fieldset{min-width:0;margin:0;padding:0;border:0}fieldset:disabled{opacity:.45}fieldset:disabled input,fieldset:disabled select,fieldset:disabled button{cursor:not-allowed}
    button,input,select{border:0;border-radius:10px;background:rgba(110,120,106,.19);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);padding:9px 14px;font-size:13px}
    button{cursor:pointer;transition:background .18s}button:hover,button:focus-visible{background:rgba(140,150,136,.3)}
    input:focus-visible,select:focus-visible{outline:2px solid #bdc3b9;outline-offset:2px}button:focus-visible{outline:0}
    #toggle,#restore{display:flex;align-items:center;justify-content:center;gap:6px} .lucide-icon{display:block;flex:0 0 16px;width:16px;height:16px} button[hidden]{display:none!important}
    #toggle{opacity:1;border:0;outline:0;background:rgba(25,28,25,.58);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);box-shadow:0 4px 18px #0003;color:#e0e4dc;padding:9px 13px;border-radius:10px;font-size:12px;min-height:34px;white-space:nowrap;transition:background .18s}
    #toggle:hover,#toggle:focus-visible{background:rgba(45,49,43,.72)}#toggle[aria-pressed=true]{color:#e8c658}
    @media(pointer:coarse){#toggle{min-height:44px}}
    #panel{position:absolute;bottom:46px;left:calc(-1 * var(--menu-panel-offset,0px));width:min(340px,calc(100vw - 24px));max-height:80vh;overflow:auto;border:0;background:rgba(25,28,25,.68);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);border-radius:14px;padding:20px;box-shadow:0 8px 30px #0004;color:#e0e4dc;scrollbar-width:thin;scrollbar-color:#ffffff30 transparent}[hidden]{display:none!important}
    header,.row{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}h2{font-size:15px;font-weight:700;margin:0}p{font-size:13px;line-height:1.5;color:#bdc3b9}label{display:block;margin:12px 0;font-size:13px}
    label input[type=range]{width:100%;padding:0;background:transparent;backdrop-filter:none;accent-color:#bdc3b9}input[type=checkbox]{accent-color:#bdc3b9}
    select{max-width:160px}option{background:#191c19;color:#e0e4dc}
    #bindings .row{margin:6px 0;font-size:12px}#bindings input{width:100px;padding:8px}#bindings select{width:90px;padding:8px}
    details{margin-top:16px;border-radius:10px;background:rgba(110,120,106,.1)}summary{cursor:pointer;padding:12px;font-size:13px;color:#e0e4dc;list-style:none;display:flex;justify-content:space-between;align-items:center}summary::-webkit-details-marker{display:none}summary::after{content:'+';font-size:17px;color:#bdc3b9}details[open]>summary::after{content:'-'}summary:focus-visible{outline:2px solid #bdc3b9;outline-offset:2px}.aim-sensitivities{display:grid;grid-template-columns:minmax(0,1fr);gap:0}.aim-sensitivities label{font-size:12px}.aim-sensitivities input{width:100%;box-sizing:border-box}.binding-options{padding:0 12px 12px}.restore-row{margin-top:12px}.axis label{display:flex;align-items:center;justify-content:space-between}.note{margin-bottom:0}#status{color:#bdc3b9;overflow-wrap:anywhere}small{color:#bdc3b9}

    :host{font:400 13px/1.5 var(--player-font,system-ui,sans-serif);color:#f2f2f2}
    #toggle{box-sizing:border-box;height:44px;min-height:44px;padding:0 14px;font:400 12px/1.4 var(--player-font,system-ui,sans-serif);border-radius:12px;background:var(--player-glass,rgba(38,38,38,.72));color:#f2f2f2;backdrop-filter:var(--player-blur,blur(18px));-webkit-backdrop-filter:var(--player-blur,blur(18px))}
    #toggle:hover,#toggle:focus-visible{background:var(--player-hover,rgba(54,54,54,.82))}
    #panel{left:calc(-1 * var(--menu-panel-offset,0px));transform:none;bottom:56px;width:min(340px,calc(100vw - 24px));max-height:calc(100dvh - 92px - env(safe-area-inset-bottom));background:var(--player-glass,rgba(38,38,38,.72));border-radius:16px;font:400 13px/1.5 var(--player-font,system-ui,sans-serif)}
    h2{font:400 15px/1.4 var(--player-font,system-ui,sans-serif)}p,small,#status{color:#c2c2c2}header{margin-bottom:12px}p{margin:12px 0}
    button,input:not([type=range]):not([type=checkbox]),select{font:400 13px/1.4 var(--player-font,system-ui,sans-serif);min-height:40px;padding:10px 12px;background:rgba(255,255,255,.08);color:#f2f2f2;backdrop-filter:none;-webkit-backdrop-filter:none}
    #toggle{min-height:44px;background:var(--player-glass,rgba(38,38,38,.72));backdrop-filter:var(--player-blur,blur(18px));-webkit-backdrop-filter:var(--player-blur,blur(18px))}
    #bindings .row{flex-wrap:wrap;gap:6px}#bindings input{flex:1;min-width:70px}#bindings select{flex:1;min-width:70px}
    input[type=checkbox]{width:14px;height:14px;margin:0 6px 0 0;vertical-align:middle}input[type=range]{display:block;min-height:24px;margin:8px 0 0}
    details{background:rgba(255,255,255,.08)}summary{font-weight:400;min-height:44px}
    @media(max-width:420px){#toggle{padding-inline:10px}}
    #toggle{height:var(--player-height,34px);min-height:var(--player-height,34px);padding:0 10px;border-radius:9px;font-size:11px}
    #panel{bottom:calc(var(--player-height,34px) + 8px);width:min(300px,calc(100vw - 20px));padding:16px;border-radius:12px}
    button,input:not([type=range]):not([type=checkbox]),select,details{border:0;outline:0;background:var(--player-glass,rgba(38,38,38,.72));backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px)}
    button:hover,summary:hover,button:focus-visible,summary:focus-visible,input:focus-visible,select:focus-visible{outline:0;background:var(--player-hover,rgba(54,54,54,.82));box-shadow:inset 0 0 0 2px #ffffff18}
    /* Follow the shared player policy inside the controller shadow root. */
    #toggle,button,details,summary{background:transparent!important;box-shadow:none!important}
    #toggle,button,details{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}
    button:hover,summary:hover{background:transparent!important;color:#fff;box-shadow:none!important}
    button:focus-visible,summary:focus-visible{background:transparent!important;box-shadow:none!important;outline:2px solid #ddd!important;outline-offset:2px}

    /* Shared Playdeck appearance tokens inherited from :root through shadow DOM. */
    :host{font:400 13px/1.5 var(--player-font,system-ui,sans-serif)}
    #panel{width:min(300px,calc(100vw - 20px));padding:14px;border:0;
      border-radius:12px;background:var(--playdeck-menu-surface,rgba(30,30,30,.79))!important;
      backdrop-filter:var(--playdeck-menu-blur,blur(18px))!important;
      -webkit-backdrop-filter:var(--playdeck-menu-blur,blur(18px))!important;
      box-shadow:var(--playdeck-menu-shadow,0 8px 30px #0004)!important;
      font:400 13px/1.5 var(--player-font,system-ui,sans-serif)}
    #panel h2{font:500 14px/1.4 var(--player-font,system-ui,sans-serif)}
    #panel p,#panel label{font-size:12px}
    #toggle,button,summary{border:0!important;border-radius:9px;
      background:var(--playdeck-control-surface,rgba(255,255,255,.055))!important;
      box-shadow:none!important;backdrop-filter:none!important;
      -webkit-backdrop-filter:none!important;
      transition:background-color 150ms ease,color 150ms ease}
    #toggle:hover,button:not(:disabled):hover,summary:hover{
      background:var(--playdeck-control-hover,rgba(255,255,255,.125))!important;color:#fff}
    #toggle[aria-expanded=true],button:active{
      background:var(--playdeck-control-active,rgba(255,255,255,.16))!important}
    #toggle{height:var(--player-height,34px);min-height:var(--player-height,34px);
      padding:0 10px;font-size:11px;border-radius:var(--player-radius,9px)}
    details{background:transparent!important;box-shadow:none!important;
      backdrop-filter:none!important;-webkit-backdrop-filter:none!important}
    #panel select,#panel input:not([type=checkbox]):not([type=range]){
      min-height:34px;border:0!important;border-radius:9px;
      background:var(--playdeck-field-surface,rgba(255,255,255,.085))!important;
      box-shadow:none!important;backdrop-filter:none!important;
      -webkit-backdrop-filter:none!important;font:400 12px/1.4 var(--player-font,system-ui,sans-serif)}
    #panel select:hover,#panel input:not([type=checkbox]):not([type=range]):hover{
      background:var(--playdeck-control-hover,rgba(255,255,255,.125))!important}
    button:focus-visible,summary:focus-visible,input:focus-visible,select:focus-visible{
      outline:2px solid #ddd!important;outline-offset:2px;box-shadow:none!important}
    @media(prefers-reduced-motion:reduce){#toggle,button,summary{transition:none!important}}
  </style><button id="toggle" type="button" aria-expanded="false" aria-pressed="false">${iconMarkup('gamepad-2')}<span>Controller</span></button>
  <section id="panel" hidden aria-label="Controller settings"><header><h2>Controller mapping</h2></header>
  <p id="status" role="status">Connect a controller and press a button.</p>
  <div class="row"><label for="pad">Controller</label><select id="pad"><option value="auto">First connected</option></select></div>
  <fieldset id="mapping-controls" disabled>
  <label><input id="enable" type="checkbox"> Map controller to keyboard / mouse</label><p>Leave off for games with native controller support. Changes save for this game. Close this panel to play with your mappings.</p>
  <label>Stick deadzone <output id="deadvalue"></output><input id="deadzone" type="range" min="0.05" max="0.8" step="0.01"></label>
  <div class="aim-sensitivities">
  <label><span id="sensitivity-label">Aim sensitivity</span> <output id="sensvalue"></output><input id="sensitivity" type="range" min="50" max="2400" step="50"></label>
  <label id="vertical-sensitivity" hidden>Vertical sensitivity (Y) <output id="sensyvalue"></output><input id="sensitivity-y" type="range" min="50" max="2400" step="50"></label>
  </div>
  <details id="keybind-options"><summary>Advanced settings &amp; keybinds</summary><div class="binding-options">
  <label>Left trigger sensitivity reduction <output id="slowvalue"></output><input id="aim-slowdown" type="range" min="0" max="100" step="5"></label>
  <label><input id="move-cursor" type="checkbox"> Move cursor from its current position</label>
  <label><input id="link-aim" type="checkbox" checked> Link X and Y sensitivity</label>
  <label><input id="look" type="checkbox"> Stick controls mouse aiming</label><div class="axis"><label>Horizontal axis<select id="lookx"></select></label><label>Vertical axis<select id="looky"></select></label></div><label><input id="invert" type="checkbox"> Invert vertical aiming</label>
  <p>Click a key field and press a key, or choose a mouse button. Delete clears a binding. Inputs light up as you use them.</p><div id="bindings"></div></div></details>
  <div class="restore-row"><button id="restore" type="button">${iconMarkup('rotate-ccw')}<span>Restore defaults</span></button></div>
  </fieldset>
  <p class="note">Compatibility depends on the game accepting simulated inputs. This does not add aim assist or native analog movement.</p></section>`;
  const $ = (selector) => root.querySelector(selector);
  function save() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(config));
    } catch {}
    sync();
  }
  function updateMappingIndicator(pad) {
    const mapped = Boolean((config.enabled || forceMapping) && pad && pad.connected !== false);
    $('#toggle').setAttribute('aria-pressed', String(mapped));
    $('#toggle span').textContent = mapped ? 'Controller \u00b7 mapped' : 'Controller';
  }
  function sync() {
    $('#enable').checked = config.enabled || forceMapping;
    const pads = Array.from(navigator.getGamepads?.() || []).filter(
      (pad) => pad && pad.connected !== false,
    );
    updateMappingIndicator(
      config.pad === 'auto' ? pads[0] : pads.find((pad) => String(pad.index) === config.pad),
    );
    $('#deadzone').value = config.deadzone;
    $('#deadvalue').textContent = ' ' + Math.round(config.deadzone * 100) + '%';
    $('#sensitivity').value = config.sensitivity;
    $('#sensvalue').textContent = ' ' + config.sensitivity;
    $('#aim-slowdown').value = config.aimSlowdown;
    $('#slowvalue').textContent = ' ' + config.aimSlowdown + '%';
    $('#move-cursor').checked = Boolean(config.look.cursor);
    $('#link-aim').checked = !config.separateAim;
    $('#sensitivity-label').textContent = config.separateAim
      ? 'Horizontal sensitivity (X)'
      : 'Aim sensitivity';
    $('#vertical-sensitivity').hidden = !config.separateAim;
    $('#sensitivity-y').value = config.separateAim ? config.sensitivityY : config.sensitivity;
    $('#sensyvalue').textContent = ' ' + $('#sensitivity-y').value;
    $('#look').checked = config.look.enabled;
    $('#invert').checked = config.look.invert;
    $('#lookx').value = String(config.look.x);
    $('#looky').value = String(config.look.y);
    $('#pad').value = config.pad;
  }
  document.addEventListener('timebomb:menu-open', (event) => {
    if (event.detail !== 'controller' && open) setOpen(false);
  });
  document.addEventListener('playdeck:game-interaction', () => {
    if (open) setOpen(false);
  });
  function setOpen(value) {
    if (value)
      document.dispatchEvent(new CustomEvent('timebomb:menu-open', { detail: 'controller' }));
    open = value;
    $('#panel').hidden = !value;
    $('#toggle').setAttribute('aria-expanded', String(value));
    if (!value) {
      save();
    }
  }
  $('#toggle').onclick = () => setOpen(!open);
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (open && !event.composedPath().includes(host)) setOpen(false);
    },
    true,
  );
  window.addEventListener('blur', () =>
    setTimeout(() => {
      if (open && document.activeElement === getFrame()) setOpen(false);
    }, 0),
  );
  $('#enable').onchange = (event) => {
    config.enabled = event.target.checked;
    save();
  };
  $('#pad').onchange = (event) => {
    config.pad = event.target.value;
    maxButtons = 0;
    maxAxes = 0;
    lastInfo = '';
    save();
  };
  $('#deadzone').oninput = (event) => {
    config.deadzone = Number(event.target.value);
    save();
  };
  $('#sensitivity').oninput = (event) => {
    config.sensitivity = Number(event.target.value);
    if (!config.separateAim) config.sensitivityY = config.sensitivity;
    save();
  };
  $('#sensitivity-y').oninput = (event) => {
    config.sensitivityY = Number(event.target.value);
    if (!config.separateAim) config.sensitivity = config.sensitivityY;
    save();
  };
  $('#aim-slowdown').oninput = (event) => {
    config.aimSlowdown = Number(event.target.value);
    save();
  };
  $('#move-cursor').onchange = (event) => {
    config.look.cursor = event.target.checked;
    save();
  };
  $('#link-aim').onchange = (event) => {
    config.separateAim = !event.target.checked;
    config.sensitivityY = config.sensitivity;
    save();
  };
  $('#look').onchange = (event) => {
    config.look.enabled = event.target.checked;
    save();
  };
  $('#invert').onchange = (event) => {
    config.look.invert = event.target.checked;
    save();
  };
  for (const [id, prop] of [
    ['lookx', 'x'],
    ['looky', 'y'],
  ])
    $('#' + id).onchange = (event) => {
      config.look[prop] = Number(event.target.value);
      save();
    };
  $('#restore').onclick = () => {
    config = controllerDefaults();
    renderBindings();
    save();
  };
  function renderBindings() {
    $('#bindings').replaceChildren();
    for (const source of Object.keys(config.bindings)) {
      const [type, index] = source.split(':');
      if (type === 'button') maxButtons = Math.max(maxButtons, Number(index) + 1);
      if (type === 'axis') maxAxes = Math.max(maxAxes, Number(index) + 1);
    }
    const sources = [];
    for (let i = 0; i < maxButtons; i++) sources.push(['button:' + i, 'Button ' + i]);
    for (let i = 0; i < maxAxes; i++)
      for (const sign of [-1, 1])
        sources.push(['axis:' + i + ':' + sign, 'Axis ' + i + ' ' + (sign < 0 ? '-' : '+')]);
    for (const [source, label] of sources) {
      const row = document.createElement('div');
      row.className = 'row';
      row.dataset.source = source;
      const text = document.createElement('span');
      text.textContent = label;
      const key = document.createElement('input');
      key.readOnly = true;
      key.placeholder = 'Press key';
      key.setAttribute('aria-label', label + ' keyboard binding');
      const action = document.createElement('select');
      action.setAttribute('aria-label', label + ' action');
      for (const [value, title] of [
        ['none', 'None'],
        ['key', 'Key'],
        ['0', 'Left click'],
        ['2', 'Right click'],
        ['1', 'Middle click'],
      ]) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = title;
        action.append(option);
      }
      const binding = config.bindings[source];
      key.value = binding?.kind === 'key' ? binding.code : '';
      action.value = binding?.kind === 'mouse' ? String(binding.button) : binding?.kind || 'none';
      key.onkeydown = (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (['Delete', 'Backspace'].includes(event.code)) {
          delete config.bindings[source];
          key.value = '';
          action.value = 'none';
        } else {
          config.bindings[source] = { kind: 'key', code: event.code, key: event.key };
          key.value = event.code;
          action.value = 'key';
        }
        save();
      };
      action.onchange = () => {
        if (action.value === 'none') {
          delete config.bindings[source];
          key.value = '';
        } else if (action.value === 'key') {
          if (key.value) config.bindings[source] = { kind: 'key', code: key.value };
          else {
            delete config.bindings[source];
            key.focus();
          }
        } else {
          config.bindings[source] = { kind: 'mouse', button: Number(action.value) };
          key.value = '';
        }
        save();
      };
      row.append(text, key, action);
      $('#bindings').append(row);
    }
    for (const id of ['lookx', 'looky']) {
      $('#' + id).replaceChildren();
      for (let i = 0; i < Math.max(4, maxAxes); i++) {
        const option = document.createElement('option');
        option.value = String(i);
        option.textContent = 'Axis ' + i;
        $('#' + id).append(option);
      }
    }
    sync();
  }
  function refresh() {
    const pads = Array.from(navigator.getGamepads?.() || []).filter(
      (pad) => pad && pad.connected !== false,
    );
    const info = pads.map((pad) => pad.index + ':' + pad.id).join('|');
    if (info !== lastInfo) {
      lastInfo = info;
      $('#pad').replaceChildren();
      const option = document.createElement('option');
      option.value = 'auto';
      option.textContent = 'First connected';
      $('#pad').append(option);
      for (const pad of pads) {
        const option = document.createElement('option');
        option.value = String(pad.index);
        option.textContent = pad.id;
        $('#pad').append(option);
      }
      sync();
    }
    const pad =
      config.pad === 'auto' ? pads[0] : pads.find((pad) => String(pad.index) === config.pad);
    updateMappingIndicator(pad);
    $('#mapping-controls').disabled = !pad;
    $('#pad').disabled = !pads.length;
    $('#status').textContent = pad
      ? pad.id + (open && config.enabled ? ' - close settings to activate mappings.' : '')
      : 'Connect a controller and press a button.';
    if (pad && (maxButtons < pad.buttons.length || maxAxes < pad.axes.length)) {
      maxButtons = Math.max(maxButtons, pad.buttons.length);
      maxAxes = Math.max(maxAxes, pad.axes.length);
      renderBindings();
    }
    if (open && pad)
      for (const row of root.querySelectorAll('[data-source]')) {
        const [type, index, sign] = row.dataset.source.split(':');
        const active =
          type === 'button'
            ? pad.buttons[Number(index)]?.value > 0.5
            : (pad.axes[Number(index)] || 0) * Number(sign) > config.deadzone;
        row.style.color = active ? '#e8c658' : '';
      }
  }
  const runtime=controllerRuntime({
    getFrame,
    readConfig: () => ({ ...config, enabled: (config.enabled || forceMapping) && !open }),
    isPaused: () => paused,
  });
  const curveLabel=document.createElement('label');curveLabel.innerHTML='Response curve<select data-curve><option value="1">Linear</option><option value="1.5">Standard</option><option value="2.5">Precision</option></select>';
  root.querySelector('#keybind-options .binding-options').append(curveLabel);
  const curve=curveLabel.querySelector('select');curve.value=config.responseCurve ?? 1.5;curve.onchange=()=>{config.responseCurve=Number(curve.value);save();};
  renderBindings();
  sync();
  refresh();
  const interval = setInterval(() => {
    if (!document.hidden) refresh();
  }, 500);
  window.addEventListener('gamepaddisconnected', refresh);
  window.addEventListener('gamepadconnected', refresh);
  window.addEventListener('pagehide', () => clearInterval(interval), { once: true });
  return {
    setPaused(value) {
      paused = Boolean(value);
      if(paused)runtime?.release();
    },
    setForceMapping(value) {
      forceMapping = Boolean(value);
      sync();
    },
    attach(frame) {
      runtime?.reset();
      // Sample the same gamepad API as the settings detector. Dispatch into the
      // live game document directly; no second poller or inline-script injection.
      try {
        frame.contentDocument.addEventListener(
          'pointerdown',
          () => {
            if (open) setOpen(false);
          },
          true,
        );
        frame.contentWindow.focus();
      } catch {}
    },
    detach(){runtime?.reset();},
  };
}


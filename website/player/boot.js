import {graphicsOptions,nextRenderScale,scaledPlayerViewport} from './graphics-quality.js';
import {createSession,gameId} from './session.js';
import {readProfile,profiles} from './profiles.js';
import {installDeck,showRecentGames,showLinkBuilder} from './deck.js';
import { PERFORMANCE_OPTIONS, PERFORMANCE_MODES } from './options.js';
import { readLaunchOptions } from './launch-options.js';
import { playerViewport, fixedGameViewport } from './viewport.js';
import { initialRenderBudget } from './performance.js';
import { installController } from './controller.js';
import { readSettings, readGameSettings, installSettings, matchesBind } from './settings.js';
import { installToolbar } from './toolbar.js';
import { displayCSS, displayMarkup, displayConfig, canvasDisplayBox } from './display.js';
import { iconMarkup as toolbarIcon } from './toolbar-icons.js';
const LOCAL = '/player/games/';

const params = new URLSearchParams(location.search);
let launch, launchError;
try {
  launch = readLaunchOptions(params, document.referrer);
} catch (error) {
  launch = {};
  launchError = error;
}
let legacySettings = {};
try {
  legacySettings = JSON.parse(params.get('legacySettings') || '{}');
} catch {}
const nativeGamepad = launch.nativeGamepad;
let playerSettings = {
  ...readSettings(legacySettings),
  forceController:
    !nativeGamepad &&
    (launch.forceController ?? readGameSettings(params.get('url')).forceController),
};
document.documentElement.dataset.playdeckAppearance = playerSettings.appearance;
const embedded = window.parent !== window;
function announceSettings() {
  if (embedded)
    parent.postMessage({ type: 'playdeck:settings', settings: playerSettings }, parentOrigin);
}
function panicGame() {
  if (embedded) {
    parent.postMessage({ type: 'playdeck:panic' }, parentOrigin);
    return;
  }
  frame?.remove();
  frame = null;
  location.replace(playerSettings.panicURL);
}
let displayOptionsConfig = null;
try {
  displayOptionsConfig = displayConfig(launch.displayOptions);
} catch {}
let performanceMode = 'auto';
try {
  const saved = localStorage.getItem('playdeck.performance.v2');
  if (PERFORMANCE_MODES.includes(saved)) performanceMode = saved;
} catch {}
if (launch.performance) performanceMode = launch.performance;
let frameCap = launch.frameCap ?? 0;
let graphics=graphicsOptions(), dynamicScale=graphics.renderScale, rendererScaling=false;
const launchGraphics=Object.fromEntries(['renderScale','adaptive','reducedFiltering','engineOptimizations'].filter(key=>launch[key]!==undefined).map(key=>[key,launch[key]]));
const $ = (value) => document.querySelector(value);
let gameURL,
  frame,
  panicBind = playerSettings.panicBind,
  parentOrigin = launch.parentOrigin || location.origin,
  worker;
let renderBudget = initialRenderBudget(
  performanceMode,
  navigator.deviceMemory,
  navigator.hardwareConcurrency,
);
let pageLoaded = false,
  gameReady = false,
  failedDocument = null,
  idleTimer,
  activityPoll,
  slowTimer;
let activeDownloads = null,
  lastDownload = Date.now();
function revealGame() {
  if (gameReady || failedDocument || !frame) return;
  gameReady = true;
  for (const doc of cleanupDocuments) doc.dispatchEvent(new Event('timebomb:clean-extras'));
  clearInterval(activityPoll);
  clearTimeout(idleTimer);
  clearTimeout(slowTimer);
  $('#loading').hidden = true;
  // Loading must not steal focus from settings opened during the import.
  const active = document.activeElement;
  if (!menuBar.contains(active) && !$('#panel').contains(active) && !castDialog.contains(active))
    frame.focus();
  refreshStats();
  parent.postMessage({ type: 'playdeck:game-ready' }, parentOrigin);
}
$('#continue').onclick = revealGame;
function checkDownloads() {
  clearTimeout(idleTimer);
  if (gameReady || failedDocument || !pageLoaded || activeDownloads !== 0) return;
  const remaining = 2000 - (Date.now() - lastDownload);
  if (remaining > 0) {
    idleTimer = setTimeout(checkDownloads, remaining);
    return;
  }
  revealGame();
}
function downloadActivity(data) {
  if (!Number.isFinite(data.active) || !Number.isFinite(data.lastDownload)) return;
  activeDownloads = data.active;
  lastDownload = Math.max(lastDownload, data.lastDownload);
  if (!gameReady && !failedDocument)
    $('#status').textContent = activeDownloads
      ? `Downloading game files (${activeDownloads} active).`
      : 'Finishing loading.';
  checkDownloads();
}
function monitorDownloads() {
  clearInterval(activityPoll);
  if (!worker) {
    $('#status').textContent = 'Loading game online…';
    $('#continue').hidden = false;
    return;
  }
  const poll = () =>
    send('sandbox:activity')
      .then(downloadActivity)
      .catch(() => {
        activeDownloads = null;
        clearTimeout(idleTimer);
        $('#status').textContent =
          'Download tracking is unavailable. You can reveal the game below.';
        $('#continue').hidden = false;
      });
  poll();
  activityPoll = setInterval(poll, 500);
}
const name = params.get('name') || (params.get('url') ? 'Game' : 'Playdeck');
try {
  const preview = new URL(params.get('image'), location.href);
  if (
    params.get('image') &&
    preview.protocol === 'https:' &&
    !preview.username &&
    !preview.password
  )
    $('#loading').style.setProperty('--game-preview', 'url(' + JSON.stringify(preview.href) + ')');
} catch {}
$('#name').textContent = name;
try {
  if (launchError) throw launchError;
  gameURL = params.get('url') ? new URL(params.get('url')) : null;
  if (
    gameURL &&
    (gameURL.protocol !== 'https:' ||
      gameURL.username ||
      gameURL.password ||
      gameURL.port ||
      !gameURL.hostname.includes('.'))
  )
    throw new Error('Invalid game URL');
} catch {
  gameURL = null;
  $('#error').hidden = false;
  $('#error').textContent = launchError?.message || 'This game link is invalid.';
}

let launchSession=null,deck=null;
if(gameURL){const saved=profiles()[gameId(gameURL.href)]?.profile;if(saved && !launch.performance)performanceMode=readProfile(gameURL.href).performance;frameCap=launch.frameCap ?? readProfile(gameURL.href).frameCap;graphics=graphicsOptions({...readProfile(gameURL.href).graphics,...launchGraphics});dynamicScale=graphics.renderScale;renderBudget=initialRenderBudget(performanceMode,navigator.deviceMemory,navigator.hardwareConcurrency);launchSession=createSession(gameURL.href,performanceMode,readProfile(gameURL.href).compatibility,frameCap,graphics);}
const launchCleanups=new Set();
function tearDownLaunch(){clearInterval(enginePoll);clearInterval(activityPoll);clearTimeout(idleTimer);clearTimeout(slowTimer);for(const cleanup of launchCleanups){try{cleanup();}catch{}}launchCleanups.clear();cleanupDocuments.clear();cleanupHidden.clear();controllerMapper?.setPaused(true);controllerMapper?.detach();}
const menuBar = document.createElement('div');
menuBar.id = 'game-menu-bar';
document.body.append(menuBar);
menuBar.append($('#badge'));
$('#badge').innerHTML = toolbarIcon('settings') + '<span>Settings</span>';
const gameMenu = document.createElement('details');
gameMenu.className = 'game-menu';
gameMenu.innerHTML =
  '<summary>' +
  toolbarIcon('menu') +
  '<span>Menu</span></summary><section class="game-menu-panel" aria-label="Game controls"><button type="button" data-action="return">Return to library</button><button type="button" data-action="reload">Reload game</button><button type="button" data-action="fullscreen">Toggle fullscreen</button><button type="button" data-action="exit">Close game</button><button type="button" data-action="cast">Screen mirroring</button></section>';
menuBar.append(gameMenu);
gameMenu.addEventListener('click', (event) => {
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (!action) {
    if (event.target.closest('summary') && !gameMenu.open) {
      try {
        frame?.contentDocument.exitPointerLock?.();
      } catch {}
      announceMenu('game');
    }
    return;
  }
  gameMenu.open = false;
  if (action === 'cast') {
    openCastDialog();
    return;
  }
  if (action === 'reload') {
  mount(gamePath(LOCAL));
    return;
  }
  if (!embedded) {
    if (action === 'return' || action === 'exit') {
      location.assign('/');
      return;
    }
    if (action === 'fullscreen') {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      else document.documentElement.requestFullscreen?.().catch(() => {});
      return;
    }
  }
  parent.postMessage({ type: 'playdeck:menu-action', action }, parentOrigin);
});
const menuStyle = document.createElement('style');
menuStyle.textContent =
  '#game-menu-bar{position:fixed;bottom:12px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:8px;z-index:2147483646}#game-menu-bar #badge{position:static;font:12px system-ui,sans-serif;white-space:nowrap}#panel{right:auto;left:50%;transform:translateX(-50%);bottom:68px}body{overflow:hidden}';
document.head.append(menuStyle);
function alignMenuPanels() {
  const host = menuBar.firstElementChild;
  const menuWidth = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--playdeck-menu-width')) || 258;
  const panelLeft = (innerWidth - Math.min(menuWidth, innerWidth - 20)) / 2;
  if (host && host !== $('#badge'))
    host.style.setProperty(
      '--menu-panel-offset',
      host.getBoundingClientRect().left - panelLeft + 'px',
    );
  for (const menu of [displayMenu, gameMenu]) {
    if (!menu) continue;
    const rect = menu.getBoundingClientRect();
    menu.style.setProperty(
      '--display-panel-offset',
      rect.left + rect.width / 2 - innerWidth / 2 + 'px',
    );
  }
}
window.addEventListener('resize', alignMenuPanels);
let gameDisplay = null,
  displayMenu = null,
  castViewport = null;
const castDialog = document.createElement('dialog');
castDialog.id = 'tv-cast';
castDialog.innerHTML =
  '<form method="dialog"><header><h2>Screen mirroring</h2><button aria-label="Close" value="close">Close</button></header><label>TV resolution <select id="tv-resolution"><option value="auto">Automatic / device screen</option><option value="1280x720">720p - 1280 × 720</option><option value="1920x1080">1080p - 1920 × 1080</option><option value="3840x2160">4K - 3840 × 2160</option></select></label><p id="tv-status" role="status">Mirror your current game using your device’s casting controls.</p><button type="button" id="tv-connect">Open Android Cast</button><button type="button" id="tv-stop" hidden>Stop casting</button><p>Keep both devices on the same Wi-Fi. Automatic uses this device’s viewport; a mirrored TV does not report its resolution to the website. Choose 720p, 1080p, or 4K to set the game viewport - this does not change the casting stream’s quality. Pixel phones need a Google Cast receiver; Fire TV’s built-in mirroring uses a different protocol.</p></form>';
document.body.append(castDialog);
const castStyle = document.createElement('style');
castStyle.textContent =
  '#tv-cast{width:min(430px,90vw);max-height:85vh;overflow:auto;border:0;border-radius:18px;padding:24px;background:#171a17;color:#e6e9e2;font:15px system-ui}#tv-cast::backdrop{background:#0009}#tv-cast header{display:flex;align-items:center;justify-content:space-between;gap:16px}#tv-cast h2{font-size:20px}#tv-cast p{line-height:1.5;color:#b6bdb1}#tv-cast button,#tv-cast select{padding:10px;border:0;border-radius:9px;background:#30362d;color:#eee;cursor:pointer}#tv-cast label{display:grid;gap:9px}#tv-cast [hidden]{display:none!important}';
document.head.append(castStyle);
$('#tv-resolution').addEventListener('change', () => {
  const value = $('#tv-resolution').value;
  castViewport = value === 'auto' ? null : value.split('x').map(Number);
  applyDisplay();
});
function castStatus(message) {
  $('#tv-status').textContent = message;
}

function openCastDialog() {
  const android = /Android/i.test(navigator.userAgent);
  const apple = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  $('#tv-connect').hidden = !android;
  $('#tv-stop').hidden = true;
  castStatus(
    android
      ? 'Open Android Cast, choose your TV, then return to this game. This mirrors your current session. A Google Cast-compatible TV or receiver is required.'
      : apple
        ? 'Open Control Center → Screen Mirroring, select your TV, then return to the game.'
        : 'In Chrome: menu → Cast, save and share → Cast → Sources → Cast tab. Choose your TV to mirror this game.',
  );
  castDialog.showModal();
}
$('#tv-connect').onclick = () => {
  // Chrome handles this explicit user click as an Android system-settings intent.
  // A webpage cannot start screen mirroring or approve screen capture itself.
  const link = document.createElement('a');
  link.href =
    'intent:#Intent;action=android.settings.CAST_SETTINGS;S.browser_fallback_url=' +
    encodeURIComponent('https://support.google.com/pixelphone/answer/2865484') +
    ';end';
  document.body.append(link);
  link.click();
  link.remove();
  castStatus(
    'Choose your TV in Android Cast, then return here. If settings did not open, use Quick Settings → Screen Cast. Fire TV’s built-in mirroring is not a Google Cast receiver.',
  );
};

new ResizeObserver(alignMenuPanels).observe(menuBar);

let expandedCanvas = null,
  expandedDoc = null;

const canvasStyleDocs = new WeakSet();
function restoreExpandedCanvas() {
  expandedCanvas?.removeAttribute('data-timebomb-game-canvas');
  if (expandedDoc) {
    expandedDoc.documentElement.removeAttribute('data-timebomb-canvas-view');
    for (const key of ['--tb-game-width', '--tb-game-height', '--tb-game-left', '--tb-game-top'])
      expandedDoc.documentElement.style.removeProperty(key);
    expandedDoc
      .querySelectorAll('[data-timebomb-canvas-parent]')
      .forEach((node) => node.removeAttribute('data-timebomb-canvas-parent'));
  }
  expandedCanvas = null;
  expandedDoc = null;
}
function findGameCanvas(doc, depth = 0) {
  if (!doc?.defaultView || depth > 6) return null;
  let best = null,
    score = 0;
  for (const canvas of doc.querySelectorAll('canvas')) {
    if (
      canvas.hasAttribute('data-timebomb-page-extra') ||
      /(?:fps|debug|stats)/i.test(canvas.id + ' ' + canvas.className)
    )
      continue;
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 64 || rect.height < 64 || canvas.width < 64 || canvas.height < 64) continue;
    const area = rect.width * rect.height;
    if (area > score) {
      best = canvas;
      score = area;
    }
  }
  if (best) return best;
  for (const child of doc.querySelectorAll('iframe')) {
    try {
      const result = findGameCanvas(child.contentDocument, depth + 1);
      if (result) return result;
    } catch {}
  }
  return null;
}

const legacyInputCanvases = new WeakSet();
function alignLegacyCanvasInput(canvas) {
  // Clickteam's HTML5 runtime uses layout offsets instead of the displayed rect.
  const runtime=canvas.ownerDocument.defaultView;
  if (!runtime) return;
  const bufferCoordinates=runtime.PlaydeckAdapter?.inputCoordinates==='buffer' || (typeof runtime.CRunApp==='function' && typeof runtime.CRun==='function') || canvas.id==='MMFCanvas';
  if (!bufferCoordinates || legacyInputCanvases.has(canvas)) return;
  legacyInputCanvases.add(canvas);
  const normalize = (event) => {
    if (canvas !== expandedCanvas || canvas.ownerDocument.pointerLockElement) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    let left = 0,
      top = 0;
    for (let node = canvas; node && node.tagName !== 'BODY'; node = node.offsetParent) {
      left += node.offsetLeft;
      top += node.offsetTop;
    }
    const x = ((event.clientX - rect.left) * canvas.width) / rect.width,
      y = ((event.clientY - rect.top) * canvas.height) / rect.height;
    const win = canvas.ownerDocument.defaultView;
    const values = {
      pageX: left + x,
      pageY: top + y,
      clientX: left + x - win.scrollX,
      clientY: top + y - win.scrollY,
      offsetX: x,
      offsetY: y,
    };
    for (const [key, value] of Object.entries(values))
      try {
        Object.defineProperty(event, key, { value, configurable: true });
      } catch {}
  };
  for (const type of [
    'mousemove',
    'mousedown',
    'mouseup',
    'click',
    'dblclick',
    'pointermove',
    'pointerdown',
    'pointerup',
  ])
    canvas.addEventListener(type, normalize, true);
}

function sizeGameCanvas() {
  if (!gameDisplay) {
    restoreExpandedCanvas();
    return false;
  }
  let canvas = expandedCanvas?.isConnected && expandedCanvas.ownerDocument.defaultView
    ? expandedCanvas : null;
  try {
    canvas ||= findGameCanvas(frame.contentDocument);
  } catch {}
  if (!canvas?.ownerDocument.defaultView) {
    restoreExpandedCanvas();
    return false;
  }
  alignLegacyCanvasInput(canvas);
  const doc = canvas.ownerDocument;
  if (expandedCanvas !== canvas) {
    restoreExpandedCanvas();
    expandedCanvas = canvas;
    expandedDoc = doc;
  }
  if (!canvasStyleDocs.has(doc)) {
    canvasStyleDocs.add(doc);
    const style = doc.createElement('style');
    style.textContent =
      'html[data-timebomb-canvas-view],html[data-timebomb-canvas-view] body{margin:0!important;width:100%!important;height:100%!important;overflow:hidden!important;background:#000!important;background-image:none!important}html[data-timebomb-canvas-view] [data-timebomb-canvas-parent]{transform:none!important;filter:none!important;perspective:none!important;contain:none!important;overflow:visible!important;background:#000!important;background-image:none!important;position:fixed!important;left:var(--tb-game-left)!important;top:var(--tb-game-top)!important;width:var(--tb-game-width)!important;height:var(--tb-game-height)!important;min-width:0!important;min-height:0!important;max-width:none!important;max-height:none!important;margin:0!important;padding:0!important;border:0!important;box-sizing:border-box!important}canvas[data-timebomb-game-canvas]{position:fixed!important;left:var(--tb-game-left)!important;top:var(--tb-game-top)!important;transform:none!important;width:var(--tb-canvas-width)!important;height:var(--tb-canvas-height)!important;max-width:none!important;max-height:none!important;margin:0!important;object-fit:fill!important;z-index:1!important}';
    (doc.head || doc.documentElement).append(style);
  }
  doc.documentElement.setAttribute('data-timebomb-canvas-view', '');
  for (
    let node = canvas.parentElement;
    node && node !== doc.body && node !== doc.documentElement;
    node = node.parentElement
  )
    node.setAttribute('data-timebomb-canvas-parent', '');
  const win = doc.defaultView,
    width = win.innerWidth,
    height = win.innerHeight;
  const box = canvasDisplayBox(width, height, gameDisplay.ratio);
  const w = box.width,
    h = box.height;
  const root = doc.documentElement;
  const changed =
    root.style.getPropertyValue('--tb-game-width') !== w + 'px' ||
    root.style.getPropertyValue('--tb-game-height') !== h + 'px';
  root.style.setProperty('--tb-game-width', w + 'px');
  root.style.setProperty('--tb-game-height', h + 'px');
  root.style.setProperty('--tb-game-left', (width - w) / 2 + 'px');
  root.style.setProperty('--tb-game-top', (height - h) / 2 + 'px');
  canvas.style.setProperty('--tb-canvas-width', w + 'px');
  canvas.style.setProperty('--tb-canvas-height', h + 'px');
  canvas.setAttribute('data-timebomb-game-canvas', '');
  if (changed) win.dispatchEvent(new win.Event('resize'));
  return true;
}

const fixedViewportDocs = new WeakMap();
function applyDisplay() {
  if (!frame) return;
  // Fixed CSS-sized engine containers need their own virtual frame dimensions.
  // Scale the complete document so native canvas hitboxes stay aligned.
  const tvViewport = typeof castViewport === 'undefined' ? null : castViewport;
  let fixed = null;
  if (!gameDisplay) {
    try {
      const doc = frame.contentDocument;
      fixed = fixedViewportDocs.get(doc) || fixedGameViewport(doc);
      if (fixed && doc) fixedViewportDocs.set(doc, fixed);
    } catch {}
  }
  // Ratio is applied once to the game surface, never canceled by a second frame stretch.
  const renderRatio = null;
  const layout = scaledPlayerViewport(playerViewport(
    innerWidth,
    innerHeight,
    performanceMode,
    renderBudget,
    tvViewport,
    fixed,
    true,
    renderRatio,
  ),rendererScaling ? 1 : dynamicScale,!!fixed);
  if (!layout) return;
  const { width, height, scaleX, scaleY, left, top } = layout;
  frame.style.position = 'absolute';
  frame.style.margin = '0';
  frame.style.maxWidth = 'none';
  frame.style.maxHeight = 'none';
  if (frame.style.width !== width + 'px') frame.style.width = width + 'px';
  if (frame.style.height !== height + 'px') frame.style.height = height + 'px';
  frame.style.left = left + 'px';
  frame.style.top = top + 'px';
  frame.style.transformOrigin = 'top left';
  const transform = 'scale(' + scaleX + ',' + scaleY + ')';
  if (frame.style.transform !== transform) frame.style.transform = transform;
  if (!gameDisplay) {
    restoreExpandedCanvas();
    frame.style.opacity = '1';
    frame.style.pointerEvents = 'auto';
    return;
  }
  const found = sizeGameCanvas();
  frame.style.opacity = '1';
  frame.style.pointerEvents = 'auto';
  document.body.style.background = '#000';
  if (!found && pageLoaded && !gameFailureReported && $('#error').hidden)
    $('#loading').hidden = true;
}
function setupDisplay(data) {
  if (!displayMenu) {
    const style = document.createElement('style');
    style.textContent =
      data.css +
      '#game-menu-bar .game-display{position:relative;bottom:auto;left:auto;transform:none}#game-menu-bar .game-display summary{min-height:34px;white-space:nowrap}#game-menu-bar .display-panel{left:calc(50% - var(--display-panel-offset,0px))}';
    document.head.append(style);
    displayMenu = document.createElement('details');
    displayMenu.className = 'game-display';
    displayMenu.innerHTML = data.markup;
    menuBar.append(displayMenu);
    displayMenu.addEventListener('change', () => {
      gameDisplay = {
        ratio: displayMenu.querySelector('[data-display-ratio]').value,
        mode: 'stretch',
      };
      try {
        localStorage.setItem('playdeck.display.v2:' + gameURL.href, JSON.stringify(gameDisplay));
      } catch {}
      applyDisplay();
    });
    displayMenu.querySelector('summary').addEventListener('click', () => {
      if (!displayMenu.open) announceMenu('display');
    });
  }
  displayMenu.hidden = !data.config;
  gameDisplay = data.config ? data.selection || { ratio: 'auto', mode: 'stretch' } : null;
  if (data.config) {
    const select = displayMenu.querySelector('[data-display-ratio]');
    select.replaceChildren(
      ...data.config.ratios.map((r) => {
        const option = document.createElement('option');
        option.value = r;
        option.textContent = r === 'auto' ? 'Screen' : r;
        return option;
      }),
    );
    select.value = gameDisplay.ratio;
  }
  applyDisplay();
  requestAnimationFrame(alignMenuPanels);
}
window.addEventListener('resize', applyDisplay);
setInterval(() => {
  if (!document.hidden && frame?.isConnected) applyDisplay();
}, 1500);

const performanceControl = document.createElement('label');
performanceControl.id = 'performance-control';
performanceControl.style.cssText = 'display:grid;gap:8px;margin-top:16px;font-size:13px';
performanceControl.innerHTML = 'Performance<select aria-label="Performance"></select>';
performanceControl.querySelector('select').replaceChildren(
  ...Object.entries(PERFORMANCE_OPTIONS).map(([value, label]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    return option;
  }),
);
performanceControl.querySelector('select').value = performanceMode;
performanceControl.querySelector('select').onchange = (event) => {
  performanceMode = event.target.value;
  try {
    localStorage.setItem('playdeck.performance.v2', performanceMode);
    if(gameURL)deck?.save({...deck.profile(),performance:performanceMode});
  } catch {}
  const nextURL = new URL(location.href);
  nextURL.searchParams.set('performance', performanceMode);
  location.replace(nextURL.href);
};
$('#panel').append(performanceControl);
const frameCapControl = document.createElement('label');
frameCapControl.id = 'frame-cap-control';
frameCapControl.style.cssText = performanceControl.style.cssText;
frameCapControl.innerHTML = 'FPS limit<select aria-label="FPS limit"></select>';
for (const limit of [15,30,45,60,75,90,105,120,0]) {
  const option = document.createElement('option');
  option.value = String(limit);
  option.textContent = limit ? limit + ' FPS' : 'Uncapped';
  frameCapControl.querySelector('select').append(option);
}
frameCapControl.querySelector('select').value = String(frameCap);
frameCapControl.querySelector('select').onchange = event => {
  frameCap = Number(event.target.value);
  if (gameURL) deck?.save({...deck.profile(), frameCap});
  const nextURL = new URL(location.href);
  nextURL.searchParams.set('frameCap', String(frameCap));
  location.replace(nextURL.href);
};
$('#panel').append(frameCapControl);
const graphicsControls=document.createElement('div');graphicsControls.id='graphics-controls';
function graphicsControl(title,key,choices) {
  const label=document.createElement('label');label.append(document.createTextNode(title));
  const control=document.createElement(choices?'select':'input');
  control.setAttribute('aria-label',title);
  if(choices){for(const [value,text] of choices){const option=document.createElement('option');option.value=String(value);option.textContent=text;control.append(option);}control.value=String(graphics[key]);}
  else {control.type='checkbox';control.checked=graphics[key];}
  control.onchange=()=>{graphics=graphicsOptions({...graphics,[key]:choices?Number(control.value):control.checked});if(gameURL)deck?.save({...deck.profile(),graphics});const url=new URL(location.href);for(const [name,value] of Object.entries(graphics))url.searchParams.set(name,String(value));location.replace(url.href);};
  label.append(control);graphicsControls.append(label);
}
graphicsControl('Render scale','renderScale',[[.25,'25%'],[.5,'50%'],[.75,'75%'],[1,'100%']]);
graphicsControl('Adaptive resolution (Automatic mode)','adaptive');
graphicsControl('Reduced texture filtering','reducedFiltering');
graphicsControl('Engine quality reductions','engineOptimizations');
const graphicsStatus=document.createElement('p');graphicsStatus.className='deck-status';graphicsStatus.textContent='Engine: detecting';graphicsControls.append(graphicsStatus);
$('#panel').append(graphicsControls);
document.body.classList.toggle('performance-active', performanceMode !== 'native');
// Unified chrome remains blurred; the small toolbar is hidden during normal gameplay.
let performanceChannel = null,
  lastBudgetChange = 0,
  healthySamples = 0;
function connectPerformanceChannel(){performanceChannel?.close();
healthySamples = 0;
rendererScaling=false;dynamicScale=graphics.renderScale;
lastBudgetChange = Date.now();
try {
  performanceChannel = new BroadcastChannel(launchSession?'playdeck-performance:'+launchSession.id:'timebomb-performance:' + gameURL.origin);
  performanceChannel.onmessage = (event) => {
    const data = event.data;
    if(data?.type==='graphics-status'){
      const next=rendererScaling || !!data.rendererScaling;
      const changed=rendererScaling!==next;
      rendererScaling=next;
      if(data.rendererScaling || !rendererScaling)graphicsStatus.textContent='Engine: '+String(data.engine || 'Unknown')+(data.rendererScaling?' · renderer scaling': ' · viewport scaling where supported');
      if(changed)applyDisplay();
      if(changed)performanceChannel.postMessage({type:'graphics-config',scale:dynamicScale});
      return;
    }
    if (['graphics-failure', 'allocation-failure'].includes(data?.type)) {
      if (frame?.isConnected)
        reportGameFailure(data.type === 'graphics-failure' ? 'graphics' : 'crash', data.detail);
      return;
    }
    if (data?.type !== 'cadence' || !Number.isFinite(data.fps) || !Number.isFinite(data.p90))
      return;
    deck?.sample(data);
    if (
      performanceMode !== 'auto' ||
      document.hidden ||
      !gameReady ||
      Date.now() - lastBudgetChange < 10000
    )
      return;
    if(graphics.adaptive){
      const target=data.targetFPS || 60, refresh=data.refreshInterval || 1000/60;
      const expected=Math.ceil((1000/target)/refresh-.02)*refresh;
      healthySamples=data.count>=30 && data.p90<=expected*1.1?healthySamples+1:0;
      const next=nextRenderScale(dynamicScale,data,graphics.renderScale,healthySamples);
      if(next!==dynamicScale){dynamicScale=next;healthySamples=0;lastBudgetChange=Date.now();performanceChannel.postMessage({type:'graphics-config',scale:dynamicScale});applyDisplay();}
      return;
    }

  };
  window.addEventListener('pagehide', () => performanceChannel?.close(), { once: true });
} catch {}
}
connectPerformanceChannel();

let hidePageExtras = true;
try {
  hidePageExtras = localStorage.getItem('timebomb.hidePageExtras') !== 'false';
} catch {}
if(gameURL && profiles()[gameId(gameURL.href)]?.profile)hidePageExtras=readProfile(gameURL.href).hidePageExtras;
if (launch.hidePageExtras !== undefined) hidePageExtras = launch.hidePageExtras;
const cleanupDocuments = new Set(),
  cleanupHidden = new Set();
const extrasToggle = document.createElement('label');
extrasToggle.style.cssText =
  'display:flex;align-items:center;gap:8px;margin-top:16px;font-size:13px';
extrasToggle.id = 'hide-page-extras';
extrasToggle.innerHTML = '<input type="checkbox"> Hide page extras';
extrasToggle.querySelector('input').checked = hidePageExtras;
$('#panel').append(extrasToggle);
function isPageExtraControl(element) {
  if (
    !element.matches('button,a[href],[role="button"],input[type="button"],input[type="submit"]') ||
    element.querySelector('canvas,iframe,video')
  )
    return false;
  // Only control labels and their own identifiers count, never a game container.
  const label = [
    element.getAttribute('aria-label'),
    element.getAttribute('title'),
    element.textContent?.slice(0, 200),
    element.value,
    element.id,
    element.getAttribute('name'),
  ]
    .filter(Boolean)
    .join(' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]/g, ' ')
    .toLowerCase();
  if (
    /\b(donat(?:e|ion|ions)|fullscreen|full screen|join (?:our |the )?(?:discord|community|server)|discord (?:server|invite)|buy me a coffee|support (?:us|me|the developer|this project)|patreon|ko fi|sponsor(?:s|ship)?|remove ads|visit (?:our|my) (?:website|store))\b/.test(
      label,
    )
  )
    return true;
  const href = element.getAttribute('href') || '';
  if (/(?:discord\.gg\/|discord(?:app)?\.com\/invite\/)/i.test(href)) return true;
  return false;
}
function pageExtraKind(element) {
  if (isPageExtraControl(element)) return 'hide';
  if (
    element.matches('html,body,main,script,style,link,iframe,video,audio') ||
    element.querySelector('iframe,video,audio,button,input,select,[contenteditable="true"]')
  )
    return '';
  const signature = [element.id, element.getAttribute('class'), element.getAttribute('aria-label')]
    .filter(Boolean)
    .join(' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]/g, ' ')
    .toLowerCase();
  const text = (element.textContent || '').trim().slice(0, 500);
  const counter =
    /^(?:fps\s*[:=]?\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?\s*fps|frame(?:rate| rate)\s*[:=]?\s*\d+)/i.test(
      text,
    );
  const logLines =
    /^(?:\[(?:info|debug|trace|warn|error)\]|(?:debug|trace|info):)/im.test(text) &&
    text.split('\n').length > 1;
  const debug =
    /\b(?:fps|frame rate|framerate|debug (?:overlay|output|log|info)|debugger|console (?:output|log)|performance (?:overlay|stats)|stats panel|log output)\b/.test(
      signature,
    );
  const canvas = element.matches('canvas') || element.querySelector('canvas');
  if (canvas) {
    // Never hide the game canvas based on nearby text.
    if (element.matches('canvas') && debug && element.width <= 320 && element.height <= 200)
      return 'hide';
    return '';
  }
  if (
    (counter || debug || (logLines && element.matches('pre,code,textarea,output'))) &&
    !element.matches('button,a,input,select') &&
    (!element.matches('textarea') || element.readOnly)
  )
    return 'hide';
  // Brand/promo DOM splash layers can be hidden only after the game is ready.
  if (
    gameReady &&
    /\b(?:promo|advertisement|social|discord) (?:overlay|splash|intro)\b/.test(signature)
  )
    return 'hide';
  if (
    /\b(?:decorative|background|logo) (?:animation|animated)\b/.test(signature) &&
    !/\b(?:loading|loader|progress)\b/.test(signature)
  )
    return 'motion';
  return '';
}
function cleanGameDocument(doc) {
  if (!doc || cleanupDocuments.has(doc)) return;
  cleanupDocuments.add(doc);
  const owner = doc.ownerDocument || doc;
  const style = owner.createElement('style');
  style.textContent =
    '[data-timebomb-page-extra]{display:none!important}[data-timebomb-decorative-motion]{animation:none!important;transition:none!important}';
  (doc.head || doc.documentElement || doc).append(style);
  let timer;
  const pending = new Set([doc]);
  const scan = () => {
    timer = null;
    if (!hidePageExtras) return;
    const selector =
      'button,a[href],[role="button"],input[type="button"],input[type="submit"],[id],[class],textarea,output,small,span,pre,code';
    const roots = pending.has(doc) ? [doc] : [...pending].filter((node) => node.isConnected);
    pending.clear();
    const candidates = new Set();
    for (const root of roots) {
      if (root.matches?.(selector)) candidates.add(root);
      for (const element of root.querySelectorAll?.(selector) || []) candidates.add(element);
    }
    for (const element of cleanupHidden) if (!element.isConnected) cleanupHidden.delete(element);
    for (const element of candidates) {
      const kind = pageExtraKind(element);
      if (kind === 'hide') {
        element.setAttribute('data-timebomb-page-extra', '');
        cleanupHidden.add(element);
      } else if (cleanupHidden.has(element)) {
        element.removeAttribute('data-timebomb-page-extra');
        element.removeAttribute('data-timebomb-decorative-motion');
        cleanupHidden.delete(element);
      }
      if (kind === 'motion') {
        element.setAttribute('data-timebomb-decorative-motion', '');
        cleanupHidden.add(element);
      }
    }
    for (const root of roots) {
      if (root.shadowRoot) cleanGameDocument(root.shadowRoot);
      for (const element of root.querySelectorAll?.('*') || [])
        if (element.shadowRoot) cleanGameDocument(element.shadowRoot);
    }
    const frames = new Set();
    for (const root of roots) {
      if (root.matches?.('iframe')) frames.add(root);
      for (const child of root.querySelectorAll?.('iframe') || []) frames.add(child);
    }
    for (const child of frames) {
      if (!child.dataset.timebombCleanupBound) {
        child.dataset.timebombCleanupBound = 'true';
        child.addEventListener('load', () => {
          try {
            cleanGameDocument(child.contentDocument);
          } catch {}
        });
      }
      try {
        if (child.contentDocument) cleanGameDocument(child.contentDocument);
      } catch {}
    }
  };
  const observer = new MutationObserver((records) => {
    if (!hidePageExtras) return;
    for (const record of records) {
      if (record.type === 'childList')
        for (const node of record.addedNodes) {
          if (node.nodeType === 1) pending.add(node);
          else if (record.target.nodeType === 1) pending.add(record.target);
        }
      if (record.type !== 'childList' || record.addedNodes.length === 0) {
        const node = record.target.nodeType === 1 ? record.target : record.target.parentElement;
        if (node) pending.add(node);
      }
    }
    if (pending.size && !timer) timer = setTimeout(scan, 750);
  });
  launchCleanups.add(()=>{observer.disconnect();clearTimeout(timer);pending.clear();});
  observer.observe(doc.documentElement || doc, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['aria-label', 'title', 'id', 'class', 'name', 'href', 'value'],
  });
  doc.addEventListener('timebomb:clean-extras', () => {
    pending.add(doc);
    scan();
  });
  scan();
}
extrasToggle.querySelector('input').onchange = (event) => {
  hidePageExtras = event.target.checked;
  if(gameURL)deck?.save({...deck.profile(),hidePageExtras});
  try {
    localStorage.setItem('timebomb.hidePageExtras', String(hidePageExtras));
  } catch {}
  if (!hidePageExtras) {
    for (const element of cleanupHidden) {
      element.removeAttribute('data-timebomb-page-extra');
      element.removeAttribute('data-timebomb-decorative-motion');
    }
    cleanupHidden.clear();
  } else for (const doc of cleanupDocuments) doc.dispatchEvent(new Event('timebomb:clean-extras'));
};
function announceMenu(name) {
  document.dispatchEvent(new CustomEvent('timebomb:menu-open', { detail: name }));
}

const controllerMapper =
  gameURL && !nativeGamepad
    ? installController({
        profileId: gameURL.href,
        getFrame: () => frame,
        forceMapping: playerSettings.forceController,
      })
    : null;
requestAnimationFrame(alignMenuPanels);
function gamePath(prefix) {
  prefix=prefix===LOCAL && launchSession?launchSession.prefix:prefix;
  return location.origin + prefix + gameURL.host + gameURL.pathname + gameURL.search + gameURL.hash;
}
function send(type, data = {}) {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => {
      channel.port1.close();
      reject(new Error('Storage worker did not respond.'));
    }, 5000);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      channel.port1.close();
      event.data.ok ? resolve(event.data) : reject(new Error(event.data.error));
    };
    (navigator.serviceWorker.controller || worker).postMessage({ type, session:launchSession?.id,game:launchSession?.game,routePrefix:launchSession?.prefix,performance:performanceMode,keepDownloaded:!!(gameURL && profiles()[gameId(gameURL.href)]?.downloadPinned),...data }, [channel.port2]);
  });
}
let statsTimer,
  statsLast = 0;
function refreshStats() {
  clearTimeout(statsTimer);
  statsTimer = setTimeout(
    async () => {
      try {
        const stats = await send('sandbox:stats');
        statsLast = Date.now();
        $('#files').textContent = `${stats.files} downloaded files`;
        $('#badge').textContent = 'Settings';
        $('#badge').innerHTML = toolbarIcon('settings') + '<span>Settings</span>';
        $('#clear-game').disabled = !gameURL || !worker || stats.gameFiles === 0;
      } catch {}
    },
    gameReady && $('#panel').hidden ? Math.max(500, 5000 - (Date.now() - statsLast)) : 500,
  );
}
function configChild() {
  if (panicBind && frame)
    frame.contentWindow.postMessage(
      { type: 'playdeck:panic-config', bind: panicBind },
      location.origin,
    );
}

let gameFailureReported = false,
  enginePoll;
function reportGameFailure(kind, detail = '') {
  if (gameFailureReported) return;
  if (!embedded) {
    $('#loading').hidden = false;
    $('#loading .loader-mark').hidden = true;
    $('#status').textContent =
      kind === 'quit'
        ? 'Game closed.'
        : kind === 'graphics'
          ? 'Graphics context lost. Try restarting the game.'
          : 'The game stopped unexpectedly.';
    $('#error').hidden = !detail;
    $('#error').textContent = String(detail).slice(0, 200);
    $('#retry').hidden = false;
  }
  gameFailureReported = true;
  controllerMapper?.setPaused(true);
  try {
    frame?.contentDocument.querySelectorAll('audio,video').forEach((media) => {
      media.muted = true;
      media.pause();
    });
  } catch {}
  parent.postMessage(
    { type: 'playdeck:game-failure', kind, detail: String(detail).slice(0, 500) },
    parentOrigin,
  );
}
function watchGameLifecycle() {
  clearInterval(enginePoll);
  gameFailureReported = false;
  let doc, win;
  try {
    doc = frame.contentDocument;
    win = frame.contentWindow;
    if (!doc?.body) return;
  } catch {
    return;
  }
  win.close = () => reportGameFailure('quit');
  const fatal = (error) =>
    error?.name === 'RuntimeError' ||
    /(?:out of memory|memory access out of bounds|unreachable|abort\(|wasm.*trap)/i.test(
      error?.message || '',
    );
  win.addEventListener('error', (event) => {
    if (fatal(event.error || { message: event.message }))
      reportGameFailure(
        'crash',
        (event.error || event.reason)?.message || event.message || String(event.reason || ''),
      );
  });
  win.addEventListener('unhandledrejection', (event) => {
    if (fatal(event.reason))
      reportGameFailure(
        'crash',
        (event.error || event.reason)?.message || event.message || String(event.reason || ''),
      );
  });
  doc.addEventListener('webglcontextlost', () => reportGameFailure('graphics'), true);
  const wrap = (module, key, kind) => {
    const previous = module[key];
    if (previous?.__timebombLifecycle) return;
    const handler = function (...args) {
      reportGameFailure(
        kind === 'exit' ? (Number(args[0]) === 0 ? 'quit' : 'crash') : kind,
        args[0],
      );
      return typeof previous === 'function' ? previous.apply(this, args) : undefined;
    };
    handler.__timebombLifecycle = true;
    module[key] = handler;
  };
  const inspect = () => {
    if (!frame?.isConnected) {
      clearInterval(enginePoll);
      return;
    }
    try {
      const module = win.Module;
      if (module && typeof module === 'object') {
        wrap(module, 'onAbort', 'crash');
        wrap(module, 'onExit', 'exit');
        if (module.ABORT === true) reportGameFailure('crash');
      }
    } catch {}
  };
  inspect();
  enginePoll = setInterval(inspect, 1000);
}

const mouseGuardDocs = new WeakSet();
let mouseLockTarget = null,
  mouseLockDocument = null;
const mouseLockOptions = new WeakMap();
const relockButton = document.createElement('button');
relockButton.id = 'mouse-relock';
relockButton.type = 'button';
relockButton.textContent = 'Lock mouse';
relockButton.hidden = true;
relockButton.style.cssText =
  'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483646;border:0;border-radius:10px;background:rgba(25,28,25,.68);backdrop-filter:blur(14px);color:#e0e4dc;font:12px system-ui;padding:9px 13px';
document.body.append(relockButton);
function updateMouseLock() {
  relockButton.hidden =
    !mouseLockTarget?.isConnected || Boolean(mouseLockDocument?.pointerLockElement);
}
function requestMouseCapture() {
  if (!mouseLockTarget?.isConnected || mouseLockDocument?.pointerLockElement) return;
  try {
    mouseLockTarget.focus?.({ preventScroll: true });
    const result = mouseLockTarget.requestPointerLock(...(mouseLockOptions.get(mouseLockTarget) || []));
    result?.catch(() => {
      relockButton.textContent = 'Click game to lock mouse';
    });
  } catch {
    relockButton.textContent = 'Click game to lock mouse';
  }
}
relockButton.onclick = requestMouseCapture;
function stabilizeGameMouse(doc) {
  if (!doc || mouseGuardDocs.has(doc)) return;
  mouseGuardDocs.add(doc);
  const win = doc.defaultView;
  const nativeRequest = win.Element.prototype.requestPointerLock;
  if (nativeRequest) {
    win.Element.prototype.requestPointerLock = function (...args) {
      mouseLockTarget = this;
      mouseLockDocument = doc;
      mouseLockOptions.set(this, args);
      return nativeRequest.apply(this, args);
    };
  }
  doc.addEventListener(
    'pointerlockchange',
    () => {
      if (doc.pointerLockElement) {
        mouseLockTarget = doc.pointerLockElement;
        mouseLockDocument = doc;
        relockButton.textContent = 'Lock mouse';
      }
      updateMouseLock();
    },
    true,
  );
  doc.addEventListener('pointerlockerror', updateMouseLock, true);
  // Games own their click-to-lock behavior. Issuing another request while the
  // game's asynchronous request is pending can change options or fail capture.
  // The explicit Lock mouse button remains available for recovery.
  for (const child of doc.querySelectorAll('iframe')) {
    const attach = () => {
      try {
        stabilizeGameMouse(child.contentDocument);
      } catch {}
    };
    child.addEventListener('load', attach);
    attach();
  }
}
function mount(url) {
  tearDownLaunch();gameFailureReported=false;
  failedDocument = null;
  restoreExpandedCanvas();
  mouseLockTarget = null;
  mouseLockDocument = null;
  relockButton.hidden = true;
  pageLoaded = false;
  gameReady = false;
  lastDownload = Date.now();
  activeDownloads = null;
  clearTimeout(idleTimer);
  $('#loading').hidden = false;
  $('#loading .loader-mark').hidden = false;
  $('#error').hidden = true;
  $('#retry').hidden = true;
  $('#status').textContent = 'Loading game files.';
  clearTimeout(slowTimer);
  $('#continue').hidden = true;
  slowTimer = setTimeout(() => {
    if (!gameReady) {
      $('#continue').hidden = false;
      $('#status').textContent =
        'Still loading files. You can reveal the game if its own loader needs interaction.';
    }
  }, 12000);
  monitorDownloads();
  frame?.remove();
  frame = document.createElement('iframe');
  frame.title = 'Play ' + name;
  frame.setAttribute(
    'sandbox',
    'allow-scripts allow-same-origin allow-pointer-lock allow-forms allow-orientation-lock',
  );
  frame.setAttribute('allow', 'fullscreen; autoplay; gamepad; cross-origin-isolated');
  frame.addEventListener('load', () => {
    pageLoaded = true;
    lastDownload = Date.now();
    if (!worker) revealGame();
    applyDisplay();
    controllerMapper?.attach(frame);
    try {
      stabilizeGameMouse(frame.contentDocument);
      toolbar.attach(frame.contentDocument);
    } catch {}
    watchGameLifecycle();
    try {
      // Toolbar.attach listens within the game document and dismisses every menu.
      cleanGameDocument(frame.contentDocument);
    } catch {}
    configChild();deck?.mounted();
    try {
      const status=frame.contentWindow.performance.getEntriesByType('navigation')[0]?.responseStatus;
      if(status>=400)failedDocument={url:frame.contentWindow.location.href,status};
    } catch {}
    if(failedDocument){showDocumentFailure(failedDocument);return;}
    checkDownloads();
  });
  frame.src = url;
  document.body.prepend(frame);
  applyDisplay();
}
$('#retry').onclick = () => location.reload();
$('#badge').onclick = () => {
  toolbar.toggleSettings();
  refreshStats();
};
async function clearDownloads(currentOnly) {
  if (currentOnly && !gameURL) return;
  tearDownLaunch();
  frame?.remove();
  frame = null;
  $('#clear').disabled = true;
  $('#clear-game').disabled = true;
  $('#files').textContent = 'Clearing downloaded files…';
  try {
    await send(currentOnly && launchSession?'sandbox:remove-owner':currentOnly?'sandbox:clear-game':'sandbox:clear',currentOnly && launchSession?{owner:launchSession.game}:{});
    $('#files').textContent = currentOnly
      ? 'This game’s cached files cleared.'
      : 'Downloaded files cleared.';
    $('#loading').hidden = false;
    $('#status').textContent = 'Cached files cleared. Game saves were kept.';
    $('#retry').hidden = false;
    refreshStats();
  } catch (error) {
    $('#files').textContent = error.message;
  } finally {
    $('#clear').disabled = !worker;
    $('#clear-game').disabled = !worker || !gameURL;
  }
}
$('#clear').onclick = () => clearDownloads(false);
$('#clear-game').onclick = () => clearDownloads(true);
window.addEventListener('message', (event) => {
  if (event.source === parent && embedded && event.origin === parentOrigin) {
    parentOrigin = event.origin;
    if (event.data?.type === 'playdeck:health-ping')
      parent.postMessage({ type: 'playdeck:health-pong' }, parentOrigin);
    // Display configuration is supplied in the launch URL, not catalog-owned markup.
    // Panic preferences are owned and persisted by Playdeck.
    if (event.data?.type === 'playdeck:state') deck?.setParentState(event.data);
  } else if (
    frame &&
    event.source === frame.contentWindow &&
    event.origin === location.origin &&
    event.data?.type === 'playdeck:panic'
  )
    panicGame();
});
window.addEventListener(
  'keydown',
  (event) => {
    const bind = panicBind;
    if (event.composedPath().some((node) => ['INPUT', 'SELECT', 'TEXTAREA'].includes(node.tagName)))
      return;
    if (matchesBind(event, playerSettings.panicBind)) {
      event.preventDefault();
      panicGame();
    }
  },
  true,
);
function showDocumentFailure(data) {
  failedDocument=data;gameReady=false;
  clearInterval(activityPoll);clearTimeout(idleTimer);clearTimeout(slowTimer);
  $('#loading').hidden=false;$('#loading .loader-mark').hidden=true;
  $('#continue').hidden=true;$('#retry').hidden=false;
  $('#status').textContent='The game host returned HTTP '+data.status+'. The game did not start.';
  deck?.failure({...data,kind:'request-failure',detail:'The game host could not serve its launch page.'});
}
navigator.serviceWorker?.addEventListener('message', (event) => {
  if(event.data?.session && event.data.session!==launchSession?.id)return;
  if(event.data?.type==='sandbox:request-error' && event.data.document && event.data.url===frame?.src)showDocumentFailure(event.data);
  if (event.data?.type === 'sandbox:downloads') downloadActivity(event.data);
  if (event.data?.type === 'sandbox:saved') refreshStats();
  if (event.data?.type === 'sandbox:storage-error') {
    $('#storage-note').hidden = false;
    $('#storage-note').textContent = event.data.message;
  }
});
navigator.serviceWorker?.addEventListener('controllerchange', () => refreshStats());
async function start() {
  if (!gameURL) return;
  try {
    if (!navigator.serviceWorker || !window.caches)
      throw new Error('Local storage is unavailable in this browser. Try another browser.');
    for (const old of await navigator.serviceWorker.getRegistrations()) {
      if ([location.origin + '/player/', location.origin + '/__sandbox/'].includes(old.scope))
        await old.unregister();
    }
    const registration = await navigator.serviceWorker.register('/player/sw.js', {
      scope: '/',
      type: 'module',
      updateViaCache: 'none',
    });
    // Wait for the new worker instead of sending new messages to an old controller.
    const next = registration.installing || registration.waiting;
    if (next && next.state !== 'activated')
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          cleanup();
          reject(new Error('Sandbox worker installation timed out. Try again.'));
        }, 20000);
        function cleanup() {
          clearTimeout(timeout);
          next.removeEventListener('statechange', changed);
        }
        function changed() {
          if (next.state === 'activated') {
            cleanup();
            resolve();
          } else if (next.state === 'redundant') {
            cleanup();
            reject(new Error('Sandbox worker installation failed.'));
          }
        }
        next.addEventListener('statechange', changed);
        changed();
      });
    worker = registration.active || next;
    if (!worker) throw new Error('Sandbox worker could not start.');
    if (navigator.serviceWorker.controller !== worker)
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          cleanup();
          reject(new Error('Sandbox worker could not control this page.'));
        }, 8000);
        function cleanup() {
          clearTimeout(timeout);
          navigator.serviceWorker.removeEventListener('controllerchange', changed);
        }
        function changed() {
          if (navigator.serviceWorker.controller === worker) {
            cleanup();
            resolve();
          }
        }
        navigator.serviceWorker.addEventListener('controllerchange', changed);
        changed();
      });
  } catch (error) {
    // Third-party storage can be blocked on mobile. The server proxy still runs online.
    worker = null;
    $('#storage-note').textContent =
      'Browser storage is unavailable. This game is running online without offline downloads.';
    $('#files').textContent = 'Online mode';
    $('#badge').textContent = 'Settings';
    $('#badge').innerHTML = toolbarIcon('settings') + '<span>Settings</span>';
    $('#clear').disabled = true;
    $('#clear-game').disabled = true;
  }
  // Let the game's own document load its dependencies once, in the correct order.
  if(worker)try{await send('sandbox:config');}catch{}
  if(deck && !(await deck.preflight()))return;
  mount(gamePath(LOCAL));
  if (worker) refreshStats();
}
installSettings(
  $('#panel'),
  playerSettings,
  (next) => {
    playerSettings = next;
    document.documentElement.dataset.playdeckAppearance = next.appearance;
    panicBind = next.panicBind;
    controllerMapper?.setForceMapping(next.forceController);
    configChild();
    announceSettings();
  },
  { gameURL: gameURL?.href, nativeGamepad },
);
const toolbar=installToolbar(menuBar, $('#panel'), {
  getFrame: () => frame,
  alwaysVisible: launch.toolbar === 'visible',
});
if (gameURL) {
  const config = displayOptionsConfig;
  let selection = config ? { ratio: config.ratio, mode: config.mode } : null;
  try {
    const saved = JSON.parse(localStorage.getItem('playdeck.display.v2:' + gameURL.href) || 'null');
    if (config?.ratios.includes(saved?.ratio)) selection = { ratio: saved.ratio, mode: 'stretch' };
  } catch {}
  if (config && launch.ratio && config.ratios.includes(launch.ratio))
    selection = { ratio: launch.ratio, mode: 'stretch' };
  setupDisplay({ config, selection, css: displayCSS, markup: displayMarkup });
} else if (!params.get('url') && !launchError) {
  $('#loading .loader-mark').hidden = true;
  $('#status').textContent =
    'Open a game in your browser. Proxy and local file caching are built in.';
  const form = document.createElement('form');
  form.id = 'playdeck-launch';
  form.innerHTML =
    '<label>Game URL<input name="url" type="url" required placeholder="https://example.com/game/" aria-label="Game URL"></label><label>Game name<input name="name" placeholder="Game" aria-label="Game name"></label><label class="check-row"><input name="canvas" type="checkbox">Enable canvas display options</label><button type="submit">Play game</button>';
  form.onsubmit = (event) => {
    event.preventDefault();
    try {
      const url = new URL(form.elements.url.value);
      if (url.protocol !== 'https:' || url.username || url.password)
        throw new Error('Use a public HTTPS game URL.');
      const launch = new URL('/player/', location.origin);
      launch.searchParams.set('url', url.href);
      launch.searchParams.set('name', form.elements.name.value.trim() || 'Game');
      if (form.elements.canvas.checked) launch.searchParams.set('displayOptions', 'true');
      location.assign(launch.href);
    } catch (error) {
      $('#error').hidden = false;
      $('#error').textContent = error.message;
    }
  };
  $('#loading').append(form);
  const links = document.createElement('p');
  links.innerHTML =
    '<a href="/docs/">URL API &amp; deployment guide</a> · <a href="/downloads/playdeck-source.zip" download>Download source</a> · <a href="/downloads/playdeck-deploy.zip" download>Deployable ZIP</a>';
  $('#loading').append(links);
}
deck=installDeck({gameURL:gameURL?.href,name,image:params.get('image'),getFrame:()=>frame,getSession:()=>launchSession,getMode:()=>performanceMode,getFrameCap:()=>frameCap,getGraphics:()=>graphics,launchOptions:{nativeGamepad,displayOptions:displayOptionsConfig},toolbar,send,reload:({online=false}={})=>{if(!gameURL)return;launchSession=createSession(gameURL.href,performanceMode,readProfile(gameURL.href).compatibility,frameCap,graphics);connectPerformanceChannel();send('sandbox:config',{online}).catch(()=>{}).finally(()=>mount(gamePath(LOCAL)));},setState:data=>{controllerMapper?.setPaused(data.paused);frame?.contentWindow.postMessage({type:'playdeck:state',...data},location.origin);}});
if(!gameURL && !params.get('url')){const recent=document.createElement('button');recent.type='button';recent.textContent='Recent games';recent.onclick=()=>showRecentGames();const link=document.createElement('button');link.type='button';link.textContent='Build launch link';link.onclick=()=>showLinkBuilder();$('#loading').append(recent,link);}
window.addEventListener('pagehide',tearDownLaunch,{once:true});
announceSettings();
if (embedded) parent.postMessage({ type: 'playdeck:sandbox-ready' }, parentOrigin);
start();


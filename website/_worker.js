import {installPerformance} from './player/performance.js';
export {installPerformance as installMobilePerformance} from './player/performance.js';
import {decodeS3TC,installS3TC} from './player/s3tc.js';

const LEGACY_PREFIX = '/__game/';
const PREFIX = LEGACY_PREFIX + 'v4/';
const LOCAL_PREFIX = '/player/games/';
// Wrangler adds __name calls inside serialized functions when keeping names.
// Supply the helper in the injected realm, isolated from the game's own bindings.
const INJECTED_NAMES='const __name=(fn,name)=>{try{Object.defineProperty(fn,"name",{value:name,configurable:true});}catch{}return fn;};';
export const DESKTOP_UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36';
export function desktopMedia(query) {
  return String(query).replace(/\(\s*((?:any-)?pointer|(?:any-)?hover)\s*:\s*(coarse|fine|none|hover)\s*\)/gi,(_,feature,value)=>{
    const matches=/pointer/i.test(feature) ? value.toLowerCase()==='fine' : value.toLowerCase()==='hover';
    return matches ? '(min-width: 0px)' : '(max-width: -1px)';
  });
}
export function desktopOverrides(mapMedia,ua,mode='native') {
  const define=(object,key,value)=>{try {Object.defineProperty(object,key,{configurable:true,get:()=>value});} catch {}};
  const nav=globalThis.navigator;
  if(nav){
    if(globalThis.__timebombNativeMobile===undefined)globalThis.__timebombNativeMobile=/Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent) || (nav.platform==='MacIntel' && nav.maxTouchPoints>1);
    // Keep native identity in performance modes so engines retain mobile optimizations.
    if(mode!=='native')return;
    define(nav,'userAgent',ua);define(nav,'appVersion',ua.slice(8));define(nav,'platform','Win32');
    define(nav,'vendor','Google Inc.');define(nav,'maxTouchPoints',0);define(nav,'msMaxTouchPoints',0);
    define(nav,'oscpu','Windows NT 10.0; Win64; x64');
    define(nav,'standalone',false);
    const brands=[{brand:'Chromium',version:'144'},{brand:'Google Chrome',version:'144'},{brand:'Not_A Brand',version:'99'}];
    const values={brands,mobile:false,platform:'Windows',architecture:'x86',bitness:'64',model:'',platformVersion:'10.0.0',uaFullVersion:'144.0.0.0',fullVersionList:brands.map(b=>({...b,version:b.version+'.0.0.0'})),wow64:false};
    define(nav,'userAgentData',{brands,mobile:false,platform:'Windows',toJSON:()=>({brands,mobile:false,platform:'Windows'}),getHighEntropyValues:async hints=>Object.fromEntries(['brands','mobile','platform',...hints].filter(key=>key in values).map(key=>[key,values[key]]))});
  }
  if(typeof window==='undefined')return;
  // Keep real touch events and rendering APIs; only change device detection signals.
  for(const start of [window,document,globalThis.HTMLElement?.prototype]){
    for(let object=start;object && object!==Object.prototype;object=Object.getPrototypeOf(object)){
      for(const key of ['ontouchstart','ontouchmove','ontouchend','ontouchcancel']){try {delete object[key];} catch {}}
    }
  }
  try {delete window.orientation;} catch {}
  if(window.matchMedia){
    const native=window.matchMedia.bind(window);
    window.matchMedia=query=>{const result=native(mapMedia(query));try {Object.defineProperty(result,'media',{value:String(query),configurable:true});} catch {}return result;};
  }
  if(window.screen){
    define(window.screen,'width',Math.max(1280,window.innerWidth || 0));define(window.screen,'availWidth',Math.max(1280,window.innerWidth || 0));
    define(window.screen,'height',Math.max(720,window.innerHeight || 0));define(window.screen,'availHeight',Math.max(720,window.innerHeight || 0));
  }
  const sheet=globalThis.CSSStyleSheet?.prototype;
  if(sheet)for(const key of ['insertRule','replace','replaceSync']){
    const native=sheet[key];if(typeof native==='function')sheet[key]=function(text,...args){return native.call(this,mapMedia(text),...args);};
  }
}

export function installPointerCompatibility() {
  if(typeof document==='undefined' || typeof Element==='undefined' || Element.prototype.requestPointerLock)return;
  let target=null;
  const change=()=>document.dispatchEvent(new Event('pointerlockchange'));
  // Capture is virtual: controller mapping can send relative motion on browsers
  // without native pointer lock. This does not claim OS-level mouse confinement.
  Object.defineProperty(document,'pointerLockElement',{configurable:true,get:()=>target});
  Element.prototype.requestPointerLock=function(){target=this;change();return Promise.resolve();};
  Document.prototype.exitPointerLock=function(){if(target){target=null;change();}};
  document.addEventListener('keydown',event=>{if(event.key==='Escape')document.exitPointerLock();});
}
function publicHost(host) {
  return /^[a-z0-9.-]+$/i.test(host) && host.includes('.') && !/^\d+(\.\d+){3}$/.test(host) &&
    !/(^|\.)(localhost|local|internal|test|invalid)$/.test(host);
}
export function targetFromProxy(url, prefix = PREFIX) {
  if (!url.pathname.startsWith(prefix)) throw new Error('Invalid proxy path');
  return new URL('https://' + url.pathname.slice(prefix.length) + url.search);
}
export function proxyURL(value, base, origin, prefix = PREFIX) {
  if (!value || /^(#|data:|blob:|javascript:|mailto:|tel:)/i.test(value)) return value;
  try {
    const url = new URL(value, base);
    if (url.origin === origin && url.pathname.startsWith(prefix)) return url.href;
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return value;
    return origin + prefix + url.host + url.pathname + url.search + url.hash;
  } catch { return value; }
}
// String source prevents bundlers from leaking private helper names into game pages.
const CLIENT_HOOK = "function(base, origin, prefix) {\n  const remote = value => {\n    const url = new URL(value, base);\n    if (url.origin !== origin) return url.href;\n    if (url.pathname.startsWith(prefix)) return 'https://' + url.pathname.slice(prefix.length) + url.search + url.hash;\n    return new URL(url.pathname + url.search + url.hash, base).href;\n  };\n  const map = value => {\n    if (typeof value !== 'string' && !(value instanceof URL)) return value;\n    value = String(value);\n    if (/^(#|data:|blob:|javascript:|mailto:|tel:)/i.test(value)) return value;\n    // import.meta.url-derived .pathname values already include the proxy route.\n    if (value.startsWith(prefix)) return origin + value;\n    try {\n      // The page's <base> may appear after this hook, or change at runtime.\n      const sourceBase = typeof document === 'object' ? remote(document.baseURI || base) : base;\n      let url = new URL(value, sourceBase);\n      if (url.origin === origin) {\n        if (url.pathname.startsWith(prefix)) return url.href;\n        url = new URL(url.pathname + url.search + url.hash, sourceBase);\n      }\n      return url.protocol === 'https:' && !url.username && !url.password && !url.port\n        ? origin + prefix + url.host + url.pathname + url.search + url.hash : value;\n    } catch { return value; }\n  };\n  const nativeFetch = globalThis.fetch.bind(globalThis);\n  globalThis.fetch = (input, options) => nativeFetch(input instanceof Request ? new Request(map(input.url), input) : map(input), options);\n  if (typeof XMLHttpRequest !== 'undefined') {\n    const nativeOpen = XMLHttpRequest.prototype.open;\n    XMLHttpRequest.prototype.open = function(method, url, ...args) { return nativeOpen.call(this, method, map(url), ...args); };\n  }\n  if (typeof importScripts === 'function') {\n    const nativeImport = importScripts;\n    globalThis.importScripts = (...urls) => nativeImport(...urls.map(map));\n  }\n  for (const name of ['Worker', 'SharedWorker']) {\n    const Native = globalThis[name];\n    if (Native) globalThis[name] = new Proxy(Native, {construct(target, args) { args[0] = map(args[0]); return Reflect.construct(target, args); }});\n  }\n  if (typeof window === 'undefined') return;\n\n  const cookieNamespace = 'tb_' + Array.from(new URL(base).hostname, c => c.charCodeAt(0).toString(16).padStart(2,'0')).join('') + '_';\n  let cookieOwner = document;\n  while (cookieOwner && !Object.getOwnPropertyDescriptor(cookieOwner,'cookie')) cookieOwner = Object.getPrototypeOf(cookieOwner);\n  const cookieDescriptor = cookieOwner && Object.getOwnPropertyDescriptor(cookieOwner,'cookie');\n  if (cookieDescriptor?.get && cookieDescriptor?.set) Object.defineProperty(document,'cookie', {\n    configurable:true,\n    get() { return cookieDescriptor.get.call(document).split(';').map(value=>value.trim()).filter(value=>value.startsWith(cookieNamespace)).map(value=>value.slice(cookieNamespace.length)).join('; '); },\n    set(value) {\n      const parts=String(value).split(';').map(value=>value.trim());\n      const first=parts.shift();\n      if (!first || !first.includes('=')) return;\n      const attributes=parts.filter(value=>!/^(domain|samesite|secure|partitioned)(=|$)/i.test(value)).map(value=>{\n        if (!/^path=/i.test(value)) return value;\n        const path=value.slice(5);\n        return 'Path=' + prefix + new URL(base).host + (path.startsWith('/') ? path : '/');\n      });\n      cookieDescriptor.set.call(document,cookieNamespace + first + '; ' + [...attributes,'Secure','SameSite=None','Partitioned'].join('; '));\n    }\n  });\n  let panicBind = null;\n  window.addEventListener('message', event => {\n    if (event.source === window.parent && (['https://timebomb.lol','https://www.timebomb.lol'].includes(event.origin) || event.origin === origin) && event.data?.type === 'playdeck:panic-config') panicBind = event.data.bind;\n  });\n  window.addEventListener('keydown', event => {\n    if (panicBind && !event.repeat && event.code === panicBind.code && event.ctrlKey === panicBind.ctrl && event.altKey === panicBind.alt && event.shiftKey === panicBind.shift && event.metaKey === panicBind.meta) {\n      event.preventDefault();event.stopImmediatePropagation();window.parent.postMessage({type:'playdeck:panic'}, '*');\n    }\n  },true);\n  const srcset = value => /^\\s*data:/i.test(String(value)) ? value : String(value).split(',').map(part => part.trim().replace(/^(\\S+)/, url => map(url))).join(', ');\n  const nativeSetAttribute = Element.prototype.setAttribute;\n  Element.prototype.setAttribute = function(name, value) {\n    return nativeSetAttribute.call(this, name, /^(src|href|poster|action|data)$/i.test(name) ? map(value) : /^srcset$/i.test(name) ? srcset(value) : value);\n  };\n  for (const [name, prop] of [['HTMLImageElement','src'],['HTMLImageElement','srcset'],['HTMLScriptElement','src'],['HTMLLinkElement','href'],['HTMLMediaElement','src'],['HTMLMediaElement','poster'],['HTMLSourceElement','src'],['HTMLSourceElement','srcset'],['HTMLIFrameElement','src'],['HTMLAnchorElement','href'],['HTMLAreaElement','href'],['HTMLObjectElement','data'],['HTMLFormElement','action']]) {\n    const type = window[name];\n    const descriptor = type && Object.getOwnPropertyDescriptor(type.prototype, prop);\n    if (descriptor?.set && descriptor.configurable) Object.defineProperty(type.prototype, prop, {...descriptor, set(value) { descriptor.set.call(this, prop === 'srcset' ? srcset(value) : map(value)); }});\n  }\n  for (const name of ['pushState','replaceState']) {\n    const native = history[name].bind(history);\n    history[name] = (state, title, url) => native(state, title, url == null ? url : map(url));\n  }\n  if (navigator.serviceWorker) {\n    const nativeRegister = navigator.serviceWorker.register.bind(navigator.serviceWorker);\n    navigator.serviceWorker.register = (script, options = {}) => {\n      const root = origin + prefix + new URL(base).host + '/';\n      const scriptURL = new URL(map(script));\n      const scopeURL = options.scope ? new URL(map(options.scope)) : new URL('./', scriptURL);\n      if (!scriptURL.href.startsWith(root) || !scopeURL.href.startsWith(root)) return Promise.reject(new Error('Worker scope must remain inside this game.'));\n      return nativeRegister(scriptURL.href, {...options, scope:scopeURL.href});\n    };\n  }\n}\n";
export function bootstrap(base, origin, worker = false, prefix = PREFIX, mode='auto') {
  const params = [base, origin, prefix].map(value => JSON.stringify(value).replace(/</g, '\\u003c')).join(',');
  const desktop = prefix===LOCAL_PREFIX ? '('+desktopOverrides.toString()+')('+desktopMedia.toString()+','+JSON.stringify(DESKTOP_UA)+','+JSON.stringify(mode)+');' : '';
  const pointer=prefix===LOCAL_PREFIX ? '('+installPointerCompatibility.toString()+')();' : '';
  const script = '(()=>{'+INJECTED_NAMES+desktop+(prefix===LOCAL_PREFIX?'('+installPerformance.toString()+')('+JSON.stringify(mode)+','+JSON.stringify('timebomb-performance:'+new URL(base).origin)+');':'')+pointer+s3tcBootstrap(base,prefix)+'(' + CLIENT_HOOK + ')(' + params + ');})();';
  return worker ? script : '<script data-cfasync="false">' + script + '</script>';
}
export function s3tcBootstrap(base,prefix) {
  const url=new URL(base);
  return prefix===LOCAL_PREFIX ? '(()=>{'+INJECTED_NAMES+'('+installS3TC.toString()+')('+decodeS3TC.toString()+');})();' : '';
}
export function rewriteCSS(text, base, origin, prefix = PREFIX, mode='native') {
  if(prefix===LOCAL_PREFIX && mode==='native')text=desktopMedia(text);
  return text.replace(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi, (_, quote, value) => 'url(' + JSON.stringify(proxyURL(value.trim(), base, origin, prefix)) + ')')
    .replace(/(@import\s+)(['"])([^'"]+)\2/gi, (_, lead, quote, value) => lead + JSON.stringify(proxyURL(value, base, origin, prefix)));
}
export function rewriteJS(text, base, origin, prefix = PREFIX) {
  text = rewriteGameCompatibility(text,base,prefix);
  // Only module specifiers are source URLs. Ordinary strings can be origin checks,
  // regexes, packed data or integrity-sensitive values: runtime hooks handle requests.
  return text.replace(/(\b(?:from|import)\s*|\bimport\s*\(\s*)(['"])((?:https:\/\/|\/\/|\.{1,2}\/|\/(?!\/))[^'"\\]+)\2/g,
    (_, lead, quote, value) => lead + quote + proxyURL(value, base, origin, prefix) + quote);
}
export function rewriteGameCompatibility(text,base,prefix=PREFIX) {
  const url=new URL(base);
  if(prefix!==LOCAL_PREFIX || url.hostname!=='vel.gg')return text;
  if(url.pathname==='/bo1z/capability-worker.js' || /^\/bo1z\/artifacts\/.*\.mjs$/.test(url.pathname))return s3tcBootstrap(base,prefix)+'\n'+text;
  if(url.pathname!=='/bo1z/capabilities.js')return text;
  // This is a device policy gate, not a graphics capability test. Keep all
  // actual shared memory, storage, Wasm, worker and WebGL checks intact.
  const mobileGate=/if\s*\(\/Android\|iPhone\|iPad\|iPod\|Mobile\/i\.test\(navigator\.userAgent\)\s*\|\|\s*\(navigator\.platform\s*===\s*'MacIntel'\s*&&\s*navigator\.maxTouchPoints\s*>\s*1\)\)\s*return\s*\{\s*kind:\s*'mobile',[\s\S]*?\};/;
  return text.replace(mobileGate,'/* Timebomb desktop compatibility: continue to real engine capability checks. */');
}
export function cookiePrefix(host) {
  return 'tb_' + Array.from(host, c => c.charCodeAt(0).toString(16).padStart(2,'0')).join('') + '_';
}
export function scopedCookie(value, target, prefix = PREFIX) {
  const parts = value.split(';').map(value => value.trim());
  const first = parts.shift();
  if (!first || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+=/.test(first)) return null;
  // Preserve expiry and HttpOnly, but keep cookies in this upstream's namespace.
  const path = parts.find(value => /^path=/i.test(value))?.slice(5);
  const remotePath = path?.startsWith('/') ? path : target.pathname.slice(0,target.pathname.lastIndexOf('/')+1) || '/';
  const attributes = parts.filter(value => /^(expires|max-age|httponly)(=|$)/i.test(value));
  return cookiePrefix(target.hostname) + first + '; ' + [...attributes, 'Path=' + prefix + target.host + remotePath, 'Secure','SameSite=None','Partitioned'].join('; ');
}
function upstreamHeaders(request, target) {
  const headers = new Headers();
  // Preserve game protocol headers, never launcher/browser identity headers.
  for (const [name,value] of request.headers) {
    if (/^(host|cookie|authorization|proxy-.*|connection|keep-alive|transfer-encoding|te|trailer|upgrade|content-length|accept-encoding|origin|referer|sec-.*|cf-.*|x-forwarded-.*|forwarded|true-client-ip)$/i.test(name)) continue;
    headers.set(name,value);
  }
  const prefix = cookiePrefix(target.hostname);
  const cookies = (request.headers.get('cookie') || '').split(';').map(value => value.trim()).filter(value => value.startsWith(prefix)).map(value => value.slice(prefix.length));
  // Accept the previous KSP-only cookie until existing admission sessions expire.
  if (target.hostname === 'kerbalspaceprogram.pages.dev' && target.pathname.startsWith('/OfflinePacks/') && !cookies.some(value => value.startsWith('ksp_offline_pack='))) {
    const legacy = (request.headers.get('cookie') || '').split(';').map(value => value.trim()).find(value => /^ksp_offline_pack=[a-zA-Z0-9.]+$/.test(value));
    if (legacy) cookies.push(legacy);
  }
  if (cookies.length) headers.set('cookie',cookies.join('; '));
  headers.set('accept-encoding','identity');
  return headers;
}
function proxyHeaders(response, target, prefix = PREFIX) {
  const headers = new Headers(response.headers);
  for (const name of ['set-cookie','x-frame-options','content-security-policy','content-security-policy-report-only','clear-site-data','service-worker-allowed','cross-origin-opener-policy','cross-origin-embedder-policy']) headers.delete(name);
  headers.set('Content-Security-Policy', 'frame-ancestors https: http://localhost:* http://127.0.0.1:*');
  headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
  // Threaded WebAssembly games need isolation on the launcher, frame AND workers.
  headers.set('Cross-Origin-Embedder-Policy', 'credentialless');
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cache-Control', 'no-cache');
  headers.set('X-Timebomb-Proxy-Version', '4');
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
  headers.set('X-Content-Type-Options', 'nosniff');
  for (const value of response.headers.getSetCookie()) {
    const cookie = scopedCookie(value,target,prefix);
    if (cookie) headers.append('Set-Cookie',cookie);
  }
  return headers;
}
export default {
  async fetch(request, env) {
    const incoming = new URL(request.url);
    const oldPlayerRoute=['/__sandbox','/_sandbox'].find(path=>incoming.pathname===path || incoming.pathname.startsWith(path+'/'));
    if(oldPlayerRoute){
      incoming.pathname='/player'+incoming.pathname.slice(oldPlayerRoute.length);
      return new Response(null,{status:308,headers:{Location:incoming.href,'Cache-Control':'no-cache','Cross-Origin-Resource-Policy':'cross-origin','Service-Worker-Allowed':'/'}});
    }
    if(incoming.pathname==='/player'){
      incoming.pathname='/player/';return Response.redirect(incoming.href,308);
    }
    const local = incoming.pathname.startsWith(LOCAL_PREFIX);
    const routePrefix = local ? LOCAL_PREFIX : PREFIX;
    if (!local && !incoming.pathname.startsWith(LEGACY_PREFIX)) {
      const response=await env.ASSETS.fetch(request);
      if(!incoming.pathname.startsWith('/player/')) return response;
      const headers=new Headers(response.headers);
      headers.delete('X-Frame-Options');
      headers.set('Cross-Origin-Resource-Policy','cross-origin');
      headers.set('Content-Security-Policy','frame-ancestors '+(env.FRAME_ANCESTORS || 'https: http://localhost:* http://127.0.0.1:*'));
      headers.set('Cross-Origin-Embedder-Policy','credentialless');
      headers.set('Cache-Control','no-cache, must-revalidate');
      if(incoming.pathname==='/player/sw.js') headers.set('Service-Worker-Allowed','/');
      return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
    }
    if (['timebomb.lol','www.timebomb.lol'].includes(incoming.hostname)) return new Response('Use a separate Playdeck player origin.', {status:403});
    if (!local && !incoming.pathname.startsWith(PREFIX)) {
      // New paths avoid stale rewritten assets cached by previous proxy versions.
      incoming.pathname = PREFIX + incoming.pathname.slice(LEGACY_PREFIX.length);
      return Response.redirect(incoming.href, 307);
    }
    if (request.method === 'OPTIONS') return new Response(null, {status:204, headers:{
      'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers':request.headers.get('Access-Control-Request-Headers') || 'Range, Content-Type','Access-Control-Max-Age':'600'
    }});
    try {
      let target = targetFromProxy(incoming,routePrefix);
      if (!['GET','HEAD','POST','PUT','PATCH','DELETE'].includes(request.method)) return new Response('Unsupported game request method.', {status:405});
      const read = ['GET','HEAD'].includes(request.method);
      let response;
      for (let redirects = 0; redirects <= 5; redirects++) {
        // Runtime URL hooks discover dependencies as the game requests them.
        // Follow changing public HTTPS hosts without a catalog host list.
        if (!publicHost(target.hostname) || target.username || target.password || target.port || target.protocol !== 'https:' || target.hostname === incoming.hostname || ['timebomb.lol','www.timebomb.lol'].includes(target.hostname))
          return new Response('This game dependency must use a public HTTPS host.', {status:403});
        const headers = upstreamHeaders(request,target);
        if(local){
          headers.set('user-agent',DESKTOP_UA);
          headers.set('sec-ch-ua','"Chromium";v="144", "Google Chrome";v="144", "Not_A Brand";v="99"');
          headers.set('sec-ch-ua-mobile','?0');headers.set('sec-ch-ua-platform','"Windows"');
          headers.set('sec-ch-ua-platform-version','"10.0.0"');headers.set('sec-ch-ua-model','""');
          headers.set('sec-ch-ua-arch','"x86"');headers.set('sec-ch-ua-bitness','"64"');
          headers.set('sec-ch-ua-full-version','"144.0.0.0"');
          headers.set('sec-ch-ua-full-version-list','"Chromium";v="144.0.0.0", "Google Chrome";v="144.0.0.0", "Not_A Brand";v="99.0.0.0"');
          headers.set('sec-ch-ua-wow64','?0');
          headers.set('sec-ch-viewport-width','1280');
        }
        // Asset loaders use HEAD sizes and hashes of the original bytes. Do not
        // negotiate an encoded upstream representation with a different length.
        headers.set('accept-encoding', 'identity');
        for (let attempt = 0; attempt < 3; attempt++) {
          response = await fetch(target.href, {method:request.method,headers,body:read ? undefined : request.body,redirect:'manual',cf:{cacheTtlByStatus:{'404':0,'500-599':0}},...(!read ? {duplex:'half'} : {})});
          if (!read || attempt===2 || ![404,500,502,503,504].includes(response.status)) break;
          await response.body?.cancel();
          headers.set('cache-control','no-cache');
          await new Promise(resolve=>setTimeout(resolve,150*(attempt+1)));
        }
        if (![301,302,303,307,308].includes(response.status) || !response.headers.has('location')) break;
        const destination = new URL(response.headers.get('location'),target);
        if (destination.protocol !== 'https:' || destination.username || destination.password || destination.port || !publicHost(destination.hostname) || destination.hostname === incoming.hostname || ['timebomb.lol','www.timebomb.lol'].includes(destination.hostname)) return new Response('Invalid game redirect.',{status:403});
        // Let the browser apply redirect method rules and store scoped cookies.
        const redirected = proxyHeaders(response,target,routePrefix);
        redirected.set('Location',proxyURL(destination.href,target.href,incoming.origin,routePrefix));
        return new Response(response.body,{status:response.status,headers:redirected});
      }
      const selected=(request.headers.get('cookie') || '').match(/(?:^|;\s*)tb_performance=(full|auto|fast|native)(?:;|$)/)?.[1] || 'full';
      const headers = proxyHeaders(response,target,routePrefix);
      if(local)headers.set('X-Timebomb-Desktop','6');
      const type = headers.get('content-type') || '';
      // Do not buffer null responses, ranges, large payloads, or integrity-checked KSP scripts.
      if (request.method === 'HEAD' || [204,205,304].includes(response.status) || response.status === 206 || (target.hostname === 'kerbalspaceprogram.pages.dev' && /javascript|ecmascript/i.test(type)) || !/(text\/html|text\/css|javascript|ecmascript)/i.test(type))
        return new Response(response.body, {status:response.status,headers});
      for (const name of ['content-length','content-encoding','etag','content-md5']) headers.delete(name);
      const clean = new Response(response.body, {status:response.status,headers});
      const base = target.href, origin = incoming.origin;
      if (/text\/html/i.test(type)) {
        let documentBase = base;
        return new HTMLRewriter()
          .on('base', {element(element) {
            const href = element.getAttribute('href');
            if (href) { documentBase = new URL(href, base).href; element.setAttribute('href', proxyURL(documentBase, base, origin,routePrefix)); }
          }})
          .on('meta[http-equiv]', {element(element) {
            if (/^(content-security-policy|refresh)$/i.test(element.getAttribute('http-equiv') || '')) element.remove();
          }})
          .on('head', {element(element) {element.prepend(bootstrap(base, origin,false,routePrefix,selected), {html:true});}})
          .on('*', {element(element) {
            for (const attr of ['src','href','poster','action','data']) {
              const value = element.getAttribute(attr);
              if (value) element.setAttribute(attr, proxyURL(value, documentBase, origin,routePrefix));
            }
            // Rewritten scripts no longer match their upstream SRI hashes.
            element.removeAttribute('integrity');
            if (element.tagName === 'iframe') element.setAttribute('allow', 'cross-origin-isolated; fullscreen; autoplay; gamepad');
            if(local && selected==='native' && element.getAttribute('media'))element.setAttribute('media',desktopMedia(element.getAttribute('media')));
            if (element.getAttribute('style')) element.setAttribute('style', rewriteCSS(element.getAttribute('style'), documentBase, origin,routePrefix));
          }})
          .on('script:not([src])', {text(chunk) {
            // HTMLRewriter text chunks are not guaranteed to align with URL literals.
            // Buffer each inline script until the last chunk before rewriting.
            this.buffer = (this.buffer || '') + chunk.text;
            chunk.remove();
            if (chunk.lastInTextNode) {chunk.after(rewriteJS(this.buffer, documentBase, origin,routePrefix), {html:true});this.buffer='';}
          }})
          .on('style', {text(chunk) {
            this.buffer = (this.buffer || '') + chunk.text; chunk.remove();
            if (chunk.lastInTextNode) {chunk.after(rewriteCSS(this.buffer, documentBase, origin,routePrefix,selected), {html:true});this.buffer='';}
          }})
          .transform(clean);
      }
      let text = await clean.text();
      if (/javascript|ecmascript/i.test(type) && ['worker','sharedworker'].includes(request.headers.get('sec-fetch-dest'))) text = bootstrap(base, origin, true,routePrefix,selected) + '\n' + text;
      return new Response(/text\/css/i.test(type) ? rewriteCSS(text, base, origin,routePrefix,selected) : /javascript|ecmascript/i.test(type) ? rewriteJS(text, base, origin,routePrefix) : text,
        {status:response.status, headers});
    } catch (error) {return new Response('Game proxy unavailable: ' + error.message, {status:502});}
  }
};




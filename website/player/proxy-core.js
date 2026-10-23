import {installDownloadPolicy,selectDownloadManifest} from './download-options.js';
import {proxyURL,targetFromProxy} from './network-url.js';
export {proxyURL,targetFromProxy} from './network-url.js';
import {installNetworkProxy} from './network.js';
import {installGraphicsQuality} from './graphics-quality.js';
import {installPerformance,installFrameCap} from './performance.js';
export {installPerformance as installMobilePerformance} from './performance.js';
import {decodeS3TC,installS3TC} from './s3tc.js';
import {proxyContext,telemetryChannel} from './session.js';
import {installGameRuntime} from './game-runtime.js';
import {rewriteJavaScript,rewriteMobilePolicy,executableScript} from './rewrite.js';
import {installCookieNamespace,restoreCookie} from './cookies.js';

const LEGACY_PREFIX = '/__game/';
const PREFIX = LEGACY_PREFIX + 'v4/';
const LOCAL_PREFIX = '/player/games/';
const ASSET_VERSION='deck-network-10';
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
  if(typeof document==='undefined' || typeof Element==='undefined' || globalThis.__playdeckPointerInstalled)return;
  globalThis.__playdeckPointerInstalled=true;
  const native=Element.prototype.requestPointerLock;
  if(native) {
    let rawSupported=true;
    Element.prototype.requestPointerLock=function(options) {
      // Prefer unaccelerated motion without overriding an explicit game choice.
      const requested={...options};
      if(requested.unadjustedMovement===undefined)requested.unadjustedMovement=rawSupported;
      const retry=error=>{
        if(error?.name!=='NotSupportedError' || !requested.unadjustedMovement)throw error;
        rawSupported=false;
        return native.call(this,{...requested,unadjustedMovement:false});
      };
      try {
        const result=native.call(this,requested);
        return result?.catch ? result.catch(retry) : result;
      } catch(error) {return retry(error);}
    };
  }
  const surface=document.defaultView || document;
  const pending=new Set();
  const reset=()=>{pending.add('mousemove');pending.add('pointermove');};
  document.addEventListener('pointerlockchange',reset,true);
  surface.addEventListener('blur',reset,true);
  surface.addEventListener('focus',reset,true);
  document.addEventListener('visibilitychange',reset,true);
  for(const type of ['mousemove','pointermove'])surface.addEventListener(type,event=>{
    if(!event.isTrusted || (type==='pointermove' && event.pointerType && event.pointerType!=='mouse'))return;
    const transition=pending.delete(type);
    if(!transition && Number.isFinite(event.movementX) && Number.isFinite(event.movementY))return;
    // Preserve the original event, position and button state, and zero only
    // discontinuous relative motion. Never clamp legitimate rapid turns.
    for(const key of ['movementX','movementY'])try{Object.defineProperty(event,key,{value:0,configurable:true});}catch{}
  },true);
  if(native)return;
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
// String source prevents bundlers from leaking private helper names into game pages.
const CLIENT_HOOK = installNetworkProxy.toString();
export function bootstrap(base, origin, worker = false, prefix = PREFIX, mode='auto') {
  const params = [base, origin, prefix].map(value => JSON.stringify(value).replace(/</g, '\\u003c')).join(',');
  const local=prefix.startsWith(LOCAL_PREFIX);
  const context=local?'const context=('+proxyContext.toString()+')(globalThis.location?.pathname || '+JSON.stringify(new URL(origin+prefix+new URL(base).host+new URL(base).pathname).pathname)+');context.mode ||= '+JSON.stringify(mode)+';context.source=' + JSON.stringify(base) + ';globalThis.__playdeckContext=context;':'';
  const runtime=local?'('+installDownloadPolicy.toString()+')(context,'+selectDownloadManifest.toString()+');('+installGameRuntime.toString()+')(context);':'';
  const desktop=local?'if(context.compatibility.desktop)('+desktopOverrides.toString()+')('+desktopMedia.toString()+','+JSON.stringify(DESKTOP_UA)+',context.session?"native":context.mode);':'';
  const pointer=local?'('+installPointerCompatibility.toString()+')();':'';
  const identity=local && proxyContext(prefix).compatibility.identity?'('+installPageIdentity.toString()+')('+params+');':'';
  const performance=local?'('+installFrameCap.toString()+')(context.frameCap);('+installPerformance.toString()+')(context.mode,context.session?"playdeck-performance:"+context.session:'+JSON.stringify('timebomb-performance:'+new URL(base).origin)+',context.frameCap);':'';
  const graphics=local?'('+installGraphicsQuality.toString()+')(context);':'';
  const networkHelpers=','+proxyURL.toString()+','+targetFromProxy.toString();
  const workerCap=local?'('+installFrameCap.toString()+')('+Number(proxyContext(prefix).frameCap || 0)+');':'';
  const workerPrelude='(()=>{'+INJECTED_NAMES+workerCap+(local?'('+installDownloadPolicy.toString()+')('+JSON.stringify(proxyContext(prefix))+','+selectDownloadManifest.toString()+');':'')+(local?'('+installGraphicsQuality.toString()+')('+JSON.stringify({...proxyContext(prefix),source:base})+');':'')+'('+CLIENT_HOOK+')('+params+',null'+networkHelpers+');})();';
  const script='(()=>{if(typeof globalThis.registerProcessor===\"function\" || typeof globalThis.registerPaint===\"function\")return;if(globalThis.__playdeckProxyInstalled)return;globalThis.__playdeckProxyInstalled=true;'+INJECTED_NAMES+context+runtime+identity+desktop+performance+graphics+pointer+s3tcBootstrap(base,prefix)+'('+installCookieNamespace.toString()+')('+params+','+targetFromProxy.toString()+');('+CLIENT_HOOK+')('+params+','+JSON.stringify(workerPrelude)+networkHelpers+');})();';
  return worker?script:'<script data-cfasync="false" data-playdeck-bootstrap>'+script+'</script>';
}
export function s3tcBootstrap(base,prefix) {
  const url=new URL(base);
  return prefix.startsWith(LOCAL_PREFIX) ? '(()=>{if(globalThis.__playdeckContext?.compatibility?.textures===false)return;'+INJECTED_NAMES+'('+installS3TC.toString()+')('+decodeS3TC.toString()+');})();' : '';
}
export function rewriteCSS(text, base, origin, prefix = PREFIX, mode='native') {
  if(prefix===LOCAL_PREFIX && mode==='native')text=desktopMedia(text);
  return text.replace(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi, (_, quote, value) => 'url(' + JSON.stringify(proxyURL(value.trim(), base, origin, prefix)) + ')')
    .replace(/(@import\s+)(['"])([^'"]+)\2/gi, (_, lead, quote, value) => lead + JSON.stringify(proxyURL(value, base, origin, prefix)));
}

export function rewritePageIdentity(text,prefix=PREFIX) {
  return rewriteJavaScript(text,{identity:prefix.startsWith(LOCAL_PREFIX) && proxyContext(prefix).compatibility.identity});
}
export function installPageIdentity(base, origin, prefix) {
  const source = value => {
    try {
      const url = new URL(value);
      return url.origin === origin && url.pathname.startsWith(prefix)
        ? new URL('https://' + url.pathname.slice(prefix.length) + url.search + url.hash) : new URL(base);
    } catch { return new URL(base); }
  };
  // Resolve on every read so history updates remain visible to the game.
  Object.defineProperty(globalThis, '__playdeckSourceLocation', {configurable:true,
    get:()=>globalThis.__playdeckContext?.compatibility?.identity===false ? globalThis.location : source(globalThis.location?.href || base)});
  if (typeof document === 'undefined') return;
  // Computed and obfuscated host checks read document.domain without an AST rewrite.
  try { Object.defineProperty(document,'domain',{configurable:true,enumerable:true,get:()=>globalThis.__playdeckSourceLocation.hostname}); } catch {}
  for (const key of ['URL','documentURI']) {
    try { Object.defineProperty(document,key,{configurable:true,get:()=>globalThis.__playdeckSourceLocation.href}); } catch {}
  }
  try { Object.defineProperty(document,'referrer',{configurable:true,get:()=>''}); } catch {}
}

export function rewriteJS(text,base,origin,prefix=PREFIX) {
  const local=prefix.startsWith(LOCAL_PREFIX),filename=new URL(base).pathname.split('/').pop();
  text=rewriteJavaScript(text,{network:true,identity:local && proxyContext(prefix).compatibility.identity,mobile:local,mapURL:value=>/^(?:https?:\/\/|\/\/|\.{1,2}\/|\/(?!\/))/.test(value)?proxyURL(value,base,origin,prefix):value});
  return local && /\.mjs$|(?:^|[-_.])worker(?:[-_.]|$)/i.test(filename)?s3tcBootstrap(base,prefix)+'\n'+text:text;
}
// Kept as an API alias; compatibility now installs in every realm by capability.
export function rewriteGameCompatibility(text,base,prefix=PREFIX) {
  if(!prefix.startsWith(LOCAL_PREFIX))return text;
  text=rewriteMobilePolicy(text);
  const filename=new URL(base).pathname.split('/').pop();
  return /\.mjs$|(?:^|[-_.])worker(?:[-_.]|$)/i.test(filename)?s3tcBootstrap(base,prefix)+'\n'+text:text;
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
  const launched=prefix.includes('/.launch/'),encoded=Array.from(remotePath,char=>char.charCodeAt(0).toString(16).padStart(2,'0')).join('');
  const route=target.protocol==='https:' && !target.port?target.host:'.net/'+target.protocol.slice(0,-1)+'/'+target.host;
  return cookiePrefix(target.hostname) + (launched?'_p'+encoded+'_':'') + first + '; ' + [...attributes, 'Path=' + (launched?LOCAL_PREFIX:prefix + route + remotePath), 'Secure','SameSite=None','Partitioned'].join('; ');
}
function upstreamHeaders(request, target) {
  const headers = new Headers();
  // Preserve game protocol headers, never launcher/browser identity headers.
  for (const [name,value] of request.headers) {
    if (/^(host|cookie|authorization|proxy-.*|x-playdeck-.*|connection|keep-alive|transfer-encoding|te|trailer|upgrade|content-length|accept-encoding|origin|referer|sec-.*|cf-.*|x-forwarded-.*|forwarded|true-client-ip)$/i.test(name)) continue;
    headers.set(name,value);
  }
  // Translate browser provenance back to the game's source origin.
  let source = target;
  try {
    const ref = new URL(request.headers.get('referer') || request.referrer);
    const route = proxyContext(ref.pathname);
    if (ref.pathname.startsWith(route.prefix)) source = targetFromProxy(ref, route.prefix);
  } catch {}
  headers.set('Referer', source.href);
  if (request.headers.has('origin')) headers.set('Origin', source.origin);
  const prefix = cookiePrefix(target.hostname);
  const cookies = (request.headers.get('cookie') || '').split(';').map(value => value.trim()).filter(value => value.startsWith(prefix)).map(value => restoreCookie(value.slice(prefix.length),target.pathname)).filter(Boolean);
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
  if(response.headers.has('etag'))headers.set('X-Playdeck-Source-ETag',response.headers.get('etag'));
  if(/\bno-store\b/i.test(response.headers.get('cache-control') || ''))headers.set('X-Playdeck-No-Store','1');
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
// Hosts without validators can still avoid retransmitting rewritten text to
// the device. Hash after rewriting so the hash identifies the saved bytes.
export async function contentHashResponse(response,request){
  const text=await response.text(),headers=new Headers(response.headers);
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),byte=>byte.toString(16).padStart(2,'0')).join('');
  headers.set('X-Playdeck-Content-Hash',hash);
  if(request.headers.get('X-Playdeck-Known-Hash')===hash)return new Response(null,{status:304,headers});
  return new Response(text,{status:response.status,statusText:response.statusText,headers});
}

export {LEGACY_PREFIX,PREFIX,LOCAL_PREFIX,ASSET_VERSION,INJECTED_NAMES,publicHost,CLIENT_HOOK,upstreamHeaders,proxyHeaders};

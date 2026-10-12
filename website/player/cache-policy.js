import {canonicalGameURL,proxyContext,GAME_PREFIX} from './session.js';
import {bootstrap} from './proxy-core.js';
import {parse} from './vendor/acorn.js';
import {restoreLegacyIdentity} from './rewrite.js';

export function staticResponse(request,response) {
  const url=canonicalGameURL(request.url),type=response.headers.get('Content-Type') || '';
  if(request.method!=='GET' || response.status!==200)return false;
  if(/\.(?:json|wasm|bin|data|pak|pk3|zip|js|mjs)$/i.test(url.pathname) && /html/i.test(type))return false;
  if(/(?:^|\/)(?:api|graphql|auth|login|logout|session|sessions|user|account|save|progress)(?:\/|\.|$)/i.test(url.pathname))return false;
  if(/json|xml/i.test(type)) {
    if(/(?:^|\/)(?:config|configuration|status|profile|settings|token)\.(?:json|xml)$/i.test(url.pathname))return false;
    if(!/\.(?:json|xml)$/i.test(url.pathname))return false;
    if([...url.searchParams.keys()].some(key=>!/^(?:v|version|_+|cache[-_]?bust(?:er)?|timestamp|nocache|__playdeck_integrity)$/i.test(key)))return false;
  }
  return true;
}

export async function routeCachedResponse(response,request) {
  if(response.headers.has('X-Playdeck-Preserve-Source') || request.integrity || new URL(request.url).searchParams.has('__playdeck_integrity'))return response;
  const context=proxyContext(new URL(request.url).pathname);
  if(!context.session || !/html|css|javascript|ecmascript/i.test(response.headers.get('Content-Type') || ''))return response;
  const previous=response.headers.get('X-Playdeck-Route') || GAME_PREFIX;
  const headers=new Headers(response.headers);headers.delete('Content-Length');headers.delete('Content-Encoding');
  headers.set('X-Playdeck-Route',context.prefix);
  let text=await response.text();
  // Only machine-generated proxy prefixes change. This never checks upstream.
  const origin=new URL(request.url).origin,oldOrigin=response.headers.get('X-Playdeck-Origin') || origin;
  for(const from of new Set([oldOrigin+previous,(oldOrigin+previous).replaceAll('/','\\/')])) {
    const to=from.includes('\\/')?(origin+context.prefix).replaceAll('/','\\/'):origin+context.prefix;
    text=text.split(from).join(to);
  }
  // Bootstrap literal prefixes do not include the origin.
  text=text.split(JSON.stringify(previous)).join(JSON.stringify(context.prefix));
  if(oldOrigin!==origin)text=text.split(JSON.stringify(oldOrigin)).join(JSON.stringify(origin));
  headers.set('X-Playdeck-Origin',origin);
  const target=canonicalGameURL(request.url);
  const source='https://'+target.pathname.slice(GAME_PREFIX.length)+target.search;
  if(response.headers.get('X-Playdeck-Compatibility')!=='deck-runtime-1') {
    if(/html/i.test(response.headers.get('Content-Type') || '')) {
      text=text.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi,(match,attributes,body)=>/(?:data-cfasync|data-playdeck-bootstrap)/.test(attributes) && /__timebombPerformanceInstalled|__playdeckProxyInstalled/.test(body)?'':match.replace(body,restoreLegacyIdentity(body)));
      const injected=bootstrap(source,origin,false,context.prefix,context.mode);
      text=/<head\b[^>]*>/i.test(text)?text.replace(/<head\b[^>]*>/i,match=>match+injected):injected+text;
    }else if(/javascript|ecmascript/i.test(response.headers.get('Content-Type') || '')) {
      try{const ast=parse(text,{ecmaVersion:'latest',sourceType:'module',allowReturnOutsideFunction:true});const first=ast.body[0];if(first?.type==='ExpressionStatement' && /__timebombPerformanceInstalled|__playdeckProxyInstalled/.test(text.slice(first.start,first.end)))text=text.slice(first.end);}catch{}
      text=bootstrap(source,origin,true,context.prefix,context.mode)+'\n'+restoreLegacyIdentity(text);
    }
    headers.set('X-Playdeck-Compatibility','deck-runtime-1');
  }
  return new Response(text,{status:response.status,statusText:response.statusText,headers});
}

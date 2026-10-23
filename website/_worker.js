import {BUILD_REVISION,FEATURE_RELEASE} from './player/version.js';
import {checkAvailability} from './player/availability.js';
import {LEGACY_PREFIX,PREFIX,LOCAL_PREFIX,ASSET_VERSION,INJECTED_NAMES,DESKTOP_UA,desktopMedia,desktopOverrides,installPointerCompatibility,publicHost,targetFromProxy,proxyURL,CLIENT_HOOK,bootstrap,s3tcBootstrap,rewriteCSS,rewritePageIdentity,installPageIdentity,rewriteJS,rewriteGameCompatibility,cookiePrefix,scopedCookie,upstreamHeaders,proxyHeaders,contentHashResponse} from './player/proxy-core.js';
import {proxyContext,recoverGameRequest} from './player/session.js';
import {executableScript,rewriteImportMap} from './player/rewrite.js';
export * from './player/proxy-core.js';
export {installPerformance as installMobilePerformance} from './player/performance.js';

export default {
  async fetch(request, env) {
    request = recoverGameRequest(request,[request.headers.get('referer'),request.referrer]);
    const incoming = new URL(request.url);
    if(incoming.pathname==='/player/availability')return checkAvailability(request);
    if(incoming.pathname==='/player/worker-version.json')return Response.json({revision:BUILD_REVISION,features:FEATURE_RELEASE,compatibility:'deck-runtime-1'},{headers:{'Cache-Control':'no-store','Cross-Origin-Resource-Policy':'cross-origin'}});
    const oldPlayerRoute=['/__sandbox','/_sandbox'].find(path=>incoming.pathname===path || incoming.pathname.startsWith(path+'/'));
    // Service-worker update requests may not follow redirects. Keep previous
    // script URLs alive so an old cached player can install the current worker.
    if(oldPlayerRoute && incoming.pathname===oldPlayerRoute+'/sw.js'){
      const current=new URL('/player/sw.js',incoming.origin);current.search=incoming.search;
      const response=await env.ASSETS.fetch(new Request(current,request));
      const headers=new Headers(response.headers);
      headers.set('Service-Worker-Allowed','/');headers.set('Cache-Control','no-store');
      headers.set('Cross-Origin-Resource-Policy','cross-origin');
      return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
    }
    if(oldPlayerRoute){
      incoming.pathname='/player'+incoming.pathname.slice(oldPlayerRoute.length);
      return new Response(null,{status:308,headers:{Location:incoming.href,'Cache-Control':'no-cache','Cross-Origin-Resource-Policy':'cross-origin','Service-Worker-Allowed':'/'}});
    }
    if(incoming.pathname==='/player'){
      incoming.pathname='/player/';return Response.redirect(incoming.href,308);
    }
    const local = incoming.pathname.startsWith(LOCAL_PREFIX);
    const launchContext=proxyContext(incoming.pathname);
    const routePrefix = local ? launchContext.prefix : PREFIX;
    if (!local && !incoming.pathname.startsWith(LEGACY_PREFIX)) {
      const response=await env.ASSETS.fetch(request);
      if(!incoming.pathname.startsWith('/player/')) {
         // A missing game asset must never masquerade as a successful JSON or
         // binary download because Pages served its HTML fallback.
         if (/\.(?:json|wasm|bin|data|pak|pk3|zip)(?:$)/i.test(incoming.pathname) &&
             /text\/html/i.test(response.headers.get('content-type') || ''))
           return new Response('Unrouted game asset: the request did not include its game session.',{
             status:404,headers:{'Content-Type':'text/plain','Cache-Control':'no-store','Access-Control-Allow-Origin':'*'}
           });
         return response;
       }
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
      const websocket=request.headers.get('upgrade')?.toLowerCase()==='websocket';
      const socketSource=target.searchParams.get('__playdeck_source');
      target.searchParams.delete('__playdeck_source');
      if(/^wss?:$/.test(target.protocol)) {
        if(!websocket)return new Response('WebSocket route requires an upgrade.',{status:426});
        target.protocol=target.protocol==='wss:'?'https:':'http:';
      }
      if (!['GET','HEAD','POST','PUT','PATCH','DELETE'].includes(request.method)) return new Response('Unsupported game request method.', {status:405});
      const read = ['GET','HEAD'].includes(request.method);
      const selected=launchContext.mode || (request.headers.get('cookie') || '').match(/(?:^|;\s*)tb_performance=(full|auto|fast|native)(?:;|$)/)?.[1] || 'full';
      const workerDestination=target.searchParams.get('__playdeck_worker');
      target.searchParams.delete('__playdeck_worker');
      const destination=['worker','sharedworker'].includes(workerDestination) ? workerDestination : request.headers.get('X-Playdeck-Destination') || request.headers.get('sec-fetch-dest') || '';
      const integrity=target.searchParams.has('__playdeck_integrity') || !!request.integrity || request.headers.has('X-Playdeck-Integrity');
      target.searchParams.delete('__playdeck_integrity');
      target.searchParams.delete('__playdeck_original');target.searchParams.delete('__playdeck_range');
      const transform=ASSET_VERSION+':runtime-1'+':'+(['worker','sharedworker'].includes(destination)?destination:'asset');
      let response;
      for (let redirects = 0; redirects <= 5; redirects++) {
        // Runtime URL hooks discover dependencies as the game requests them.
        // Follow changing public dependency hosts without a catalog host list.
        if (!publicHost(target.hostname) || target.username || target.password || !/^https?:$/.test(target.protocol) || target.hostname === incoming.hostname || ['timebomb.lol','www.timebomb.lol'].includes(target.hostname))
          return new Response('This game dependency must use a public HTTP(S) host.', {status:403});
        const headers = upstreamHeaders(request,target);
        if(websocket) {
          headers.set('Upgrade','websocket');
          for(const name of ['sec-websocket-protocol','sec-websocket-version','sec-websocket-key','sec-websocket-extensions']) {
            if(request.headers.has(name))headers.set(name,request.headers.get(name));
          }
          // Upstream servers validate the original game's Origin, not the launcher.
          let source=target.origin;
          try {const upstreamSource=new URL(socketSource);if(publicHost(upstreamSource.hostname) && /^https?:$/.test(upstreamSource.protocol))source=upstreamSource.origin;}catch{}
          try {const referrer=new URL(request.headers.get('referer') || request.referrer);source=targetFromProxy(referrer,proxyContext(referrer.pathname).prefix).origin;}catch{}
          headers.set('Origin',source);
          const upgraded=await fetch(target.href,{method:'GET',headers,redirect:'manual'});
          // Return the native upgrade Response intact so Cloudflare relays frames.
          return upgraded;
        }
        // Old rewrites must be rebuilt even when the upstream file is unchanged.
        if(local && request.headers.has('X-Playdeck-Transform') && request.headers.get('X-Playdeck-Transform')!==transform){
          headers.delete('if-none-match');headers.delete('if-modified-since');
        }
        if(local && launchContext.compatibility.desktop){
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
        if (!/^https?:$/.test(destination.protocol) || destination.username || destination.password || !publicHost(destination.hostname) || destination.hostname === incoming.hostname || ['timebomb.lol','www.timebomb.lol'].includes(destination.hostname)) return new Response('Invalid game redirect.',{status:403});
        // Let the browser apply redirect method rules and store scoped cookies.
        const redirected = proxyHeaders(response,target,routePrefix);
        redirected.set('Location',proxyURL(destination.href,target.href,incoming.origin,routePrefix));
        return new Response(response.body,{status:response.status,headers:redirected});
      }
      const headers = proxyHeaders(response,target,routePrefix);
      if(local){headers.set('X-Timebomb-Desktop','7');headers.set('X-Playdeck-Route',routePrefix);headers.set('X-Playdeck-Compatibility','deck-runtime-1');}
      const type = headers.get('content-type') || '';
      const rewritten=/(text\/html|text\/css|javascript|ecmascript)/i.test(type);
      const preserveSource=integrity || (/javascript|ecmascript/i.test(type) && destination==='empty' && !request.headers.has('X-Playdeck-Executable'));
      if(preserveSource)headers.set('X-Playdeck-Preserve-Source','1');
      if(local && rewritten && !preserveSource){headers.set('X-Playdeck-Transform',transform);headers.set('X-Playdeck-Network',ASSET_VERSION);}
      const finish=result=>local && response.status===200 && !headers.has('X-Playdeck-Source-ETag') && !headers.has('Last-Modified')?contentHashResponse(result,request):result;
      // Data-fetch and integrity-protected sources must retain their original bytes.
      if (request.method === 'HEAD' || [204,205,304].includes(response.status) || response.status === 206 || preserveSource || !/(text\/html|text\/css|javascript|ecmascript)/i.test(type))
        return new Response(response.body, {status:response.status,headers});
      for (const name of ['content-length','content-encoding','etag','content-md5']) headers.delete(name);
      const clean = new Response(response.body, {status:response.status,headers});
      const base = target.href, origin = incoming.origin;
      if (/text\/html/i.test(type)) {
        let documentBase = base, bootstrapped = false;
        return finish(new HTMLRewriter()
          .on('base', {element(element) {
            const href = element.getAttribute('href');
            if (href) { documentBase = new URL(href, base).href; element.setAttribute('href', proxyURL(documentBase, base, origin,routePrefix)); }
          }})
          .on('meta[http-equiv]', {element(element) {
            if (/^(content-security-policy|refresh)$/i.test(element.getAttribute('http-equiv') || '')) element.remove();
          }})
          .on('html,head,body', {element(element) {if(!bootstrapped){bootstrapped=true;element.prepend(bootstrap(base, origin,false,routePrefix,selected), {html:true});}}})
          .on('*', {element(element) {
            for (const attr of ['src','href','poster','action','formaction','data','background','xlink:href']) {
              const value = element.getAttribute(attr);
              if (value) element.setAttribute(attr, proxyURL(value, documentBase, origin,routePrefix));
            }
            for(const attr of ['srcset','imagesrcset']) {
              const value=element.getAttribute(attr);
              if(value)element.setAttribute(attr,value.replace(/(^|,\s*|\s+)([^\s]+)(\s+(?:\d+w|[\d.]+x))?(?=\s*(?:,|$))/g,(_all,lead,url,size='')=>lead+proxyURL(url.replace(/,$/,''),documentBase,origin,routePrefix)+size+(url.endsWith(',')?',':'')));
            }
            if(element.getAttribute('ping'))element.setAttribute('ping',element.getAttribute('ping').split(/\s+/).map(value=>proxyURL(value,documentBase,origin,routePrefix)).join(' '));
            if(element.tagName==='script' && element.getAttribute('integrity') && element.getAttribute('src')){const url=new URL(element.getAttribute('src'));url.searchParams.set('__playdeck_integrity','1');element.setAttribute('src',url.href);}else element.removeAttribute('integrity');
            if (element.tagName === 'iframe') element.setAttribute('allow', 'cross-origin-isolated; fullscreen; autoplay; gamepad');
            // Keep authored media queries; desktop identity and quality are independent.
            if (element.getAttribute('style')) element.setAttribute('style', rewriteCSS(element.getAttribute('style'), documentBase, origin,routePrefix,'full'));
          }})
          .on('script:not([src])', {element(element){this.importMap=element.getAttribute('type')?.trim()==='importmap';this.executable=executableScript(element.getAttribute('type'));this.buffer='';},text(chunk) {
            if(this.executable===false && !this.importMap)return;
            // HTMLRewriter text chunks are not guaranteed to align with URL literals.
            // Buffer each inline script until the last chunk before rewriting.
            this.buffer = (this.buffer || '') + chunk.text;
            chunk.remove();
            if (chunk.lastInTextNode) {chunk.after(this.importMap?rewriteImportMap(this.buffer,value=>proxyURL(value,documentBase,origin,routePrefix)):rewriteJS(this.buffer, documentBase, origin,routePrefix), {html:true});this.buffer='';}
          }})
          .on('style', {text(chunk) {
            this.buffer = (this.buffer || '') + chunk.text; chunk.remove();
            if (chunk.lastInTextNode) {chunk.after(rewriteCSS(this.buffer, documentBase, origin,routePrefix,'full'), {html:true});this.buffer='';}
          }})
          .transform(clean));
      }
      let text = await clean.text();
      text=/text\/css/i.test(type)?rewriteCSS(text,base,origin,routePrefix,'full'):rewriteJS(text,base,origin,routePrefix);
      if (/javascript|ecmascript/i.test(type) && (local || ['worker','sharedworker'].includes(destination))) text = bootstrap(base, origin, true,routePrefix,selected) + '\n' + text;
      return finish(new Response(text,
        {status:response.status, headers}));
    } catch (error) {return new Response('Game proxy unavailable: ' + error.message, {status:502});}
  }
};






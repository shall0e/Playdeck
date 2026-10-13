export const GAME_PREFIX = '/player/games/';
export const COMPATIBILITY_VERSION = 'deck-runtime-1';
export const compatibilityDefaults = {desktop:true,identity:false,textures:true};

export function gameId(value) {
  const url = new URL(value);
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) if (/^(?:_+|cache[-_]?bust(?:er)?|timestamp|nocache)$/i.test(key)) url.searchParams.delete(key);
  let hash = 2166136261;
  for (const char of url.href) {hash ^= char.charCodeAt(0); hash = Math.imul(hash,16777619);}
  return (hash >>> 0).toString(36);
}

export function createSession(gameURL,mode='full',compatibility={}) {
  const options = {...compatibilityDefaults,...compatibility,identity:false};
  const flags = ['desktop','identity','textures'].map(key=>options[key] ? '1':'0').join('');
  const id = crypto.randomUUID();
  const game = gameId(gameURL);
  return {id,game,mode,compatibility:options,prefix:GAME_PREFIX+'.launch/'+id+'/'+mode+'/'+flags+'/'+game+'/'};
}

// Also serialized into page and worker realms. It must have no external bindings.
export function proxyContext(pathname) {
  const root='/player/games/';
  const match=/^\/player\/games\/\.launch\/([a-z0-9-]{8,64})\/(full|auto|fast|native)\/([01]{3})\/([a-z0-9]+)\//i.exec(pathname);
  return match ? {prefix:match[0],session:match[1],mode:match[2],game:match[4],compatibility:{desktop:match[3][0]==='1',identity:match[3][1]==='1',textures:match[3][2]==='1'}} : {prefix:root,session:null,mode:null,game:null,compatibility:{desktop:true,identity:false,textures:true}};
}

export function canonicalGameURL(value) {
  const url=new URL(value);
  const context=proxyContext(url.pathname);
  if(url.pathname.startsWith(context.prefix))url.pathname=GAME_PREFIX+url.pathname.slice(context.prefix.length);
  return url;
}

export function telemetryChannel(context,source) {
  return context.session ? 'playdeck-performance:'+context.session : 'timebomb-performance:'+new URL(source).origin;
}

// Native browser loaders can escape the injected fetch/XHR hooks. Recover
// root-relative game resources from the initiating game frame, not the site root.
// A request may have multiple candidate clients (e.g. a worker and its referrer).
export function recoverGameRequest(request, clientURLs) {
  try {
    const original = new URL(request.url);
    if (original.pathname.startsWith(GAME_PREFIX) || original.pathname.startsWith('/__game/')) return request;
    const candidates = Array.isArray(clientURLs) ? clientURLs : [clientURLs];
    for (const candidate of candidates) {
      if (!candidate) continue;
      let client;
      try { client = new URL(candidate); } catch { continue; }
      if (original.origin !== client.origin) continue;
      const context = proxyContext(client.pathname);
      let prefix = client.pathname.startsWith(GAME_PREFIX) ? context.prefix : client.pathname.startsWith('/__game/v4/') ? '/__game/v4/' : null;
      let host = prefix ? client.pathname.slice(prefix.length).split('/')[0] : null;
      // When a service worker restarts or storage is blocked, recover the
      // upstream host from the initiating launcher rather than serving Pages HTML.
      if (!prefix && client.pathname === '/player/' &&
          original.pathname !== '/' &&
          !original.pathname.startsWith('/player/') &&
          !original.pathname.startsWith('/__sandbox/') &&
          !['/games.json','/home.css','/home.js','/player-ui.css','/favicon.ico'].includes(original.pathname)) {
        try {
          const source = new URL(client.searchParams.get('url') || '');
          if (source.protocol === 'https:' && !source.username && !source.password && !source.port) {
            prefix = GAME_PREFIX;
            host = source.hostname;
          }
        } catch {}
      }
      if (!prefix || !host || !/^[a-z0-9.-]+$/i.test(host) || !host.includes('.')) continue;
      const incoming = new URL(original);
      incoming.pathname = prefix + host + original.pathname;
      const headers = new Headers(request.headers);
      headers.set('X-Playdeck-Destination', request.destination || headers.get('X-Playdeck-Destination') || headers.get('sec-fetch-dest') || 'empty');
      return new Request(incoming, {...{method:request.method,headers,body:['GET','HEAD'].includes(request.method)?undefined:request.body,redirect:request.redirect,credentials:request.credentials,cache:request.cache,integrity:request.integrity,signal:request.signal},mode:request.mode==='navigate'?'same-origin':request.mode,...(!['GET','HEAD'].includes(request.method)?{duplex:'half'}:{})});
    }
  } catch {}
  return request;
}

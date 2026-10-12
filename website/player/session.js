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

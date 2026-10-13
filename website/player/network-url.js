export function targetFromProxy(url, prefix = '/__game/v4/') {
  if (!url.pathname.startsWith(prefix)) throw new Error('Invalid proxy path');
  const path=url.pathname.slice(prefix.length);
  const routed=/^\.net\/(https?|wss?)\/([^/]+)(\/.*)?$/.exec(path);
  return new URL(routed ? routed[1]+'://'+routed[2]+(routed[3] || '/')+url.search+url.hash : 'https://'+path+url.search+url.hash);
}
export function proxyURL(value, base, origin, prefix = '/__game/v4/') {
  if (!value || /^(#|data:|blob:|javascript:|mailto:|tel:)/i.test(value)) return value;
  try {
    let url = new URL(value, base);
    if (url.origin === origin && url.pathname.startsWith(prefix)) return url.href;
    if(/^wss?:$/.test(url.protocol) && url.host===new URL(origin).host && url.pathname.startsWith(prefix))return url.href;
    if (url.origin === origin) url=new URL(url.pathname+url.search+url.hash,base);
    if (!/^(https?|wss?):$/.test(url.protocol) || url.username || url.password) return value;
    const socket=/^wss?:$/.test(url.protocol);
    const host=new URL(origin);
    if(socket)host.protocol=host.protocol==='https:'?'wss:':'ws:';
    const route=url.protocol==='https:' && !url.port ? url.host : '.net/'+url.protocol.slice(0,-1)+'/'+url.host;
    return host.origin + prefix + route + url.pathname + url.search + url.hash;
  } catch { return value; }
}

export function installCookieNamespace(base,origin,prefix,decodeURL) {
  if(typeof document==='undefined')return;
  const target=new URL(base),namespace='tb_'+Array.from(target.hostname,char=>char.charCodeAt(0).toString(16).padStart(2,'0')).join('')+'_';
  let owner=document;while(owner && !Object.getOwnPropertyDescriptor(owner,'cookie'))owner=Object.getPrototypeOf(owner);
  const descriptor=owner && Object.getOwnPropertyDescriptor(owner,'cookie');if(!descriptor?.get || !descriptor?.set)return;
  const launched=prefix.includes('/.launch/'),encoded=value=>Array.from(value,char=>char.charCodeAt(0).toString(16).padStart(2,'0')).join('');
  const pathMatches=(path,location)=>location===path || location.startsWith(path.endsWith('/')?path:path+'/');
  Object.defineProperty(document,'cookie',{configurable:true,get(){return descriptor.get.call(document).split(';').map(value=>value.trim()).filter(value=>value.startsWith(namespace)).flatMap(value=>{const raw=value.slice(namespace.length),match=/^_p([a-f0-9]+)_(.*)$/i.exec(raw);if(!match)return [raw];const path=(match[1].match(/../g) || []).map(value=>String.fromCharCode(parseInt(value,16))).join('');let pathname=target.pathname;try{const url=new URL(globalThis.location.href);if(url.pathname.startsWith(prefix))pathname=decodeURL?decodeURL(url,prefix).pathname:new URL('https://'+url.pathname.slice(prefix.length)).pathname;}catch{}return pathMatches(path,pathname)?[match[2]]:[];}).join('; ');},set(value){const parts=String(value).split(';').map(value=>value.trim()),first=parts.shift();if(!first?.includes('='))return;const authored=parts.find(value=>/^path=/i.test(value))?.slice(5),path=authored?.startsWith('/')?authored:target.pathname.slice(0,target.pathname.lastIndexOf('/')+1) || '/';const attributes=parts.filter(value=>!/^(domain|path|samesite|secure|partitioned)(=|$)/i.test(value));const name=launched?namespace+'_p'+encoded(path)+'_'+first:namespace+first;descriptor.set.call(document,name+'; '+[...attributes,'Path='+(launched?'/player/games/':prefix+(target.protocol==='https:' && !target.port?target.host:'.net/'+target.protocol.slice(0,-1)+'/'+target.host)+path),'Secure','SameSite=None','Partitioned'].join('; '));}});
}

export function restoreCookie(value,pathname) {
  const match=/^_p([a-f0-9]+)_(.*)$/i.exec(value);if(!match)return value;
  const path=(match[1].match(/../g) || []).map(value=>String.fromCharCode(parseInt(value,16))).join('');
  return pathname===path || pathname.startsWith(path.endsWith('/')?path:path+'/')?match[2]:null;
}

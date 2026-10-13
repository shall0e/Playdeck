// Serialized into documents and worker realms; dependencies are passed explicitly.
export function installNetworkProxy(base, origin, prefix, workerPrelude, resolveURL, decodeURL) {
  if(globalThis.__playdeckNetworkInstalled)return;
  globalThis.__playdeckNetworkInstalled=true;
  const remote = value => {
    const url = new URL(value, base);
    if(!/^https?:$/.test(url.protocol))return base;
    if (url.origin !== origin) return url.href;
    if (url.pathname.startsWith(prefix)) return decodeURL(url,prefix).href;
    return new URL(url.pathname + url.search + url.hash, base).href;
  };
  const map = value => {
    if (typeof value !== 'string' && !(value instanceof URL)) return value;
    value = String(value);
    if (/^(#|data:|blob:|javascript:|mailto:|tel:)/i.test(value)) return value;
    // import.meta.url-derived .pathname values already include the proxy route.
    if (value.startsWith(prefix)) return origin + value;
    try {
      // The page's <base> may appear after this hook, or change at runtime.
      const sourceBase = typeof document === 'object' ? remote(document.baseURI || base) : base;
      let url = new URL(value, sourceBase);
      if (url.origin === origin) {
        if (url.pathname.startsWith(prefix)) return url.href;
        url = new URL(url.pathname + url.search + url.hash, sourceBase);
      }
      // Socket URLs built from location.host refer to the sandbox, too.
      if (/^wss?:$/.test(url.protocol) && url.host===new URL(origin).host) {
        const protocol=url.protocol;
        url.protocol=new URL(origin).protocol;
        if(url.pathname.startsWith(prefix))return (protocol==='wss:'?'wss:':'ws:')+url.href.slice(url.protocol.length);
        url=new URL(url.pathname+url.search+url.hash,sourceBase);url.protocol=protocol;
      }
      return resolveURL(url.href,sourceBase,origin,prefix);
    } catch { return value; }
  };
  globalThis.__playdeckMap=map;
  const nativeFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (input, options) => nativeFetch(input instanceof Request ? new Request(map(input.url), input) : map(input), options);
  if (typeof XMLHttpRequest !== 'undefined') {
    const nativeOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url, ...args) { return nativeOpen.call(this, method, map(url), ...args); };
  }
  if (typeof importScripts === 'function') {
    const nativeImport = importScripts;
    globalThis.importScripts = (...urls) => nativeImport(...urls.map(map));
  }
  for(const name of ['WebSocket','EventSource']) {
    const Native=globalThis[name];
    if(Native)globalThis[name]=new Proxy(Native,{construct(target,args,newTarget){
      let value=args[0];
      if(name==='WebSocket') {
        const url=new URL(String(value),typeof document==='object'?remote(document.baseURI || base):base);
        if(url.protocol==='https:')url.protocol='wss:';
        if(url.protocol==='http:')url.protocol='ws:';
        value=url.href;
      }
      args[0]=map(value);
      if(name==='WebSocket' && /^wss?:/.test(args[0])) {
        const socket=new URL(args[0]);
        if(socket.host===new URL(origin).host) {
          socket.searchParams.set('__playdeck_source',new URL(base).origin);
          args[0]=socket.href;
        }
      }
      return Reflect.construct(target,args,newTarget);
    }});
  }
  if(globalThis.navigator?.sendBeacon) {
    const native=navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon=(url,data)=>native(map(url),data);
  }
  const networkPrelude=workerPrelude || '(()=>{const __name=(fn,name)=>fn;('+installNetworkProxy.toString()+')('+[base,origin,prefix].map(JSON.stringify).join(',')+',null,'+resolveURL.toString()+','+decodeURL.toString()+');})();';
  // Native engine-created blob workers execute outside the document hook.
  // Prepend a small networking hook before the generated worker's own code.
  const workerBlobs = new Map();
  if (typeof URL.createObjectURL === 'function') {
    const create = URL.createObjectURL.bind(URL);
    URL.createObjectURL = blob => {
      const url = create(blob);
      if (typeof Blob !== 'undefined' && blob instanceof Blob) workerBlobs.set(url,blob);
      return url;
    };
    if (typeof URL.revokeObjectURL === 'function') {
      const revoke = URL.revokeObjectURL.bind(URL);
      URL.revokeObjectURL = url => { workerBlobs.delete(String(url)); return revoke(url); };
    }
  }
  for (const name of ['Worker', 'SharedWorker']) {
    const Native = globalThis[name];
    if (Native) globalThis[name] = new Proxy(Native, {construct(target, args, newTarget) {
      let blob = workerBlobs.get(String(args[0]));
      if(!blob && /^data:(?:text|application)\/(?:java|ecma)script[;,]/i.test(String(args[0]))) {
        const url=String(args[0]),comma=url.indexOf(','),payload=url.slice(comma+1);
        const text=/;base64/i.test(url.slice(0,comma))?new TextDecoder().decode(Uint8Array.from(atob(payload),char=>char.charCodeAt(0))):decodeURIComponent(payload);
        blob=new Blob([text],{type:'text/javascript'});
      }
      if (blob && (!blob.type || /javascript|ecmascript/i.test(blob.type))) {
        args[0] = URL.createObjectURL(new Blob([networkPrelude,'\n',blob],{type:'text/javascript'}));
      } else {
        args[0] = map(args[0]);
        // Service worker fetches can lose the browser's worker destination.
        // Carry it in the URL so file workers always receive network hooks.
        const script = new URL(String(args[0]), origin);
        if (script.origin === origin && script.pathname.startsWith(prefix)) {
          script.searchParams.set('__playdeck_worker', name === 'SharedWorker' ? 'sharedworker' : 'worker');
          args[0] = script.href;
        }
      }
      return Reflect.construct(target, args, newTarget);
    }});
  }
  if (typeof window === 'undefined') return;
  if(window.open) {
    const native=window.open.bind(window);
    window.open=(url,...args)=>native(url==null?url:map(url),...args);
  }

  let panicBind = null;
  window.addEventListener('message', event => {
    if (event.source === window.parent && (['https://timebomb.lol','https://www.timebomb.lol'].includes(event.origin) || event.origin === origin) && event.data?.type === 'playdeck:panic-config') panicBind = event.data.bind;
  });
  window.addEventListener('keydown', event => {
    if (panicBind && !event.repeat && event.code === panicBind.code && event.ctrlKey === panicBind.ctrl && event.altKey === panicBind.alt && event.shiftKey === panicBind.shift && event.metaKey === panicBind.meta) {
      event.preventDefault();event.stopImmediatePropagation();window.parent.postMessage({type:'playdeck:panic'}, '*');
    }
  },true);
  // URL tokens can contain commas (data URLs, signed image endpoints).
  const srcset = value => String(value).replace(/(^|,\s*|\s+)([^\s]+)(\s+(?:\d+w|[\d.]+x))?(?=\s*(?:,|$))/g,(_all,lead,url,size='')=>lead+map(url.replace(/,$/,''))+size+(url.endsWith(',')?',':''));
  const css = value => String(value).replace(/url\(\s*(['"]?)([^)'"\n]+)\1\s*\)/gi,(_all,_quote,url)=>'url('+JSON.stringify(map(url.trim()))+')').replace(/(@import\s+)(['"])([^'"]+)\2/gi,(_all,lead,_quote,url)=>lead+JSON.stringify(map(url)));
  const importMap=value=>{
    try {
      const parsed=JSON.parse(value),entries=table=>Object.fromEntries(Object.entries(table).map(([key,url])=>[key,typeof url==='string'?map(url):url]));
      if(parsed.imports)parsed.imports=entries(parsed.imports);
      if(parsed.scopes)parsed.scopes=Object.fromEntries(Object.entries(parsed.scopes).map(([key,table])=>[map(key),entries(table)]));
      return JSON.stringify(parsed);
    }catch{return value;}
  };
  const urlAttribute=/^(src|href|poster|action|formaction|data|background|xlink:href)$/i;
  const list=value=>String(value).split(/\s+/).map(map).join(' ');
  const nativeSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function(name, value) {
    return nativeSetAttribute.call(this, name, urlAttribute.test(name) ? map(value) : /^(srcset|imagesrcset)$/i.test(name) ? srcset(value) : name==='style'?css(value):name==='ping'?list(value):name==='srcdoc'?frameMarkup(value):value);
  };
  if(Element.prototype.setAttributeNS) {
    const native=Element.prototype.setAttributeNS;
    Element.prototype.setAttributeNS=function(namespace,name,value){return native.call(this,namespace,name,urlAttribute.test(name)?map(value):value);};
  }
  // Rewrite before insertion: a MutationObserver runs after native loaders start.
  const htmlDescriptor=Object.getOwnPropertyDescriptor(Element.prototype,'innerHTML');
  const frameMarkup=value=>'<script>'+networkPrelude.replace(/<\/script/gi,'<\\/script')+'<\/script>'+markup(value);
  const markup=value=>{
    if(!htmlDescriptor?.set || !document.createElement)return value;
    if(/<[^>]*$/.test(String(value)))return value; // Preserve incremental document.write fragments.
    const template=document.createElement('template');
    htmlDescriptor.set.call(template,String(value));
    const visit=root=>{
      for(const element of root.querySelectorAll('*')) {
        for(const attr of Array.from(element.attributes)) {
          const name=attr.name;
          const next=urlAttribute.test(name)?map(attr.value):/^(srcset|imagesrcset)$/i.test(name)?srcset(attr.value):name==='style'?css(attr.value):name==='ping'?list(attr.value):name==='srcdoc'?frameMarkup(attr.value):attr.value;
          nativeSetAttribute.call(element,name,next);
        }
        if(element.localName==='style')element.textContent=css(element.textContent);
        if(element.localName==='script' && element.type==='importmap')element.textContent=importMap(element.textContent);
        if(element.content)visit(element.content);
      }
    };
    visit(template.content);
    return htmlDescriptor.get.call(template);
  };
  const textDescriptor=globalThis.Node && Object.getOwnPropertyDescriptor(Node.prototype,'textContent');
  if(textDescriptor?.set && textDescriptor.configurable)Object.defineProperty(Node.prototype,'textContent',{...textDescriptor,set(value){textDescriptor.set.call(this,this.localName==='style'?css(value):this.localName==='script' && this.type==='importmap'?importMap(value):value);}});
  for(const [prototype,prop] of [[Element.prototype,'innerHTML'],[Element.prototype,'outerHTML'],[globalThis.ShadowRoot?.prototype,'innerHTML'],[globalThis.HTMLIFrameElement?.prototype,'srcdoc']]) {
    const descriptor=prototype && Object.getOwnPropertyDescriptor(prototype,prop);
    if(descriptor?.set && descriptor.configurable)Object.defineProperty(prototype,prop,{...descriptor,set(value){descriptor.set.call(this,prop==='srcdoc'?frameMarkup(value):this.localName==='style'?css(value):this.localName==='script' && this.type==='importmap'?importMap(value):markup(value));}});
  }
  if(Element.prototype.insertAdjacentHTML) {
    const native=Element.prototype.insertAdjacentHTML;
    Element.prototype.insertAdjacentHTML=function(position,value){return native.call(this,position,markup(value));};
  }
  const parser=globalThis.DOMParser?.prototype;
  if(parser) {
    const native=parser.parseFromString;
    parser.parseFromString=function(value,type){return native.call(this,type==='text/html'?markup(value):value,type);};
  }
  const range=globalThis.Range?.prototype;
  if(range?.createContextualFragment) {
    const native=range.createContextualFragment;
    range.createContextualFragment=function(value){return native.call(this,markup(value));};
  }
  for(const method of ['write','writeln'])if(document[method]) {
    const native=document[method].bind(document);
    document[method]=(...values)=>native(markup(values.join('')));
  }
  for(const [name,rewrite] of [['Audio',map],['FontFace',css]]) {
    const Native=window[name];
    if(Native)window[name]=new Proxy(Native,{construct(target,args,newTarget){const index=name==='FontFace'?1:0;if(typeof args[index]==='string')args[index]=rewrite(args[index]);return Reflect.construct(target,args,newTarget);}});
  }
  for (const [name, prop] of [['HTMLImageElement','src'],['HTMLImageElement','srcset'],['HTMLScriptElement','src'],['HTMLLinkElement','href'],['HTMLLinkElement','imageSrcset'],['HTMLMediaElement','src'],['HTMLVideoElement','poster'],['HTMLSourceElement','src'],['HTMLSourceElement','srcset'],['HTMLIFrameElement','src'],['HTMLAnchorElement','href'],['HTMLAreaElement','href'],['HTMLObjectElement','data'],['HTMLFormElement','action'],['HTMLInputElement','src'],['HTMLInputElement','formAction'],['HTMLButtonElement','formAction'],['HTMLEmbedElement','src']]) {
    const type = window[name];
    const descriptor = type && Object.getOwnPropertyDescriptor(type.prototype, prop);
    if (descriptor?.set && descriptor.configurable) Object.defineProperty(type.prototype, prop, {...descriptor, set(value) { descriptor.set.call(this, /srcset/i.test(prop) ? srcset(value) : map(value)); }});
  }
  const declaration=globalThis.CSSStyleDeclaration?.prototype;
  if(declaration) {
    // Chromium exposes named CSS properties directly on each declaration,
    // bypassing prototype setters. Wrap the native style getter with stable identity.
    const styles=new WeakMap();
    const wrap=style=>{
      if(!styles.has(style))styles.set(style,new Proxy(style,{
        get(target,key){const value=Reflect.get(target,key,target);return typeof value==='function' && key!=='constructor'?value.bind(target):value;},
        set(target,key,value){return Reflect.set(target,key,typeof value==='string'?css(value):value,target);}
      }));
      return styles.get(style);
    };
    for(const name of ['HTMLElement','SVGElement','CSSStyleRule','CSSKeyframeRule','CSSFontFaceRule','CSSPageRule']) {
      const prototype=globalThis[name]?.prototype,descriptor=prototype && Object.getOwnPropertyDescriptor(prototype,'style');
      if(descriptor?.get && descriptor.configurable)Object.defineProperty(prototype,'style',{...descriptor,get(){return wrap(descriptor.get.call(this));},...(descriptor.set?{set(value){descriptor.set.call(this,css(value));}}:{})});
    }
    const native=declaration.setProperty;
    declaration.setProperty=function(name,value,priority){return native.call(this,name,css(value),priority);};
    for(const prop of ['cssText','background','backgroundImage','borderImage','borderImageSource','listStyle','listStyleImage','cursor','content','mask','maskImage']) {
      let owner=globalThis.CSSStyleProperties?.prototype || declaration;
      while(owner && !Object.getOwnPropertyDescriptor(owner,prop))owner=Object.getPrototypeOf(owner);
      const descriptor=owner && Object.getOwnPropertyDescriptor(owner,prop);
      if(descriptor?.set && descriptor.configurable)Object.defineProperty(owner,prop,{...descriptor,set(value){descriptor.set.call(this,css(value));}});
    }
  }
  const sheet=globalThis.CSSStyleSheet?.prototype;
  if(sheet)for(const prop of ['insertRule','replace','replaceSync']) {
    const native=sheet[prop];
    if(native)sheet[prop]=function(value,...args){return native.call(this,css(value),...args);};
  }
  for (const name of ['pushState','replaceState']) {
    const native = history[name].bind(history);
    history[name] = (state, title, url) => native(state, title, url == null ? url : map(url));
  }
  if (navigator.serviceWorker) {
    const nativeRegister = navigator.serviceWorker.register.bind(navigator.serviceWorker);
    navigator.serviceWorker.register = (script, options = {}) => {
      const root = map(new URL('/',base).href);
      const scriptURL = new URL(map(script));
      const scopeURL = options.scope ? new URL(map(options.scope)) : new URL('./', scriptURL);
      if (!scriptURL.href.startsWith(root) || !scopeURL.href.startsWith(root)) return Promise.reject(new Error('Worker scope must remain inside this game.'));
      return nativeRegister(scriptURL.href, {...options, scope:scopeURL.href});
    };
  }
}

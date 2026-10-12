// Serialized into game realms. All dependencies are passed or standard browser APIs.
export function installGameRuntime(context) {
  if(globalThis.__playdeckRuntimeInstalled)return;
  globalThis.__playdeckRuntimeInstalled=true;
  globalThis.__playdeckContext=context;
  const namespace='playdeck.game:'+context.game+':';
  const playerKey=key=>/^(?:playdeck[.:]|timebomb[.:]|tb_)/.test(key);
  let legacyOwner=false;
  if(context.game) {
    for(const kind of ['localStorage','sessionStorage']) {
      try {
        const storage=globalThis[kind],keys=()=>Object.keys(storage).filter(key=>key.startsWith(namespace)).map(key=>key.slice(namespace.length));
        // Retain original saves. Only the first game claims unscoped legacy data.
        const claim='playdeck.legacySaveOwner';
        if(kind==='localStorage' && !storage.getItem(claim)) {
          for(const key of Object.keys(storage))if(!playerKey(key))storage.setItem(namespace+key,storage.getItem(key));
          storage.setItem(claim,context.game);
        }
        if(kind==='localStorage')legacyOwner=storage.getItem(claim)===context.game;
        const methods={getItem:key=>storage.getItem(namespace+key),setItem:(key,value)=>storage.setItem(namespace+key,String(value)),removeItem:key=>storage.removeItem(namespace+key),clear:()=>keys().forEach(key=>storage.removeItem(namespace+key)),key:index=>keys()[index] ?? null};
        const proxy=new Proxy(storage,{
          get(_target,key){if(key==='length')return keys().length;if(key===Symbol.toStringTag)return 'Storage';if(key in methods)return methods[key];if(typeof key==='symbol')return Reflect.get(storage,key);return storage.getItem(namespace+key) ?? undefined;},
          set(_target,key,value){storage.setItem(namespace+String(key),String(value));return true;},
          deleteProperty(_target,key){storage.removeItem(namespace+String(key));return true;},
          ownKeys:keys,
          has(_target,key){return key in methods || storage.getItem(namespace+String(key))!==null;},
          getOwnPropertyDescriptor(_target,key){if(keys().includes(key))return {configurable:true,enumerable:true,writable:true,value:storage.getItem(namespace+key)};}
        });
        Object.defineProperty(globalThis,kind,{configurable:true,get:()=>proxy});
      } catch {}
    }
    const idb=globalThis.indexedDB;
    if(idb) {
      const open=idb.open.bind(idb),remove=idb.deleteDatabase.bind(idb),databases=idb.databases?.bind(idb);
      const mapped=name=>legacyOwner && !/^(?:playdeck|timebomb)[.:-]/.test(String(name))?String(name):namespace+name;
      idb.open=(name,version)=>version===undefined?open(mapped(name)):open(mapped(name),version);
      idb.deleteDatabase=name=>remove(mapped(name));
      if(databases)idb.databases=async()=> (await databases()).filter(db=>db.name?.startsWith(namespace) || (legacyOwner && !/^(?:playdeck|timebomb)[.:-]/.test(db.name))).map(db=>({...db,name:db.name.startsWith(namespace)?db.name.slice(namespace.length):db.name}));
    }
    const cacheStorage=globalThis.caches;
    if(cacheStorage) {
      const open=cacheStorage.open.bind(cacheStorage),remove=cacheStorage.delete.bind(cacheStorage),keys=cacheStorage.keys.bind(cacheStorage),has=cacheStorage.has.bind(cacheStorage);
      cacheStorage.open=name=>open(namespace+name);cacheStorage.delete=name=>remove(namespace+name);cacheStorage.has=name=>has(namespace+name);
      cacheStorage.keys=async()=> (await keys()).filter(name=>name.startsWith(namespace)).map(name=>name.slice(namespace.length));
      cacheStorage.match=async(request,options={})=>{for(const name of await cacheStorage.keys()){if(options.cacheName && options.cacheName!==name)continue;const found=await (await cacheStorage.open(name)).match(request,options);if(found)return found;}};
    }
  }
  if(typeof window==='undefined')return;
  const notify=data=>{try{window.parent.postMessage({type:'playdeck:runtime',session:context.session,...data},location.origin);}catch{}};
  const held=new Map(),heldMouse=new Map(),audioContexts=new Set(),mediaState=new WeakMap(),suspendedByPlayer=new WeakSet();
  let paused=false,muted=false;
  const nativePads=globalThis.navigator?.getGamepads?.bind(globalThis.navigator);
  if(nativePads)globalThis.navigator.getGamepads=()=>{const pads=nativePads();return paused?Array.from(pads,()=>null):pads;};
  for(const name of ['AudioContext','webkitAudioContext']) {
    const Native=globalThis[name];if(!Native)continue;
    globalThis[name]=new Proxy(Native,{construct(target,args,newTarget){const audio=Reflect.construct(target,args,newTarget);audioContexts.add(audio);if(muted){suspendedByPlayer.add(audio);void audio.suspend().catch(()=>{});}return audio;}});
  }
  const applyAudio=()=>{
    for(const media of document.querySelectorAll('audio,video')){if(muted){if(!mediaState.has(media))mediaState.set(media,media.muted);media.muted=true;}else if(mediaState.has(media)){media.muted=mediaState.get(media);mediaState.delete(media);}}
    for(const audio of audioContexts)if(audio.state!=='closed'){if(muted){if(audio.state==='running'){suspendedByPlayer.add(audio);void audio.suspend().catch(()=>{});}}else if(audio.state==='suspended' && suspendedByPlayer.has(audio)){suspendedByPlayer.delete(audio);void audio.resume().catch(()=>{});}}
  };
  new MutationObserver(()=>{if(muted)applyAudio();}).observe(document,{subtree:true,childList:true});
  for(const type of ['keydown','keyup'])document.addEventListener(type,event=>{
    if(paused && event.isTrusted){event.preventDefault();event.stopImmediatePropagation();return;}
    if(type==='keydown')held.set(event.code,{key:event.key,code:event.code,keyCode:event.keyCode,which:event.which,target:event.target});else held.delete(event.code);
  },true);
  for(const type of ['pointerdown','pointerup','mousedown','mouseup','mousemove','touchstart','touchmove','wheel'])document.addEventListener(type,event=>{if(paused && event.isTrusted){event.preventDefault();event.stopImmediatePropagation();}},{capture:true,passive:false});
  for(const type of ['pointerdown','pointerup','mousedown','mouseup'])document.addEventListener(type,event=>{const key=(type.startsWith('pointer')?'pointer:':'mouse:')+event.button;if(type.endsWith('down'))heldMouse.set(key,{type,target:event.target,button:event.button,clientX:event.clientX,clientY:event.clientY,pointerId:event.pointerId,pointerType:event.pointerType});else heldMouse.delete(key);},true);
  let enginePause='unsupported';
  const adapter=value=>{
    let applied=false;
    for(const engine of [globalThis.Module,globalThis.unityInstance?.Module])if(engine?.pauseMainLoop && engine?.resumeMainLoop){value?engine.pauseMainLoop():engine.resumeMainLoop();applied=true;}
    // Explicit opt-in integration is preferable to guessing arbitrary engine methods.
    if(typeof globalThis.PlaydeckAdapter?.setPaused==='function'){globalThis.PlaydeckAdapter.setPaused(value);applied=true;}
    enginePause=applied?'applied':'unsupported';
  };
  window.addEventListener('message',event=>{
    if(event.source!==window.parent || event.origin!==location.origin || event.data?.type!=='playdeck:state')return;
    const next=!!event.data.paused;
    if(next && !paused)for(const input of held.values()){const released=new KeyboardEvent('keyup',{key:input.key,code:input.code,bubbles:true});for(const key of ['keyCode','which'])Object.defineProperty(released,key,{value:input[key]});input.target?.dispatchEvent(released);}
    if(next && !paused)for(const input of heldMouse.values()){const pointer=input.type.startsWith('pointer'),Type=pointer?globalThis.PointerEvent:globalThis.MouseEvent;if(Type)input.target?.dispatchEvent(new Type(pointer?'pointerup':'mouseup',{...input,buttons:0,bubbles:true}));}
    heldMouse.clear();
    paused=next;held.clear();muted=!!event.data.muted;applyAudio();
    try{adapter(paused);}catch{enginePause='failed';}
    for(const child of document.querySelectorAll('iframe'))try{child.contentWindow.postMessage(event.data,location.origin);}catch{}
    notify({kind:'state',paused,muted,enginePause});
  });
  const nativeFetch=globalThis.fetch?.bind(globalThis);
  if(nativeFetch)globalThis.fetch=async(input,options)=>{
    const response=await nativeFetch(input,options);
    if(!response.ok)notify({kind:'request-failure',url:response.url || String(input?.url || input),status:response.status,contentType:response.headers.get('Content-Type')});
    const nativeJSON=response.json.bind(response);
    response.json=async()=>{try{return await nativeJSON();}catch(error){notify({kind:'json-failure',url:response.url || String(input?.url || input),status:response.status,contentType:response.headers.get('Content-Type'),detail:String(error.message).slice(0,300)});throw error;}};
    return response;
  };
  window.addEventListener('error',event=>notify({kind:'error',detail:String(event.message).slice(0,300),url:event.filename}));
  window.addEventListener('unhandledrejection',event=>notify({kind:'error',detail:String(event.reason?.message || event.reason).slice(0,300)}));
  notify({kind:'ready'});
}

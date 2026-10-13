export const graphicsDefaults = Object.freeze({renderScale:1,adaptive:true,reducedFiltering:true,engineOptimizations:true});
export function graphicsOptions(value={}) {
  const result={...graphicsDefaults,...value};
  if(![.25,.5,.75,1].includes(result.renderScale))throw new Error('Invalid render scale');
  for(const key of ['adaptive','reducedFiltering','engineOptimizations'])if(typeof result[key]!=='boolean')throw new Error('Invalid graphics option');
  return Object.fromEntries(Object.keys(graphicsDefaults).map(key=>[key,result[key]]));
}

// A missed 45 FPS presentation on a 60 Hz display can take 33ms. Allow one
// display refresh beyond the target period rather than treating that as overload.
export function nextRenderScale(scale,sample,maximum=1,healthySamples=0) {
  if(!sample || sample.count<30 || !(sample.p90>0))return scale;
  const target=sample.targetFPS || 60;
  const refresh=sample.refreshInterval || 1000/60;
  const expected=Math.ceil((1000/target)/refresh-.02)*refresh;
  if(sample.p90>expected*1.25 && sample.slowRatio>=.15)return Math.max(.25,Math.round(scale*.85*100)/100);
  if(healthySamples>=3 && sample.p90<=expected*1.1)return Math.min(maximum,Math.round((scale+.05)*100)/100);
  return scale;
}

export function scaledPlayerViewport(layout,scale=1,fixed=false) {
  if(!layout || fixed || scale>=1)return layout;
  const width=Math.max(1,Math.round(layout.width*scale)),height=Math.max(1,Math.round(layout.height*scale));
  return {...layout,width,height,scale:layout.scale*layout.width/width,scaleX:layout.scaleX*layout.width/width,scaleY:layout.scaleY*layout.height/height};
}

// Self-contained: injected into pages, file workers and generated blob workers.
export function installGraphicsQuality(context={}) {
  if(globalThis.__playdeckGraphicsInstalled)return;
  globalThis.__playdeckGraphicsInstalled=true;
  const options={renderScale:1,adaptive:true,reducedFiltering:true,engineOptimizations:true,...context.graphics};
  const reduced=context.mode==='auto' || context.mode==='fast';
  let scale=options.renderScale,stopped=false,channel=null;
  const entries=new Set(),seen=new WeakSet(),contexts=new WeakSet(),methods=new WeakMap();
  const status={engine:'Unknown',rendererScaling:false,changes:[]};
  try {if(typeof BroadcastChannel==='function')channel=new BroadcastChannel(context.session?'playdeck-performance:'+context.session:'timebomb-performance:'+new URL(context.source).origin);}catch{}
  let reported='';
  const report=()=>{reported=JSON.stringify(status);try{channel?.postMessage({type:'graphics-status',...status});}catch{}};
  function filter(gl) {
    if(!reduced || !options.reducedFiltering || !gl || contexts.has(gl))return;
    contexts.add(gl);
    let extension;
    try {extension=gl.getExtension?.('EXT_texture_filter_anisotropic') || gl.getExtension?.('WEBKIT_EXT_texture_filter_anisotropic');}catch{}
    if(!extension)return;
    for(const key of ['texParameterf','texParameteri']) {
      const native=gl[key];if(typeof native!=='function')continue;
      try {gl[key]=function(target,pname,value,...rest){return native.call(this,target,pname,pname===extension.TEXTURE_MAX_ANISOTROPY_EXT?Math.min(value,1):value,...rest);};}catch{}
    }
  }
  // Texture dimensions, mipmaps, atlas coordinates and framebuffer attachments
  // stay intact. Only the supported anisotropy parameter is limited.
  for(const name of ['HTMLCanvasElement','OffscreenCanvas']) {
    const proto=globalThis[name]?.prototype;if(!proto?.getContext)continue;
    const native=proto.getContext;
    proto.getContext=function(type,...args){const gl=native.call(this,type,...args);if(/^(webgl2?|experimental-webgl)$/.test(type))filter(gl);return gl;};
  }
  function remember(engine,instance) {
    if(!instance || seen.has(instance) || typeof WeakRef!=='function')return;
    let entry;
    try {
      if(engine==='Three.js' && instance.isWebGLRenderer && typeof instance.setPixelRatio==='function' && typeof instance.getPixelRatio==='function')entry={engine,ref:new WeakRef(instance),baseline:instance.getPixelRatio(),last:null};
      if(engine==='Babylon.js' && typeof instance.setHardwareScalingLevel==='function' && typeof instance.getHardwareScalingLevel==='function')entry={engine,ref:new WeakRef(instance),baseline:instance.getHardwareScalingLevel(),last:null};
      if(engine==='PlayCanvas' && instance.graphicsDevice && typeof instance.resizeCanvas==='function')entry={engine,ref:new WeakRef(instance),baseline:Math.min(instance.graphicsDevice.maxPixelRatio,globalThis.devicePixelRatio || 1),last:null};
      if(engine==='PixiJS' && instance.screen && Number.isFinite(instance.resolution) && typeof instance.resize==='function')entry={engine,ref:new WeakRef(instance),baseline:instance.resolution,last:null};
    }catch{}
    if(!entry || !(entry.baseline>0))return;
    seen.add(instance);entries.add(entry);status.engine=engine;
    // Capture authored resolution changes without multiplying an already-scaled
    // value. Store native methods weakly so discarded renderers can be collected.
    const key=engine==='Three.js'?'setPixelRatio':engine==='Babylon.js'?'setHardwareScalingLevel':null;
    if(key)try {
      const native=instance[key];methods.set(instance,native);
      instance[key]=function(value,...args){if(Number.isFinite(value) && value>0)entry.baseline=value;return native.call(this,engine==='Babylon.js'?value/scale:value*scale,...args);};
    }catch{}
    apply();
  }
  function apply() {
    let applied=false;
    for(const entry of entries) {
      const instance=entry.ref.deref();if(!instance){entries.delete(entry);continue;}
      try {
        if(entry.engine==='Three.js') {
          const ratio=entry.baseline*scale;
          if((scale!==1 || entry.last!==null && entry.last!==1) && instance.getPixelRatio()!==ratio)(methods.get(instance) || instance.setPixelRatio).call(instance,ratio);
          if(reduced && options.engineOptimizations && instance.shadowMap)instance.shadowMap.enabled=false;
        } else if(entry.engine==='Babylon.js') {
          const ratio=entry.baseline/scale;
          if((scale!==1 || entry.last!==null && entry.last!==1) && instance.getHardwareScalingLevel()!==ratio)(methods.get(instance) || instance.setHardwareScalingLevel).call(instance,ratio);
          if(reduced && options.engineOptimizations)for(const scene of instance.scenes || [])if(typeof scene.shadowsEnabled==='boolean')scene.shadowsEnabled=false;
        } else if(entry.engine==='PlayCanvas') {
          const ratio=entry.baseline*scale;
          if((scale!==1 || entry.last!==null && entry.last!==1) && instance.graphicsDevice.maxPixelRatio!==ratio){instance.graphicsDevice.maxPixelRatio=ratio;instance.resizeCanvas();}
          if(reduced && options.engineOptimizations && typeof instance.scene?.lighting?.shadowsEnabled==='boolean')instance.scene.lighting.shadowsEnabled=false;
        } else if(entry.engine==='PixiJS') {
          const ratio=entry.baseline*scale;
          if((scale!==1 || entry.last!==null && entry.last!==1) && instance.resolution!==ratio){instance.resolution=ratio;instance.resize(instance.screen.width,instance.screen.height);}
        }
        applied=true;entry.last=scale;
      }catch{}
    }
    const previous=reported;
    status.rendererScaling=applied;
    status.changes=[...(applied?['Renderer resolution']:[]),...(applied && reduced && options.engineOptimizations && status.engine!=='PixiJS'?['Shadows disabled']:[])];
    if(previous!==JSON.stringify(status))report();
  }
  function hook(namespace,key,engine,select=value=>value) {
    const Constructor=namespace?.[key];if(typeof Constructor!=='function' || Constructor.__playdeckQualityConstructor)return;
    try {
      const wrapped=new Proxy(Constructor,{construct(target,args,newTarget){const instance=Reflect.construct(target,args,newTarget);remember(engine,select(instance));return instance;}});
      Object.defineProperty(wrapped,'__playdeckQualityConstructor',{value:true});
      namespace[key]=wrapped;
    }catch{}
  }
  function discover() {
    if(stopped || globalThis.document?.hidden)return;
    try {
      hook(globalThis.THREE,'WebGLRenderer','Three.js');
      hook(globalThis.BABYLON,'Engine','Babylon.js');
      hook(globalThis.pc,'Application','PlayCanvas');
      hook(globalThis.PIXI,'Renderer','PixiJS');
      hook(globalThis.PIXI,'WebGLRenderer','PixiJS');
      for(const engine of globalThis.BABYLON?.Engine?.Instances || [])remember('Babylon.js',engine);
      const app=globalThis.pc?.Application?.getApplication?.();if(app)remember('PlayCanvas',app);
      for(const key of ['renderer','engine','app','game']) {
        const value=globalThis[key];if(!value)continue;
        if(value.isWebGLRenderer)remember('Three.js',value);
        if(value.getHardwareScalingLevel)remember('Babylon.js',value);
        if(globalThis.pc?.Application && value instanceof globalThis.pc.Application)remember('PlayCanvas',value);
        const renderer=value.renderer || value;
        if(globalThis.PIXI && (renderer instanceof (globalThis.PIXI.Renderer || class {}) || renderer instanceof (globalThis.PIXI.WebGLRenderer || class {})))remember('PixiJS',renderer);
      }
      if(!status.rendererScaling && (globalThis.unityInstance || globalThis.createUnityInstance))status.engine='Unity';
      if(!status.rendererScaling && globalThis.Engine && globalThis.Engine.isWebGLAvailable)status.engine='Godot';
      apply();
    }catch{}
  }
  // Catch libraries assigned after this bootstrap, before their first renderer
  // is constructed. Leave non-configurable properties and module namespaces alone.
  for(const key of ['THREE','BABYLON','pc','PIXI'])try {
    const descriptor=Object.getOwnPropertyDescriptor(globalThis,key);
    if(descriptor && (!descriptor.configurable || descriptor.get || descriptor.set || !descriptor.writable))continue;
    let value=globalThis[key];
    Object.defineProperty(globalThis,key,{configurable:true,enumerable:descriptor?.enumerable ?? true,get:()=>value,set(next){value=next;discover();}});
  }catch{}
  globalThis.__playdeckRegisterGraphics=remember;
  if(channel)channel.onmessage=event=>{
    if(event.data?.type!=='graphics-config' || !Number.isFinite(event.data.scale) || event.data.scale<.25 || event.data.scale>options.renderScale)return;
    scale=event.data.scale;discover();report();
  };
  discover();report();
  const timer=typeof setInterval==='function'?setInterval(discover,1500):null;
  globalThis.addEventListener?.('pagehide',()=>{stopped=true;if(timer!==null)clearInterval(timer);channel?.close();},{once:true});
}

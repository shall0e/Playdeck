import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {graphicsOptions,nextRenderScale,scaledPlayerViewport,installGraphicsQuality} from '../website/player/graphics-quality.js';
import {createSession,proxyContext,canonicalGameURL} from '../website/player/session.js';
import {validateProfile} from '../website/player/profiles.js';
import {readLaunchOptions} from '../website/player/launch-options.js';
import {playerViewport} from '../website/player/viewport.js';
import {bootstrap} from '../website/player/proxy-core.js';

function runtime(globals={},graphics={}) {
  let tick,receiver,cleanup;
  const messages=[];
  const context=vm.createContext({
    ...globals,
    BroadcastChannel:class {constructor(){receiver=this;}postMessage(value){messages.push(value);}close(){}},
    setInterval(callback){tick=callback;return 1;},clearInterval(){tick=null;},
    addEventListener(type,callback){if(type==='pagehide')cleanup=callback;},
  });
  vm.runInContext('('+installGraphicsQuality.toString()+')('+JSON.stringify({mode:'auto',session:'12345678',graphics:graphicsOptions(graphics)})+')',context);
  return {context,messages,poll:()=>tick?.(),setScale:scale=>receiver.onmessage({data:{type:'graphics-config',scale}}),stop:()=>cleanup()};
}

test('manual render scales shrink responsive render viewports while preserving screen coverage and fixed input space',()=>{
  const layout=playerViewport(1920,1080,'full',0,null,null,true);
  for(const scale of [.25,.5,.75,1]) {
    const result=scaledPlayerViewport(layout,scale);
    assert.equal(result.width,1920*scale);assert.equal(result.height,1080*scale);
    assert.equal(result.width*result.scaleX,1920);assert.equal(result.height*result.scaleY,1080);
    assert.equal(scaledPlayerViewport(layout,scale,true),layout);
  }
});

test('adaptive resolution follows the selected FPS goal, stays bounded and recovers only with sustained headroom',()=>{
  assert.equal(nextRenderScale(1,{count:90,p90:50,slowRatio:.8,targetFPS:30}),.85);
  assert.equal(nextRenderScale(.25,{count:90,p90:100,slowRatio:.8,targetFPS:60}),.25);
  assert.equal(nextRenderScale(.5,{count:90,p90:33.4,slowRatio:.3,targetFPS:30}),.5);
  assert.equal(nextRenderScale(.5,{count:90,p90:33.4,slowRatio:.3,targetFPS:45}),.5);
  assert.equal(nextRenderScale(.5,{count:90,p90:16,slowRatio:0,targetFPS:60},.75,2),.5);
  assert.equal(nextRenderScale(.5,{count:90,p90:16,slowRatio:0,targetFPS:60},.75,3),.55);
  assert.equal(nextRenderScale(.75,{count:90,p90:16,slowRatio:0,targetFPS:60},.75,3),.75);
});

test('filtering caps anisotropy without touching texture dimensions, mipmaps or unrelated parameters',()=>{
  const calls=[],extension={TEXTURE_MAX_ANISOTROPY_EXT:34046};
  const gl={getExtension:()=>extension,texParameterf(...args){calls.push(args);},texParameteri(...args){calls.push(args);},texImage2D(){},generateMipmap(){}};
  const image=gl.texImage2D,mipmap=gl.generateMipmap;
  class Canvas{getContext(){return gl;}}
  runtime({HTMLCanvasElement:Canvas});
  new Canvas().getContext('webgl2');
  gl.texParameterf(3553,34046,16);gl.texParameteri(3553,10241,9987);
  assert.deepEqual(calls,[[3553,34046,1],[3553,10241,9987]]);
  assert.equal(gl.texImage2D,image);assert.equal(gl.generateMipmap,mipmap);
});

test('filtering opt-out and unsupported extensions preserve native parameter calls',()=>{
  for(const reducedFiltering of [true,false]) {
    const original=function(){},gl={getExtension:()=>null,texParameterf:original};
    class Canvas{getContext(){return gl;}}
    runtime({HTMLCanvasElement:Canvas},{reducedFiltering});new Canvas().getContext('webgl');assert.equal(gl.texParameterf,original);
  }
});

test('Three.js discovery catches late-loaded constructors, scales buffers once and preserves the renderer identity',()=>{
  class Renderer{constructor(){this.isWebGLRenderer=true;this.ratio=2;this.shadowMap={enabled:true};}getPixelRatio(){return this.ratio;}setPixelRatio(value){this.ratio=value;}}
  const game=runtime({}, {renderScale:.5});
  game.context.THREE={WebGLRenderer:Renderer};
  const renderer=new game.context.THREE.WebGLRenderer();
  assert.ok(renderer instanceof Renderer);assert.equal(renderer.ratio,1);assert.equal(renderer.shadowMap.enabled,false);
  game.setScale(.25);assert.equal(renderer.ratio,.5);game.poll();assert.equal(renderer.ratio,.5);
  game.setScale(.5);assert.equal(renderer.ratio,1);
  renderer.setPixelRatio(3);assert.equal(renderer.ratio,1.5);game.poll();assert.equal(renderer.ratio,1.5);
  game.setScale(.25);assert.equal(renderer.ratio,.75);
  assert.ok(game.messages.some(value=>value.engine==='Three.js' && value.rendererScaling));
  assert.equal(game.context.__playdeckRegisterGraphics('Three.js',null),undefined);
});

test('Babylon.js uses engine scaling and only disables supported scene shadows',()=>{
  const scene={shadowsEnabled:true,particlesEnabled:true,postProcessesEnabled:true};
  const engine={ratio:1,scenes:[scene],getHardwareScalingLevel(){return this.ratio;},setHardwareScalingLevel(value){this.ratio=value;}};
  const game=runtime({BABYLON:{Engine:class {static Instances=[engine];}}},{renderScale:.5});
  assert.equal(engine.ratio,2);assert.equal(scene.shadowsEnabled,false);assert.equal(scene.particlesEnabled,true);assert.equal(scene.postProcessesEnabled,true);
  game.setScale(.25);assert.equal(engine.ratio,4);
});

test('PlayCanvas and PixiJS use their resolution APIs without changing game timing or scene contents',()=>{
  let resizes=0;
  const app={graphicsDevice:{maxPixelRatio:2},scene:{lighting:{shadowsEnabled:true}},resizeCanvas(){resizes++;}};
  const pc=runtime({devicePixelRatio:1,pc:{Application:class {static getApplication(){return app;}}}},{renderScale:.5});
  assert.equal(app.graphicsDevice.maxPixelRatio,.5);assert.equal(app.scene.lighting.shadowsEnabled,false);assert.equal(resizes,1);
  pc.setScale(.25);assert.equal(app.graphicsDevice.maxPixelRatio,.25);
  class Renderer{constructor(){this.resolution=2;this.screen={width:800,height:600};}resize(width,height){this.sized=[width,height];}}
  const pixi=runtime({PIXI:{Renderer}},{renderScale:.5});
  const renderer=new pixi.context.PIXI.Renderer();
  assert.equal(renderer.resolution,1);assert.deepEqual(renderer.sized,[800,600]);
});

test('engine quality opt-out preserves shadows, unknown engines remain untouched, and discovery stops on exit',()=>{
  const renderer={isWebGLRenderer:true,ratio:1,shadowMap:{enabled:true},getPixelRatio(){return this.ratio;},setPixelRatio(value){this.ratio=value;}};
  const game=runtime({renderer},{engineOptimizations:false});assert.equal(renderer.shadowMap.enabled,true);
  game.stop();renderer.ratio=3;game.poll();assert.equal(renderer.ratio,3);
  const unknown={simulationRate:60,physics:true};runtime({game:unknown});assert.deepEqual(unknown,{simulationRate:60,physics:true});
});

test('graphics settings survive launch routes and profiles and share canonical cached assets',()=>{
  const quality=graphicsOptions({renderScale:.5,adaptive:false,reducedFiltering:false,engineOptimizations:true});
  const session=createSession('https://game.example/','auto',{},45,quality);
  assert.deepEqual(proxyContext(session.prefix).graphics,quality);
  assert.deepEqual(validateProfile({graphics:quality}).graphics,quality);
  assert.equal(canonicalGameURL('https://player.example'+session.prefix+'game.example/data.bin').pathname,'/player/games/game.example/data.bin');
  const launch=readLaunchOptions(new URLSearchParams('renderScale=0.5&adaptive=false&reducedFiltering=false&engineOptimizations=true'));
  assert.deepEqual(graphicsOptions(launch),quality);
  assert.ok(bootstrap('https://game.example/','https://player.example',true,session.prefix).includes('installGraphicsQuality'));
  assert.throws(()=>graphicsOptions({renderScale:.1}));assert.throws(()=>graphicsOptions({adaptive:'true'}));
});

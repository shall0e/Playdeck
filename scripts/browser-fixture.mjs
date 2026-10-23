import {createServer} from 'node:http';
import {readFileSync,existsSync,statSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import {bootstrap,rewriteJS,ASSET_VERSION} from '../website/player/proxy-core.js';
import {proxyContext} from '../website/player/session.js';
import {fixtureResponse} from './browser-virtual.mjs';
export function fixtureServer(){
  const counts=new Map();let broken=false,version=1;
  const server=createServer(async(req,res)=>{
    const origin='http://127.0.0.1:'+server.address().port,url=new URL(req.url,origin);const path=url.pathname;counts.set(path,(counts.get(path)||0)+1);
    const headers={'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'credentialless','Cross-Origin-Resource-Policy':'cross-origin','Cache-Control':'no-cache'};
    if(path==='/player/sw.js')headers['Service-Worker-Allowed']='/';
    try{
      if(path.startsWith('/player/games/')){
        const context=proxyContext(path),source='https://'+path.slice(context.prefix.length)+url.search,remote=new URL(source),file=remote.pathname.split('/').pop();headers['X-Playdeck-Route']=context.prefix;headers['X-Playdeck-Compatibility']='deck-runtime-1';headers['X-Playdeck-Network']=ASSET_VERSION;headers['X-Playdeck-Transform']=ASSET_VERSION+':runtime-1:asset';
        if(remote.pathname.includes('/unavailable/')){headers['Content-Type']='text/html';res.writeHead(530,headers);res.end('<!doctype html><html><body>Source unavailable</body></html>');return;}
        if(file==='optional.bin'){headers['Content-Type']='application/octet-stream';res.writeHead(200,headers);res.end('optional-video');return;}
        if(file==='asset.bin'){const data=Buffer.alloc(16*1024*version,version);headers['Content-Type']='application/octet-stream';headers['Content-Length']=data.length;headers['ETag']='"fixture-'+version+'"';headers['Accept-Ranges']='bytes';if(req.headers['if-none-match']===headers['ETag']){res.writeHead(304,headers);res.end();return;}res.writeHead(200,headers);res.end(data);return;}
        if(file==='manifest.json'){const body=broken?'<html>wrong response</html>':JSON.stringify(remote.pathname.includes('/light/')?{version,playdeckDownloads:{version:1},totalBytes:14,files:[{path:'optional.bin',size:14,optional:true,category:'video'}]}:{version});headers['Content-Type']=broken?'text/html':'application/json';res.writeHead(200,headers);res.end(body);return;}
        if(file==='engine.js'){
          let body=`globalThis.fixture={ready:true,pauses:0,resumes:0,inputs:[],jsonError:null};globalThis.Module={pauseMainLoop(){fixture.pauses++},resumeMainLoop(){fixture.resumes++}};const canvas=document.querySelector('canvas'),ctx=canvas.getContext('2d');function draw(now){ctx.fillStyle='#152318';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#d7ff64';ctx.fillRect((now/10)%500,100,60,60);requestAnimationFrame(draw)}requestAnimationFrame(draw);document.addEventListener('keydown',event=>fixture.inputs.push(event.code));localStorage.setItem('fixture-counter',String(Number(localStorage.getItem('fixture-counter')||0)+1));fixture.counter=localStorage.getItem('fixture-counter');fetch('./manifest.json').then(response=>response.json()).then(async value=>{fixture.manifest=value;fixture.optional=[];for(const file of value.files || []){await (await fetch('./'+file.path)).arrayBuffer();fixture.optional.push(file.path);}fixture.downloadsReady=true;}).catch(error=>fixture.jsonError=error.message);fetch('./asset.bin').then(response=>response.arrayBuffer()).then(value=>fixture.bytes=value.byteLength);`;
          body=bootstrap(source,origin,true,context.prefix,context.mode || 'full')+'\n'+rewriteJS(body,source,origin,context.prefix);headers['Content-Type']='text/javascript';res.writeHead(200,headers);res.end(body);return;
        }
        const body='<!doctype html><html><head>'+bootstrap(source,origin,false,context.prefix,context.mode || 'full')+'<style>html,body{margin:0;background:#101010}canvas{display:block;width:640px;height:360px}</style></head><body><canvas width="640" height="360"></canvas><script src="./engine.js"></script></body></html>';headers['Content-Type']='text/html';res.writeHead(200,headers);res.end(body);return;
      }
      let file=resolve('dist','.'+path);if(existsSync(file)&&statSync(file).isDirectory())file=resolve(file,'index.html');if(!file.startsWith(resolve('dist')) || !existsSync(file)){res.writeHead(404,headers);res.end('Not found');return;}
      headers['Content-Type']=({'.js':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'})[extname(file)] || 'application/octet-stream';res.writeHead(200,headers);res.end(readFileSync(file));
    }catch(error){res.writeHead(500,headers);res.end(error.stack);}
  });
  return {server,counts,response:fixtureResponse(counts,{broken:()=>broken,version:()=>version}),broken:value=>{broken=value;},version:value=>{version=value;},async start(){await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return 'http://127.0.0.1:'+server.address().port;},async close(){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}

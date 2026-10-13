import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {fixtureServer} from './browser-fixture.mjs';
import {installNetworkProxy} from '../website/player/network.js';
import {proxyURL,targetFromProxy} from '../website/player/network-url.js';
const fixture=fixtureServer(),origin=await fixture.start(),prefix='/player/games/.launch/12345678-abcd/full/101/gameid/',base='https://game.example/folder/index.html';
const hook='('+installNetworkProxy.toString()+')('+[base,origin,prefix].map(JSON.stringify).join(',')+',null,'+proxyURL.toString()+','+targetFromProxy.toString()+');';
const browser=await chromium.launch({headless:true});
try {
  const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage(),requests=[],escaped=[],errors=[],sockets=[];
  page.on('pageerror',error=>errors.push(error.message));
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());requests.push({url:request.url(),method:request.method(),body:request.postData()});
    if(url.origin!==origin){escaped.push(request.url());return route.abort();}
    if(url.pathname.endsWith('/index.html'))return route.fulfill({contentType:'text/html',body:'<!doctype html><head><script>'+hook+'</script></head><body><div id="root"></div></body>'});
    if(url.pathname.endsWith('/engine-worker.js'))return route.fulfill({contentType:'text/javascript',body:hook+"onmessage=async()=>{postMessage(await (await fetch('/packs/zm_transit/dist/manifest.json')).json());};"});
    if(url.pathname.endsWith('/live'))return route.fulfill({contentType:'text/event-stream',body:'data: ready\n\n'});
    if(/\.png$/.test(url.pathname))return route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jEZkAAAAASUVORK5CYII=','base64')});
    return route.fulfill({contentType:'application/json',body:'{"ok":true}'});
  });
  await page.routeWebSocket(/.*/,socket=>{sockets.push(socket.url());socket.onMessage(message=>socket.send(message));});
  await page.goto(origin+prefix+'game.example/folder/index.html');
  const results=await page.evaluate(async()=>{
    const tasks=[];
    tasks.push(fetch('http://assets.example:8080/map.json').then(r=>r.json()));
    tasks.push(fetch(new Request('https://api.example/save',{method:'POST',body:'save',headers:{'Content-Type':'text/plain'}})).then(r=>r.json()));
    tasks.push(new Promise((resolve,reject)=>{const xhr=new XMLHttpRequest();xhr.open('GET','https://cdn.example/xhr.json');xhr.onload=()=>resolve(xhr.status);xhr.onerror=reject;xhr.send();}));
    tasks.push(new Promise(resolve=>{const events=new EventSource('https://events.example/live');events.onmessage=e=>{events.close();resolve(e.data);};}));
    navigator.sendBeacon('https://api.example/beacon','beacon-body');
    const socket=new WebSocket('wss://'+location.host+'/api/lobby/test/ws');
    tasks.push(new Promise(resolve=>{socket.onopen=()=>socket.send('connected');socket.onmessage=e=>{socket.close();resolve(e.data);};}));
    tasks.push(new Promise(resolve=>{const worker=new Worker('engine-worker.js');worker.onmessage=e=>{worker.terminate();resolve(e.data);};worker.postMessage({manifestUrls:['/packs/zm_transit/dist/manifest.json']});}));
    tasks.push(new Promise(resolve=>{const script="onmessage=async()=>{const nested=new Worker(URL.createObjectURL(new Blob([\"onmessage=async()=>postMessage(await (await fetch('https://packs.example/nested.json')).json())\"],{type:'text/javascript'})));nested.onmessage=e=>postMessage(e.data);nested.postMessage('start');}";const worker=new Worker(URL.createObjectURL(new Blob([script],{type:'text/javascript'})));worker.onmessage=e=>{worker.terminate();resolve(e.data);};worker.postMessage('start');}));
    const root=document.querySelector('#root');
    root.innerHTML='<img src="https://images.example/inner.png"><style>.styled{background-image:url(https://images.example/style.png)}</style><div class="styled" style="height:20px"></div>';
    root.insertAdjacentHTML('beforeend','<img src="https://images.example/adjacent.png">');
    const img=new Image();img.srcset='https://images.example/small.png 1x, https://images.example/large.png 2x';root.append(img);
    root.style.backgroundImage='url(https://images.example/property.png)';
    const sheet=new CSSStyleSheet();sheet.replaceSync('body{background-image:url(https://images.example/sheet.png)}');document.adoptedStyleSheets=[sheet];
    tasks.push(new Promise(resolve=>{const frame=document.createElement('iframe');window.addEventListener('message',event=>{if(event.source===frame.contentWindow){frame.remove();resolve(event.data);}});frame.srcdoc='<script>fetch("https://frames.example/child.json").then(r=>r.json()).then(value=>parent.postMessage(value,"*"))<\/script>';root.append(frame);}));
    return Promise.all(tasks);
  });
  await page.waitForTimeout(250);
  assert.deepEqual(escaped,[],'Requests escaped the sandbox');assert.deepEqual(errors,[]);
  assert.equal(results[3],'ready');assert.equal(results[4],'connected');assert.equal(results[5].ok,true);assert.equal(results[6].ok,true);assert.equal(results[7].ok,true);
  for(const path of ['images.example/inner.png','images.example/adjacent.png','images.example/property.png','images.example/sheet.png','game.example/packs/zm_transit/dist/manifest.json','packs.example/nested.json','frames.example/child.json'])assert(requests.some(r=>r.url.includes(prefix+path)),'Missing proxy request: '+path);
  assert.equal(sockets.length,1);assert(new URL(sockets[0]).pathname.startsWith(prefix+'.net/wss/game.example/'));
  const save=requests.find(r=>r.url.endsWith('/api.example/save'));assert.equal(save.method,'POST');
  console.log(JSON.stringify({requests:requests.length,sockets:sockets.length,escaped:escaped.length,workerManifest:true,nestedWorker:true,srcdoc:true,dynamicCSS:true}));
} finally {await browser.close();await fixture.close();}


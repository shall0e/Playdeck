import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const boot=readFileSync(new URL('../website/player/boot.js',import.meta.url),'utf8');
test('failed launch documents retain recovery controls and cannot announce game readiness',()=>{
 const elements=new Map(),failures=[];
 const context=vm.createContext({failedDocument:null,gameReady:true,activityPoll:1,idleTimer:2,slowTimer:3,clearInterval(){},clearTimeout(){},deck:{failure:data=>failures.push(data)},$:selector=>{if(!elements.has(selector))elements.set(selector,{});return elements.get(selector);}});
 vm.runInContext(boot.slice(boot.indexOf('function showDocumentFailure('),boot.indexOf("navigator.serviceWorker?.addEventListener('message'")),context);
 context.showDocumentFailure({url:'https://player.example/player/games/game.example/',status:530});
 assert.equal(context.gameReady,false);assert.equal(elements.get('#loading').hidden,false);assert.equal(elements.get('#retry').hidden,false);assert.equal(elements.get('#continue').hidden,true);assert.match(elements.get('#status').textContent,/HTTP 530/);assert.equal(failures[0].status,530);
 context.lastDownload=0;context.checkDownloads=()=>{};
 vm.runInContext(boot.slice(boot.indexOf('function downloadActivity('),boot.indexOf('function monitorDownloads(')),context);
 context.downloadActivity({active:0,lastDownload:Date.now()});assert.match(elements.get('#status').textContent,/HTTP 530/);
 context.frame={};
 vm.runInContext(boot.slice(boot.indexOf('function revealGame('),boot.indexOf("$('#continue').onclick")),context);
 context.revealGame();assert.equal(context.gameReady,false);
});

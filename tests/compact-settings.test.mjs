import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {canvasDisplayBox} from '../website/player/display.js';
import {gameCacheScope,matchesGameCache,clearGameCache} from '../website/player/sw.js';
test('ratio affects visible canvas geometry rather than being canceled by frame stretch',()=>{
 const screen={width:1920,height:1080};
 assert.deepEqual(canvasDisplayBox(screen.width,screen.height,'16:9'),{...screen,left:0,top:0});
 const square=canvasDisplayBox(screen.width,screen.height,'1:1');
 assert.equal(square.width,1080);assert.equal(square.height,1080);assert.equal(square.left,420);
 const classic=canvasDisplayBox(screen.width,screen.height,'4:3');assert.equal(classic.width/classic.height,4/3);assert.notDeepEqual(classic,square);
});
test('clear game preserves adjacent games, external origins and shared dependencies',async()=>{
 const origin='https://playdeck-1z1.pages.dev',scope=gameCacheScope('https://ports.example/fnaf1/index.html',origin);
 const paths=['/player/games/ports.example/fnaf1/index.html','/player/games/ports.example/fnaf1/pack.data','/player/games/ports.example/fnaf10/pack.data','/player/games/ports.example/slime/pack.data','/player/games/cdn.example/shared.js'];
 const requests=paths.map(path=>new Request(origin+path));requests.push(new Request('https://other.example'+paths[0]));
 const removed=[],cache={keys:async()=>requests,delete:async key=>{removed.push(key.url);return true;}};
 assert.equal(await clearGameCache(cache,scope),2);assert.equal(removed.length,2);
 assert.equal(matchesGameCache(requests[2],scope),false);assert.equal(gameCacheScope('javascript:alert(1)',origin),null);
});
test('Settings auto-save and native controller games bypass the mapper entirely',()=>{
 const settings=readFileSync(new URL('../website/player/settings.js',import.meta.url),'utf8'),boot=readFileSync(new URL('../website/player/boot.js',import.meta.url),'utf8');
 assert.ok(!settings.includes('Save player settings'));assert.ok(!settings.includes('for all games'));
 assert.ok(settings.includes("addEventListener('change',save)"));
 assert.ok(boot.includes("gameURL && !nativeGamepad ? installController"));
 assert.ok(boot.includes("launch.displayOptions"));assert.ok(!boot.includes("params.get('display')"));
});
test('performance settings are available independently of canvas display options',()=>{
 const boot=readFileSync(new URL('../website/player/boot.js',import.meta.url),'utf8');
 assert.ok(boot.includes("if(['full','auto','fast','native'].includes(saved))"));
 assert.ok(boot.includes("performanceControl.id='performance-control'"));
 assert.ok(!boot.includes('performanceControl.hidden=!hasDisplayOptions'));
 assert.ok(boot.includes("nextURL.searchParams.set('performance',performanceMode)"));
});


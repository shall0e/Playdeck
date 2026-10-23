import test from 'node:test';
import assert from 'node:assert/strict';
import {importDownloads} from '../website/player/packages.js';
import {gameId} from '../website/player/session.js';
class Cache {
 files=new Map();
 async match(key){return this.files.get(typeof key==='string'?key:key.url)?.clone();}
 async put(key,response){const copy=new Response(await response.arrayBuffer(),{status:response.status,headers:response.headers});this.files.set(typeof key==='string'?key:key.url,copy);}
 async keys(){return [...this.files.keys()].map(key=>new Request(key));}
}
const source='https://game.example/',key='https://player.example/player/games/game.example/asset.bin';
async function archive({expected=3,extra=false}={}){
 const bytes=new Uint8Array([1,2,3]),hash=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');
 const records=[{type:'playdeck-downloads',version:1,url:source,game:gameId(source)},{file:key,headers:[['Content-Type','application/octet-stream']],metadata:{bytes:expected}},{chunk:Buffer.from(bytes).toString('base64'),hash},{end:true},{complete:true}];
 if(extra)records.push({complete:true});
 return new Blob([records.map(record=>JSON.stringify(record)).join('\n')+'\n']);
}
test('download packages reject missing chunks and trailing records without replacing saved files',async()=>{
 const saved={caches:globalThis.caches,location:globalThis.location},stores=new Map();
 globalThis.location=new URL('https://player.example/');
 globalThis.caches={open:async name=>{if(!stores.has(name))stores.set(name,new Cache());return stores.get(name);},delete:async name=>stores.delete(name)};
 try{
  const cache=await caches.open('timebomb-local-games-v1');await cache.put(key,new Response('working'));
  await assert.rejects(importDownloads(await archive({expected:4})),/size does not match/);
  assert.equal(await (await cache.match(key)).text(),'working');
  await assert.rejects(importDownloads(await archive({extra:true})),/Unexpected data after/);
  assert.equal(await (await cache.match(key)).text(),'working');
  assert.equal((await importDownloads(await archive())).files,1);
  assert.deepEqual([...new Uint8Array(await (await cache.match(key)).arrayBuffer())],[1,2,3]);
  assert.equal([...stores.keys()].some(name=>name.startsWith('playdeck-import-')),false);
 }finally{globalThis.caches=saved.caches;globalThis.location=saved.location;}
});

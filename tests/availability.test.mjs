import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../website/_worker.js';
const request=url=>new Request('https://player.example/player/availability?url='+encodeURIComponent(url));
async function withFetch(fetcher,run){const saved=globalThis.fetch;globalThis.fetch=fetcher;try{await run();}finally{globalThis.fetch=saved;}}
test('availability endpoint checks HTTP status without downloading game assets',()=>withFetch(async(_url,options)=>{assert.equal(options.method,'HEAD');return new Response(null,{status:200});},async()=>{assert.deepEqual(await (await worker.fetch(request('https://game.example/'),{})).json(),{available:true,status:200});}));
test('offline HTTP responses disable links while rate limits remain unknown',async()=>{
 for(const status of [404,451,530,503,429])await withFetch(async()=>new Response(null,{status}),async()=>{const response=await worker.fetch(request('https://game.example/'),{});assert.equal(response.headers.get('Access-Control-Allow-Origin'),'*');assert.equal((await response.json()).available,status===429?null:false);});
});
test('HEAD rejection falls back to a bounded GET and redirects are followed',()=>withFetch(async(url,options)=>{
 if(url==='https://game.example/')return new Response(null,{status:302,headers:{Location:'/play/'}});
 if(options.method==='HEAD')return new Response(null,{status:405});
 assert.equal(options.headers.Range,'bytes=0-0');return new Response('x',{status:206});
},async()=>{assert.equal((await (await worker.fetch(request('https://game.example/'),{})).json()).available,true);}));
test('unreachable links are unavailable and private/recursive targets are rejected',()=>withFetch(async()=>{throw new Error('DNS failed');},async()=>{
 assert.equal((await (await worker.fetch(request('https://game.example/'),{})).json()).available,false);
 for(const url of ['https://127.0.0.1/','https://localhost/','https://player.example/','https://user:secret@game.example/'])assert.equal((await worker.fetch(request(url),{})).status,400);
}));
test('availability checks do not follow redirects into private services',()=>withFetch(async()=>new Response(null,{status:302,headers:{Location:'http://127.0.0.1/admin'}}),async()=>{assert.equal((await (await worker.fetch(request('https://game.example/'),{})).json()).reason,'invalid-redirect');}));

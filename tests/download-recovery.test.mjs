import test from 'node:test';
import assert from 'node:assert/strict';
import {indexedDB,IDBKeyRange} from 'fake-indexeddb';
import {partialWriter,resumeDownload,clearPartial} from '../website/player/download-store.js';
globalThis.indexedDB=indexedDB;globalThis.IDBKeyRange=IDBKeyRange;
const total=9*1024*1024,head=new Uint8Array(1024).fill(1),url='https://player.example/player/games/game.example/asset.bin';
const source=()=>new Response(null,{headers:{'Content-Length':String(total),'Accept-Ranges':'bytes',ETag:'"v1"'}});
async function seed(){await clearPartial(url);const writer=partialWriter(url,source());await writer.write(head);await writer.interrupt();}
function tail(headers={},body=new Uint8Array(total-head.length).fill(2)){
 return new Response(body,{status:206,headers:{'Content-Range':`bytes ${head.length}-${total-1}/${total}`,ETag:'"v1"',...headers}});
}
test('resumed bytes preserve the prefix, range and entity validator',async()=>{
 await seed();let request;
 const result=await resumeDownload(new Request(url),url,async value=>{request=value;return tail();});
 assert.equal(request.headers.get('Range'),'bytes=1024-');assert.equal(request.headers.get('If-Range'),'"v1"');
 const bytes=new Uint8Array(await result.arrayBuffer());assert.equal(bytes.length,total);assert.equal(bytes[1023],1);assert.equal(bytes[1024],2);
});
test('inconsistent resumed headers fall back instead of combining incompatible data',async()=>{
 for(const headers of [{ETag:'"v2"'},{ETag:''},{'Content-Range':`bytes 1024-2047/${total}`},{'Content-Length':'1'},{'Content-Encoding':'gzip'}]){
  await seed();assert.equal(await resumeDownload(new Request(url),url,async()=>tail(headers)),null);
 }
});
test('short and oversized resumed bodies fail rather than reporting a complete file',async()=>{
 for(const size of [1,total]){await seed();const result=await resumeDownload(new Request(url),url,async()=>tail({},new Uint8Array(size)));await assert.rejects(result.arrayBuffer(),/Resumed download/);}
});
test('encoded bodies and weak validators are not eligible for byte resumption',()=>{
 for(const extra of [{'Content-Encoding':'gzip'},{ETag:'W/"v1"'}]){
  const response=source();for(const [key,value] of Object.entries(extra))response.headers.set(key,value);
  assert.equal(partialWriter(url,response),null);
 }
});

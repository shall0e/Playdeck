const DATABASE='playdeck.partial-downloads.v1';
const CHUNK=1024*1024;
let database;
function validatorFor(response) {
  const etag=response.headers.get('ETag') || response.headers.get('X-Playdeck-Source-ETag');
  return etag && !/^W\//i.test(etag) ? etag : response.headers.get('Last-Modified');
}
async function open() {
  if(!globalThis.indexedDB)return null;
  if(!database)database=new Promise((resolve,reject)=>{const request=indexedDB.open(DATABASE,1);request.onupgradeneeded=()=>{request.result.createObjectStore('chunks',{keyPath:['url','offset']});request.result.createObjectStore('meta',{keyPath:'url'});};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  return database;
}
async function operation(store,mode,run) {
  const db=await open();if(!db)return null;
  return new Promise((resolve,reject)=>{const transaction=db.transaction(store,mode);const request=run(transaction.objectStore(store));let result;request.onsuccess=()=>{result=request.result;};transaction.oncomplete=()=>resolve(result);transaction.onerror=()=>reject(transaction.error);transaction.onabort=()=>reject(transaction.error);});
}
export async function partialDownload(url) {try{return await operation('meta','readonly',store=>store.get(url));}catch{return null;}}
export async function clearPartial(url) {
  try{const db=await open();if(!db)return;await new Promise((resolve,reject)=>{const transaction=db.transaction(['meta','chunks'],'readwrite');transaction.objectStore('meta').delete(url);transaction.objectStore('chunks').delete(IDBKeyRange.bound([url,0],[url,Number.MAX_SAFE_INTEGER]));transaction.oncomplete=resolve;transaction.onerror=()=>reject(transaction.error);});}catch{}
}
export async function clearAllPartials(){try{const db=await open();if(!db)return;await Promise.all(['meta','chunks'].map(name=>operation(name,'readwrite',store=>store.clear())));}catch{}}

export function partialWriter(url,response) {
  const total=Number(response.headers.get('Content-Length')),validator=validatorFor(response);
  if(response.status!==200 || (response.headers.has('Content-Encoding') && response.headers.get('Content-Encoding')!=='identity'))return null;
  if(!globalThis.indexedDB || !(total>8*CHUNK && total<=32*CHUNK) || !validator || response.headers.get('Accept-Ranges')!=='bytes' || /html|css|javascript|json/i.test(response.headers.get('Content-Type') || ''))return null;
  // Bound duplicate disk usage while Cache Storage receives the same stream.
  let offset=0,parts=[],bytes=0,available=true;
  async function flush() {
    if(!available || !bytes)return;
    const blob=new Blob(parts),start=offset;parts=[];bytes=0;
    try{await operation('chunks','readwrite',store=>store.put({url,offset:start,blob}));offset+=blob.size;await operation('meta','readwrite',store=>store.put({url,bytes:offset,total,validator,headers:[...response.headers]}));}catch{available=false;parts=[];bytes=0;await clearPartial(url);}
  }
  return {async write(value){if(!available)return;parts.push(value.slice());bytes+=value.byteLength;if(bytes>=CHUNK)await flush();},async finish(){await clearPartial(url);},async interrupt(){await flush();}};
}

export async function resumeDownload(request,url,fetcher) {
  const partial=await partialDownload(url);
  if(!partial?.bytes || partial.bytes>=partial.total)return null;
  const headers=new Headers(request.headers);headers.set('Range','bytes='+partial.bytes+'-');headers.set('If-Range',partial.validator);
  const response=await fetcher(new Request(request,{headers}));
  const range=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('Content-Range') || '');
  const validator=validatorFor(response),remaining=partial.total-partial.bytes;
  if(response.status!==206 || !response.body || !range || Number(range[1])!==partial.bytes || Number(range[2])!==partial.total-1 || Number(range[3])!==partial.total || validator!==partial.validator || (response.headers.has('Content-Length') && Number(response.headers.get('Content-Length'))!==remaining) || (response.headers.has('Content-Encoding') && response.headers.get('Content-Encoding')!=='identity')){await clearPartial(url);if(response.status===200)return response;await response.body?.cancel();return null;}
  const chunks=await operation('chunks','readonly',store=>store.getAll(IDBKeyRange.bound([url,0],[url,Number.MAX_SAFE_INTEGER])));
  let offset=0;for(const chunk of chunks || []){if(chunk.offset!==offset){await response.body?.cancel();await clearPartial(url);return null;}offset+=chunk.blob.size;}
  if(offset!==partial.bytes){await response.body?.cancel();await clearPartial(url);return null;}
  const output=new Headers(partial.headers);output.set('Content-Length',String(partial.total));output.delete('Content-Range');
  const reader=response.body.getReader();let index=0,chunkReader=null,received=0;
  const body=new ReadableStream({async pull(controller){try{while(index<chunks.length){chunkReader ||= chunks[index].blob.stream().getReader();const next=await chunkReader.read();if(next.done){index++;chunkReader=null;continue;}controller.enqueue(next.value);return;}const next=await reader.read();if(next.done){if(received!==remaining)throw new Error('Resumed download ended before all bytes arrived');controller.close();}else{received+=next.value.byteLength;if(received>remaining)throw new Error('Resumed download exceeded its declared size');controller.enqueue(next.value);}}catch(error){await reader.cancel(error).catch(()=>{});controller.error(error);}},async cancel(reason){await Promise.allSettled([reader.cancel(reason),chunkReader?.cancel(reason)]);}});
  return new Response(body,{status:200,headers:output});
}

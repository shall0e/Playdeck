const DATABASE='playdeck.partial-downloads.v1';
const CHUNK=1024*1024;
let database;
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
  const total=Number(response.headers.get('Content-Length')),validator=response.headers.get('ETag') || response.headers.get('X-Playdeck-Source-ETag') || response.headers.get('Last-Modified');
  if(!globalThis.indexedDB || !(total>8*CHUNK) || !validator || response.headers.get('Accept-Ranges')!=='bytes' || /html|css|javascript|json/i.test(response.headers.get('Content-Type') || ''))return null;
  let offset=0,parts=[],bytes=0,available=true;
  async function flush() {
    if(!available || !bytes)return;
    const blob=new Blob(parts),start=offset;parts=[];bytes=0;
    try{await operation('chunks','readwrite',store=>store.put({url,offset:start,blob}));offset+=blob.size;await operation('meta','readwrite',store=>store.put({url,bytes:offset,total,validator,headers:[...response.headers]}));}catch{available=false;}
  }
  return {async write(value){if(!available)return;parts.push(value.slice());bytes+=value.byteLength;if(bytes>=CHUNK)await flush();},async finish(){await clearPartial(url);},async interrupt(){await flush();}};
}

export async function resumeDownload(request,url,fetcher) {
  const partial=await partialDownload(url);
  if(!partial?.bytes || partial.bytes>=partial.total)return null;
  const headers=new Headers(request.headers);headers.set('Range','bytes='+partial.bytes+'-');headers.set('If-Range',partial.validator);
  const response=await fetcher(new Request(request,{headers}));
  const range=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('Content-Range') || '');
  const validator=response.headers.get('ETag') || response.headers.get('X-Playdeck-Source-ETag') || response.headers.get('Last-Modified');
  if(response.status!==206 || !range || Number(range[1])!==partial.bytes || Number(range[3])!==partial.total || (validator && validator!==partial.validator)){await clearPartial(url);if(response.status===200)return response;await response.body?.cancel();return null;}
  const chunks=await operation('chunks','readonly',store=>store.getAll(IDBKeyRange.bound([url,0],[url,Number.MAX_SAFE_INTEGER])));
  let offset=0;for(const chunk of chunks || []){if(chunk.offset!==offset){await response.body?.cancel();await clearPartial(url);return null;}offset+=chunk.blob.size;}
  if(offset!==partial.bytes){await response.body?.cancel();await clearPartial(url);return null;}
  const output=new Headers(partial.headers);output.set('Content-Length',String(partial.total));output.delete('Content-Range');
  const reader=response.body.getReader();let index=0,chunkReader=null;
  const body=new ReadableStream({async pull(controller){try{while(index<chunks.length){chunkReader ||= chunks[index].blob.stream().getReader();const next=await chunkReader.read();if(next.done){index++;chunkReader=null;continue;}controller.enqueue(next.value);return;}const next=await reader.read();if(next.done)controller.close();else controller.enqueue(next.value);}catch(error){controller.error(error);}},async cancel(reason){await Promise.allSettled([reader.cancel(reason),chunkReader?.cancel(reason)]);}});
  return new Response(body,{status:200,headers:output});
}

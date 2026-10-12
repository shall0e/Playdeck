import {canonicalGameURL,gameId} from './session.js';
import {downloadFile} from './saves.js';
const DATA='timebomb-local-games-v1',META='playdeck-local-hashes-v1';
const chunkSize=512*1024;
const encode=bytes=>{let text='';for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(text);};
const decode=text=>Uint8Array.from(atob(text),char=>char.charCodeAt(0));
const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');
export async function exportDownloads(gameURL,files,onProgress=()=>{}) {
  let writer,parts=[],size=0;
  if(globalThis.showSaveFilePicker){const handle=await showSaveFilePicker({suggestedName:'game.playdeck',types:[{description:'Playdeck downloads',accept:{'application/octet-stream':['.playdeck']}}]});writer=await handle.createWritable();}
  const owned=(await files).filter(file=>file.owners?.includes(gameId(gameURL)));
  if(!owned.length){await writer?.abort();throw new Error('No downloaded files are recorded for this game');}
  if(!writer && owned.reduce((sum,file)=>sum+(file.bytes || 0),0)>48*1024*1024)throw new Error('Large exports need a browser with streamed file saving, such as desktop Chrome or Edge');
  const write=async value=>{const bytes=new TextEncoder().encode(JSON.stringify(value)+'\n');size+=bytes.byteLength;if(writer)await writer.write(bytes);else{if(size>64*1024*1024)throw new Error('This export is too large for this browser');parts.push(bytes);}};
  try{await write({type:'playdeck-downloads',version:1,game:gameId(gameURL),url:gameURL});const cache=await caches.open(DATA);let count=0;
    for(const entry of owned){const response=await cache.match(entry.url);if(!response)continue;const headers=[...response.headers].filter(([key])=>!['set-cookie','authorization'].includes(key.toLowerCase()));await write({file:entry.url,status:response.status,headers,metadata:{bytes:entry.bytes,owners:entry.owners,savedAt:entry.savedAt}});const reader=response.body.getReader();let buffer=new Uint8Array(0);while(true){const next=await reader.read();if(next.done)break;const merged=new Uint8Array(buffer.length+next.value.length);merged.set(buffer);merged.set(next.value,buffer.length);buffer=merged;while(buffer.length>=chunkSize){const bytes=buffer.subarray(0,chunkSize);await write({chunk:encode(bytes),hash:await digest(bytes)});buffer=buffer.slice(chunkSize);}}if(buffer.length)await write({chunk:encode(buffer),hash:await digest(buffer)});await write({end:true});onProgress(++count,owned.length);}
    await write({complete:true});if(writer)await writer.close();else downloadFile(new Blob(parts,{type:'application/octet-stream'}),'game.playdeck');
  }catch(error){if(writer)await writer.abort();throw error;}
}

async function* lines(file){const reader=file.stream().getReader(),decoder=new TextDecoder();let pending='';try{while(true){const next=await reader.read();pending+=decoder.decode(next.value || new Uint8Array(),{stream:!next.done});let index;while((index=pending.indexOf('\n'))>=0){const line=pending.slice(0,index);pending=pending.slice(index+1);if(line.length>2*1024*1024)throw new Error('Invalid download package');if(line)yield JSON.parse(line);}if(pending.length>2*1024*1024)throw new Error('Invalid download package');if(next.done)break;}if(pending.trim())yield JSON.parse(pending);}finally{reader.releaseLock();}}

export async function importDownloads(file,onProgress=()=>{}){
  const cache=await caches.open(DATA),metadata=await caches.open(META),stagingName='playdeck-import-'+crypto.randomUUID(),staging=await caches.open(stagingName),stagedMetadata=new Map();let header,entry,writer,save,count=0,complete=false;
  try{for await(const item of lines(file)) {
    if(!header){if(item.type!=='playdeck-downloads' || item.version!==1 || gameId(item.url)!==item.game)throw new Error('Choose a Playdeck download package');const url=new URL(item.url);if(url.protocol!=='https:' || url.username || url.password || url.port)throw new Error('Invalid game URL');header=item;continue;}
    if(item.file){if(entry)throw new Error('Incomplete downloaded file');const url=canonicalGameURL(item.file);if(!url.pathname.startsWith('/player/games/'))throw new Error('Invalid file path');const source=new URL('https://'+url.pathname.slice('/player/games/'.length));if(source.username || source.password || source.port || !source.hostname.includes('.'))throw new Error('Invalid file host');const headers=new Headers(item.headers);headers.delete('Set-Cookie');headers.set('X-Playdeck-Origin',url.origin);url.host=location.host;url.protocol=location.protocol;entry={key:url.href,metadata:item.metadata,bytes:0};const pipe=new TransformStream();writer=pipe.writable.getWriter();save=staging.put(entry.key,new Response(pipe.readable,{status:200,headers}));void save.catch(error=>writer.abort(error).catch(()=>{}));}
    else if(item.chunk){if(!entry)throw new Error('Unexpected download chunk');const bytes=decode(item.chunk);if(await digest(bytes)!==item.hash)throw new Error('A download chunk failed its integrity check');entry.bytes+=bytes.length;await writer.write(bytes);}
    else if(item.end){if(!entry)throw new Error('Unexpected file end');await writer.close();await save;stagedMetadata.set(entry.key,{...entry.metadata,bytes:entry.bytes,owners:[header.game],importedAt:Date.now()});entry=writer=save=null;onProgress(++count);}
    else if(item.complete){if(entry)throw new Error('Incomplete downloaded file');complete=true;}
    else throw new Error('Invalid download package record');
  }
  if(!complete || !header)throw new Error('Incomplete download package');
  // Corrupt archives never replace working downloads. Apply only after full validation.
  for(const key of await staging.keys()){await cache.put(key,await staging.match(key));const info=stagedMetadata.get(key.url);if(info)await metadata.put(key,Response.json(info));}
  return {url:header.url,files:count};
  }catch(error){if(writer)await writer.abort(error).catch(()=>{});await save?.catch(()=>{});throw error;}finally{await caches.delete(stagingName);}
}

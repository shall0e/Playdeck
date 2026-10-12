export function downloadFile(blob,name){const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
const bytesTo64=bytes=>{let value='';for(let i=0;i<bytes.length;i+=8192)value+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(value);};
const from64=value=>Uint8Array.from(atob(value),char=>char.charCodeAt(0));
export async function encodeSave(value,state={seen:new Map(),next:1,bytes:0}) {
  if(value===undefined)return {$type:'undefined'};
  if(typeof value==='bigint')return {$type:'bigint',value:String(value)};
  if(value===null || typeof value!=='object'){if(typeof value==='string'){state.bytes+=value.length*2;if(state.bytes>32*1024*1024)throw new Error('This save is too large for JSON backup. Use the game’s own export.');}return value;}
  if(state.seen.has(value))return {$ref:state.seen.get(value)};
  const id=state.next++;state.seen.set(value,id);
  let result;
  const type=Object.prototype.toString.call(value);
  const byteLength=value.byteLength || (type==='[object Blob]' || type==='[object File]'?value.size:0);state.bytes+=byteLength;if(state.bytes>32*1024*1024)throw new Error('This save is too large for JSON backup. Use the game’s own export.');
  if(type==='[object Date]')result={$type:'Date',value:value.toISOString()};
  else if(type==='[object ArrayBuffer]')result={$type:'ArrayBuffer',value:bytesTo64(new Uint8Array(value))};
  else if(ArrayBuffer.isView(value))result={$type:'View',name:value.constructor.name,value:bytesTo64(new Uint8Array(value.buffer,value.byteOffset,value.byteLength))};
  else if(type==='[object Blob]' || type==='[object File]')result={$type:'Blob',mime:value.type,value:bytesTo64(new Uint8Array(await value.arrayBuffer()))};
  else if(type==='[object Map]'){result={$type:'Map',value:[]};for(const [key,item]of value)result.value.push([await encodeSave(key,state),await encodeSave(item,state)]);}
  else if(type==='[object Set]'){result={$type:'Set',value:[]};for(const item of value)result.value.push(await encodeSave(item,state));}
  else if(Array.isArray(value)){result={$type:'Array',value:[]};for(const item of value)result.value.push(await encodeSave(item,state));}
  else {result={$type:'Object',value:{}};for(const [key,item] of Object.entries(value))Object.defineProperty(result.value,key,{value:await encodeSave(item,state),enumerable:true,configurable:true,writable:true});}
  result.$id=id;return result;
}
export function decodeSave(value,refs=new Map()) {
  if(!value || typeof value!=='object')return value;
  if(value.$ref!==undefined){if(!refs.has(value.$ref))throw new Error('Invalid save reference');return refs.get(value.$ref);}
  const registered=object=>{if(value.$id!==undefined)refs.set(value.$id,object);return object;};
  if(value.$type==='undefined')return undefined;
  if(value.$type==='bigint')return BigInt(value.value);
  if(value.$type==='Date')return registered(new Date(value.value));
  if(value.$type==='ArrayBuffer')return registered(from64(value.value).buffer);
  if(value.$type==='View'){const bytes=from64(value.value),types={Uint8Array,Int8Array,Uint8ClampedArray,Uint16Array,Int16Array,Uint32Array,Int32Array,Float32Array,Float64Array,BigInt64Array,BigUint64Array,DataView};const Type=types[value.name];if(!Type)throw new Error('Unsupported save buffer');return registered(new Type(bytes.buffer));}
  if(value.$type==='Blob')return registered(new Blob([from64(value.value)],{type:value.mime}));
  if(value.$type==='Map'){const map=registered(new Map());for(const [key,item]of value.value)map.set(decodeSave(key,refs),decodeSave(item,refs));return map;}
  if(value.$type==='Set'){const set=registered(new Set());for(const item of value.value)set.add(decodeSave(item,refs));return set;}
  if(value.$type==='Array'){const array=registered([]);for(const item of value.value)array.push(decodeSave(item,refs));return array;}
  if(Array.isArray(value))return value.map(item=>decodeSave(item,refs));
  const object=registered({});for(const [key,item] of Object.entries(value.$type==='Object'?value.value:value))Object.defineProperty(object,key,{value:decodeSave(item,refs),enumerable:true,configurable:true,writable:true});return object;
}
const result=request=>new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
async function database(factory,name,version){return result(version===undefined?factory.open(name):factory.open(name,version));}
export async function exportSaves(win,game){
  if(!win)throw new Error('Launch the game before exporting saves');
  const storage={};for(let i=0;i<win.localStorage.length;i++){const key=win.localStorage.key(i);storage[key]=win.localStorage.getItem(key);}
  const databases=[];
  if(win.indexedDB?.databases)for(const info of await win.indexedDB.databases()) {
    const db=await database(win.indexedDB,info.name),stores=[];
    try{for(const name of db.objectStoreNames){const transaction=db.transaction(name,'readonly'),store=transaction.objectStore(name),rows=[];await new Promise((resolve,reject)=>{const cursor=store.openCursor();cursor.onsuccess=()=>{const item=cursor.result;if(item){rows.push({key:item.key,value:item.value});item.continue();}else resolve();};cursor.onerror=()=>reject(cursor.error);});stores.push({name,keyPath:store.keyPath,autoIncrement:store.autoIncrement,indexes:[...store.indexNames].map(index=>{const item=store.index(index);return {name:index,keyPath:item.keyPath,unique:item.unique,multiEntry:item.multiEntry};}),rows:await encodeSave(rows)});}}finally{db.close();}databases.push({name:info.name,version:info.version,stores});
  }
  return {type:'playdeck-saves',version:1,game,createdAt:new Date().toISOString(),localStorage:storage,databases,indexedDBSupported:!!win.indexedDB?.databases};
}
export async function importSaves(win,value,game){
  if(value?.type!=='playdeck-saves' || value.version!==1 || value.game!==game || !value.localStorage || !Array.isArray(value.databases))throw new Error('Choose a save backup for this game');
  // Decode and validate everything before writing any data.
  const entries=value.databases.map(info=>({...info,stores:info.stores.map(store=>({...store,decoded:decodeSave(store.rows)}))}));
  for(const info of entries){if(typeof info.name!=='string' || !(info.version>=1))throw new Error('Invalid save database');for(const store of info.stores)if(typeof store.name!=='string' || !Array.isArray(store.decoded))throw new Error('Invalid save store');}
  for(const info of entries){const request=win.indexedDB.open(info.name,info.version);request.onupgradeneeded=()=>{const db=request.result;for(const spec of info.stores){if(!db.objectStoreNames.contains(spec.name)){const store=db.createObjectStore(spec.name,{keyPath:spec.keyPath,autoIncrement:spec.autoIncrement});for(const index of spec.indexes)store.createIndex(index.name,index.keyPath,{unique:index.unique,multiEntry:index.multiEntry});}}};const db=await result(request);try{await new Promise((resolve,reject)=>{const transaction=db.transaction(info.stores.map(store=>store.name),'readwrite');for(const spec of info.stores){const store=transaction.objectStore(spec.name);store.clear();for(const row of spec.decoded)spec.keyPath===null?store.put(row.value,row.key):store.put(row.value);}transaction.oncomplete=resolve;transaction.onerror=()=>reject(transaction.error);transaction.onabort=()=>reject(transaction.error);});}finally{db.close();}}
  for(const [key,item]of Object.entries(value.localStorage)){if(typeof item!=='string')throw new Error('Invalid local save');win.localStorage.setItem(key,item);}
}

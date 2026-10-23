export const downloadDefaults={textures:true,audio:true,video:true};
export function downloadOptions(value={}) {
  return Object.fromEntries(['textures','audio','video'].map(key=>[key,value?.[key]!==false]));
}

// Serialized into page and worker realms. Only an explicitly opted-in manifest
// may omit files; extensions, paths, hostnames and game names are never guessed.
export function selectDownloadManifest(manifest,preferences={}) {
  if(manifest?.playdeckDownloads?.version!==1 || !Array.isArray(manifest.files))return manifest;
  const keys=['textures','audio','video'];
  const choices=Object.fromEntries(keys.map(key=>[key,preferences[key]!==false]));
  // Custom loaders may explicitly select a manifest already handled by fetch.
  if(manifest.downloadSelection && keys.every(key=>manifest.downloadSelection.choices?.[key]===choices[key]))return manifest;
  const supported=keys.filter(key=>manifest.files.some(file=>file?.optional===true && file.category===key));
  // Invalid manifests are left to their own loader to validate.
  if(!manifest.files.every(file=>file && Number.isSafeInteger(file.size) && file.size>=0))return manifest;
  const originalBytes=manifest.files.reduce((sum,file)=>sum+file.size,0);
  if(!Number.isSafeInteger(originalBytes))return manifest;
  const files=manifest.files.filter(file=>!(file.optional===true && supported.includes(file.category) && !choices[file.category]));
  const totalBytes=files.reduce((sum,file)=>sum+file.size,0);
  if(!Number.isSafeInteger(totalBytes))return manifest;
  return {...manifest,files,totalBytes,downloadSelection:{choices,supported,omittedBytes:originalBytes-totalBytes}};
}

// Install before a game starts. JSON is changed only by the manifest contract.
export function installDownloadPolicy(context,selectManifest) {
  if(globalThis.PlaydeckDownloads)return;
  const preferences=Object.freeze({...context.downloads});
  globalThis.PlaydeckDownloads=Object.freeze({preferences,selectManifest:value=>selectManifest(value,preferences)});
  const nativeFetch=globalThis.fetch?.bind(globalThis);
  if(!nativeFetch)return;
  const decorate=response=>{
    const json=response.json.bind(response),clone=response.clone?.bind(response);
    response.json=async()=>{
      const selected=selectManifest(await json(),preferences);
      if(selected?.downloadSelection && typeof window!=='undefined')try{window.parent.postMessage({type:'playdeck:runtime',session:context.session,kind:'download-selection',...selected.downloadSelection},location.origin);}catch{}
      return selected;
    };
    if(clone)response.clone=()=>decorate(clone());
    return response;
  };
  globalThis.fetch=async(...args)=>decorate(await nativeFetch(...args));
}

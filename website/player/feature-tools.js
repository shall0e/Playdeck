import {canonicalGameURL} from './session.js';

export function requirementWarnings(requirements={},report={}) {
  const warnings=[];
  for(const [key,label] of [['webgl','WebGL'],['webgl2','WebGL 2'],['webgpu','WebGPU'],['sharedMemory','shared memory'],['isolated','cross-origin isolation']])
    if(requirements[key]===true && !report[key])warnings.push(label+' is required but unavailable.');
  if(Number(requirements.memoryGB)>0 && report.memoryGB && report.memoryGB<requirements.memoryGB)warnings.push('Reported device memory is below '+requirements.memoryGB+' GB.');
  return warnings;
}

export function offlineReadiness(gameURL,files,requested=[],failed=[]) {
  const saved=new Set(files.map(file=>canonicalGameURL(file.url).href));
  const launch=canonicalGameURL(new URL('/player/games/'+new URL(gameURL).host+new URL(gameURL).pathname+new URL(gameURL).search, 'https://playdeck.invalid')).pathname;
  const launchSaved=files.some(file=>canonicalGameURL(file.url).pathname===launch && !file.url.includes('__playdeck_range'));
  const missing=[...new Set([...requested,...failed].map(url=>canonicalGameURL(url).href))].filter(url=>!saved.has(url));
  return {launchSaved,missing,ready:launchSaved && !missing.length};
}

export function backgroundState(profile,{hidden=false,menu=false,manual=false}={}) {
  return {paused:manual || menu || (hidden && profile.pauseBackground),muted:!!profile.muted || (hidden && profile.muteBackground)};
}

export function buildLaunchLink(values,origin) {
  const game=new URL(values.url);
  if(game.protocol!=='https:' || game.username || game.password || game.port)throw new Error('Use a public HTTPS game URL');
  const url=new URL('/player/',origin);url.searchParams.set('url',game.href);
  for(const key of ['name','image'])if(values[key]){if(key==='image' && new URL(values[key]).protocol!=='https:')throw new Error('Cover images must use HTTPS');url.searchParams.set(key,values[key]);}
  for(const key of ['performance','ratio','toolbar'])if(values[key])url.searchParams.set(key,values[key]);
  if(values.graphics)for(const [key,value] of Object.entries(values.graphics))if(['renderScale','adaptive','reducedFiltering','engineOptimizations'].includes(key))url.searchParams.set(key,String(value));
  if(values.frameCap!==undefined){if(![0,15,30,45,60,75,90,105,120].includes(Number(values.frameCap)))throw new Error('Invalid frame cap');url.searchParams.set('frameCap',String(values.frameCap));}
  if(values.displayOptions!==undefined)url.searchParams.set('displayOptions',String(values.displayOptions));
  for(const key of ['nativeGamepad','forceController','hidePageExtras'])if(values[key]!==undefined)url.searchParams.set(key,String(values[key]));
  if(values.parentOrigin){const parent=new URL(values.parentOrigin);if(parent.href!==parent.origin+'/' || parent.username || parent.password || !['https:','http:'].includes(parent.protocol))throw new Error('Enter a parent origin without a path');url.searchParams.set('parentOrigin',parent.origin);}
  if(values.requirements && Object.keys(values.requirements).length)url.searchParams.set('requirements',JSON.stringify(values.requirements));
  return url;
}

export function loadProgress({active=0,received=0,url='',localHits=0,pageLoaded=false,elapsed=1}={}) {
  return {stage:active>0?'Downloading':pageLoaded?'Starting':'Waiting for interaction',received,rate:received/Math.max(1,elapsed),localHits,file:url?new URL(url).pathname.split('/').pop():''};
}

export function recentShortcuts(entries,origin) {
  return entries.filter(entry=>entry.url).sort((a,b)=>(b.lastUsed || 0)-(a.lastUsed || 0)).slice(0,4).map(entry=>({name:String(entry.title || 'Game').slice(0,60),short_name:String(entry.title || 'Game').slice(0,20),url:buildLaunchLink({url:entry.url,name:entry.title},origin).href,icons:[{src:'/player/icon.svg',sizes:'any',type:'image/svg+xml'}]}));
}

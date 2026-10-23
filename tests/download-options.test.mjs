import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {downloadOptions,selectDownloadManifest,installDownloadPolicy} from '../website/player/download-options.js';
import {createSession,proxyContext,canonicalGameURL} from '../website/player/session.js';
import {validateProfile} from '../website/player/profiles.js';
import {bootstrap} from '../website/player/proxy-core.js';

const manifest={version:'content-hash',playdeckDownloads:{version:1},totalBytes:160,files:[
  {path:'required-textures.zip',size:100,category:'textures'},
  {path:'opaque-a',size:30,category:'textures',optional:true},
  {path:'opaque-b',size:20,category:'audio',optional:true},
  {path:'opaque-c',size:10,category:'video',optional:true},
]};
test('defaults preserve all downloads, profiles normalize choices and routes carry them without changing cache keys',()=>{
  assert.deepEqual(downloadOptions(),{textures:true,audio:true,video:true});
  const downloads=validateProfile({downloads:{textures:false,video:false,audio:'false'}}).downloads;
  assert.deepEqual(downloads,{textures:false,audio:true,video:false});
  const session=createSession('https://any.example/', 'auto',{},60,{},downloads),context=proxyContext(session.prefix+'any.example/');
  assert.deepEqual(context.downloads,downloads);assert.equal(context.prefix,session.prefix);
  assert.equal(canonicalGameURL('https://player.example'+session.prefix+'any.example/a').href,'https://player.example/player/games/any.example/a');
  assert.deepEqual(proxyContext('/player/games/.launch/12345678/full/111/abc/gfx-100-111/any.example/').downloads,downloadOptions());
});
test('omits only declared optional categories and preserves manifest identity, hashes and required textures',()=>{
  const original=JSON.stringify(manifest),result=selectDownloadManifest(manifest,{textures:false,audio:false,video:false});
  assert.deepEqual(result.files,[manifest.files[0]]);assert.equal(result.totalBytes,100);assert.equal(result.downloadSelection.omittedBytes,60);
  assert.equal(result.version,manifest.version);assert.equal(result.files[0],manifest.files[0]);assert.equal(JSON.stringify(manifest),original);
  const video=selectDownloadManifest(manifest,{video:false});assert.equal(video.totalBytes,150);assert.equal(video.files.length,3);
  assert.equal(selectDownloadManifest(manifest).totalBytes,160);
  assert.equal(selectDownloadManifest(video,{video:false}),video,'Explicit custom-loader selection must be idempotent');
});
test('unknown schemas, undeclared files, unsafe sizes and unrelated JSON remain untouched',()=>{
  for(const value of [null,{},[],{...manifest,playdeckDownloads:undefined},{...manifest,playdeckDownloads:{version:2}},{...manifest,files:[{size:-1,optional:true,category:'video'}]},{...manifest,files:[{size:Number.MAX_SAFE_INTEGER},{size:1,optional:true,category:'video'}]}])assert.equal(selectDownloadManifest(value,{video:false}),value);
  const result=selectDownloadManifest({...manifest,files:[{path:'movie.bik',size:1},{path:'unknown',size:2,optional:true,category:'maps'}]},{video:false});
  assert.equal(result.files.length,2);
});
test('serialized policy applies to fetch and cloned responses in window and worker realms without altering bytes',async()=>{
  for(const windowRealm of [false,true]) {
    const messages=[],realm=vm.createContext({fetch:async()=>Response.json(manifest),...(windowRealm?{window:{parent:{postMessage:value=>messages.push(value)}},location:{origin:'https://player.example'}}:{})});
    vm.runInContext('('+installDownloadPolicy.toString()+')({session:"test-session",downloads:{video:false}},'+selectDownloadManifest.toString()+')',realm);
    const response=await realm.fetch('any.json'),clone=response.clone();assert.equal((await response.json()).totalBytes,150);assert.equal((await clone.json()).totalBytes,150);
    assert.equal(messages.length,windowRealm?2:0);
    assert.equal((await (await realm.fetch('any.json')).text()),JSON.stringify(manifest));
  }
});
test('page, direct worker and blob worker bootstraps include the same download policy',()=>{
  const session=createSession('https://any.example/','full',{},0,{}, {video:false});
  for(const worker of [true,false]){const source=bootstrap('https://any.example/','https://player.example',worker,session.prefix);assert(source.includes('selectDownloadManifest'));assert(source.includes('installDownloadPolicy'));assert(source.includes('dl-110'));new vm.Script(worker?source:source.replace(/^<script[^>]*>/,'').replace(/<\/script>$/,''));}
});

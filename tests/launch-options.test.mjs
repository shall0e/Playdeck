import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../website/_worker.js';
import {readLaunchOptions} from '../website/player/launch-options.js';
test('URL flags, encoded game URLs and independent launcher origins work',()=>{
  const options=readLaunchOptions(new URLSearchParams('url=https%3A%2F%2Fgame.example%2F%3Fx%3D1%26y%3D2&displayOptions&forceController&nativeGamepad=false&performance=fast&toolbar=visible&ratio=4%3A3&parentOrigin=https%3A%2F%2Fother-launcher.example'));
  assert.equal(options.displayOptions,true);assert.equal(options.forceController,true);assert.equal(options.nativeGamepad,false);assert.equal(options.performance,'fast');assert.equal(options.parentOrigin,'https://other-launcher.example');
  assert.equal(readLaunchOptions(new URLSearchParams(),'https://launcher.example/catalog').parentOrigin,'https://launcher.example');
  assert.equal(readLaunchOptions(new URLSearchParams('displayOptions=false')).displayOptions,false);
});
test('invalid options and non-origin parent values are rejected',()=>{
  for(const value of ['performance=bogus','nativeGamepad=yes','ratio=3%3A2','displayOptions=%7B%22ratios%22%3A%5B%22bogus%22%5D%7D','parentOrigin=https%3A%2F%2Flauncher.example%2Fpath','parentOrigin=javascript%3Aalert(1)'])assert.throws(()=>readLaunchOptions(new URLSearchParams(value)));
});
test('custom-domain instances proxy assets and reject their own origin',async()=>{
  const previous=globalThis.fetch;globalThis.fetch=async()=>new Response('asset',{headers:{'content-type':'application/octet-stream'}});
  try {
    assert.equal(await (await worker.fetch(new Request('https://my-player.example/player/games/assets.example/a.bin'),{})).text(),'asset');
    assert.equal((await worker.fetch(new Request('https://my-player.example/player/games/my-player.example/a.bin'),{})).status,403);
  }finally{globalThis.fetch=previous;}
});

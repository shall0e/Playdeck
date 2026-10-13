import test from 'node:test';
import assert from 'node:assert/strict';
import {proxyOutgoingGameRequest,gameRequestClient,recoverGameRequest} from '../website/player/session.js';

const origin='https://playdeck-1z1.pages.dev';
const game=origin+'/player/games/.launch/12345678-abcd/full/101/gameid/zombies.mdelworkstation.cc/';
const source='https://zombies.mdelworkstation.cc/packs/zm_transit/dist/manifest.json?version=2';

test('direct game-origin requests use the local-first player proxy',async()=>{
  const outgoing=new Request(source,{method:'POST',body:'payload',headers:{'Content-Type':'text/plain'}});
  const routed=proxyOutgoingGameRequest(outgoing,game+'index.html',origin);
  assert.equal(routed.url,game+'zombies.mdelworkstation.cc/packs/zm_transit/dist/manifest.json?version=2');
  assert.equal(routed.method,'POST');
  assert.equal(await routed.text(),'payload');
  assert.equal(routed.headers.get('Content-Type'),'text/plain');
  assert.equal(proxyOutgoingGameRequest(new Request(source),origin+'/player/',origin).url,source);
  assert.equal(proxyOutgoingGameRequest(new Request(origin+'/player/boot.js'),game,origin).url,origin+'/player/boot.js');
  assert.equal(proxyOutgoingGameRequest(new Request('http://game.example/asset.bin'),game,origin).url,'http://game.example/asset.bin');
});

test('blob workers only inherit an unambiguous active game route',()=>{
  const other=origin+'/player/games/.launch/98765432-abcd/full/101/anotherid/another.example/';
  const workerURL='blob:'+origin+'/worker-blob';
  assert.equal(gameRequestClient(workerURL,[game]),game);
  assert.equal(gameRequestClient(workerURL,[game,game+'index.html']),game);
  assert.equal(gameRequestClient(workerURL,[game,other]),workerURL);
  const selected=gameRequestClient(workerURL,[game]);
  assert.equal(recoverGameRequest(new Request(origin+'/packs/zm_transit/dist/manifest.json'),[selected]).url,
    game+'zombies.mdelworkstation.cc/packs/zm_transit/dist/manifest.json');
});

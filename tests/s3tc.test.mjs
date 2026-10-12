import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { decodeS3TC, installS3TC } from '../website/player/s3tc.js';
import { bootstrap, rewriteJS, s3tcBootstrap } from '../website/_worker.js';
const rgb = 0x83f0,
  rgba = 0x83f1,
  dxt3 = 0x83f2,
  dxt5 = 0x83f3;
const red = new Uint8Array([0, 248, 31, 0, 0, 0, 0, 0]);
test('BC1 decodes colors, partial edge blocks, transparent and opaque variants', () => {
  const result = decodeS3TC(red, 3, 2, rgb);
  assert.equal(result.length, 24);
  for (let p = 0; p < 6; p++)
    assert.deepEqual([...result.slice(p * 4, p * 4 + 4)], [255, 0, 0, 255]);
  const transparent = new Uint8Array([0, 0, 255, 255, 255, 255, 255, 255]);
  assert.deepEqual([...decodeS3TC(transparent, 1, 1, rgba)], [0, 0, 0, 0]);
  assert.deepEqual([...decodeS3TC(transparent, 1, 1, rgb)], [0, 0, 0, 255]);
});
test('BC2 alpha nibbles and BC3 alpha interpolation decode correctly', () => {
  const bc2 = new Uint8Array(16);
  bc2.set(red, 8);
  bc2[0] = 0x81;
  const r = decodeS3TC(bc2, 2, 1, dxt3);
  assert.equal(r[3], 17);
  assert.equal(r[7], 136);
  const bc3 = new Uint8Array(16);
  bc3.set(red, 8);
  bc3[0] = 255;
  bc3[1] = 0;
  bc3[2] = 2;
  assert.equal(decodeS3TC(bc3, 1, 1, dxt5)[3], 218);
  bc3[0] = 0;
  bc3[1] = 128;
  bc3[2] = 7;
  assert.equal(decodeS3TC(bc3, 1, 1, dxt5)[3], 255);
});
test('decoder handles texture-array layers and rejects truncated blocks', () => {
  const layers = new Uint8Array(16);
  layers.set(red);
  layers.set([31, 0, 0, 248, 0, 0, 0, 0], 8);
  const r = decodeS3TC(layers, 1, 1, rgb, 2);
  assert.deepEqual([...r], [255, 0, 0, 255, 0, 0, 255, 255]);
  assert.throws(() => decodeS3TC(new Uint8Array(7), 4, 4, rgb), /Incomplete/);
});
function context(native = false) {
  class GL {
    calls = [];
    buffer = null;
    getExtension() {
      return native ? { native: true } : null;
    }
    getSupportedExtensions() {
      return native ? ['WEBGL_compressed_texture_s3tc'] : [];
    }
    getParameter(name) {
      return name === 0x86a3 ? new Uint32Array() : this.buffer;
    }
    compressedTexImage2D(...a) {
      this.calls.push(['compressed', ...a]);
    }
    compressedTexSubImage2D(...a) {
      this.calls.push(['compressed-sub', ...a]);
    }
    compressedTexImage3D(...a) {
      this.calls.push(['compressed-3d', ...a]);
    }
    compressedTexSubImage3D(...a) {
      this.calls.push(['compressed-sub-3d', ...a]);
    }
    texImage2D(...a) {
      this.calls.push(['rgba', ...a]);
    }
    texSubImage2D(...a) {
      this.calls.push(['rgba-sub', ...a]);
    }
    texImage3D(...a) {
      this.calls.push(['rgba-3d', ...a]);
    }
    texSubImage3D(...a) {
      this.calls.push(['rgba-sub-3d', ...a]);
    }
    texStorage2D(...a) {
      this.calls.push(['storage', ...a]);
    }
    getBufferSubData(target, offset, out) {
      out.set(red);
    }
    bindBuffer(target, buffer) {
      this.buffer = buffer;
    }
  }
  const c = vm.createContext({ WebGL2RenderingContext: GL, decode: decodeS3TC });
  vm.runInContext('(' + installS3TC.toString() + ')(decode)', c);
  return new GL();
}
test('fallback advertises only formats it decodes and performs real RGBA uploads', () => {
  const gl = context();
  assert.equal(gl.getExtension('WEBGL_compressed_texture_s3tc').COMPRESSED_RGB_S3TC_DXT1_EXT, rgb);
  assert.ok(gl.getSupportedExtensions().includes('WEBGL_compressed_texture_s3tc'));
  assert.ok([...gl.getParameter(0x86a3)].includes(dxt5));
  const padded = new Uint8Array(12);
  padded.set(red, 4);
  gl.compressedTexImage2D(0xde1, 0, rgb, 1, 1, 0, padded, 4, 8);
  assert.equal(gl.calls[0][0], 'rgba');
  assert.equal(gl.calls[0][3], 0x8058);
  assert.deepEqual([...gl.calls[0].at(-1)], [255, 0, 0, 255]);
  gl.compressedTexSubImage2D(0xde1, 0, 0, 0, 1, 1, rgb, red);
  assert.equal(gl.calls[1][0], 'rgba-sub');
  gl.compressedTexImage3D(0x8c1a, 0, rgb, 1, 1, 1, 0, red);
  assert.equal(gl.calls[2][0], 'rgba-3d');
  gl.texStorage2D(0xde1, 1, rgb, 1, 1);
  assert.equal(gl.calls[3][3], 0x8058);
});
test('pixel-unpack-buffer uploads decode their bytes and restore buffer binding', () => {
  const gl = context(),
    buffer = {};
  gl.buffer = buffer;
  gl.compressedTexImage2D(0xde1, 0, rgb, 1, 1, 0, 8, 0);
  assert.equal(gl.calls[0][0], 'rgba');
  assert.equal(gl.buffer, buffer);
});
test('native S3TC support keeps native compressed upload paths', () => {
  const gl = context(true);
  assert.equal(gl.getExtension('WEBGL_compressed_texture_s3tc').native, true);
  gl.compressedTexImage2D(0xde1, 0, rgb, 1, 1, 0, red);
  assert.equal(gl.calls[0][0], 'compressed');
});
test('compatibility installs in both the page and the engine module worker realm', () => {
  assert.ok(
    bootstrap(
      'https://vel.gg/bo1z',
      'https://playdeck-1z1.pages.dev',
      false,
      '/player/games/',
    ).includes('installS3TC'),
  );
  assert.ok(
    rewriteJS(
      'export default 1',
      'https://vel.gg/bo1z/artifacts/KisakBlack-web.mjs',
      'https://playdeck-1z1.pages.dev',
      '/player/games/',
    ).includes('installS3TC'),
  );
});
test('serialized deployment functions can call the build name helper without game bindings', () => {
  const saved = Object.getOwnPropertyDescriptor(installS3TC, 'toString');
  Object.defineProperty(installS3TC, 'toString', {
    configurable: true,
    value: () =>
      `function installS3TC(decode){const run=__name(()=>{globalThis.installed=true},'run');run();}`,
  });
  try {
    const c = vm.createContext({});
    vm.runInContext(
      "const __name='game-owned';" +
        s3tcBootstrap('https://vel.gg/bo1z/artifacts/KisakBlack-web.mjs', '/player/games/'),
      c,
    );
    assert.equal(c.installed, true);
    assert.equal(vm.runInContext('__name', c), 'game-owned');
    const page = vm.createContext({
      URL,
      Request,
      navigator: { userAgent: 'Android' },
      fetch: () => Promise.resolve(),
    });
    vm.runInContext(
      bootstrap('https://vel.gg/bo1z', 'https://playdeck-1z1.pages.dev', true, '/player/games/'),
      page,
    );
    assert.equal(page.installed, true);
    assert.equal(page.navigator.userAgent, 'Android');
  } finally {
    if (saved) Object.defineProperty(installS3TC, 'toString', saved);
    else delete installS3TC.toString;
  }
});

test('texture fallback is available globally without a game host list', () => {
  for (const host of ['https://game.example/', 'https://other.example/']) {
    assert.ok(
      bootstrap(host, 'https://playdeck-1z1.pages.dev', true, '/player/games/').includes(
        'installS3TC',
      ),
    );
  }
});
test('decoder can reuse scratch without returning bytes outside the texture', () => {
  const scratch = new Uint8Array(128).fill(99),
    pixels = decodeS3TC(red, 1, 1, rgb, 1, scratch);
  assert.equal(pixels.length, 4);
  assert.equal(pixels.buffer, scratch.buffer);
  assert.deepEqual([...pixels], [255, 0, 0, 255]);
  assert.equal(scratch[4], 99);
});

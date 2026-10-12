// Allocation-bounded BC1/BC2/BC3 decoder. Palette scratch is reused per call.
export function decodeS3TC(data, width, height, format, depth = 1, scratch) {
  if (![0x83f0, 0x83f1, 0x83f2, 0x83f3].includes(format))
    throw new RangeError('Unsupported S3TC format');
  if (![width, height, depth].every((n) => Number.isInteger(n) && n > 0))
    throw new RangeError('Invalid texture dimensions');
  const bytes = ArrayBuffer.isView(data)
    ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    : new Uint8Array(data);
  const bc1 = format === 0x83f0 || format === 0x83f1,
    size = bc1 ? 8 : 16;
  const bx = Math.ceil(width / 4),
    by = Math.ceil(height / 4),
    length = width * height * depth * 4;
  if (bytes.length < bx * by * depth * size) throw new RangeError('Incomplete S3TC texture');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = scratch?.length >= length ? scratch.subarray(0, length) : new Uint8Array(length);
  const palette = new Uint8Array(16),
    alpha = new Uint8Array(8),
    five = new Uint8Array(32),
    six = new Uint8Array(64);
  for (let i = 0; i < 32; i++) five[i] = Math.round((i * 255) / 31);
  for (let i = 0; i < 64; i++) six[i] = Math.round((i * 255) / 63);
  let offset = 0;
  for (let z = 0; z < depth; z++)
    for (let y = 0; y < by; y++)
      for (let x = 0; x < bx; x++, offset += size) {
        const colorsAt = offset + (bc1 ? 0 : 8),
          a = view.getUint16(colorsAt, true),
          b = view.getUint16(colorsAt + 2, true);
        palette[0] = five[a >>> 11];
        palette[1] = six[(a >>> 5) & 63];
        palette[2] = five[a & 31];
        palette[3] = 255;
        palette[4] = five[b >>> 11];
        palette[5] = six[(b >>> 5) & 63];
        palette[6] = five[b & 31];
        palette[7] = 255;
        if (bc1 && a <= b) {
          for (let k = 0; k < 3; k++) {
            palette[8 + k] = (palette[k] + palette[4 + k]) >> 1;
            palette[12 + k] = 0;
          }
          palette[11] = 255;
          palette[15] = format === 0x83f1 ? 0 : 255;
        } else {
          for (let k = 0; k < 3; k++) {
            palette[8 + k] = Math.floor((2 * palette[k] + palette[4 + k]) / 3);
            palette[12 + k] = Math.floor((palette[k] + 2 * palette[4 + k]) / 3);
          }
          palette[11] = palette[15] = 255;
        }
        const indices = view.getUint32(colorsAt + 4, true);
        let alphaLow = 0,
          alphaHigh = 0;
        if (format === 0x83f3) {
          alpha[0] = bytes[offset];
          alpha[1] = bytes[offset + 1];
          alphaLow = bytes[offset + 2] | (bytes[offset + 3] << 8) | (bytes[offset + 4] << 16);
          alphaHigh = bytes[offset + 5] | (bytes[offset + 6] << 8) | (bytes[offset + 7] << 16);
          if (alpha[0] > alpha[1])
            for (let k = 1; k <= 6; k++)
              alpha[k + 1] = Math.floor(((7 - k) * alpha[0] + k * alpha[1]) / 7);
          else {
            for (let k = 1; k <= 4; k++)
              alpha[k + 1] = Math.floor(((5 - k) * alpha[0] + k * alpha[1]) / 5);
            alpha[6] = 0;
            alpha[7] = 255;
          }
        }
        for (let p = 0; p < 16; p++) {
          const px = x * 4 + (p & 3),
            py = y * 4 + (p >>> 2);
          if (px >= width || py >= height) continue;
          const dest = ((z * height + py) * width + px) * 4,
            c = ((indices >>> (2 * p)) & 3) * 4;
          out[dest] = palette[c];
          out[dest + 1] = palette[c + 1];
          out[dest + 2] = palette[c + 2];
          out[dest + 3] = palette[c + 3];
          if (format === 0x83f2)
            out[dest + 3] = ((bytes[offset + (p >>> 1)] >>> ((p & 1) * 4)) & 15) * 17;
          if (format === 0x83f3)
            out[dest + 3] = alpha[((p < 8 ? alphaLow : alphaHigh) >>> ((p & 7) * 3)) & 7];
        }
      }
  return out;
}

export function installS3TC(decode) {
  const formats = [0x83f0, 0x83f1, 0x83f2, 0x83f3];
  const extension = {
    COMPRESSED_RGB_S3TC_DXT1_EXT: formats[0],
    COMPRESSED_RGBA_S3TC_DXT1_EXT: formats[1],
    COMPRESSED_RGBA_S3TC_DXT3_EXT: formats[2],
    COMPRESSED_RGBA_S3TC_DXT5_EXT: formats[3],
  };
  function patch(proto) {
    if (!proto?.getExtension || Object.hasOwn(proto, '__timebombS3TC')) return;
    Object.defineProperty(proto, '__timebombS3TC', { value: true });
    const nativeExtension = proto.getExtension,
      nativeParameter = proto.getParameter,
      nativeSupported = proto.getSupportedExtensions;
    const states = new WeakMap(),
      scratchBuffers = new WeakMap();
    const emulate = (gl) => {
      if (!states.has(gl))
        states.set(gl, !nativeExtension.call(gl, 'WEBGL_compressed_texture_s3tc'));
      return states.get(gl);
    };
    proto.getExtension = function (name) {
      if (/^(?:WEBKIT_|MOZ_)?WEBGL_compressed_texture_s3tc$/i.test(name) && emulate(this))
        return extension;
      return nativeExtension.call(this, name);
    };
    if (nativeSupported)
      proto.getSupportedExtensions = function () {
        const result = nativeSupported.call(this);
        return result && emulate(this)
          ? [...new Set([...result, 'WEBGL_compressed_texture_s3tc'])]
          : result;
      };
    proto.getParameter = function (name) {
      const result = nativeParameter.call(this, name);
      return name === 0x86a3 && result && emulate(this)
        ? new Uint32Array([...new Set([...result, ...formats])])
        : result;
    };
    for (const name of ['texStorage2D', 'texStorage3D']) {
      const native = proto[name];
      if (native)
        proto[name] = function (...args) {
          if (formats.includes(args[2]) && emulate(this)) args[2] = 0x8058;
          return native.apply(this, args);
        };
    }
    for (const [name, formatAt, dataAt, widthAt, heightAt, depthAt] of [
      ['compressedTexImage2D', 2, 6, 3, 4, null],
      ['compressedTexSubImage2D', 6, 7, 4, 5, null],
      ['compressedTexImage3D', 2, 7, 3, 4, 5],
      ['compressedTexSubImage3D', 8, 9, 5, 6, 7],
    ]) {
      const native = proto[name];
      if (!native) continue;
      proto[name] = function (...args) {
        const format = args[formatAt];
        if (!formats.includes(format) || !emulate(this)) return native.apply(this, args);
        const w = args[widthAt],
          h = args[heightAt],
          d = depthAt === null ? 1 : args[depthAt],
          source = args[dataAt];
        let data,
          buffer = null;
        if (typeof source === 'number') {
          // WebGL2 pixel-unpack-buffer overload: read compressed bytes first.
          data = new Uint8Array(source);
          buffer = nativeParameter.call(this, 0x88ef);
          this.getBufferSubData(0x88ec, args[dataAt + 1] || 0, data);
        } else {
          const unit = source.BYTES_PER_ELEMENT || 1,
            start = (args[dataAt + 1] || 0) * unit;
          const length = args[dataAt + 2] ? args[dataAt + 2] * unit : source.byteLength - start;
          data = ArrayBuffer.isView(source)
            ? new Uint8Array(source.buffer, source.byteOffset + start, length)
            : new Uint8Array(source, start, length);
        }
        const length = w * h * d * 4;
        let scratch = scratchBuffers.get(this);
        // TexImage copies CPU bytes synchronously. Keep at most 8 MiB per context.
        if (length <= 8 * 1024 * 1024 && (!scratch || scratch.length < length)) {
          scratch = new Uint8Array(length);
          scratchBuffers.set(this, scratch);
        }
        const pixels = decode(data, w, h, format, d, scratch);
        if (buffer) this.bindBuffer(0x88ec, null);
        try {
          const rgba = 0x1908,
            type = 0x1401,
            internal = this.texImage3D ? 0x8058 : rgba;
          if (name === 'compressedTexImage2D')
            return this.texImage2D(args[0], args[1], internal, w, h, args[5], rgba, type, pixels);
          if (name === 'compressedTexSubImage2D')
            return this.texSubImage2D(args[0], args[1], args[2], args[3], w, h, rgba, type, pixels);
          if (name === 'compressedTexImage3D')
            return this.texImage3D(
              args[0],
              args[1],
              internal,
              w,
              h,
              d,
              args[6],
              rgba,
              type,
              pixels,
            );
          return this.texSubImage3D(
            args[0],
            args[1],
            args[2],
            args[3],
            args[4],
            w,
            h,
            d,
            rgba,
            type,
            pixels,
          );
        } finally {
          if (buffer) this.bindBuffer(0x88ec, buffer);
        }
      };
    }
  }
  for (const name of ['WebGLRenderingContext', 'WebGL2RenderingContext'])
    patch(globalThis[name]?.prototype);
  // Some workers expose WebGL only through OffscreenCanvas.getContext().
  for (const name of ['HTMLCanvasElement', 'OffscreenCanvas']) {
    const proto = globalThis[name]?.prototype;
    if (!proto || Object.hasOwn(proto, '__timebombS3TCCanvas')) continue;
    Object.defineProperty(proto, '__timebombS3TCCanvas', { value: true });
    const native = proto.getContext;
    proto.getContext = function (...args) {
      const context = native.apply(this, args);
      if (context && /^(webgl2?|experimental-webgl)$/.test(args[0]))
        patch(Object.getPrototypeOf(context));
      return context;
    };
  }
}

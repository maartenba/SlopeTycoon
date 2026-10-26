import { describe, expect, it } from 'vitest';
import { base64ToBytes, bytesToBase64, crc32, decodeBytes, encodeBytes, getCompressor, pack, packTyped, setCompressor, unpack, unpackTyped } from '../../src/persist/codec';
import { gunzipSync, gzipSync } from 'node:zlib';

describe('codec', () => {
  it('base64 round trips arbitrary bytes', () => {
    const b = Uint8Array.from({ length: 70000 }, (_, i) => (i * 31) & 255);
    expect(base64ToBytes(bytesToBase64(b))).toEqual(b);
  });
  it('typed arrays round trip in raw / delta / sparse encodings', () => {
    const smooth = Int16Array.from({ length: 5000 }, (_, i) => Math.round(40 + 30 * Math.sin(i / 50)));
    const wrapping = Int16Array.from([32767, -32768, 32767, 0, -5, 32000, -32000, ...Array.from({ length: 80 }, (_, i) => i * 400 - 16000)]);
    const sparse = new Uint8Array(10000); sparse[5] = 3; sparse[9999] = 255; sparse[4000] = 1;
    const f32 = Float32Array.from({ length: 300 }, (_, i) => i * 0.37 - 4);
    const f32sparse = new Float32Array(1000); f32sparse[10] = 1.5; f32sparse[999] = -0.25;
    const u32 = Uint32Array.from({ length: 100 }, (_, i) => i * 40000000);
    for (const a of [smooth, wrapping, sparse, f32, f32sparse, u32, new Uint8Array(0), new Float64Array([NaN, 1, 2])]) {
      const p = packTyped(a);
      const r = unpackTyped(JSON.parse(JSON.stringify(p)));
      expect(r.constructor).toBe(a.constructor);
      expect(Array.from(r as ArrayLike<number>)).toEqual(Array.from(a as ArrayLike<number>));
    }
    expect(packTyped(sparse).e).toBe('sparse');
    expect(packTyped(smooth).e).toBe('delta');
    expect(JSON.stringify(packTyped(sparse)).length).toBeLessThan(200);
  });
  it('pack/unpack handles nested objects, long number arrays (int + float) and leaves short ones alone', () => {
    const v = { a: new Uint8Array([1, 2, 3]), long: Array.from({ length: 100 }, (_, i) => i - 50), floats: Array.from({ length: 50 }, (_, i) => i / 7), short: [1, 2, 3], s: 'x', n: null, nested: { f: new Float32Array(100).fill(1.25) } };
    const r = unpack(JSON.parse(JSON.stringify(pack(v)))) as typeof v;
    expect(r.a).toEqual(v.a); expect(r.long).toEqual(v.long); expect(r.floats).toEqual(v.floats); expect(r.short).toEqual([1, 2, 3]);
    expect(r.nested.f).toEqual(v.nested.f); expect(r.s).toBe('x'); expect(r.n).toBeNull();
  });
  it('crc32 matches the standard check value and is sensitive', () => {
    expect(crc32('123456789')).toBe(0xcbf43926);
    expect(crc32('abc')).not.toBe(crc32('abd'));
    expect(crc32('héllo ☃')).toBe(crc32('héllo ☃'));
  });
  it('gzip via CompressionStream, via an injected Node-zlib compressor, and uncompressed fallback all round trip', async () => {
    const text = JSON.stringify({ k: 'x'.repeat(20000) });
    const native = await encodeBytes(text);
    if (getCompressor()) expect(native.length).toBeLessThan(text.length / 10);
    expect(await decodeBytes(native)).toBe(text);
    setCompressor({ gzip: async (b) => new Uint8Array(gzipSync(b)), gunzip: async (b) => new Uint8Array(gunzipSync(b)) });
    try { const z = await encodeBytes(text); expect(z[0]).toBe(0x1f); expect(await decodeBytes(z)).toBe(text); } finally { setCompressor(undefined); }
    setCompressor(null);
    try {
      const plain = await encodeBytes(text);
      expect(plain.length).toBe(text.length);
      expect(await decodeBytes(plain)).toBe(text);
      await expect(decodeBytes(native)).rejects.toThrow(/gzip/); // compressed save on a platform without gzip: clear error
    } finally { setCompressor(undefined); }
  });
});

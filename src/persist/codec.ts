/**
 * Save codec (Task 33): typed arrays <-> compact JSON-safe values (base64, delta, sparse), CRC32, gzip.
 * Pure functions, no DOM; works in browsers and Node 18+ (btoa/atob, CompressionStream when present).
 * Assumes a little-endian host (every browser / Node target we support).
 */

type TypedArray = Int8Array | Uint8Array | Int16Array | Uint16Array | Int32Array | Uint32Array | Float32Array | Float64Array;
const KINDS = {
  i8: Int8Array, u8: Uint8Array, i16: Int16Array, u16: Uint16Array, i32: Int32Array, u32: Uint32Array, f32: Float32Array, f64: Float64Array,
} as const;
export type TypedKind = keyof typeof KINDS;

const kindOf = (a: unknown): TypedKind | null => {
  if (a instanceof Uint8Array) return 'u8';
  if (a instanceof Int8Array) return 'i8';
  if (a instanceof Int16Array) return 'i16';
  if (a instanceof Uint16Array) return 'u16';
  if (a instanceof Int32Array) return 'i32';
  if (a instanceof Uint32Array) return 'u32';
  if (a instanceof Float32Array) return 'f32';
  if (a instanceof Float64Array) return 'f64';
  return null;
};

// ---------------------------------------------------------------- base64
export function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function base64ToBytes(b64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') { const b = Buffer.from(b64, 'base64'); return new Uint8Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); }
  const s = atob(b64), out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
const bytesOf = (a: TypedArray): Uint8Array => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
function fromBytes<K extends TypedKind>(kind: K, bytes: Uint8Array, n: number): InstanceType<(typeof KINDS)[K]> {
  const Ctor = KINDS[kind] as unknown as new (b: ArrayBuffer, o: number, l: number) => InstanceType<(typeof KINDS)[K]>;
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new Ctor(copy, 0, n);
}

// ---------------------------------------------------------------- value packing
export interface PackedArray { $t: TypedKind; n: number; e: 'raw' | 'delta' | 'sparse'; d: string; i?: string }
const isPacked = (v: unknown): v is PackedArray => !!v && typeof v === 'object' && '$t' in (v as object) && 'n' in (v as object) && 'e' in (v as object);

/** Encode one typed array: sparse (mostly zeros), delta (smooth Int16/Int32 like heights) or raw. */
export function packTyped(a: TypedArray): PackedArray {
  const k = kindOf(a)!;
  let nz = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== 0) nz++;
  if (a.length >= 64 && nz < a.length * 0.2) {
    const idx = new Uint32Array(nz), vals = new (KINDS[k] as unknown as new (n: number) => TypedArray)(nz);
    let p = 0, prev = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== 0) { idx[p] = i - prev; prev = i; vals[p++] = a[i]!; }
    return { $t: k, n: a.length, e: 'sparse', i: bytesToBase64(bytesOf(idx)), d: bytesToBase64(bytesOf(vals)) };
  }
  if ((k === 'i16' || k === 'i32') && a.length >= 64) {
    const d = new (KINDS[k] as unknown as new (n: number) => TypedArray)(a.length);
    let prev = 0;
    for (let i = 0; i < a.length; i++) { d[i] = (a[i]! - prev) as number; prev = a[i]!; }
    // Wrapping arithmetic on Int16/32 stays reversible, so no range check is needed.
    return { $t: k, n: a.length, e: 'delta', d: bytesToBase64(bytesOf(d)) };
  }
  return { $t: k, n: a.length, e: 'raw', d: bytesToBase64(bytesOf(a)) };
}

export function unpackTyped(p: PackedArray): TypedArray {
  const Ctor = KINDS[p.$t] as unknown as new (n: number) => TypedArray;
  if (p.e === 'raw') return fromBytes(p.$t, base64ToBytes(p.d), p.n);
  if (p.e === 'delta') {
    const d = fromBytes(p.$t, base64ToBytes(p.d), p.n) as unknown as Int16Array;
    const out = d; let prev = 0;
    for (let i = 0; i < out.length; i++) { out[i] = prev + out[i]!; prev = out[i]!; }
    return out;
  }
  const out = new Ctor(p.n);
  const idxBytes = base64ToBytes(p.i!), idx = fromBytes('u32', idxBytes, idxBytes.byteLength / 4);
  const vb = base64ToBytes(p.d), vals = fromBytes(p.$t, vb, idx.length);
  let pos = 0;
  for (let j = 0; j < idx.length; j++) { pos += idx[j]!; out[pos] = vals[j]!; }
  return out;
}

const MIN_PACK = 24;
/** Make any JSON-ish value stringify-safe and compact: typed arrays + long number arrays become base64 blocks. */
export function pack(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v;
  const k = kindOf(v);
  if (k) return packTyped(v as TypedArray);
  if (Array.isArray(v)) {
    if (v.length >= MIN_PACK && v.every((x) => typeof x === 'number')) {
      let int = true;
      for (const x of v as number[]) if (!Number.isInteger(x) || x < -2147483648 || x > 2147483647) { int = false; break; }
      return { ...packTyped(int ? Int32Array.from(v as number[]) : Float64Array.from(v as number[])), $a: 1 };
    }
    return v.map(pack);
  }
  const o: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(v as Record<string, unknown>)) if (val !== undefined) o[key] = pack(val);
  return o;
}

/** Inverse of `pack`. Typed arrays come back typed; packed plain number arrays come back as number[]. */
export function unpack(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(unpack);
  if (isPacked(v)) {
    const t = unpackTyped(v);
    return (v as { $a?: number }).$a ? Array.from(t as unknown as ArrayLike<number>) : t;
  }
  const o: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(v as Record<string, unknown>)) o[key] = unpack(val);
  return o;
}

// ---------------------------------------------------------------- CRC32
let CRC_TABLE: Uint32Array | null = null;
export function crc32(text: string): number {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC_TABLE[n] = c >>> 0; }
  }
  let c = 0xffffffff;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    c = CRC_TABLE[(c ^ (ch & 0xff)) & 0xff]! ^ (c >>> 8);
    if (ch > 0xff) c = CRC_TABLE[(c ^ (ch >>> 8)) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------- text <-> bytes, gzip
const enc = new TextEncoder(), dec = new TextDecoder();
export const textToBytes = (s: string): Uint8Array => enc.encode(s);
export const bytesToText = (b: Uint8Array): string => dec.decode(b);

export interface Compressor {
  gzip(bytes: Uint8Array): Promise<Uint8Array>;
  gunzip(bytes: Uint8Array): Promise<Uint8Array>;
}

async function streamThrough(bytes: Uint8Array, t: { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> }): Promise<Uint8Array> {
  const w = t.writable.getWriter();
  // A failing stream (corrupt gzip) rejects the read side below; swallow the matching writer rejection so it is not reported twice.
  w.write(bytes as unknown as Uint8Array).then(() => w.close()).catch(() => undefined);
  w.closed.catch(() => undefined);
  const chunks: Uint8Array[] = [];
  let total = 0;
  const r = t.readable.getReader();
  for (;;) { const { done, value } = await r.read(); if (done) break; chunks.push(value); total += value.length; }
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of chunks) { out.set(c, p); p += c.length; }
  return out;
}

/** CompressionStream-based gzip, or null when the platform has none (saves are then stored uncompressed). */
export function nativeCompressor(): Compressor | null {
  const g = globalThis as { CompressionStream?: new (f: string) => unknown; DecompressionStream?: new (f: string) => unknown };
  if (!g.CompressionStream || !g.DecompressionStream) return null;
  const C = g.CompressionStream, D = g.DecompressionStream;
  return {
    gzip: (b) => streamThrough(b, new C('gzip') as never),
    gunzip: (b) => streamThrough(b, new D('gzip') as never),
  };
}

let compressor: Compressor | null | undefined;
/** Override (tests / Node zlib fallback). `undefined` re-detects. */
export function setCompressor(c: Compressor | null | undefined): void { compressor = c; }
export function getCompressor(): Compressor | null { if (compressor === undefined) compressor = nativeCompressor(); return compressor; }

export const isGzip = (b: Uint8Array): boolean => b.length > 2 && b[0] === 0x1f && b[1] === 0x8b;

/** Text -> bytes, gzip when available (`compress` = false forces plain). */
export async function encodeBytes(text: string, compress = true): Promise<Uint8Array> {
  const raw = textToBytes(text), c = compress ? getCompressor() : null;
  return c ? c.gzip(raw) : raw;
}
/** Bytes (gzip or plain JSON text) -> text. */
export async function decodeBytes(bytes: Uint8Array): Promise<string> {
  if (isGzip(bytes)) {
    const c = getCompressor();
    if (!c) throw new Error('This save is compressed but gzip is not supported by this browser.');
    return bytesToText(await c.gunzip(bytes));
  }
  return bytesToText(bytes);
}

/** Let the event loop breathe between slices (keeps the UI responsive while saving / loading). */
export function yieldNow(): Promise<void> {
  const s = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (s?.yield) return s.yield();
  return new Promise((r) => setTimeout(r, 0));
}

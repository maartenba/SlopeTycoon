/**
 * Tiny integer codec for the statistics save module (Task 30): zigzag + LEB128 varints, base64 text. Small numbers cost one byte, so
 * quantised daily series stay far below the generic Float32 / Float64 base64 blocks of `persist/codec` (4 / 8 bytes per value).
 * Pure; `btoa` / `atob` exist in browsers and Node >= 16.
 */
export function encodeInts(values: ArrayLike<number>, delta = false): string {
  const out: number[] = [];
  let prev = 0;
  for (let i = 0; i < values.length; i++) {
    const v = Math.round(values[i]!), d = delta ? v - prev : v; prev = v;
    let z = d < 0 ? -2 * d - 1 : 2 * d; // zigzag (values stay < 2^52, so plain arithmetic is exact)
    while (z >= 128) { out.push((z % 128) | 128); z = Math.floor(z / 128); }
    out.push(z);
  }
  let bin = '';
  for (let i = 0; i < out.length; i += 4096) bin += String.fromCharCode(...out.slice(i, i + 4096));
  return btoa(bin);
}

/** Inverse of `encodeInts`; `n` = number of values expected (extra / missing bytes are tolerated: the rest reads as 0). */
export function decodeInts(text: string, n: number, delta = false): number[] {
  let bin = '';
  try { bin = atob(text); } catch { return new Array<number>(n).fill(0); }
  const out: number[] = [];
  let i = 0, prev = 0;
  while (out.length < n && i < bin.length) {
    let z = 0, mul = 1, b: number;
    do { b = bin.charCodeAt(i++); z += (b & 127) * mul; mul *= 128; } while (b & 128 && i < bin.length);
    const d = z % 2 ? -(z + 1) / 2 : z / 2;
    prev = delta ? prev + d : d; out.push(prev);
  }
  while (out.length < n) out.push(0);
  return out;
}

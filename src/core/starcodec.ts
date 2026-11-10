/**
 * Compact binary for point catalogues (stars, galaxies): 8 bytes per object.
 *
 *   header (24 bytes): "LKB1", count u32, logMin f32, logMax f32, aMin f32, aMax f32
 *   record  (8 bytes): direction u16 x 2 (octahedral), distance u16 (log scale),
 *                      a u8 (absolute magnitude), b u8 (B-V colour index, -0.4 .. 2.0)
 *
 * Direction error is under 0.01 degrees and distance error under 0.02 percent, both far below
 * the measurement error of the catalogues themselves. Shared by the build script and the page.
 */

export const HEADER_BYTES = 24;
export const RECORD_BYTES = 8;
const MAGIC = 0x3142_4b4c; // "LKB1" little-endian
export const BV_MIN = -0.4;
export const BV_MAX = 2.0;

export interface CatalogueInput {
  /** xyz triples, any unit */
  positions: ArrayLike<number>;
  /** one value per object (absolute magnitude for stars) */
  a: ArrayLike<number>;
  /** B-V colour index per object */
  bv: ArrayLike<number>;
}

export interface Catalogue {
  count: number;
  positions: Float32Array;
  a: Float32Array;
  bv: Float32Array;
}

const sign = (v: number) => (v >= 0 ? 1 : -1);

/** Unit vector to a point in the [-1, 1] square (octahedral mapping). */
export function octEncode(x: number, y: number, z: number): [number, number] {
  const s = Math.abs(x) + Math.abs(y) + Math.abs(z) || 1;
  let u = x / s;
  let v = y / s;
  if (z < 0) {
    const ou = u;
    u = (1 - Math.abs(v)) * sign(ou);
    v = (1 - Math.abs(ou)) * sign(v);
  }
  return [u, v];
}

export function octDecode(u: number, v: number): [number, number, number] {
  let x = u;
  let y = v;
  const z = 1 - Math.abs(u) - Math.abs(v);
  if (z < 0) {
    x = (1 - Math.abs(v)) * sign(u);
    y = (1 - Math.abs(u)) * sign(v);
  }
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
}

const q16 = (t: number) => Math.min(65535, Math.max(0, Math.round(t * 65535)));
const q8 = (t: number) => Math.min(255, Math.max(0, Math.round(t * 255)));

export function encodeCatalogue(input: CatalogueInput): ArrayBuffer {
  const count = input.a.length;
  let logMin = Infinity;
  let logMax = -Infinity;
  let aMin = Infinity;
  let aMax = -Infinity;
  const dist = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const d = Math.hypot(input.positions[i * 3], input.positions[i * 3 + 1], input.positions[i * 3 + 2]);
    if (!(d > 0)) throw new Error(`catalogue: object ${i} has no distance`);
    dist[i] = d;
    logMin = Math.min(logMin, Math.log(d));
    logMax = Math.max(logMax, Math.log(d));
    aMin = Math.min(aMin, input.a[i]);
    aMax = Math.max(aMax, input.a[i]);
  }
  if (logMax === logMin) logMax = logMin + 1;
  if (aMax === aMin) aMax = aMin + 1;
  const buf = new ArrayBuffer(HEADER_BYTES + count * RECORD_BYTES);
  const view = new DataView(buf);
  view.setUint32(0, MAGIC, true);
  view.setUint32(4, count, true);
  view.setFloat32(8, logMin, true);
  view.setFloat32(12, logMax, true);
  view.setFloat32(16, aMin, true);
  view.setFloat32(20, aMax, true);
  // Quantise against the float32 header values so encode and decode agree exactly.
  const lMin = view.getFloat32(8, true);
  const lMax = view.getFloat32(12, true);
  const mMin = view.getFloat32(16, true);
  const mMax = view.getFloat32(20, true);
  for (let i = 0; i < count; i++) {
    const o = HEADER_BYTES + i * RECORD_BYTES;
    const d = dist[i];
    const [u, v] = octEncode(
      input.positions[i * 3] / d,
      input.positions[i * 3 + 1] / d,
      input.positions[i * 3 + 2] / d,
    );
    view.setUint16(o, q16(u * 0.5 + 0.5), true);
    view.setUint16(o + 2, q16(v * 0.5 + 0.5), true);
    view.setUint16(o + 4, q16((Math.log(d) - lMin) / (lMax - lMin)), true);
    view.setUint8(o + 6, q8((input.a[i] - mMin) / (mMax - mMin)));
    view.setUint8(o + 7, q8((input.bv[i] - BV_MIN) / (BV_MAX - BV_MIN)));
  }
  return buf;
}

/** Decode at most `limit` objects (catalogues are stored brightest first). */
export function decodeCatalogue(buf: ArrayBuffer, limit = Infinity): Catalogue {
  const view = new DataView(buf);
  if (view.getUint32(0, true) !== MAGIC) throw new Error('catalogue: bad header');
  const count = Math.min(view.getUint32(4, true), limit);
  const lMin = view.getFloat32(8, true);
  const lMax = view.getFloat32(12, true);
  const mMin = view.getFloat32(16, true);
  const mMax = view.getFloat32(20, true);
  const positions = new Float32Array(count * 3);
  const a = new Float32Array(count);
  const bv = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const o = HEADER_BYTES + i * RECORD_BYTES;
    const dir = octDecode(
      (view.getUint16(o, true) / 65535) * 2 - 1,
      (view.getUint16(o + 2, true) / 65535) * 2 - 1,
    );
    const d = Math.exp(lMin + (view.getUint16(o + 4, true) / 65535) * (lMax - lMin));
    positions[i * 3] = dir[0] * d;
    positions[i * 3 + 1] = dir[1] * d;
    positions[i * 3 + 2] = dir[2] * d;
    a[i] = mMin + (view.getUint8(o + 6) / 255) * (mMax - mMin);
    bv[i] = BV_MIN + (view.getUint8(o + 7) / 255) * (BV_MAX - BV_MIN);
  }
  return { count, positions, a, bv };
}

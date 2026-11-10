/**
 * Zooming happens in log space: one scroll notch always multiplies the distance by the same
 * factor, whether that means 3,000 km or 3,000 light-years.
 */

/** Exponential approach to a target that behaves the same at any frame rate. */
export function smoothTo(current: number, target: number, dt: number, tau: number): number {
  if (tau <= 0) return target;
  return target + (current - target) * Math.exp(-dt / tau);
}

export const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

export const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export interface Key {
  t: number;
  v: number;
}

/**
 * Monotone cubic interpolation (Fritsch-Carlson) through keyframes: passes through every key,
 * never overshoots, and has continuous velocity, so the guided journey is one unbroken motion
 * that eases at the landmarks instead of stopping at them.
 */
export function monotoneAt(keys: Key[], t: number): number {
  const n = keys.length;
  if (t <= keys[0].t) return keys[0].v;
  if (t >= keys[n - 1].t) return keys[n - 1].v;
  const slope = (i: number) => (keys[i + 1].v - keys[i].v) / (keys[i + 1].t - keys[i].t);
  const tangent = (i: number): number => {
    if (i === 0) return slope(0);
    if (i === n - 1) return slope(n - 2);
    const a = slope(i - 1);
    const b = slope(i);
    if (a * b <= 0) return 0;
    // Weighted harmonic mean keeps the curve monotone.
    const h0 = keys[i].t - keys[i - 1].t;
    const h1 = keys[i + 1].t - keys[i].t;
    return (3 * (h0 + h1)) / ((2 * h1 + h0) / a + (h1 + 2 * h0) / b);
  };
  let i = 0;
  while (keys[i + 1].t < t) i++;
  const h = keys[i + 1].t - keys[i].t;
  const s = (t - keys[i].t) / h;
  const m0 = tangent(i) * h;
  const m1 = tangent(i + 1) * h;
  const s2 = s * s;
  const s3 = s2 * s;
  return (
    (2 * s3 - 3 * s2 + 1) * keys[i].v +
    (s3 - 2 * s2 + s) * m0 +
    (-2 * s3 + 3 * s2) * keys[i + 1].v +
    (s3 - s2) * m1
  );
}

/** Inverse lookup for a monotone key list: the time at which the value is reached. */
export function timeFor(keys: Key[], v: number): number {
  let lo = keys[0].t;
  let hi = keys[keys.length - 1].t;
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    if (monotoneAt(keys, mid) < v) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Where things are in the solar system, from published orbital elements.
 * Output frame everywhere: heliocentric, equatorial J2000 (x to the vernal equinox, z to the
 * north celestial pole), which is also the frame star catalogues use.
 */
import { AU, KM } from './units.ts';
import { DEG, type Vec3 } from './vec.ts';

export const J2000_JD = 2451545.0;
/** Mean obliquity of the ecliptic at J2000 (the value the JPL element tables use). */
export const OBLIQUITY = 23.43928 * DEG;
/** Gaussian gravitational constant: mean motion in rad/day is K / a^1.5 with a in AU. */
const GAUSS_K = 0.01720209895;

export const julianDate = (unixMs: number): number => unixMs / 86_400_000 + 2440587.5;
export const centuriesSinceJ2000 = (jd: number): number => (jd - J2000_JD) / 36525;

/** Solve Kepler's equation E - e sin E = M for the eccentric anomaly (radians). */
export function solveKepler(M: number, e: number): number {
  let m = M % (2 * Math.PI);
  if (m > Math.PI) m -= 2 * Math.PI;
  if (m < -Math.PI) m += 2 * Math.PI;
  let E = e < 0.8 ? m : Math.PI * Math.sign(m || 1);
  for (let i = 0; i < 50; i++) {
    const dE = (E - e * Math.sin(E) - m) / (1 - e * Math.cos(E));
    E -= dE;
    if (Math.abs(dE) < 1e-14) break;
  }
  return E;
}

export const eclipticToEquatorial = (v: Vec3): Vec3 => {
  const c = Math.cos(OBLIQUITY);
  const s = Math.sin(OBLIQUITY);
  return [v[0], c * v[1] - s * v[2], s * v[1] + c * v[2]];
};

/** The ecliptic north pole in equatorial coordinates: "up" for the solar system. */
export const ECLIPTIC_NORTH: Vec3 = [0, -Math.sin(OBLIQUITY), Math.cos(OBLIQUITY)];

/** Classical elements. Angles in degrees, a in AU. */
export interface Orbit {
  a: number;
  e: number;
  /** inclination */
  i: number;
  /** longitude of the ascending node */
  node: number;
  /** argument of perihelion */
  argPeri: number;
}

/** Position on an orbit at eccentric anomaly E, in the equatorial frame, in the units of `a`. */
export function positionOnOrbit(o: Orbit, E: number): Vec3 {
  const xp = o.a * (Math.cos(E) - o.e);
  const yp = o.a * Math.sqrt(1 - o.e * o.e) * Math.sin(E);
  const w = o.argPeri * DEG;
  const n = o.node * DEG;
  const inc = o.i * DEG;
  const cw = Math.cos(w);
  const sw = Math.sin(w);
  const cn = Math.cos(n);
  const sn = Math.sin(n);
  const ci = Math.cos(inc);
  const si = Math.sin(inc);
  return eclipticToEquatorial([
    (cw * cn - sw * sn * ci) * xp + (-sw * cn - cw * sn * ci) * yp,
    (cw * sn + sw * cn * ci) * xp + (-sw * sn + cw * cn * ci) * yp,
    sw * si * xp + cw * si * yp,
  ]);
}

/** One row of the JPL "approximate positions of the planets" table: value at J2000 and rate per century. */
export interface JplElements {
  a: [number, number];
  e: [number, number];
  i: [number, number];
  /** mean longitude */
  L: [number, number];
  /** longitude of perihelion */
  peri: [number, number];
  node: [number, number];
}

export function jplOrbitAt(el: JplElements, T: number): Orbit & { M: number } {
  const at = (p: [number, number]) => p[0] + p[1] * T;
  const peri = at(el.peri);
  const node = at(el.node);
  return {
    a: at(el.a),
    e: at(el.e),
    i: at(el.i),
    node,
    argPeri: peri - node,
    M: (at(el.L) - peri) * DEG,
  };
}

/** Heliocentric position of a planet, in metres. */
export function planetPosition(el: JplElements, jd: number): Vec3 {
  const o = jplOrbitAt(el, centuriesSinceJ2000(jd));
  const p = positionOnOrbit(o, solveKepler(o.M, o.e));
  return [p[0] * AU, p[1] * AU, p[2] * AU];
}

/** Osculating elements at an epoch, as the JPL Small-Body Database publishes them. */
export interface SmallBodyElements extends Orbit {
  /** mean anomaly at epoch, degrees */
  ma: number;
  /** epoch, Julian date */
  epoch: number;
}

/** Two-body propagation from the epoch. Heliocentric, in AU. */
export function smallBodyPosition(el: SmallBodyElements, jd: number): Vec3 {
  const n = GAUSS_K / Math.pow(el.a, 1.5);
  const M = el.ma * DEG + n * (jd - el.epoch);
  return positionOnOrbit(el, solveKepler(M, el.e));
}

/** A closed orbit sampled evenly in eccentric anomaly, as xyz triples in the units of `a`. */
export function orbitPath(o: Orbit, segments: number): Float32Array {
  const out = new Float32Array((segments + 1) * 3);
  for (let k = 0; k <= segments; k++) {
    const p = positionOnOrbit(o, (k / segments) * 2 * Math.PI);
    out.set(p, k * 3);
  }
  return out;
}

/**
 * Geocentric position of the Moon in metres (the low-precision series from the Astronomical
 * Almanac: about 0.3 degrees in direction, 0.2 Earth radii in distance).
 */
export function moonGeocentric(jd: number): Vec3 {
  const T = (jd - J2000_JD) / 36525;
  const sin = (deg: number) => Math.sin(deg * DEG);
  const cos = (deg: number) => Math.cos(deg * DEG);
  const lon =
    218.32 +
    481267.881 * T +
    6.29 * sin(135.0 + 477198.87 * T) -
    1.27 * sin(259.3 - 413335.36 * T) +
    0.66 * sin(235.7 + 890534.22 * T) +
    0.21 * sin(269.9 + 954397.74 * T) -
    0.19 * sin(357.5 + 35999.05 * T) -
    0.11 * sin(186.5 + 966404.03 * T);
  const lat =
    5.13 * sin(93.3 + 483202.02 * T) +
    0.28 * sin(228.2 + 960400.89 * T) -
    0.28 * sin(318.3 + 6003.15 * T) -
    0.17 * sin(217.6 - 407332.21 * T);
  const parallax =
    0.9508 +
    0.0518 * cos(135.0 + 477198.87 * T) +
    0.0095 * cos(259.3 - 413335.36 * T) +
    0.0078 * cos(235.7 + 890534.22 * T) +
    0.0028 * cos(269.9 + 954397.74 * T);
  const r = (6378.14 / sin(parallax)) * KM;
  // The series gives longitude from the equinox of date; take out precession to reach J2000.
  const l = (lon - 1.396971 * T) * DEG;
  const b = lat * DEG;
  return eclipticToEquatorial([
    r * Math.cos(b) * Math.cos(l),
    r * Math.cos(b) * Math.sin(l),
    r * Math.sin(b),
  ]);
}

/** Earth is about 81.3 times the mass of the Moon, so it sits this fraction of the way from the barycentre. */
export const MOON_MASS_FRACTION = 1 / (1 + 81.30057);

export type Quat = [number, number, number, number];

export function quatMul(a: Quat, b: Quat): Quat {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

export function quatRotate(q: Quat, v: Vec3): Vec3 {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [
    v[0] + w * tx + (y * tz - z * ty),
    v[1] + w * ty + (z * tx - x * tz),
    v[2] + w * tz + (x * ty - y * tx),
  ];
}

/**
 * Orientation of a spinning body from its IAU rotation model: pole right ascension and
 * declination, and the prime-meridian angle W, all in degrees. Returns the quaternion that
 * takes body-fixed axes (z = north pole, x = prime meridian) to the equatorial frame:
 * R = Rz(ra + 90) * Rx(90 - dec) * Rz(W).
 */
export function bodyOrientation(poleRa: number, poleDec: number, W: number): Quat {
  const qz = (deg: number): Quat => [0, 0, Math.sin((deg * DEG) / 2), Math.cos((deg * DEG) / 2)];
  const qx = (deg: number): Quat => [Math.sin((deg * DEG) / 2), 0, 0, Math.cos((deg * DEG) / 2)];
  return quatMul(quatMul(qz(poleRa + 90), qx(90 - poleDec)), qz(W));
}

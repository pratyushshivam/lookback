/**
 * A procedural Milky Way: generated in the browser from a seed, never downloaded.
 *
 * Nobody has a map of every star in the galaxy (the catalogue covers a bubble a few thousand
 * light-years across), so the overall shape is drawn from the accepted model: a central bar,
 * four main spiral arms, an exponential disc about 100,000 light-years across, and the Sun
 * 8.2 kpc (26,700 light-years) from the centre. The individual points are illustrative; the
 * proportions and the Sun's place in them are real.
 *
 * Output positions are heliocentric, equatorial J2000, in kiloparsecs, the same frame as the
 * star catalogue, so the generated disc lines up with the real Milky Way band in the sky.
 */
import type { Vec3 } from './vec.ts';

/** Distance from the Sun to the galactic centre, kpc (GRAVITY Collaboration 2019: 8.178 kpc). */
export const SUN_GC_KPC = 8.178;
/** Height of the Sun above the galactic mid-plane, kpc. */
export const SUN_Z_KPC = 0.02;
const DISC_SCALE_LENGTH = 2.6; // kpc
const DISC_EDGE = 16; // kpc
const ARM_PITCH = (12.5 * Math.PI) / 180;
const BAR_ANGLE = (27 * Math.PI) / 180;

/** Rotation from galactic to equatorial J2000 coordinates (transpose of the IAU matrix). */
const G2E = [
  [-0.0548755604, 0.4941094279, -0.867666149],
  [-0.8734370902, -0.44482963, -0.1980763734],
  [-0.4838350155, 0.7469822445, 0.4559837762],
];

export function galacticToEquatorial(g: Vec3): Vec3 {
  return [
    G2E[0][0] * g[0] + G2E[0][1] * g[1] + G2E[0][2] * g[2],
    G2E[1][0] * g[0] + G2E[1][1] * g[1] + G2E[1][2] * g[2],
    G2E[2][0] * g[0] + G2E[2][1] * g[1] + G2E[2][2] * g[2],
  ];
}

/** Small, fast, seedable generator (mulberry32). */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface GalaxyCloud {
  count: number;
  /** xyz in kpc, heliocentric equatorial */
  positions: Float32Array;
  /** rgb per point, 0..255 */
  colors: Uint8Array;
}

export function generateMilkyWay(count: number, seed = 20261110): GalaxyCloud {
  const rand = prng(seed);
  const gauss = () => {
    const u = Math.max(rand(), 1e-12);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
  };
  const positions = new Float32Array(count * 3);
  const colors = new Uint8Array(count * 3);
  const put = (i: number, gc: Vec3, rgb: [number, number, number]) => {
    // Galactocentric to heliocentric galactic (x points from the Sun to the centre), then to equatorial.
    const eq = galacticToEquatorial([gc[0] + SUN_GC_KPC, gc[1], gc[2] - SUN_Z_KPC]);
    positions.set(eq, i * 3);
    const jitter = 0.9 + 0.1 * rand();
    colors[i * 3] = rgb[0] * jitter;
    colors[i * 3 + 1] = rgb[1] * jitter;
    colors[i * 3 + 2] = rgb[2] * jitter;
  };

  for (let i = 0; i < count; i++) {
    const pick = rand();
    if (pick < 0.16) {
      // Bar and bulge: old, yellowish stars. Near end of the bar is on the positive-longitude side.
      const along = gauss() * 1.7;
      const across = gauss() * 0.6;
      const c = Math.cos(BAR_ANGLE);
      const s = Math.sin(BAR_ANGLE);
      put(i, [-along * c - across * s, along * s - across * c, gauss() * 0.42], [255, 214, 160]);
      continue;
    }
    // Exponential disc, truncated at the edge.
    let r = 0;
    do {
      r = -DISC_SCALE_LENGTH * Math.log(Math.max(rand() * rand(), 1e-12));
    } while (r > DISC_EDGE || r < 0.3);
    let phi: number;
    let rgb: [number, number, number];
    if (pick < 0.72 && r > 3) {
      // Spiral arms: logarithmic spirals that trail the (clockwise) rotation.
      const arm = Math.floor(rand() * 4);
      const spread = (0.32 + 0.02 * r) / r;
      phi = (arm * Math.PI) / 2 + 0.9 + Math.log(r / 3) / Math.tan(ARM_PITCH) + gauss() * spread;
      rgb = rand() < 0.08 ? [255, 170, 190] : [196, 214, 255];
    } else {
      phi = rand() * 2 * Math.PI;
      rgb = [255, 236, 206];
    }
    const z = gauss() * (0.14 + 0.012 * r);
    put(i, [r * Math.cos(phi), r * Math.sin(phi), z], rgb);
  }
  return { count, positions, colors };
}

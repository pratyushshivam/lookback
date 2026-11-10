/**
 * Flat Lambda-CDM distances, used only beyond the Local Group where "how far" and
 * "how long ago" stop being the same number.
 * Parameters: Planck 2018 results VI (H0 = 67.4 km/s/Mpc, Omega_m = 0.315).
 */
import { C, MPC } from './units.ts';

export const H0 = 67.4; // km/s/Mpc
export const OMEGA_M = 0.315;
export const OMEGA_R = 9.2e-5; // photons plus relativistic neutrinos
export const OMEGA_L = 1 - OMEGA_M - OMEGA_R;

const H0_SI = (H0 * 1000) / MPC; // 1/s
const STEPS = 4000;

/** Cumulative tables indexed by scale factor a, from a = 1 (now) down to a = 0. */
const tableA = new Float64Array(STEPS + 1);
const tableD = new Float64Array(STEPS + 1); // comoving distance, m
const tableT = new Float64Array(STEPS + 1); // lookback time, s

// With x = sqrt(a) both integrands are finite at the origin, so plain Simpson works.
// dD = (c/H0) da / sqrt(Or + Om a + OL a^4);  dT = (1/H0) a da / sqrt(Or + Om a + OL a^4)
const root = (a: number) => Math.sqrt(OMEGA_R + OMEGA_M * a + OMEGA_L * a ** 4);
const fD = (x: number) => (2 * x) / root(x * x);
const fT = (x: number) => (2 * x ** 3) / root(x * x);
{
  const h = 1 / STEPS;
  let d = 0;
  let t = 0;
  tableA[0] = 1;
  for (let i = 1; i <= STEPS; i++) {
    const x1 = 1 - (i - 1) * h;
    const x0 = 1 - i * h;
    const xm = (x0 + x1) / 2;
    d += (h / 6) * (fD(x0) + 4 * fD(xm) + fD(x1));
    t += (h / 6) * (fT(x0) + 4 * fT(xm) + fT(x1));
    tableA[i] = x0 * x0;
    tableD[i] = (C / H0_SI) * d;
    tableT[i] = t / H0_SI;
  }
}

/** Comoving radius of the observable universe (the particle horizon), in metres. */
export const HORIZON = tableD[STEPS];
/** Age of the universe in seconds. */
export const AGE = tableT[STEPS];

function interp(xs: Float64Array, ys: Float64Array, x: number, ascending: boolean): number {
  let lo = 0;
  let hi = STEPS;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] < x === ascending) lo = mid;
    else hi = mid;
  }
  const span = xs[hi] - xs[lo];
  const f = span === 0 ? 0 : (x - xs[lo]) / span;
  return ys[lo] + (ys[hi] - ys[lo]) * Math.min(1, Math.max(0, f));
}

/** Comoving distance (the distance today) to an object seen at redshift z, in metres. */
export function comovingDistance(z: number): number {
  return interp(tableA, tableD, 1 / (1 + Math.max(0, z)), false);
}

/** How long ago light left an object that is now `metres` away, in seconds. */
export function lookbackTime(metres: number): number {
  if (metres <= 0) return 0;
  if (metres >= HORIZON) return AGE;
  // Close to home the table is coarser than the plain answer, and the two agree to parts in a thousand.
  if (metres < 3e22) return metres / C;
  return interp(tableD, tableT, metres, true);
}

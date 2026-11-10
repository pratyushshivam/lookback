/** How bright and what colour a star looks from wherever the camera is. */

/** Apparent magnitude of an object of absolute magnitude M seen from d parsecs. */
export function apparentMagnitude(absMag: number, distPc: number): number {
  return absMag + 5 * Math.log10(Math.max(distPc, 1e-12)) - 5;
}

/** Flux relative to an object exactly at the limiting magnitude (1 = just visible). */
export function relativeFlux(apparentMag: number, limitingMag: number): number {
  return Math.pow(10, -0.4 * (apparentMag - limitingMag));
}

/** Effective temperature in kelvin from a B-V colour index (Ballesteros 2012). */
export function temperatureFromBV(bv: number): number {
  const x = Math.min(2.0, Math.max(-0.4, bv));
  return 4600 * (1 / (0.92 * x + 1.7) + 1 / (0.92 * x + 0.62));
}

/**
 * Approximate sRGB colour of a black body, components in 0..1, normalised so the largest is 1.
 * Fit by Tanner Helland to the CIE 1964 colour-matching data, valid from 1,000 K to 40,000 K.
 */
export function blackbodyRgb(kelvin: number): [number, number, number] {
  const t = Math.min(40000, Math.max(1000, kelvin)) / 100;
  let r: number;
  let g: number;
  let b: number;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    b = 255;
  }
  const c = (v: number) => Math.min(255, Math.max(0, v)) / 255;
  return [c(r), c(g), c(b)];
}

export const bvToRgb = (bv: number): [number, number, number] =>
  blackbodyRgb(temperatureFromBV(bv));

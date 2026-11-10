/** Checks against things that really happened in the sky. */
import { describe, expect, it } from 'vitest';
import {
  bodyOrientation,
  julianDate,
  MOON_MASS_FRACTION,
  moonGeocentric,
  orbitPath,
  jplOrbitAt,
  planetPosition,
  quatRotate,
  smallBodyPosition,
  solveKepler,
} from '../src/core/kepler.ts';
import { PLANET_ELEMENTS } from '../src/data/elements.ts';
import { AU } from '../src/core/units.ts';
import { dot, fromRaDec, length, normalize, scale, sub, type Vec3 } from '../src/core/vec.ts';

const jd = (iso: string) => julianDate(Date.parse(iso));
const earthAt = (d: number): Vec3 =>
  sub(planetPosition(PLANET_ELEMENTS.earth, d), scale(moonGeocentric(d), MOON_MASS_FRACTION));
const angleDeg = (a: Vec3, b: Vec3) =>
  (Math.acos(Math.min(1, dot(normalize(a), normalize(b)))) * 180) / Math.PI;

describe('Kepler solver', () => {
  it('satisfies the equation for circular through to comet-like orbits', () => {
    for (const e of [0, 0.0167, 0.2056, 0.6, 0.95, 0.99]) {
      for (const M of [-3, -0.1, 0, 0.001, 1, 3.1, 7]) {
        const E = solveKepler(M, e);
        const wrapped = Math.atan2(Math.sin(M), Math.cos(M));
        expect(E - e * Math.sin(E)).toBeCloseTo(wrapped, 10);
      }
    }
  });
});

describe('planets', () => {
  it('puts Earth at perihelion in early January and aphelion in early July', () => {
    expect(length(earthAt(jd('2026-01-03T17:00:00Z'))) / AU).toBeCloseTo(0.9833, 3);
    expect(length(earthAt(jd('2026-07-06T18:00:00Z'))) / AU).toBeCloseTo(1.0166, 3);
  });

  it('reproduces the great conjunction of 21 December 2020', () => {
    const d = jd('2020-12-21T18:20:00Z');
    const e = earthAt(d);
    const sep = angleDeg(
      sub(planetPosition(PLANET_ELEMENTS.jupiter, d), e),
      sub(planetPosition(PLANET_ELEMENTS.saturn, d), e),
    );
    // Jupiter and Saturn were 0.1 degrees apart; the approximate elements are good to a few arcminutes.
    expect(sep).toBeLessThan(0.25);
  });

  it('reproduces the close approach of Mars in October 2020', () => {
    const d = jd('2020-10-06T14:00:00Z');
    const dist = length(sub(planetPosition(PLANET_ELEMENTS.mars, d), earthAt(d))) / AU;
    expect(dist).toBeCloseTo(0.4149, 2);
  });

  it('keeps every planet inside its perihelion and aphelion distance', () => {
    const d = jd('2026-11-10T00:00:00Z');
    for (const el of Object.values(PLANET_ELEMENTS)) {
      const r = length(planetPosition(el, d)) / AU;
      const o = jplOrbitAt(el, 0.27);
      expect(r).toBeGreaterThan(o.a * (1 - o.e) * 0.999);
      expect(r).toBeLessThan(o.a * (1 + o.e) * 1.001);
    }
  });

  it('draws orbit paths that pass through the planet', () => {
    const d = jd('2026-11-10T00:00:00Z');
    const o = jplOrbitAt(PLANET_ELEMENTS.mars, (d - 2451545) / 36525);
    const path = orbitPath(o, 2048);
    const p = planetPosition(PLANET_ELEMENTS.mars, d).map((v) => v / AU);
    let best = Infinity;
    for (let k = 0; k < path.length; k += 3) {
      best = Math.min(best, Math.hypot(path[k] - p[0], path[k + 1] - p[1], path[k + 2] - p[2]));
    }
    expect(best).toBeLessThan(0.004);
    expect(path[0]).toBeCloseTo(path[path.length - 3], 5);
  });
});

describe('Moon', () => {
  it('stays between perigee and apogee', () => {
    for (let k = 0; k < 60; k++) {
      const r = length(moonGeocentric(jd('2026-01-01T00:00:00Z') + k * 1.37)) / 1000;
      expect(r).toBeGreaterThan(356_000);
      expect(r).toBeLessThan(407_000);
    }
  });

  it('covers the Sun during the total eclipse of 8 April 2024', () => {
    const d = jd('2024-04-08T18:17:00Z');
    const e = earthAt(d);
    const sep = angleDeg(moonGeocentric(d), scale(e, -1));
    expect(sep).toBeLessThan(0.8); // geocentric separation at greatest eclipse was about 0.3 degrees
  });

  it('is opposite the Sun at the total lunar eclipse of 14 March 2025', () => {
    const d = jd('2025-03-14T06:59:00Z');
    expect(angleDeg(moonGeocentric(d), earthAt(d))).toBeLessThan(0.8);
  });
});

describe('small bodies', () => {
  it('propagates Pluto from JPL Small-Body Database elements to the right part of the sky', () => {
    // Elements for 134340 Pluto as served by the SBDB query API.
    const pluto = { a: 39.59, e: 0.2518, i: 17.15, node: 110.29, argPeri: 113.71, ma: 38.68, epoch: 2457588.5 };
    const d = jd('2026-11-10T00:00:00Z');
    const p = smallBodyPosition(pluto, d);
    const r = length(p);
    expect(r).toBeGreaterThan(34.5);
    expect(r).toBeLessThan(37);
    // In late 2026 Pluto is in Capricornus, near RA 20h30m, Dec -23 degrees.
    const geo = sub(scale(p, AU), earthAt(d));
    expect(angleDeg(geo, fromRaDec(307.5, -23))).toBeLessThan(3);
  });
});

describe('body orientation', () => {
  it('points the pole at the IAU pole', () => {
    const q = bodyOrientation(40.589, 83.537, 123);
    const pole = quatRotate(q, [0, 0, 1]);
    expect(angleDeg(pole, fromRaDec(40.589, 83.537))).toBeLessThan(1e-6);
  });

  it('puts Greenwich under the Sun at noon', () => {
    // Earth: pole at dec 90, W = 190.147 + 360.9856235 d (IAU). At the March equinox the Sun is
    // overhead on the equator, and at 12:07 UTC (equation of time) it crosses the Greenwich meridian.
    const d = jd('2026-03-20T12:07:30Z');
    const W = 190.147 + 360.9856235 * (d - 2451545);
    const greenwich = quatRotate(bodyOrientation(0, 90, W), [1, 0, 0]);
    const toSun = scale(earthAt(d), -1);
    expect(angleDeg(greenwich, toSun)).toBeLessThan(1.0);
  });
});

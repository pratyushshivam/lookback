import { describe, expect, it } from 'vitest';
import { AGE, comovingDistance, HORIZON, lookbackTime } from '../src/core/cosmology.ts';
import { generateMilkyWay, galacticToEquatorial, SUN_GC_KPC } from '../src/core/galaxy.ts';
import { apparentMagnitude, bvToRgb, relativeFlux, temperatureFromBV } from '../src/core/photometry.ts';
import { chooseTier, pick } from '../src/core/pick.ts';
import { decodeCatalogue, encodeCatalogue, octDecode, octEncode } from '../src/core/starcodec.ts';
import { AU, C, formatAu, formatDistance, formatDuration, LY, MPC, PC, sig3, YEAR } from '../src/core/units.ts';
import { fromRaDec } from '../src/core/vec.ts';
import { monotoneAt, smoothTo, timeFor } from '../src/core/zoom.ts';

describe('units', () => {
  it('defines the light-year and parsec correctly', () => {
    expect(LY).toBeCloseTo(9.4607304725808e15, -3);
    expect(PC / LY).toBeCloseTo(3.26156, 4);
  });

  it('speaks kilometres near home and light-years beyond', () => {
    expect(formatDistance(384_400_000)).toBe('384,000 km');
    expect(formatDistance(AU)).toBe('150 million km');
    expect(formatDistance(30.07 * AU)).toBe('4.50 billion km');
    expect(formatDistance(4.2465 * LY)).toBe('4.25 light-years');
    expect(formatDistance(26_670 * LY)).toBe('26,700 light-years');
    expect(formatDistance(2.537e6 * LY)).toBe('2.54 million light-years');
    expect(formatDistance(46.1e9 * LY)).toBe('46.1 billion light-years');
  });

  it('never prints "1,000 million"', () => {
    expect(formatDistance(999.9e6 * 1000)).toBe('1.00 billion km');
    expect(sig3(999.6)).toBe('1,000');
    expect(sig3(99.96)).toBe('100');
  });

  it('gives light times people recognise', () => {
    expect(formatDuration(384_400_000 / C)).toBe('1.28 seconds');
    expect(formatDuration(AU / C)).toBe('8.32 minutes');
    expect(formatDuration((30.07 * AU) / C)).toBe('4.17 hours');
    expect(formatDuration(4.2465 * YEAR)).toBe('4.25 years');
    expect(formatDuration(13.8e9 * YEAR)).toBe('13.8 billion years');
  });

  it('shows AU only where AU is the natural unit', () => {
    expect(formatAu(1e7)).toBeNull();
    expect(formatAu(5.2 * AU)).toBe('5.20 AU');
    expect(formatAu(1e6 * AU)).toBeNull();
  });
});

describe('cosmology', () => {
  it('gives the accepted age and size of the observable universe', () => {
    expect(AGE / YEAR / 1e9).toBeCloseTo(13.8, 1);
    expect(HORIZON / LY / 1e9).toBeGreaterThan(45.5);
    expect(HORIZON / LY / 1e9).toBeLessThan(47);
  });

  it('matches the low-redshift expansion of the Hubble law', () => {
    const q0 = 0.315 / 2 - 0.685;
    const z = 0.1;
    const approx = (C / 67400) * (z - ((1 + q0) * z * z) / 2); // Mpc
    expect(comovingDistance(z) / MPC).toBeCloseTo(approx, -1);
    expect(comovingDistance(0)).toBe(0);
  });

  it('agrees with distance over c nearby and falls behind it far away', () => {
    const near = 1e23;
    expect(lookbackTime(near) / (near / C)).toBeCloseTo(1, 2);
    expect(lookbackTime(2.9e22)).toBe(2.9e22 / C);
    const far = 1e26;
    expect(lookbackTime(far)).toBeLessThan(far / C);
    expect(lookbackTime(HORIZON * 2)).toBe(AGE);
  });

  it('is monotonic', () => {
    let last = 0;
    for (let d = 1e22; d < HORIZON; d *= 1.3) {
      const t = lookbackTime(d);
      expect(t).toBeGreaterThan(last);
      last = t;
    }
  });
});

describe('photometry', () => {
  it('reproduces the Sun as seen from Earth and from 10 parsecs', () => {
    expect(apparentMagnitude(4.83, AU / PC)).toBeCloseTo(-26.74, 1);
    expect(apparentMagnitude(4.83, 10)).toBeCloseTo(4.83, 10);
  });

  it('treats five magnitudes as a factor of one hundred', () => {
    expect(relativeFlux(1.5, 6.5)).toBeCloseTo(100, 8);
  });

  it('colours stars from blue-white to orange-red', () => {
    expect(temperatureFromBV(0.65)).toBeGreaterThan(5500);
    expect(temperatureFromBV(0.65)).toBeLessThan(6000);
    const hot = bvToRgb(-0.2);
    const cool = bvToRgb(1.8);
    expect(hot[2]).toBeGreaterThan(hot[0]);
    expect(cool[0]).toBeGreaterThan(cool[2] * 1.5);
  });
});

describe('catalogue codec', () => {
  it('round-trips directions through the octahedral map', () => {
    for (const [ra, dec] of [[0, 0], [123, 45], [266.4, -28.9], [10, 89.9], [200, -89.9], [359.9, -0.1]]) {
      const v = fromRaDec(ra, dec);
      const back = octDecode(...octEncode(v[0], v[1], v[2]));
      expect(Math.hypot(back[0] - v[0], back[1] - v[1], back[2] - v[2])).toBeLessThan(1e-12);
    }
  });

  it('keeps direction to 0.01 degrees and distance to 0.02 percent in 8 bytes', () => {
    const n = 500;
    const positions = new Float64Array(n * 3);
    const a = new Float64Array(n);
    const bv = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const v = fromRaDec((i * 137.5) % 360, ((i * 61.8) % 180) - 90);
      const d = 1.3 * Math.pow(1.02, i); // 1.3 pc to 26,000 pc
      positions.set([v[0] * d, v[1] * d, v[2] * d], i * 3);
      a[i] = -8 + (i % 25);
      bv[i] = -0.3 + (i % 20) * 0.1;
    }
    const buf = encodeCatalogue({ positions, a, bv });
    expect(buf.byteLength).toBe(24 + n * 8);
    const out = decodeCatalogue(buf);
    expect(out.count).toBe(n);
    for (let i = 0; i < n; i++) {
      const d0 = Math.hypot(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
      const d1 = Math.hypot(out.positions[i * 3], out.positions[i * 3 + 1], out.positions[i * 3 + 2]);
      expect(Math.abs(d1 / d0 - 1)).toBeLessThan(2e-4);
      const cos =
        (positions[i * 3] * out.positions[i * 3] +
          positions[i * 3 + 1] * out.positions[i * 3 + 1] +
          positions[i * 3 + 2] * out.positions[i * 3 + 2]) /
        (d0 * d1);
      expect((Math.acos(Math.min(1, cos)) * 180) / Math.PI).toBeLessThan(0.01);
      expect(Math.abs(out.a[i] - a[i])).toBeLessThan(0.06);
      expect(Math.abs(out.bv[i] - bv[i])).toBeLessThan(0.006);
    }
    expect(decodeCatalogue(buf, 10).count).toBe(10);
  });

  it('rejects files that are not catalogues', () => {
    expect(() => decodeCatalogue(new ArrayBuffer(64))).toThrow();
  });
});

describe('procedural Milky Way', () => {
  const cloud = generateMilkyWay(20000);

  it('is deterministic', () => {
    const again = generateMilkyWay(20000);
    expect(Array.from(again.positions.slice(0, 30))).toEqual(Array.from(cloud.positions.slice(0, 30)));
  });

  it('puts the centre where Sagittarius A* really is', () => {
    const gc = galacticToEquatorial([1, 0, 0]);
    const expected = fromRaDec(266.405, -28.936);
    expect(Math.hypot(gc[0] - expected[0], gc[1] - expected[1], gc[2] - expected[2])).toBeLessThan(1e-4);
    // Median of the cloud is close to the centre, 8.2 kpc from the Sun in that direction.
    const along: number[] = [];
    for (let i = 0; i < cloud.count; i++) {
      along.push(
        cloud.positions[i * 3] * gc[0] + cloud.positions[i * 3 + 1] * gc[1] + cloud.positions[i * 3 + 2] * gc[2],
      );
    }
    along.sort((p, q) => p - q);
    expect(Math.abs(along[cloud.count >> 1] - SUN_GC_KPC)).toBeLessThan(0.8);
  });

  it('is a thin disc about 100,000 light-years across', () => {
    const pole = galacticToEquatorial([0, 0, 1]);
    const gc = galacticToEquatorial([SUN_GC_KPC, 0, 0]);
    let thin = 0;
    let maxR = 0;
    for (let i = 0; i < cloud.count; i++) {
      const p = [cloud.positions[i * 3] - gc[0], cloud.positions[i * 3 + 1] - gc[1], cloud.positions[i * 3 + 2] - gc[2]];
      const z = p[0] * pole[0] + p[1] * pole[1] + p[2] * pole[2];
      if (Math.abs(z) < 1) thin++;
      maxR = Math.max(maxR, Math.hypot(p[0], p[1], p[2]));
    }
    expect(thin / cloud.count).toBeGreaterThan(0.97);
    expect((maxR * 2 * 3261.56) / 1000).toBeGreaterThan(90); // thousand light-years
    expect((maxR * 2 * 3261.56) / 1000).toBeLessThan(110);
  });
});

describe('zoom', () => {
  it('approaches the target identically at 30 and 120 frames per second', () => {
    let a = 0;
    let b = 0;
    for (let i = 0; i < 30; i++) a = smoothTo(a, 10, 1 / 30, 0.15);
    for (let i = 0; i < 120; i++) b = smoothTo(b, 10, 1 / 120, 0.15);
    expect(a).toBeCloseTo(b, 9);
    expect(a).toBeGreaterThan(9.9);
  });

  it('moves through journey keys without overshoot or reversal', () => {
    const keys = [
      { t: 0, v: 7.2 },
      { t: 6, v: 8.8 },
      { t: 12, v: 11.5 },
      { t: 30, v: 15.5 },
      { t: 31, v: 15.6 },
      { t: 60, v: 26.6 },
    ];
    for (const k of keys) expect(monotoneAt(keys, k.t)).toBeCloseTo(k.v, 9);
    let last = -Infinity;
    for (let t = 0; t <= 60; t += 0.05) {
      const v = monotoneAt(keys, t);
      expect(v).toBeGreaterThanOrEqual(last);
      last = v;
    }
    expect(monotoneAt(keys, -5)).toBe(7.2);
    expect(monotoneAt(keys, 99)).toBe(26.6);
    expect(monotoneAt(keys, timeFor(keys, 20))).toBeCloseTo(20, 6);
  });
});

describe('picking and texture tiers', () => {
  it('prefers the disc under the pointer, nearest first', () => {
    const c = [
      { item: 'far', x: 100, y: 100, radius: 50, depth: 9 },
      { item: 'near', x: 110, y: 100, radius: 20, depth: 2 },
      { item: 'dot', x: 300, y: 300, radius: 0.2, depth: 5 },
    ];
    expect(pick(c, 112, 101, 16)).toBe('near');
    expect(pick(c, 60, 100, 16)).toBe('far');
    expect(pick(c, 308, 305, 16)).toBe('dot');
    expect(pick(c, 500, 500, 16)).toBeNull();
  });

  it('steps texture resolution with size and does not flap at a threshold', () => {
    const tiers = [512, 2048, 4096];
    expect(chooseTier(2, tiers, -1)).toBe(-1);
    expect(chooseTier(40, tiers, -1)).toBe(0);
    expect(chooseTier(400, tiers, 0)).toBe(1);
    expect(chooseTier(1500, tiers, 1)).toBe(2);
    // Shrinking a little keeps the tier already loaded; shrinking a lot releases it.
    expect(chooseTier(260, tiers, 1)).toBe(1);
    expect(chooseTier(100, tiers, 1)).toBe(0);
    expect(chooseTier(5, tiers, 0)).toBe(0);
    expect(chooseTier(2, tiers, 0)).toBe(-1);
  });
});

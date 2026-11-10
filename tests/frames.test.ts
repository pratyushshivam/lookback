import { describe, expect, it } from 'vitest';
import {
  azElOf,
  cameraRelative,
  layerCamera,
  orbitDirection,
  pixelRadius,
  projectToScreen,
  relativeTo,
  splitHiLo,
  toRenderUnits,
  viewBasis,
  type CameraState,
  type FrameNode,
} from '../src/core/frames.ts';
import { depthResolution, farToNear, fitDepth } from '../src/core/depth.ts';
import { ECLIPTIC_NORTH } from '../src/core/kepler.ts';
import { AU, LY, PC } from '../src/core/units.ts';
import { length, sub, type Vec3 } from '../src/core/vec.ts';

const sun: FrameNode = { id: 'sun', parent: null, local: [0, 0, 0] };
const earth: FrameNode = { id: 'earth', parent: sun, local: [0.6 * AU, 0.8 * AU, 1234.5] };
const moon: FrameNode = { id: 'moon', parent: earth, local: [3.0e8, -2.4e8, 1.1e7] };
const neptune: FrameNode = { id: 'neptune', parent: sun, local: [-30 * AU, 2 * AU, 0.5 * AU] };
const star: FrameNode = { id: 'star', parent: sun, local: [1.3 * PC, -0.2 * PC, 0.4 * PC] };

describe('frame tree', () => {
  it('gives child-relative offsets exactly, with no large-number subtraction', () => {
    expect(relativeTo(moon, earth)).toEqual(moon.local);
    expect(relativeTo(earth, moon)).toEqual([-3.0e8, 2.4e8, -1.1e7]);
    expect(relativeTo(earth, earth)).toEqual([0, 0, 0]);
  });

  it('goes through the common ancestor for cousins', () => {
    const r = relativeTo(moon, neptune);
    expect(r[0]).toBeCloseTo(0.6 * AU + 3.0e8 + 30 * AU, -3);
    expect(length(sub(relativeTo(neptune, moon), [-r[0], -r[1], -r[2]]))).toBe(0);
  });

  it('refuses nodes from different trees', () => {
    const stray: FrameNode = { id: 'stray', parent: null, local: [0, 0, 0] };
    expect(() => relativeTo(stray, earth)).toThrow();
  });
});

describe('camera-relative precision', () => {
  it('is exact for the focus however far the focus is from the origin', () => {
    // One metre above the Moon's surface, 1 AU from the Sun.
    const cam: CameraState = { focus: moon, offset: [1_737_401, 0.25, -0.125] };
    expect(cameraRelative(moon, cam)).toEqual([-1_737_401, -0.25, 0.125]);
  });

  it('keeps millimetres at Neptune and metres at a star', () => {
    const offset: Vec3 = [24_622_000 * 1.2, 1000.001, -3000.002];
    const atNeptune = cameraRelative(neptune, { focus: neptune, offset });
    expect(atNeptune[1]).toBe(-1000.001);
    const atStar = cameraRelative(star, { focus: star, offset: [1e10, 2, 3] });
    expect(atStar).toEqual([-1e10, -2, -3]);
  });

  it('shows what would go wrong without it', () => {
    // A float32 world position at 1 AU cannot tell two points 1 km apart from each other.
    const naive = Math.fround(AU + 1000) - Math.fround(AU);
    expect(Math.abs(naive - 1000)).toBeGreaterThan(500);
    // The camera-relative path keeps the kilometre to better than a micrometre.
    const cam: CameraState = { focus: earth, offset: [7_000_000, 0, 0] };
    const a = cameraRelative(earth, cam);
    const near: FrameNode = { id: 'p', parent: earth, local: [1000, 0, 0] };
    const b = cameraRelative(near, cam);
    expect(Math.abs(b[0] - a[0] - 1000)).toBeLessThan(1e-6);
  });

  it('render units stay finite and accurate across twenty orders of magnitude', () => {
    for (const dist of [7e6, 4e8, AU, 100 * AU, LY, 1e5 * LY, 4.3e26]) {
      const cam: CameraState = { focus: earth, offset: [dist * 0.6, dist * 0.8, 0] };
      const rel = cameraRelative(earth, cam);
      const r = toRenderUnits(rel, dist);
      expect(Math.hypot(...r)).toBeCloseTo(1, 6);
      const moonRel = toRenderUnits(cameraRelative(moon, cam), dist);
      expect(moonRel.every(Number.isFinite)).toBe(true);
    }
  });
});

describe('high/low split for point clouds', () => {
  it('reconstructs the float64 value', () => {
    for (const x of [1.3, -8177.123456789, 4.848e-6, 123456.789012345]) {
      const [hi, lo] = splitHiLo(x);
      expect(hi + lo).toBeCloseTo(x, 10);
      expect(Math.fround(hi)).toBe(hi);
      expect(Math.fround(lo)).toBe(lo);
    }
  });

  it('makes the shader subtraction jitter-free next to a distant star', () => {
    // Star 1.3 pc out, stored as float32 parsecs. Camera 100 AU from it, moving in 1 km steps.
    const starPc = Math.fround(1.3);
    const km = 1000 / PC;
    let worstSplit = 0;
    let worstNaive = 0;
    for (let step = 0; step < 200; step++) {
      const camPc = starPc - (100 * AU) / PC + step * km;
      const exact = starPc - camPc;
      const [hi, lo] = splitHiLo(camPc);
      // Exactly what the vertex shader does, in float32.
      const split = Math.fround(Math.fround(starPc - hi) - lo);
      const naive = Math.fround(starPc - Math.fround(camPc));
      worstSplit = Math.max(worstSplit, Math.abs(split - exact) / exact);
      worstNaive = Math.max(worstNaive, Math.abs(naive - exact) / exact);
    }
    expect(worstSplit).toBeLessThan(1e-6);
    expect(worstNaive).toBeGreaterThan(worstSplit * 10);
  });

  it('places the camera inside a layer in that layer\'s units', () => {
    const cam: CameraState = { focus: earth, offset: [0, 0, PC] };
    const { hi, lo } = layerCamera(sun, PC, cam);
    expect(hi[2] + lo[2]).toBeCloseTo(1 + 1234.5 / PC, 9);
    expect(hi[0] + lo[0]).toBeCloseTo((0.6 * AU) / PC, 12);
  });
});

describe('depth ranges', () => {
  it('hug each body and always contain it', () => {
    for (const [dist, r] of [[7e6, 6.378e6], [4e8, 1.737e6], [AU, 6.96e8], [1e13, 7e7]]) {
      const { near, far } = fitDepth(dist, r);
      expect(near).toBeLessThan(dist - r);
      expect(far).toBeGreaterThan(dist + r);
      expect(near).toBeGreaterThan(0);
    }
  });

  it('resolve far finer than any feature, at every scale', () => {
    // Skimming Earth: 1,000 km above the surface. Worst case is the far limb.
    const range = fitDepth(7.378e6, 6.378e6);
    expect(depthResolution(range, 7.378e6 + 6.378e6)).toBeLessThan(100); // metres
    // A sub-pixel planet seen from 40 AU still has a sane range.
    const tiny = fitDepth(40 * AU, 2.5e7);
    expect(tiny.far / tiny.near).toBeLessThan(1.2);
    // Inside the bound (between Saturn and its rings) the ratio is capped.
    const inside = fitDepth(1.0e8, 1.4e8);
    expect(inside.far / inside.near).toBeLessThanOrEqual(1.0001e4);
    // The rings start 7,000 km above the cloud tops; 16-bit depth buffers on old phones still cope.
    expect(depthResolution(inside, 1.0e8)).toBeLessThan(50_000);
    expect(depthResolution(range, 7.378e6 + 6.378e6, 16)).toBeLessThan(10_000);
  });

  it('orders bodies far to near', () => {
    expect(farToNear([{ dist: 1 }, { dist: 30 }, { dist: 5 }]).map((b) => b.dist)).toEqual([30, 5, 1]);
  });
});

describe('view helpers', () => {
  it('projects the look direction to the centre of the screen', () => {
    const basis = viewBasis([0, 0, -1], [0, 1, 0]);
    const p = projectToScreen([0, 0, -5e20], basis, Math.tan(0.4), 800, 600);
    expect(p.x).toBeCloseTo(400);
    expect(p.y).toBeCloseTo(300);
    expect(p.inFront).toBe(true);
    const right = projectToScreen([1, 0, -1], basis, 1, 800, 600);
    expect(right.x).toBeCloseTo(700);
    expect(projectToScreen([0, 0, 5], basis, 1, 800, 600).inFront).toBe(false);
  });

  it('survives looking straight along the up vector', () => {
    const b = viewBasis([0, 1, 0], [0, 1, 0]);
    expect(Math.hypot(...b.right)).toBeCloseTo(1);
    expect(Math.hypot(...b.up)).toBeCloseTo(1);
  });

  it('sizes a sphere by its true silhouette', () => {
    // From 2 radii away the limb is at asin(1/2) = 30 degrees.
    const px = pixelRadius(1, 2, 1, 1000);
    expect(px).toBeCloseTo(500 * Math.tan(Math.PI / 6), 6);
  });

  it('round-trips azimuth and elevation', () => {
    const up = ECLIPTIC_NORTH;
    const ref: Vec3 = [1, 0, 0];
    const d = orbitDirection(1.1, -0.4, up, ref);
    const back = azElOf(d, up, ref);
    expect(back.az).toBeCloseTo(1.1, 9);
    expect(back.el).toBeCloseTo(-0.4, 9);
  });
});

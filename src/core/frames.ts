/**
 * The precision core.
 *
 * The journey spans about twenty orders of magnitude (1e7 m above Earth to 4e26 m), and a GPU
 * works in 32-bit floats that carry about seven significant digits. So nothing is ever sent to
 * the GPU as an absolute position. Three rules keep every vertex exact enough:
 *
 * 1. Positions live in a tree of frames, in float64 metres, each node relative to its parent
 *    (the Moon relative to Earth, Earth relative to the Sun). The offset between two nodes is
 *    summed through their nearest common ancestor, so nearby things never subtract two huge
 *    numbers.
 * 2. The camera is a small offset from the node it is looking at (the focus), never a world
 *    position. Everything is expressed relative to the camera in float64 first, and only then
 *    divided by a per-object unit and narrowed to float32. The camera sits at the render origin.
 * 3. Large static point clouds (stars, galaxies) keep their own unit (parsecs, megaparsecs).
 *    The camera position inside such a frame is passed as a float32 pair (high part + low part),
 *    which makes the per-vertex subtraction exact near the camera.
 *
 * Pure functions only: no rendering imports, covered by tests/frames.test.ts.
 */
import { add, cross, dot, length, normalize, scale, sub, type Vec3 } from './vec.ts';

export interface FrameNode {
  id: string;
  parent: FrameNode | null;
  /** Position relative to the parent, float64 metres. */
  local: Vec3;
}

/** Position of `a` as seen from `b`, in metres, through their nearest common ancestor. */
export function relativeTo(a: FrameNode, b: FrameNode): Vec3 {
  if (a === b) return [0, 0, 0];
  const fromB = new Map<FrameNode, Vec3>();
  let acc: Vec3 = [0, 0, 0];
  for (let n: FrameNode | null = b; n; n = n.parent) {
    fromB.set(n, acc);
    acc = add(acc, n.local);
  }
  acc = [0, 0, 0];
  for (let n: FrameNode | null = a; n; n = n.parent) {
    const hit = fromB.get(n);
    if (hit) return sub(acc, hit);
    acc = add(acc, n.local);
  }
  throw new Error(`frames: ${a.id} and ${b.id} do not share a root`);
}

export interface CameraState {
  focus: FrameNode;
  /** From the focus to the camera, float64 metres. */
  offset: Vec3;
}

/** Position of a node relative to the camera, float64 metres. Exact for the focus itself. */
export function cameraRelative(node: FrameNode, cam: CameraState): Vec3 {
  return sub(relativeTo(node, cam.focus), cam.offset);
}

/** A float64 as two float32 values whose sum is the original to about 1 part in 1e14. */
export function splitHiLo(x: number): [number, number] {
  const hi = Math.fround(x);
  return [hi, Math.fround(x - hi)];
}

/**
 * The camera position inside a point-cloud frame whose origin is `origin` and whose vertices
 * are stored in `unit` metres. A vertex shader computes (position - hi) - lo.
 */
export function layerCamera(
  origin: FrameNode,
  unit: number,
  cam: CameraState,
): { hi: Vec3; lo: Vec3 } {
  const rel = cameraRelative(origin, cam);
  const hi: Vec3 = [0, 0, 0];
  const lo: Vec3 = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    const [h, l] = splitHiLo(-rel[k] / unit);
    hi[k] = h;
    lo[k] = l;
  }
  return { hi, lo };
}

/** A camera-relative vector narrowed to float32 in a chosen unit. Safe for any magnitude. */
export function toRenderUnits(rel: Vec3, unit: number): Vec3 {
  return [Math.fround(rel[0] / unit), Math.fround(rel[1] / unit), Math.fround(rel[2] / unit)];
}

export interface ViewBasis {
  right: Vec3;
  up: Vec3;
  /** Unit vector the camera looks along. */
  look: Vec3;
}

/** Orthonormal camera axes from a look direction and a preferred up. */
export function viewBasis(look: Vec3, upHint: Vec3): ViewBasis {
  const f = normalize(look);
  let r = cross(f, upHint);
  if (length(r) < 1e-6) r = cross(f, Math.abs(f[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]);
  r = normalize(r);
  return { right: r, up: cross(r, f), look: f };
}

export interface ScreenPoint {
  x: number;
  y: number;
  /** Distance along the view direction, metres. Negative means behind the camera. */
  depth: number;
  inFront: boolean;
}

/** Project a camera-relative float64 vector to CSS pixels. */
export function projectToScreen(
  rel: Vec3,
  basis: ViewBasis,
  tanHalfFov: number,
  width: number,
  height: number,
): ScreenPoint {
  const depth = dot(rel, basis.look);
  const inFront = depth > 0;
  const k = height / 2 / (tanHalfFov * (inFront ? depth : 1));
  return {
    x: width / 2 + dot(rel, basis.right) * k,
    y: height / 2 - dot(rel, basis.up) * k,
    depth,
    inFront,
  };
}

/** Apparent radius in pixels of a sphere `radius` metres across at `dist` metres. */
export function pixelRadius(
  radius: number,
  dist: number,
  tanHalfFov: number,
  height: number,
): number {
  if (dist <= radius) return Infinity;
  // Exact silhouette of a sphere, not the small-angle shortcut: it matters when close.
  return (height / 2) * (radius / Math.sqrt(dist * dist - radius * radius)) / tanHalfFov;
}

/**
 * Unit vector from the focus to the camera for an azimuth and elevation (radians) measured
 * around `up`, with azimuth zero along `ref`.
 */
export function orbitDirection(az: number, el: number, up: Vec3, ref: Vec3): Vec3 {
  const e1 = normalize(sub(ref, scale(up, dot(ref, up))));
  const e2 = cross(up, e1);
  const ce = Math.cos(el);
  return normalize(
    add(add(scale(e1, ce * Math.cos(az)), scale(e2, ce * Math.sin(az))), scale(up, Math.sin(el))),
  );
}

/** Inverse of orbitDirection. */
export function azElOf(dir: Vec3, up: Vec3, ref: Vec3): { az: number; el: number } {
  const e1 = normalize(sub(ref, scale(up, dot(ref, up))));
  const e2 = cross(up, e1);
  const d = normalize(dir);
  return {
    az: Math.atan2(dot(d, e2), dot(d, e1)),
    el: Math.asin(Math.min(1, Math.max(-1, dot(d, up)))),
  };
}

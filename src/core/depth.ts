/**
 * Depth strategy: no single depth range can cover 1e3 m to 1e26 m, and a logarithmic depth
 * buffer costs fragment-shader work on every pixel. Instead:
 *
 * - Point clouds (stars, galaxies) and guide lines never touch the depth buffer.
 * - Solid bodies are drawn far to near, and each one gets a depth range fitted tightly around
 *   its own bounding sphere, with the depth buffer cleared in between. Solid bodies in space
 *   never intersect, so the painter's order is exact and nothing can z-fight.
 */

export interface DepthRange {
  near: number;
  far: number;
}

/**
 * The tightest safe near/far for one body. `dist` is camera to centre, `bound` the radius that
 * contains everything drawn with it (rings included). Same units in and out.
 */
export function fitDepth(dist: number, bound: number): DepthRange {
  const far = (dist + bound) * 1.05;
  // Outside the bound the range hugs the sphere. Inside it (for example between Saturn and its
  // rings) fall back to a fixed, still generous, ratio.
  const near = dist > bound * 1.0001 ? (dist - bound) * 0.95 : far * 1e-4;
  return { near: Math.max(near, far * 1e-4), far };
}

/**
 * Smallest depth separation a standard (non-reversed) integer depth buffer can resolve at
 * distance z. Used by the tests to prove the fitted ranges resolve far finer than any feature.
 */
export function depthResolution(range: DepthRange, z: number, bits = 24): number {
  const { near, far } = range;
  return (z * z * (far - near)) / (near * far * 2 ** bits);
}

/** Draw order for solid bodies: farthest centre first. */
export function farToNear<T extends { dist: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => b.dist - a.dist);
}

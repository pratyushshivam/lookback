/** Choosing what a click or tap meant, and which texture resolution a body deserves. */

export interface PickCandidate<T> {
  item: T;
  x: number;
  y: number;
  /** Apparent radius on screen, CSS pixels. */
  radius: number;
  /** Distance from the camera, used to break ties: nearer wins. */
  depth: number;
}

/**
 * The candidate under the pointer. A pointer inside a visible disc picks that disc (nearest
 * first); otherwise the closest centre within `slop` pixels wins, so sub-pixel planets and
 * fingers both work.
 */
export function pick<T>(
  candidates: PickCandidate<T>[],
  px: number,
  py: number,
  slop: number,
): T | null {
  let inside: PickCandidate<T> | null = null;
  let near: PickCandidate<T> | null = null;
  let nearDist = Infinity;
  for (const c of candidates) {
    const d = Math.hypot(c.x - px, c.y - py);
    if (d <= c.radius) {
      if (!inside || c.depth < inside.depth) inside = c;
    } else if (d - c.radius <= slop && d - c.radius < nearDist) {
      near = c;
      nearDist = d - c.radius;
    }
  }
  return (inside ?? near)?.item ?? null;
}

/**
 * Texture tier for a body that is `pixels` across on screen. `tiers` are texture widths in
 * ascending order. Returns -1 for "no texture needed" (the body is a dot: its flat mean colour
 * is exact at that size). Hysteresis stops a body on a threshold from flapping between tiers.
 */
export function chooseTier(pixels: number, tiers: number[], current: number): number {
  const want = (px: number): number => {
    if (px < 6) return -1;
    let t = 0;
    // A sphere shows about half of its texture's width across its visible diameter.
    while (t < tiers.length - 1 && px * 2 > tiers[t] * 1.15) t++;
    return t;
  };
  const up = want(pixels);
  if (up > current) return up;
  const down = want(pixels * 1.6);
  return down < current ? down : current;
}

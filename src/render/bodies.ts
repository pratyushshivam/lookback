/**
 * Solid bodies: true-size spheres (flattened where the real planet is), lit by the real
 * direction to the Sun, with textures stepped in by apparent size and released again.
 */
import * as THREE from 'three';
import { chooseTier } from '../core/pick.ts';
import { SATURN_RINGS, type BodyDef } from '../data/bodies.ts';
import manifest from '../data/textures.json';

type Manifest = Record<string, { tiers: number[]; bytes: number[]; mean: number[] }>;
const MANIFEST = manifest as Manifest;

/** Unit sphere in body-fixed axes: z is the north pole, x the prime meridian, longitude east. */
function sphereGeometry(lonSeg: number, latSeg: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= latSeg; j++) {
    const lat = (j / latSeg - 0.5) * Math.PI;
    for (let i = 0; i <= lonSeg; i++) {
      const lon = (i / lonSeg - 0.5) * 2 * Math.PI;
      pos.push(Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat));
      uv.push(i / lonSeg, j / latSeg);
    }
  }
  const row = lonSeg + 1;
  for (let j = 0; j < latSeg; j++) {
    for (let i = 0; i < lonSeg; i++) {
      const a = j * row + i;
      idx.push(a, a + 1, a + row, a + 1, a + row + 1, a + row);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  return geo;
}

/** Flat annulus in the equatorial plane, radius 1 at the outer edge. u runs inner to outer. */
function ringGeometry(inner: number, seg: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * 2 * Math.PI;
    pos.push(Math.cos(a) * inner, Math.sin(a) * inner, 0, Math.cos(a), Math.sin(a), 0);
    uv.push(0, 0.5, 1, 0.5);
    if (i < seg) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  return geo;
}

const BODY_VERT = /* glsl */ `
uniform float uFlatten;
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorld;
void main() {
  vUv = uv;
  // Normal of an ellipsoid, in the camera-relative (unrotated) frame.
  vNormal = mat3(modelMatrix) * (position / vec3(1.0, 1.0, uFlatten * uFlatten));
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const BODY_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform sampler2D uNight;
uniform float uHasMap;
uniform float uHasNight;
uniform vec3 uBase;
uniform vec3 uSunDir;
uniform float uEmissive;
uniform float uAir;
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorld;
void main() {
  vec3 n = normalize(vNormal);
  vec3 toEye = normalize(-vWorld);
  vec3 albedo = mix(uBase, texture2D(uMap, vUv).rgb, uHasMap);
  float mu = max(dot(n, toEye), 0.0);
  vec3 col;
  if (uEmissive > 0.5) {
    // The Sun: self-luminous, darker towards the limb as the real photosphere is.
    col = albedo * (0.45 + 0.75 * pow(mu, 0.5)) * 1.35;
  } else {
    float ndl = dot(n, uSunDir);
    col = albedo * max(ndl, 0.0);
    // City lights on the night side of Earth.
    vec3 night = texture2D(uNight, vUv).rgb * uHasNight;
    col += night * (1.0 - smoothstep(-0.12, 0.06, ndl)) * 0.9;
    // A thin band of scattered sunlight at the limb of a planet with air.
    float rim = pow(1.0 - mu, 3.0) * smoothstep(-0.15, 0.35, ndl) * uAir;
    col += vec3(0.25, 0.48, 1.0) * rim;
  }
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

const RING_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform float uHasMap;
uniform vec3 uSunDir;
uniform float uInner;
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorld;
uniform vec3 uCentre;   // planet centre, same frame as vWorld
uniform float uPlanetR; // planet radius in render units
void main() {
  vec4 tex = texture2D(uMap, vec2(vUv.x, 0.5));
  if (uHasMap < 0.5) tex = vec4(0.82, 0.76, 0.64, 0.35);
  // Shadow of the planet across the rings.
  vec3 p = (vWorld - uCentre) / uPlanetR;
  float along = dot(p, uSunDir);
  float off = length(p - uSunDir * along);
  float shadow = along < 0.0 ? smoothstep(0.97, 1.03, off) : 1.0;
  gl_FragColor = vec4(tex.rgb * (0.12 + 0.88 * shadow), tex.a);
  #include <colorspace_fragment>
}
`;

const BLACK = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
BLACK.needsUpdate = true;

async function loadTexture(url: string, maxAniso: number): Promise<THREE.Texture> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`texture ${url}: ${res.status}`);
  // Decoded off the main thread, already flipped for WebGL.
  const bitmap = await createImageBitmap(await res.blob(), { imageOrientation: 'flipY' });
  const tex = new THREE.Texture(bitmap as unknown as HTMLImageElement);
  tex.flipY = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.anisotropy = Math.min(4, maxAniso);
  tex.needsUpdate = true;
  return tex;
}

function disposeTexture(tex: THREE.Texture | null): void {
  if (!tex) return;
  (tex.image as ImageBitmap | undefined)?.close?.();
  tex.dispose();
}

/** One map (day side, night side or rings) that follows the body's size on screen. */
class SteppedMap {
  tier = -1;
  private texture: THREE.Texture | null = null;
  private pending = -2;
  constructor(
    private readonly key: string,
    private readonly tiers: number[],
    private readonly apply: (tex: THREE.Texture | null) => void,
    private readonly onChange: () => void,
    private readonly maxAniso: number,
  ) {}

  update(pixels: number, maxTier: number): void {
    const want = Math.min(chooseTier(pixels, this.tiers, this.tier), maxTier);
    if (want === this.tier || want === this.pending) return;
    if (want === -1) {
      // Too small to resolve: release the memory, the flat mean colour is exact at this size.
      this.pending = -2;
      this.swap(null, -1);
      return;
    }
    this.pending = want;
    loadTexture(`${import.meta.env.BASE_URL}tex/${this.key}_${this.tiers[want]}.webp`, this.maxAniso)
      .then((tex) => {
        if (this.pending !== want) return disposeTexture(tex);
        this.pending = -2;
        this.swap(tex, want);
      })
      .catch(() => {
        if (this.pending === want) this.pending = -2;
      });
  }

  private swap(tex: THREE.Texture | null, tier: number): void {
    const old = this.texture;
    this.texture = tex;
    this.tier = tier;
    this.apply(tex);
    disposeTexture(old);
    this.onChange();
  }

  get loaded(): boolean {
    return this.texture !== null;
  }
}

export class Body {
  readonly group = new THREE.Group();
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private ring: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> | null = null;
  private maps: SteppedMap[] = [];
  /** Radius, in metres, of everything drawn with this body. */
  readonly bound: number;
  readonly radius: number;

  constructor(
    readonly def: BodyDef,
    geometry: THREE.BufferGeometry,
    onChange: () => void,
    maxAniso: number,
  ) {
    this.radius = def.radius[0] * 1000;
    const flatten = def.radius[1] / def.radius[0];
    const mean = def.texture ? MANIFEST[def.texture].mean : def.color!;
    const uniforms = {
      uMap: { value: BLACK as THREE.Texture },
      uNight: { value: BLACK as THREE.Texture },
      uHasMap: { value: 0 },
      uHasNight: { value: 0 },
      uBase: { value: new THREE.Color().setRGB(mean[0] / 255, mean[1] / 255, mean[2] / 255, THREE.SRGBColorSpace) },
      uSunDir: { value: new THREE.Vector3(1, 0, 0) },
      uEmissive: { value: def.emissive ? 1 : 0 },
      uAir: { value: def.id === 'earth' ? 0.55 : 0 },
      uFlatten: { value: flatten },
    };
    this.mesh = new THREE.Mesh(
      geometry,
      new THREE.ShaderMaterial({ vertexShader: BODY_VERT, fragmentShader: BODY_FRAG, uniforms }),
    );
    this.mesh.scale.set(1, 1, flatten);
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);
    this.group.visible = false;

    if (def.texture) {
      this.maps.push(
        new SteppedMap(def.texture, MANIFEST[def.texture].tiers, (tex) => {
          uniforms.uMap.value = tex ?? BLACK;
          uniforms.uHasMap.value = tex ? 1 : 0;
        }, onChange, maxAniso),
      );
    }
    if (def.id === 'earth') {
      this.maps.push(
        new SteppedMap('earth_night', MANIFEST.earth_night.tiers, (tex) => {
          uniforms.uNight.value = tex ?? BLACK;
          uniforms.uHasNight.value = tex ? 1 : 0;
        }, onChange, maxAniso),
      );
    }
    if (def.id === 'saturn') {
      const outer = SATURN_RINGS.outer / def.radius[0];
      const ringUniforms = {
        uMap: { value: BLACK as THREE.Texture },
        uHasMap: { value: 0 },
        uSunDir: uniforms.uSunDir,
        uCentre: { value: new THREE.Vector3() },
        uPlanetR: { value: 1 },
        uFlatten: { value: 1 },
      };
      this.ring = new THREE.Mesh(
        ringGeometry(SATURN_RINGS.inner / SATURN_RINGS.outer, 256),
        new THREE.ShaderMaterial({
          vertexShader: BODY_VERT,
          fragmentShader: RING_FRAG,
          uniforms: ringUniforms,
          transparent: true,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      this.ring.scale.setScalar(outer);
      this.ring.frustumCulled = false;
      this.ring.renderOrder = 1;
      this.group.add(this.ring);
      this.maps.push(
        new SteppedMap('saturn_ring', [1024], (tex) => {
          ringUniforms.uMap.value = tex ?? BLACK;
          ringUniforms.uHasMap.value = tex ? 1 : 0;
        }, onChange, maxAniso),
      );
      this.bound = SATURN_RINGS.outer * 1000;
    } else {
      this.bound = this.radius;
    }
  }

  /**
   * Place the body for this frame. `rel` is the float32 camera-relative position in units of
   * `unit` metres (the camera sits at the origin).
   */
  place(rel: [number, number, number], unit: number, q: [number, number, number, number], sunDir: [number, number, number]): void {
    this.group.position.set(rel[0], rel[1], rel[2]);
    this.group.quaternion.set(q[0], q[1], q[2], q[3]);
    this.group.scale.setScalar(this.radius / unit);
    this.mesh.material.uniforms.uSunDir.value.set(sunDir[0], sunDir[1], sunDir[2]);
    if (this.ring) {
      this.ring.material.uniforms.uCentre.value.set(rel[0], rel[1], rel[2]);
      this.ring.material.uniforms.uPlanetR.value = this.radius / unit;
    }
    this.group.updateMatrixWorld(true);
  }

  /** Ask for the texture resolution that matches the body's diameter in device pixels. */
  refine(pixels: number, maxTier: number): void {
    for (const m of this.maps) m.update(pixels, maxTier);
  }

  /** True once the first texture has arrived (used to hold the loader for Earth only). */
  get textured(): boolean {
    return this.maps.length === 0 || this.maps[0].loaded;
  }

  get tier(): number {
    return this.maps.length ? this.maps[0].tier : -1;
  }
}

export const sharedSphere = (weak: boolean): THREE.BufferGeometry =>
  weak ? sphereGeometry(96, 48) : sphereGeometry(160, 80);

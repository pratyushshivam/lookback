/**
 * Point clouds and guide lines. Each layer keeps its vertices in its own unit (parsecs for
 * stars, megaparsecs for galaxies, AU for orbits) relative to its own origin node, and is given
 * the camera position inside that frame as a high/low float32 pair every frame.
 * None of these layers reads or writes the depth buffer.
 */
import * as THREE from 'three';
import { layerCamera, type CameraState, type FrameNode, type ViewBasis } from '../core/frames.ts';

/** Shared by every layer: camera-relative position and a projection that ignores depth. */
const HEAD = /* glsl */ `
uniform vec3 uCamHi;
uniform vec3 uCamLo;
uniform mat3 uView;   // rows: right, up, look
uniform vec2 uProj;   // 1 / (tanHalfFov * aspect), 1 / tanHalfFov
vec3 camRel() { return (position - uCamHi) - uCamLo; }
vec4 project(vec3 rel) {
  vec3 v = uView * rel;
  return vec4(v.x * uProj.x, v.y * uProj.y, 0.0, v.z);
}
`;

const SOFT_DOT = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(p, p);
  if (r2 > 1.0) discard;
  float a = vAlpha * (exp(-r2 * 5.0) * 0.85 + 0.15 * (1.0 - r2) * (1.0 - r2));
  gl_FragColor = vec4(vColor, a);
}
`;

export interface FrameUniforms {
  basis: ViewBasis;
  tanHalfFov: number;
  aspect: number;
  /** Drawing-buffer pixels from the centre of the view to its top edge. */
  halfHeightPx: number;
  dpr: number;
}

export class Layer<T extends THREE.Object3D = THREE.Object3D> {
  readonly material: THREE.ShaderMaterial;
  constructor(
    readonly object: T,
    readonly origin: FrameNode,
    /** metres per vertex unit */
    public unit: number,
  ) {
    this.material = (object as unknown as { material: THREE.ShaderMaterial }).material;
    object.frustumCulled = false;
    object.matrixAutoUpdate = false;
  }

  place(cam: CameraState, f: FrameUniforms): void {
    const u = this.material.uniforms;
    const { hi, lo } = layerCamera(this.origin, this.unit, cam);
    u.uCamHi.value.set(hi[0], hi[1], hi[2]);
    u.uCamLo.value.set(lo[0], lo[1], lo[2]);
    const { right, up, look } = f.basis;
    u.uView.value.set(
      right[0], right[1], right[2],
      up[0], up[1], up[2],
      look[0], look[1], look[2],
    );
    u.uProj.value.set(1 / (f.tanHalfFov * f.aspect), 1 / f.tanHalfFov);
    if (u.uDpr) u.uDpr.value = f.dpr;
    if (u.uPxPerRad) u.uPxPerRad.value = f.halfHeightPx / f.tanHalfFov;
  }

  set visible(v: boolean) {
    this.object.visible = v;
  }
  get visible(): boolean {
    return this.object.visible;
  }

  dispose(): void {
    (this.object as unknown as { geometry: THREE.BufferGeometry }).geometry.dispose();
    this.material.dispose();
    this.object.removeFromParent();
  }
}

function material(
  vertex: string,
  fragment: string,
  uniforms: Record<string, THREE.IUniform>,
  blending: THREE.Blending = THREE.AdditiveBlending,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: HEAD + vertex,
    fragmentShader: fragment,
    uniforms: {
      uCamHi: { value: new THREE.Vector3() },
      uCamLo: { value: new THREE.Vector3() },
      uView: { value: new THREE.Matrix3() },
      uProj: { value: new THREE.Vector2() },
      ...uniforms,
    },
    blending,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
}

/**
 * Stars: brightness follows the inverse-square law from each star's absolute magnitude and its
 * distance from the camera, so the sky changes honestly as the camera leaves the Sun.
 * Positions in parsecs.
 */
export function starLayer(
  origin: FrameNode,
  unit: number,
  positions: Float32Array,
  absMag: Float32Array,
  colors: Float32Array,
): Layer<THREE.Points> {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aMag', new THREE.BufferAttribute(absMag, 1));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = material(
    /* glsl */ `
    attribute float aMag;
    attribute vec3 color;
    uniform float uMagLimit;
    uniform float uDpr;
    uniform float uFade;
    varying vec3 vColor;
    varying float vAlpha;
    void main() {
      vec3 rel = camRel();
      float d = max(length(rel), 1e-9);
      float m = aMag + 5.0 * log2(d) * 0.30103 - 5.0;
      float flux = exp2(-1.32877 * (m - uMagLimit)); // 10^(-0.4 x)
      if (flux < 0.02) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
      gl_Position = project(rel);
      gl_PointSize = min(1.6 + 1.15 * log2(1.0 + flux), 46.0) * uDpr;
      vColor = mix(color, vec3(1.0), clamp(log2(1.0 + flux) * 0.035, 0.0, 0.6));
      vAlpha = clamp(flux, 0.0, 1.0) * uFade;
    }`,
    SOFT_DOT,
    { uMagLimit: { value: 6.5 }, uDpr: { value: 1 }, uFade: { value: 1 } },
  );
  return new Layer(new THREE.Points(geo, mat), origin, unit);
}

/**
 * Soft blobs with a real size in the layer's unit: the Milky Way particles and the glows of
 * named galaxies. When a blob would be smaller than a pixel or larger than the cap, its opacity
 * is scaled so the total light stays the same.
 */
export function cloudLayer(
  origin: FrameNode,
  unit: number,
  positions: Float32Array,
  colors: Uint8Array,
  sizes: Float32Array | number,
): Layer<THREE.Points> {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3, true));
  const perPoint = typeof sizes !== 'number';
  if (perPoint) geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  const mat = material(
    /* glsl */ `
    attribute vec3 color;
    ${perPoint ? 'attribute float aSize;' : 'uniform float aSize;'}
    uniform float uPxPerRad;
    uniform float uDpr;
    uniform float uAlpha;
    uniform float uMinPx;
    uniform float uMinAlpha;
    varying vec3 vColor;
    varying float vAlpha;
    void main() {
      vec3 rel = camRel();
      gl_Position = project(rel);
      float depth = max(gl_Position.w, 1e-20);
      float truePx = aSize / depth * uPxPerRad;
      float px = clamp(truePx, uMinPx * uDpr, 56.0 * uDpr);
      float ratio = truePx / px;
      gl_PointSize = px;
      vColor = color;
      vAlpha = uAlpha * max(min(ratio * ratio, 1.0), uMinAlpha) * (ratio > 1.0 ? 1.0 / ratio : 1.0);
    }`,
    SOFT_DOT,
    {
      uPxPerRad: { value: 1 },
      uDpr: { value: 1 },
      uAlpha: { value: 1 },
      uMinPx: { value: 1.5 },
      uMinAlpha: { value: 0 },
      ...(perPoint ? {} : { aSize: { value: sizes } }),
    },
  );
  return new Layer(new THREE.Points(geo, mat), origin, unit);
}

/** Fixed-size dots in one colour: surveyed galaxies, asteroids, Kuiper belt objects. */
export function dotLayer(
  origin: FrameNode,
  unit: number,
  positions: Float32Array,
  color: THREE.ColorRepresentation,
  sizePx: number,
): Layer<THREE.Points> {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = material(
    /* glsl */ `
    uniform float uDpr;
    uniform float uAlpha;
    uniform float uSize;
    uniform vec3 uColor;
    varying vec3 vColor;
    varying float vAlpha;
    void main() {
      gl_Position = project(camRel());
      gl_PointSize = uSize * uDpr;
      vColor = uColor;
      vAlpha = uAlpha;
    }`,
    SOFT_DOT,
    {
      uDpr: { value: 1 },
      uAlpha: { value: 1 },
      uSize: { value: sizePx },
      uColor: { value: new THREE.Color(color) },
    },
  );
  return new Layer(new THREE.Points(geo, mat), origin, unit);
}

/** A polyline guide: an orbit or a light-time ring. */
export function lineLayer(
  origin: FrameNode,
  unit: number,
  positions: Float32Array,
  color: THREE.ColorRepresentation,
): Layer<THREE.Line> {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = material(
    /* glsl */ `
    void main() { gl_Position = project(camRel()); }`,
    /* glsl */ `
    uniform vec3 uColor;
    uniform float uAlpha;
    void main() { gl_FragColor = vec4(uColor, uAlpha); }`,
    { uAlpha: { value: 1 }, uColor: { value: new THREE.Color(color) } },
    THREE.NormalBlending,
  );
  return new Layer(new THREE.Line(geo, mat), origin, unit);
}

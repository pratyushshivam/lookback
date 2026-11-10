/**
 * The engine: owns the camera, the frame tree, every layer and body, and draws only when
 * something has changed. The interface talks to it through a small set of methods and reads
 * one FrameInfo object per drawn frame.
 */
import * as THREE from 'three';
import { HORIZON } from './core/cosmology.ts';
import { farToNear, fitDepth } from './core/depth.ts';
import {
  azElOf,
  cameraRelative,
  orbitDirection,
  pixelRadius,
  projectToScreen,
  relativeTo,
  toRenderUnits,
  viewBasis,
  type CameraState,
  type FrameNode,
  type ViewBasis,
} from './core/frames.ts';
import { generateMilkyWay } from './core/galaxy.ts';
import {
  bodyOrientation,
  centuriesSinceJ2000,
  ECLIPTIC_NORTH,
  J2000_JD,
  jplOrbitAt,
  julianDate,
  MOON_MASS_FRACTION,
  moonGeocentric,
  orbitPath,
  planetPosition,

  smallBodyPosition,
  type Quat,
} from './core/kepler.ts';
import { apparentMagnitude, bvToRgb } from './core/photometry.ts';
import { pick, type PickCandidate } from './core/pick.ts';
import { decodeCatalogue } from './core/starcodec.ts';
import { AU, KPC, LY, MPC, PC, sig3 } from './core/units.ts';
import { cross, dot, fromRaDec, length, normalize, scale, slerp, sub, type Vec3 } from './core/vec.ts';
import { clamp, monotoneAt, smoothstep, smoothTo, timeFor } from './core/zoom.ts';
import { BODIES, type BodyDef } from './data/bodies.ts';
import { DEEP_SKY } from './data/deepsky.ts';
import { PLANET_ELEMENTS, PLUTO_ELEMENTS } from './data/elements.ts';
import { JOURNEY_KEYS, JOURNEY_SECONDS, LOG_MAX } from './data/journey.ts';
import { Body, sharedSphere } from './render/bodies.ts';
import { cloudLayer, dotLayer, Layer, lineLayer, starLayer, type FrameUniforms } from './render/layers.ts';

const PAPER = 0xf2eee5;
const ACCENT_INK = 0xff6b3d;
const FOV = 45;
const TAN_HALF_FOV = Math.tan((FOV / 2) * (Math.PI / 180));
const REF: Vec3 = [1, 0, 0];
const SUN_ABS_MAG = 4.83;

export interface Info {
  title: string;
  kind: string;
  facts: string;
  stats: [string, string][];
  source: { label: string; url: string };
}

export interface Target {
  id: string;
  name: string;
  type: 'body' | 'star' | 'deep';
  node: FrameNode;
  /** metres; 0 for objects drawn as points */
  radius: number;
  minDist: number;
  arriveDist: number;
  info: Info;
}

export interface Label {
  id: string;
  text: string;
  x: number;
  y: number;
  /** Lower wins when labels collide. */
  priority: number;
  /** Draw a small ring: the object itself is too small to see at true scale. */
  marker: boolean;
  focused: boolean;
  style: 'body' | 'star' | 'deep' | 'ring';
  target: Target | null;
}

export interface FrameInfo {
  /** Camera to the centre of Earth, metres. */
  distEarth: number;
  logEarth: number;
  focus: Target;
  playing: boolean;
  /** 0..1 through the guided journey, when playing. */
  progress: number;
  labels: Label[];
  width: number;
  height: number;
}

export interface Stats {
  fps: number;
  frameMs: number;
  drawCalls: number;
  points: number;
  textures: number;
  geometries: number;
  heapMb: number | null;
  transferredMb: number;
  dpr: number;
  stars: number;
  idle: boolean;
}

interface NamedStar {
  name: string;
  index: number;
  mag: number;
  abs: number;
  spect: string;
  pc: number;
  bv: number;
  target: Target;
  /** parsecs, from the decoded catalogue so it matches the drawn point exactly */
  p: Vec3;
}

const STAR_ALIASES: Record<string, string> = { 'Rigil Kentaurus': 'Alpha Centauri' };

function spectralPhrase(spect: string): string {
  switch (spect.trim()[0]) {
    case 'O':
    case 'B':
      return 'a hot blue-white star';
    case 'A':
      return 'a white star';
    case 'F':
      return 'a yellow-white star';
    case 'G':
      return 'a yellow star, the same class as the Sun';
    case 'K':
      return 'an orange star';
    case 'M':
      return 'a red star';
    default:
      return 'a star';
  }
}

export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  private readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 10);
  private readonly dummyCamera = new THREE.Camera();
  private readonly sky = new THREE.Scene();
  private readonly solid = new THREE.Scene();

  // --- the frame tree ---
  private readonly sunNode: FrameNode = { id: 'sun', parent: null, local: [0, 0, 0] };
  private readonly nodes = new Map<string, FrameNode>();
  private readonly bodies: Body[] = [];
  private readonly bodyQuat = new Map<string, Quat>();
  readonly targets = new Map<string, Target>();
  private readonly jd: number;

  // --- layers ---
  private stars: Layer<THREE.Points> | null = null;
  private starCount = 0;
  private starData: { positions: Float32Array } | null = null;
  private namedStars: NamedStar[] = [];
  private milkyWay: Layer<THREE.Points> | null = null;
  private glows: Layer<THREE.Points>;
  private galaxies: Layer<THREE.Points> | null = null;
  private galaxiesLoading = false;
  private belts: { layer: Layer<THREE.Points>; kind: 'mba' | 'tno' }[] = [];
  private beltsLoading = false;
  private orbits: { layer: Layer<THREE.Line>; body: string; a: number }[] = [];
  private rings: { layer: Layer<THREE.Line>; radius: number; text: string }[] = [];

  // --- camera state ---
  private focus!: Target;
  private az = 0;
  private el = 0;
  private logD = 7.28;
  private targetLogD = 7.28;
  private azVel = 0;
  private elVel = 0;
  private fly: { t: number; dur: number; fromLook: Vec3; fromLog: number; toLog: number } | null = null;
  private tween: { t: number; dur: number; from: number; to: number } | null = null;
  private journey: { t: number } | null = null;
  private pendingJourney = false;
  private holdZoom = 0;

  guides = true;
  longExposure = true;
  readonly weak: boolean;
  readonly reducedMotion: boolean;

  // --- loop ---
  private dirty = true;
  private running = false;
  private lastTime = 0;
  private width = 1;
  private height = 1;
  private dpr = 1;
  private frameTimes: number[] = [];
  private slowFrames = 0;
  private lastBasis: ViewBasis = viewBasis([0, 0, -1], ECLIPTIC_NORTH);
  private lastCam!: CameraState;
  private candidates: PickCandidate<Target>[] = [];
  onFrame: (info: FrameInfo) => void = () => {};
  onFocus: (target: Target) => void = () => {};
  onJourney: (playing: boolean) => void = () => {};
  /** Resolves when Earth has a texture and one frame has been drawn. */
  readonly ready: Promise<void>;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    opts: { weak: boolean; reducedMotion: boolean; now?: number },
  ) {
    this.weak = opts.weak;
    this.reducedMotion = opts.reducedMotion;
    this.jd = julianDate(opts.now ?? Date.now());
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: !this.weak,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.autoClear = false;
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.info.autoReset = false;

    this.buildSolarSystem();
    this.buildDeepSky();
    this.glows = this.buildGlows();
    this.buildGuides();

    this.focus = this.targets.get('earth')!;
    // Start on the sunlit side, a little above the ecliptic.
    const toSun = normalize(scale(this.nodes.get('earth')!.local, -1));
    const start = azElOf(toSun, ECLIPTIC_NORTH, REF);
    this.az = start.az + 0.55;
    this.el = 0.22;

    this.resize();
    let resolveReady!: () => void;
    this.ready = new Promise((r) => (resolveReady = r));
    const earth = this.bodies.find((b) => b.def.id === 'earth')!;
    const waitForEarth = () => {
      this.drawFrame(0);
      if (earth.textured) resolveReady();
      else setTimeout(waitForEarth, 30);
    };
    waitForEarth();
    // A safety net: never hold the page behind the loader for long.
    setTimeout(resolveReady, 6000);
  }

  // ------------------------------------------------------------------------------------------
  // Building the universe
  // ------------------------------------------------------------------------------------------

  private buildSolarSystem(): void {
    const jd = this.jd;
    const days = jd - J2000_JD;
    const moonGeo = moonGeocentric(jd);
    const positions: Record<string, Vec3> = { sun: [0, 0, 0] };
    for (const [id, el] of Object.entries(PLANET_ELEMENTS)) positions[id] = planetPosition(el, jd);
    // The table gives the Earth-Moon barycentre; step from there to Earth itself.
    positions.earth = sub(positions.earth, scale(moonGeo, MOON_MASS_FRACTION));
    positions.pluto = scale(smallBodyPosition(PLUTO_ELEMENTS, jd), AU);
    positions.moon = moonGeo; // relative to Earth

    this.nodes.set('sun', this.sunNode);
    const sphere = sharedSphere(this.weak);
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    for (const def of BODIES) {
      const node: FrameNode =
        def.id === 'sun'
          ? this.sunNode
          : { id: def.id, parent: def.parent === 'earth' ? this.nodes.get('earth')! : this.sunNode, local: positions[def.id] };
      this.nodes.set(def.id, node);
      const body = new Body(def, sphere, () => this.invalidate(), maxAniso);
      this.bodies.push(body);
      this.solid.add(body.group);
      this.bodyQuat.set(def.id, this.orientation(def, days, moonGeo));
      const radius = def.radius[0] * 1000;
      this.targets.set(def.id, {
        id: def.id,
        name: def.name,
        type: 'body',
        node,
        radius,
        minDist: radius * 1.2,
        arriveDist: radius * (def.id === 'saturn' ? 7 : 4.2),
        info: { title: def.name, kind: def.kind, facts: def.facts, stats: def.stats, source: def.source },
      });
    }
  }

  private orientation(def: BodyDef, days: number, moonGeo: Vec3): Quat {
    if (def.spin === 'locked') {
      // Tidally locked: the prime meridian faces Earth. Libration is ignored.
      const pole = fromRaDec(def.pole[0], def.pole[1]);
      const toEarth = scale(moonGeo, -1);
      const x = normalize(sub(toEarth, scale(pole, dot(toEarth, pole))));
      const y = cross(pole, x);
      const m = new THREE.Matrix4().makeBasis(
        new THREE.Vector3(...x),
        new THREE.Vector3(...y),
        new THREE.Vector3(...pole),
      );
      const q = new THREE.Quaternion().setFromRotationMatrix(m);
      return [q.x, q.y, q.z, q.w];
    }
    return bodyOrientation(def.pole[0], def.pole[1], def.spin[0] + def.spin[1] * days);
  }

  private buildDeepSky(): void {
    for (const d of DEEP_SKY) {
      const dir = fromRaDec(d.ra, d.dec);
      const node: FrameNode = { id: d.id, parent: this.sunNode, local: scale(dir, d.distance) };
      this.nodes.set(d.id, node);
      this.targets.set(d.id, {
        id: d.id,
        name: d.name,
        type: 'deep',
        node,
        radius: 0,
        minDist: d.diameter > 0 ? d.diameter * 0.3 : d.distance * 0.01,
        arriveDist: d.diameter > 0 ? d.diameter * 1.8 : d.distance * 0.12,
        info: { title: d.name, kind: d.kind, facts: d.facts, stats: d.stats, source: d.source },
      });
    }
  }

  private buildGlows(): Layer<THREE.Points> {
    const list = DEEP_SKY.filter((d) => d.diameter > 0);
    const positions = new Float32Array(list.length * 3);
    const colors = new Uint8Array(list.length * 3);
    const sizes = new Float32Array(list.length);
    list.forEach((d, i) => {
      positions.set(scale(fromRaDec(d.ra, d.dec), d.distance / MPC), i * 3);
      colors.set(d.color, i * 3);
      sizes[i] = d.diameter / MPC;
    });
    const layer = cloudLayer(this.sunNode, MPC, positions, colors, sizes);
    layer.object.renderOrder = 2;
    this.sky.add(layer.object);
    return layer;
  }

  private buildGuides(): void {
    const T = centuriesSinceJ2000(this.jd);
    const SEG = 2048;
    for (const [id, el] of Object.entries(PLANET_ELEMENTS)) {
      const o = jplOrbitAt(el, T);
      const layer = lineLayer(this.sunNode, AU, orbitPath(o, SEG), PAPER);
      layer.object.renderOrder = 6;
      this.sky.add(layer.object);
      this.orbits.push({ layer, body: id, a: o.a * AU });
    }
    {
      const layer = lineLayer(this.sunNode, AU, orbitPath(PLUTO_ELEMENTS, SEG), PAPER);
      layer.object.renderOrder = 6;
      this.sky.add(layer.object);
      this.orbits.push({ layer, body: 'pluto', a: PLUTO_ELEMENTS.a * AU });
    }
    {
      // The Moon's real path over one sidereal month around now, relative to Earth.
      const n = 720;
      const UNIT = 1e8;
      const path = new Float32Array((n + 1) * 3);
      for (let k = 0; k <= n; k++) {
        const p = moonGeocentric(this.jd + (k / n - 0.5) * 27.321661);
        path.set([p[0] / UNIT, p[1] / UNIT, p[2] / UNIT], k * 3);
      }
      const layer = lineLayer(this.nodes.get('earth')!, UNIT, path, PAPER);
      layer.object.renderOrder = 6;
      this.sky.add(layer.object);
      this.orbits.push({ layer, body: 'moon', a: 3.844e8 });
    }

    // Light-time rings around Earth, in the plane of the ecliptic: a ruler for the empty stretches.
    const circle = new Float32Array(257 * 3);
    const e1 = normalize(sub(REF, scale(ECLIPTIC_NORTH, dot(REF, ECLIPTIC_NORTH))));
    const e2 = cross(ECLIPTIC_NORTH, e1);
    for (let k = 0; k <= 256; k++) {
      const a = (k / 256) * 2 * Math.PI;
      circle.set([
        e1[0] * Math.cos(a) + e2[0] * Math.sin(a),
        e1[1] * Math.cos(a) + e2[1] * Math.sin(a),
        e1[2] * Math.cos(a) + e2[2] * Math.sin(a),
      ], k * 3);
    }
    const C = 299_792_458;
    const defs: [number, string][] = [
      [C, '1 light-second'],
      [C * 60, '1 light-minute'],
      [C * 3600, '1 light-hour'],
      [C * 86_400, '1 light-day'],
    ];
    const words = ['', '', '', ' thousand', ' thousand', ' thousand', ' million', ' million', ' million', ' billion', ' billion'];
    for (let k = 0; k <= 10; k++) {
      const lead = ['1', '10', '100'][k % 3];
      defs.push([LY * 10 ** k, `${lead}${words[k]} light-year${k === 0 ? '' : 's'}`]);
    }
    for (const [radius, text] of defs) {
      if (radius > HORIZON) continue;
      const layer = lineLayer(this.nodes.get('earth')!, radius, circle, ACCENT_INK);
      layer.object.renderOrder = 5;
      this.sky.add(layer.object);
      this.rings.push({ layer, radius, text });
    }
  }

  /** Fetch the star catalogue and build the Milky Way. Called once the first frame is on screen. */
  async loadStars(): Promise<void> {
    const base = `${import.meta.env.BASE_URL}data/`;
    const [bufA, names] = await Promise.all([
      fetch(`${base}stars-a.bin`).then((r) => r.arrayBuffer()),
      fetch(`${base}star-names.json`).then((r) => r.json()),
    ]);
    this.setStars([bufA], names);
    this.buildMilkyWay();
    if (!this.weak) {
      const bufB = await fetch(`${base}stars-b.bin`).then((r) => r.arrayBuffer());
      this.setStars([bufA, bufB], names);
    }
  }

  private setStars(buffers: ArrayBuffer[], names: Omit<NamedStar, 'target' | 'p'>[]): void {
    const parts = buffers.map((b) => decodeCatalogue(b));
    const count = 1 + parts.reduce((n, p) => n + p.count, 0);
    const positions = new Float32Array(count * 3);
    const mags = new Float32Array(count);
    const colors = new Float32Array(count * 3);
    // Index 0 is the Sun, so it behaves like every other star once you leave it behind.
    mags[0] = SUN_ABS_MAG;
    colors.set(bvToRgb(0.656), 0);
    let o = 1;
    for (const p of parts) {
      positions.set(p.positions, o * 3);
      mags.set(p.a, o);
      for (let i = 0; i < p.count; i++) colors.set(bvToRgb(p.bv[i]), (o + i) * 3);
      o += p.count;
    }
    this.stars?.dispose();
    this.stars = starLayer(this.sunNode, PC, positions, mags, colors);
    this.stars.object.renderOrder = 3;
    this.sky.add(this.stars.object);
    this.starCount = count;
    this.starData = { positions };

    for (const s of this.namedStars) {
      this.targets.delete(s.target.id);
    }
    this.namedStars = [];
    for (const s of names) {
      const i = s.index + 1;
      if (i >= count) continue;
      const p: Vec3 = [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
      const name = STAR_ALIASES[s.name] ?? s.name;
      const id = `star:${s.name}`;
      const lum = Math.pow(10, 0.4 * (SUN_ABS_MAG - s.abs));
      const lumText =
        lum >= 1.5 ? `${sig3(lum)} times as much visible light as the Sun` :
        lum > 0.67 ? 'about as much visible light as the Sun' :
        `${sig3(1 / lum)} times less visible light than the Sun`;
      const node: FrameNode = { id, parent: this.sunNode, local: scale(p, PC) };
      const target: Target = {
        id,
        name,
        type: 'star',
        node,
        radius: 0,
        minDist: AU,
        arriveDist: 60 * AU,
        info: {
          title: name,
          kind: `Star${s.spect ? ` · type ${s.spect}` : ''}`,
          facts: `${name} is ${spectralPhrase(s.spect)}, ${sig3((s.pc * PC) / LY)} light-years from the Sun. It gives off ${lumText}. Stars other than the Sun are drawn as points of light: at true scale their discs are far too small to see.`,
          stats: [
            ['Distance', `${sig3((s.pc * PC) / LY)} light-years`],
            ['Brightness from Earth', `magnitude ${s.mag.toFixed(2)}`],
            ['Absolute magnitude', s.abs.toFixed(2)],
          ],
          source: { label: 'HYG star database 4.1', url: 'https://www.astronexus.com/projects/hyg' },
        },
      };
      this.targets.set(id, target);
      this.namedStars.push({ ...s, name, target, p });
    }
    this.invalidate();
  }

  private buildMilkyWay(): void {
    if (this.milkyWay) return;
    const cloud = generateMilkyWay(this.weak ? 26000 : 64000);
    this.milkyWay = cloudLayer(this.sunNode, KPC, cloud.positions, cloud.colors, 0.26);
    this.milkyWay.object.renderOrder = 1;
    this.sky.add(this.milkyWay.object);
    this.invalidate();
  }

  /** Load and release catalogues by scale, so memory stays flat across the journey. */
  private manageAssets(logSun: number, logEarth: number): void {
    const base = `${import.meta.env.BASE_URL}data/`;
    // Asteroids and Kuiper belt objects: only inside the solar system and its outskirts.
    if (!this.belts.length && !this.beltsLoading && logSun > 9.6 && logSun < 16.2) {
      this.beltsLoading = true;
      Promise.all(['mba', 'tno'].map((n) => fetch(`${base}${n}.bin`).then((r) => r.arrayBuffer())))
        .then(([mba, tno]) => {
          this.belts = [
            { layer: this.beltLayer(mba, 1.3), kind: 'mba' as const },
            { layer: this.beltLayer(tno, 1.7), kind: 'tno' as const },
          ];
          this.invalidate();
        })
        .finally(() => (this.beltsLoading = false));
    } else if (this.belts.length && logSun > 17.2) {
      for (const b of this.belts) b.layer.dispose();
      this.belts = [];
    }
    // Surveyed galaxies: only once the Milky Way is small.
    if (!this.galaxies && !this.galaxiesLoading && logEarth > 21.6) {
      this.galaxiesLoading = true;
      fetch(`${base}galaxies.bin`)
        .then((r) => r.arrayBuffer())
        .then((buf) => {
          const cat = decodeCatalogue(buf, this.weak ? 60000 : Infinity);
          this.galaxies = dotLayer(this.sunNode, MPC, cat.positions, 0xffe9cf, 1.7);
          this.galaxies.object.renderOrder = 0;
          this.sky.add(this.galaxies.object);
          this.invalidate();
        })
        .finally(() => (this.galaxiesLoading = false));
    } else if (this.galaxies && logEarth < 20.4) {
      this.galaxies.dispose();
      this.galaxies = null;
    }
  }

  private beltLayer(buf: ArrayBuffer, size: number): Layer<THREE.Points> {
    const el = new Float32Array(buf);
    const n = el.length / 7;
    const positions = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const o = i * 7;
      const p = smallBodyPosition(
        { a: el[o], e: el[o + 1], i: el[o + 2], node: el[o + 3], argPeri: el[o + 4], ma: el[o + 5], epoch: el[o + 6] },
        this.jd,
      );
      positions.set(p, i * 3);
    }
    const layer = dotLayer(this.sunNode, AU, positions, 0xcfc8b8, size);
    layer.object.renderOrder = 4;
    this.sky.add(layer.object);
    return layer;
  }

  // ------------------------------------------------------------------------------------------
  // Controls
  // ------------------------------------------------------------------------------------------

  invalidate(): void {
    this.dirty = true;
    if (!this.running) {
      this.running = true;
      this.lastTime = performance.now();
      requestAnimationFrame(this.tick);
    }
  }

  private get maxLog(): number {
    return LOG_MAX;
  }
  private get minLog(): number {
    return Math.log10(this.focus.minDist);
  }

  private userTookOver(): void {
    if (this.journey || this.pendingJourney) {
      this.journey = null;
      this.pendingJourney = false;
      this.onJourney(false);
    }
    this.tween = null;
  }

  /** Multiply the distance to the focus by 10^delta. */
  zoomBy(delta: number): void {
    this.userTookOver();
    if (this.fly) return;
    this.targetLogD = clamp(this.targetLogD + delta, this.minLog, this.maxLog);
    this.invalidate();
  }

  /** Continuous zoom while a key or button is held: decades per second, 0 to stop. */
  holdZoomRate(rate: number): void {
    if (rate !== 0) this.userTookOver();
    this.holdZoom = rate;
    this.invalidate();
  }

  orbitBy(dAz: number, dEl: number, inertia = false): void {
    if (this.journey) {
      // Looking around does not stop the journey; it just steers the view.
      this.az += dAz;
      this.el = clamp(this.el + dEl, -1.5, 1.5);
      this.invalidate();
      return;
    }
    this.az += dAz;
    this.el = clamp(this.el + dEl, -1.5, 1.5);
    if (inertia && !this.reducedMotion) {
      this.azVel = dAz * 60;
      this.elVel = dEl * 60;
    } else {
      this.azVel = this.elVel = 0;
    }
    this.invalidate();
  }

  stopInertia(): void {
    this.azVel = this.elVel = 0;
  }

  flyTo(target: Target, arriveDist?: number): void {
    this.userTookOver();
    this.beginFly(target, arriveDist);
  }

  private beginFly(target: Target, arriveDist?: number): void {
    const cam = this.cameraState();
    const fromLook = this.lookDirection();
    const offset = scale(cameraRelative(target.node, cam), -1);
    const d = Math.max(length(offset), 1);
    const dirNow = azElOf(offset, ECLIPTIC_NORTH, REF);
    this.focus = target;
    this.az = dirNow.az;
    this.el = clamp(dirNow.el, -1.5, 1.5);
    this.logD = Math.log10(d);
    const toLog = clamp(Math.log10(arriveDist ?? target.arriveDist), this.minLog, this.maxLog);
    this.targetLogD = toLog;
    this.azVel = this.elVel = 0;
    const decades = Math.abs(toLog - this.logD);
    const dur = this.reducedMotion ? 0 : clamp(1.6 + decades * 0.45, 1.8, 6.5);
    this.fly = { t: 0, dur, fromLook, fromLog: this.logD, toLog };
    this.onFocus(target);
    this.invalidate();
  }

  /** Jump to a scale measured from Earth (log10 metres). */
  goToScale(logD: number): void {
    this.userTookOver();
    const earth = this.targets.get('earth')!;
    const v = clamp(logD, Math.log10(earth.minDist), LOG_MAX);
    if (this.focus !== earth) {
      this.beginFly(earth, 10 ** v);
      return;
    }
    if (this.reducedMotion) {
      this.logD = this.targetLogD = v;
    } else {
      const decades = Math.abs(v - this.logD);
      this.tween = { t: 0, dur: clamp(0.7 + decades * 0.5, 0.9, 7), from: this.logD, to: v };
    }
    this.invalidate();
  }

  /** Scrub directly (rail drag): no easing beyond the usual smoothing. */
  scrubScale(logD: number): void {
    this.userTookOver();
    const earth = this.targets.get('earth')!;
    if (this.focus !== earth) {
      this.goToScale(logD);
      return;
    }
    this.targetLogD = clamp(logD, this.minLog, LOG_MAX);
    this.invalidate();
  }

  get playing(): boolean {
    return this.journey !== null || this.pendingJourney;
  }

  toggleJourney(): void {
    if (this.playing) {
      this.userTookOver();
      this.targetLogD = this.logD;
      this.invalidate();
      return;
    }
    const earth = this.targets.get('earth')!;
    this.tween = null;
    this.azVel = this.elVel = 0;
    const atEnd = this.logD > LOG_MAX - 0.15;
    if (this.focus !== earth || atEnd) {
      // Go home first, then set off.
      this.pendingJourney = true;
      if (this.focus !== earth) this.beginFly(earth, 10 ** JOURNEY_KEYS[0].v);
      else if (this.reducedMotion) this.logD = this.targetLogD = JOURNEY_KEYS[0].v;
      else this.tween = { t: 0, dur: 3.2, from: this.logD, to: JOURNEY_KEYS[0].v };
    } else {
      this.journey = { t: timeFor(JOURNEY_KEYS, Math.max(this.logD, JOURNEY_KEYS[0].v)) };
    }
    this.onJourney(true);
    this.invalidate();
  }

  setGuides(on: boolean): void {
    this.guides = on;
    this.invalidate();
  }

  setLongExposure(on: boolean): void {
    this.longExposure = on;
    this.invalidate();
  }

  pickAt(x: number, y: number, slop: number): Target | null {
    return pick(this.candidates, x, y, slop);
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.width = w;
    this.height = h;
    if (this.dpr === 1 && this.frameTimes.length === 0) {
      this.dpr = Math.min(window.devicePixelRatio || 1, this.weak ? 1.5 : 2);
    }
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.invalidate();
  }

  // ------------------------------------------------------------------------------------------
  // Frame loop
  // ------------------------------------------------------------------------------------------

  private tick = (now: number): void => {
    const dt = Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;
    const moving = this.step(dt);
    if (this.dirty || moving) {
      this.dirty = false;
      this.drawFrame(dt);
      this.frameTimes.push(dt * 1000);
      if (this.frameTimes.length > 90) this.frameTimes.shift();
      this.adapt(dt);
    }
    if (moving || this.dirty) {
      requestAnimationFrame(this.tick);
    } else {
      // Nothing is changing: stop asking for frames until something does.
      this.running = false;
    }
  };

  /** If the device cannot hold the frame rate, give up resolution rather than smoothness. */
  private adapt(dt: number): void {
    if (dt > 0.024) this.slowFrames++;
    else this.slowFrames = Math.max(0, this.slowFrames - 2);
    if (this.slowFrames > 45 && this.dpr > 1) {
      this.dpr = Math.max(1, this.dpr - 0.25);
      this.slowFrames = 0;
      this.resize();
    }
  }

  /** Advance the camera. Returns true while anything is still moving. */
  private step(dt: number): boolean {
    let moving = false;
    const ease = (x: number) => x * x * (3 - 2 * x);

    if (this.fly) {
      const f = this.fly;
      f.t += dt;
      const k = f.dur <= 0 ? 1 : clamp(f.t / f.dur, 0, 1);
      this.logD = f.fromLog + (f.toLog - f.fromLog) * ease(k);
      if (k >= 1) {
        this.fly = null;
        this.logD = this.targetLogD = f.toLog;
        if (this.pendingJourney) {
          this.pendingJourney = false;
          this.journey = { t: 0 };
        }
      }
      return true;
    }

    if (this.tween) {
      const w = this.tween;
      w.t += dt;
      const k = clamp(w.t / w.dur, 0, 1);
      this.logD = this.targetLogD = w.from + (w.to - w.from) * ease(k);
      if (k >= 1) {
        this.tween = null;
        if (this.pendingJourney) {
          this.pendingJourney = false;
          this.journey = { t: 0 };
        }
      }
      return true;
    }

    if (this.pendingJourney) {
      this.pendingJourney = false;
      this.journey = { t: 0 };
    }

    if (this.journey) {
      const j = this.journey;
      if (this.reducedMotion) {
        // No continuous motion: hold each stop, then cut to the next.
        j.t += dt;
        const stop = Math.min(JOURNEY_KEYS.length - 1, Math.floor(j.t / 5));
        this.logD = this.targetLogD = JOURNEY_KEYS[stop].v;
        if (j.t > JOURNEY_KEYS.length * 5) this.endJourney();
        return true;
      }
      j.t += dt;
      this.logD = this.targetLogD = monotoneAt(JOURNEY_KEYS, j.t);
      // A slow sweep around, rising above the plane so orbits and the galaxy open up.
      this.az += dt * 0.045;
      this.el = smoothTo(this.el, 0.52, dt, 9);
      if (j.t >= JOURNEY_SECONDS) this.endJourney();
      return true;
    }

    if (this.holdZoom !== 0) {
      this.targetLogD = clamp(this.targetLogD + this.holdZoom * dt, this.minLog, this.maxLog);
      moving = true;
    }
    if (Math.abs(this.targetLogD - this.logD) > 1e-5) {
      this.logD = this.reducedMotion ? this.targetLogD : smoothTo(this.logD, this.targetLogD, dt, 0.11);
      moving = true;
    } else {
      this.logD = this.targetLogD;
    }
    if (Math.abs(this.azVel) > 1e-4 || Math.abs(this.elVel) > 1e-4) {
      this.az += this.azVel * dt;
      this.el = clamp(this.el + this.elVel * dt, -1.5, 1.5);
      const decay = Math.exp(-dt / 0.35);
      this.azVel *= decay;
      this.elVel *= decay;
      moving = true;
    }
    return moving;
  }

  private endJourney(): void {
    this.journey = null;
    this.onJourney(false);
  }

  private cameraState(): CameraState {
    const dir = orbitDirection(this.az, this.el, ECLIPTIC_NORTH, REF);
    return { focus: this.focus.node, offset: scale(dir, 10 ** this.logD) };
  }

  private lookDirection(): Vec3 {
    const toFocus = scale(orbitDirection(this.az, this.el, ECLIPTIC_NORTH, REF), -1);
    if (!this.fly || this.fly.dur <= 0) return toFocus;
    // While flying to a new object, turn towards it during the first part of the flight.
    const k = clamp(this.fly.t / (this.fly.dur * 0.4), 0, 1);
    return slerp(this.fly.fromLook, toFocus, k * k * (3 - 2 * k));
  }

  private drawFrame(_dt: number): void {
    const cam = this.cameraState();
    const basis = viewBasis(this.lookDirection(), ECLIPTIC_NORTH);
    this.lastBasis = basis;
    this.lastCam = cam;
    const { width, height, dpr } = this;
    const f: FrameUniforms = {
      basis,
      tanHalfFov: TAN_HALF_FOV,
      aspect: width / height,
      halfHeightPx: (height * dpr) / 2,
      dpr,
    };
    const earthRel = cameraRelative(this.nodes.get('earth')!, cam);
    const sunRel = cameraRelative(this.sunNode, cam);
    const distEarth = length(earthRel);
    const distSun = length(sunRel);
    const logEarth = Math.log10(Math.max(distEarth, 1));
    const logSun = Math.log10(Math.max(distSun, 1));
    this.manageAssets(logSun, logEarth);

    const g = this.guides ? 1 : 0;
    const sunPc = distSun / PC;

    // --- exposure -----------------------------------------------------------------------------
    // Naked eye: magnitude 6.5 everywhere. Long exposure: the limit rises as the Sun's
    // neighbourhood recedes, the way a longer exposure would, so the stars do not simply vanish.
    if (this.stars) {
      const u = this.stars.material.uniforms;
      u.uMagLimit.value = this.longExposure ? Math.max(7.0, 5 * Math.log10(Math.max(sunPc, 1e-9)) - 3.6) : 6.5;
      u.uFade.value = this.longExposure ? 1 - 0.9 * smoothstep(2.2, 4.3, Math.log10(Math.max(sunPc, 1e-9))) : 1;
      this.stars.visible = logSun < 23.2;
      this.stars.place(cam, f);
    }
    if (this.milkyWay) {
      const u = this.milkyWay.material.uniforms;
      const outside = smoothstep(19.6, 21.0, logSun);
      const bright = this.longExposure ? 0.05 + 0.1 * outside : 0.03 * Math.min(1, (2.5e20 / Math.max(distSun, 2.5e20)) ** 2);
      u.uAlpha.value = bright;
      u.uMinPx.value = 1.2;
      this.milkyWay.visible = logSun < 25.2;
      this.milkyWay.place(cam, f);
    }
    {
      const u = this.glows.material.uniforms;
      u.uAlpha.value = this.longExposure ? 0.85 * smoothstep(19.5, 21.2, logEarth) : 0;
      u.uMinPx.value = this.guides ? 3 : 0.5;
      u.uMinAlpha.value = this.guides ? 0.55 : 0;
      this.glows.visible = u.uAlpha.value > 0.001;
      this.glows.place(cam, f);
    }
    if (this.galaxies) {
      const u = this.galaxies.material.uniforms;
      u.uAlpha.value = this.longExposure
        ? 0.8 * smoothstep(22.4, 24.0, logEarth) * (1 - 0.55 * smoothstep(25.3, 26.6, logEarth))
        : 0;
      this.galaxies.visible = u.uAlpha.value > 0.001;
      this.galaxies.place(cam, f);
    }
    for (const b of this.belts) {
      const u = b.layer.material.uniforms;
      u.uAlpha.value =
        (this.longExposure ? 1 : 0) *
        (b.kind === 'mba'
          ? 0.55 * smoothstep(10.7, 11.5, logSun) * (1 - smoothstep(12.9, 13.9, logSun))
          : 0.8 * smoothstep(11.6, 12.5, logSun) * (1 - smoothstep(14.4, 15.4, logSun)));
      b.layer.visible = u.uAlpha.value > 0.001;
      b.layer.place(cam, f);
    }

    // --- guides -------------------------------------------------------------------------------
    for (const o of this.orbits) {
      const bodyDist = length(cameraRelative(this.nodes.get(o.body)!, cam));
      const parentDist = o.body === 'moon' ? distEarth : distSun;
      const isFocus = this.focus.id === o.body;
      const a = g * smoothstep(0.02, 0.1, bodyDist / o.a) * (1 - smoothstep(2.3, 3.0, Math.log10(parentDist / o.a)));
      o.layer.material.uniforms.uAlpha.value = a * (isFocus ? 0.9 : 0.34);
      o.layer.material.uniforms.uColor.value.setHex(isFocus ? ACCENT_INK : PAPER);
      o.layer.visible = a > 0.003;
      if (o.layer.visible) o.layer.place(cam, f);
    }
    const ringLabels: Label[] = [];
    for (const r of this.rings) {
      const ratio = r.radius / distEarth;
      const a = g * smoothstep(0.05, 0.12, ratio) * (1 - smoothstep(0.75, 1.5, ratio));
      r.layer.material.uniforms.uAlpha.value = a * 0.5;
      r.layer.visible = a > 0.01;
      if (!r.layer.visible) continue;
      r.layer.place(cam, f);
      // Label the ring at whichever of four points sits lowest on screen and in view.
      let best: { x: number; y: number } | null = null;
      const pos = r.layer.object.geometry.getAttribute('position');
      for (const k of [0, 64, 128, 192, 32, 96, 160, 224]) {
        const rel: Vec3 = [
          earthRel[0] + pos.getX(k) * r.radius,
          earthRel[1] + pos.getY(k) * r.radius,
          earthRel[2] + pos.getZ(k) * r.radius,
        ];
        const s = projectToScreen(rel, basis, TAN_HALF_FOV, width, height);
        if (!s.inFront || s.x < 60 || s.x > width - 60 || s.y < 80 || s.y > height - 120) continue;
        if (!best || s.y > best.y) best = s;
      }
      if (best && a > 0.5) {
        ringLabels.push({
          id: `ring:${r.text}`, text: r.text, x: best.x, y: best.y, priority: 50,
          marker: false, focused: false, style: 'ring', target: null,
        });
      }
    }

    // --- draw: sky first, then solid bodies far to near, each with its own depth range --------
    const gl = this.renderer;
    gl.info.reset();
    gl.clear(true, true, false);
    gl.render(this.sky, this.dummyCamera);

    const m = new THREE.Matrix4().makeBasis(
      new THREE.Vector3(...basis.right),
      new THREE.Vector3(...basis.up),
      new THREE.Vector3(-basis.look[0], -basis.look[1], -basis.look[2]),
    );
    this.camera.quaternion.setFromRotationMatrix(m);
    this.camera.position.set(0, 0, 0);
    this.camera.updateMatrixWorld(true);

    const candidates: PickCandidate<Target>[] = [];
    const labels: Label[] = [...ringLabels];
    const drawList: { body: Body; rel: Vec3; dist: number; px: number }[] = [];
    const pxPerRad = height / 2 / TAN_HALF_FOV;
    for (const body of this.bodies) {
      const node = this.nodes.get(body.def.id)!;
      const rel = cameraRelative(node, cam);
      const dist = length(rel);
      const px = pixelRadius(body.radius, dist, TAN_HALF_FOV, height);
      const screen = projectToScreen(rel, basis, TAN_HALF_FOV, width, height);
      const target = this.targets.get(body.def.id)!;
      body.refine(Number.isFinite(px) ? px * 2 * dpr : 1e5, this.weak ? 1 : 2);
      if (screen.inFront || dist < body.bound * 3) {
        if (px > 0.3) drawList.push({ body, rel, dist, px });
      }
      if (!screen.inFront) continue;
      // A label has room once the body's orbit is wider than a few dozen pixels on screen.
      const parentDist = body.def.parent === 'earth' ? distEarth : distSun;
      const orbitPx = body.def.orbit > 0 ? (body.def.orbit / Math.max(parentDist, 1)) * pxPerRad : Infinity;
      // Once a body's whole orbit is a few pixels wide its label hands over to its parent's.
      const isFocus = this.focus === target && orbitPx > 6;
      let show = orbitPx > 34 || isFocus;
      if (body.def.id === 'sun') show = logSun < 21.4;
      if (body.def.id === 'earth' && !isFocus && orbitPx <= 34) show = false;
      if (show) {
        candidates.push({ item: target, x: screen.x, y: screen.y, radius: Math.min(px, 4000), depth: dist });
        if (px < 90 || isFocus) {
          labels.push({
            id: target.id, text: target.name, x: screen.x, y: screen.y - Math.min(px, height) - 0,
            priority: isFocus ? 0 : body.def.id === 'sun' ? 1 : 2 + BODIES.indexOf(body.def) * 0.01,
            marker: px < 3.5, focused: isFocus, style: 'body', target,
          });
        }
      }
    }

    const sunDirOf = (id: string): Vec3 =>
      id === 'sun' ? [0, 0, 1] : normalize(relativeTo(this.sunNode, this.nodes.get(id)!));
    for (const item of farToNear(drawList)) {
      const { body, rel, dist } = item;
      const range = fitDepth(1, body.bound / dist);
      this.camera.near = range.near;
      this.camera.far = range.far;
      this.camera.updateProjectionMatrix();
      body.place(toRenderUnits(rel, dist), dist, this.bodyQuat.get(body.def.id)!, sunDirOf(body.def.id));
      body.group.visible = true;
      gl.clearDepth();
      gl.render(this.solid, this.camera);
      body.group.visible = false;
    }

    // --- labels for stars and deep-sky objects -------------------------------------------------
    if (this.starData && logSun > 15.2 && logSun < 19.4) {
      const camPc: Vec3 = [-sunRel[0] / PC, -sunRel[1] / PC, -sunRel[2] / PC];
      const limit = (this.stars!.material.uniforms.uMagLimit.value as number) - 3.2;
      const found: { s: NamedStar; m: number; x: number; y: number }[] = [];
      for (const s of this.namedStars) {
        const rel: Vec3 = [s.p[0] - camPc[0], s.p[1] - camPc[1], s.p[2] - camPc[2]];
        const d = length(rel);
        const mag = apparentMagnitude(s.abs, d);
        const isFocus = this.focus === s.target;
        if (mag > limit && !isFocus) continue;
        const sc = projectToScreen(rel, basis, TAN_HALF_FOV, width, height);
        if (!sc.inFront || sc.x < 0 || sc.x > width || sc.y < 0 || sc.y > height) continue;
        found.push({ s, m: isFocus ? -99 : mag, x: sc.x, y: sc.y });
        candidates.push({ item: s.target, x: sc.x, y: sc.y, radius: 0, depth: d * PC });
      }
      found.sort((a, b) => a.m - b.m);
      for (const [i, it] of found.slice(0, this.width < 700 ? 6 : 12).entries()) {
        labels.push({
          id: it.s.target.id, text: it.s.name, x: it.x, y: it.y, priority: 10 + i,
          marker: false, focused: this.focus === it.s.target, style: 'star', target: it.s.target,
        });
      }
    } else if (this.focus.type === 'star') {
      const rel = cameraRelative(this.focus.node, cam);
      const sc = projectToScreen(rel, basis, TAN_HALF_FOV, width, height);
      if (sc.inFront) {
        labels.push({
          id: this.focus.id, text: this.focus.name, x: sc.x, y: sc.y, priority: 0,
          marker: false, focused: true, style: 'star', target: this.focus,
        });
      }
    }
    for (const d of DEEP_SKY) {
      const target = this.targets.get(d.id)!;
      const isFocus = this.focus === target;
      if (!isFocus && (logEarth < d.window[0] || logEarth > d.window[1])) continue;
      const rel = cameraRelative(target.node, cam);
      const sc = projectToScreen(rel, basis, TAN_HALF_FOV, width, height);
      if (!sc.inFront) continue;
      const dist = length(rel);
      const px = d.diameter > 0 ? (d.diameter / 2 / dist) * pxPerRad : 0;
      candidates.push({ item: target, x: sc.x, y: sc.y, radius: Math.min(px, 200), depth: dist });
      labels.push({
        id: d.id, text: d.name, x: sc.x, y: sc.y - Math.min(px, 120), priority: isFocus ? 0 : 20 + DEEP_SKY.indexOf(d) * 0.1,
        marker: px < 3.5, focused: isFocus, style: 'deep', target,
      });
    }
    // Home marker once the Sun itself is lost in the galaxy.
    if (logSun >= 21.4) {
      const sc = projectToScreen(sunRel, basis, TAN_HALF_FOV, width, height);
      if (sc.inFront) {
        labels.push({
          id: 'home', text: 'Milky Way', x: sc.x, y: sc.y, priority: 1,
          marker: logSun > 23.2, focused: false, style: 'deep', target: this.targets.get('earth')!,
        });
      }
    }

    this.candidates = candidates;
    this.onFrame({
      distEarth,
      logEarth,
      focus: this.focus,
      playing: this.playing,
      progress: this.journey ? clamp(this.journey.t / JOURNEY_SECONDS, 0, 1) : 0,
      labels: this.guides ? labels : labels.filter((l) => l.focused && l.style !== 'ring'),
      width,
      height,
    });
  }

  // ------------------------------------------------------------------------------------------
  // Measurement
  // ------------------------------------------------------------------------------------------

  stats(): Stats {
    const t = this.frameTimes;
    const avg = t.length ? t.reduce((a, b) => a + b, 0) / t.length : 0;
    const info = this.renderer.info;
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    let bytes = 0;
    for (const e of performance.getEntriesByType('resource') as PerformanceResourceTiming[]) {
      bytes += e.transferSize || e.encodedBodySize || 0;
    }
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    if (nav) bytes += nav.transferSize || nav.encodedBodySize || 0;
    return {
      fps: avg ? 1000 / avg : 0,
      frameMs: avg,
      drawCalls: info.render.calls,
      points: info.render.points,
      textures: info.memory.textures,
      geometries: info.memory.geometries,
      heapMb: mem ? mem.usedJSHeapSize / 1048576 : null,
      transferredMb: bytes / 1048576,
      dpr: this.dpr,
      stars: this.starCount,
      idle: !this.running,
    };
  }

  /** For tests and recordings: the current camera, in plain numbers. */
  debugState(): { focus: string; logD: number; az: number; el: number; look: Vec3 } {
    return { focus: this.focus.id, logD: this.logD, az: this.az, el: this.el, look: this.lastBasis.look };
  }

  /** Jump without animation (used by the screenshot harness and deep links). */
  jump(logD: number, az?: number, el?: number): void {
    this.userTookOver();
    this.fly = null;
    this.focus = this.targets.get('earth')!;
    this.logD = this.targetLogD = clamp(logD, this.minLog, LOG_MAX);
    if (az !== undefined) this.az = az;
    if (el !== undefined) this.el = el;
    this.onFocus(this.focus);
    this.invalidate();
  }

  get currentCamera(): CameraState {
    return this.lastCam;
  }
}



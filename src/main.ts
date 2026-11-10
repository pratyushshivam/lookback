import '@fontsource-variable/geist/wght.css';
import './style.css';
import { lookbackTime } from './core/cosmology.ts';
import { C, formatAu, formatDistance, formatDuration } from './core/units.ts';
import { CHAPTERS, chapterAt, LOG_MAX, LOG_MIN } from './data/journey.ts';
import { Engine, type FrameInfo, type Label, type Target } from './engine.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const params = new URLSearchParams(location.search);
const nav = navigator as Navigator & { deviceMemory?: number };
const weak =
  params.has('weak') ||
  (!params.has('full') &&
    (matchMedia('(pointer: coarse)').matches ||
      (nav.hardwareConcurrency ?? 8) <= 4 ||
      (nav.deviceMemory ?? 8) <= 4));

const canvas = $<HTMLCanvasElement>('space');
let engine: Engine;
try {
  engine = new Engine(canvas, { weak, reducedMotion });
} catch (err) {
  $('loader').querySelector('.loader-note')!.textContent =
    'This browser could not start WebGL, which Lookback needs to draw.';
  throw err;
}

// ---- loader -----------------------------------------------------------------------------------
engine.ready.then(() => {
  $('loader').classList.add('gone');
  setTimeout(() => $('loader').remove(), 1400);
  engine.loadStars().catch((e) => console.error(e));
  if (params.has('play')) engine.toggleJourney();
});

// ---- readout ----------------------------------------------------------------------------------
const elDistance = $('distance');
const elLight = $('light');
const elChapterTitle = $('chapter-title');
const elChapterText = $('chapter-text');
const elThumb = $('rail-thumb');
const elPlay = $('btn-play');
const elProg = elPlay.querySelector<HTMLElement>('.prog')!;
const stops = $('rail-stops');
let chapterId = '';
const text = (el: HTMLElement, s: string) => {
  if (el.textContent !== s) el.textContent = s;
};
const railPos = (logD: number) => ((logD - LOG_MIN) / (LOG_MAX - LOG_MIN)) * 100;

for (const c of CHAPTERS) {
  const li = document.createElement('li');
  li.style.bottom = `${railPos(c.stop)}%`;
  li.dataset.id = c.id;
  const b = document.createElement('button');
  b.textContent = c.title;
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    engine.goToScale(c.stop);
  });
  li.append(b);
  stops.append(li);
}

function lightLine(d: number): string {
  // Out to the Local Group the two are the same number. Beyond, space has stretched on the way.
  if (d < 3e22) return `Light takes ${formatDuration(d / C)}`;
  return `Its light left ${formatDuration(lookbackTime(d))} ago`;
}

function onFrame(f: FrameInfo): void {
  text(elDistance, formatDistance(f.distEarth));
  const au = formatAu(f.distEarth);
  text(elLight, lightLine(f.distEarth) + (au ? ` · ${au}` : ''));
  const ch = chapterAt(f.logEarth);
  if (ch.id !== chapterId) {
    chapterId = ch.id;
    text(elChapterTitle, ch.title);
    elChapterText.classList.add('swap');
    setTimeout(() => {
      elChapterText.textContent = ch.text;
      elChapterText.classList.remove('swap');
    }, reducedMotion ? 0 : 220);
    for (const li of stops.children) li.classList.toggle('on', (li as HTMLElement).dataset.id === ch.id);
  }
  elThumb.style.bottom = `${Math.min(100, Math.max(0, railPos(f.logEarth)))}%`;
  elProg.style.transform = `scaleX(${f.playing ? f.progress : 0})`;
  drawLabels(f.labels, f.width, f.height);
}

// ---- labels -----------------------------------------------------------------------------------
const labelRoot = $('labels');
const pool = new Map<string, { el: HTMLElement; target: Target | null }>();

function drawLabels(labels: Label[], width: number, height: number): void {
  const kept: Label[] = [];
  const boxes: [number, number, number, number][] = [];
  for (const l of [...labels].sort((a, b) => a.priority - b.priority)) {
    if (l.x < -20 || l.x > width + 20 || l.y < -20 || l.y > height + 20) continue;
    const w = l.text.length * 6.6 + 24;
    const box: [number, number, number, number] = [l.x - 14, l.y - 22, l.x + w, l.y + 12];
    if (boxes.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
    boxes.push(box);
    kept.push(l);
  }
  const seen = new Set<string>();
  for (const l of kept) {
    seen.add(l.id);
    let entry = pool.get(l.id);
    if (!entry) {
      const el = document.createElement('div');
      el.innerHTML = '<span></span>';
      el.addEventListener('click', () => {
        const t = pool.get(l.id)?.target;
        if (t) select(t);
      });
      labelRoot.append(el);
      entry = { el, target: l.target };
      pool.set(l.id, entry);
    }
    entry.target = l.target;
    const cls = `lbl ${l.style}${l.marker ? ' mk' : ''}${l.focused ? ' focus' : ''}`;
    if (entry.el.className !== cls) entry.el.className = cls;
    text(entry.el.firstElementChild as HTMLElement, l.text);
    entry.el.style.transform = `translate3d(${l.x.toFixed(1)}px, ${l.y.toFixed(1)}px, 0)`;
  }
  for (const [id, entry] of pool) {
    if (!seen.has(id)) {
      entry.el.remove();
      pool.delete(id);
    }
  }
}

// ---- info card and places ---------------------------------------------------------------------
const info = $('info');
function showInfo(t: Target): void {
  $('info-kind').textContent = t.info.kind;
  $('info-title').textContent = t.info.title;
  $('info-facts').textContent = t.info.facts;
  const dl = $('info-stats');
  dl.replaceChildren();
  for (const [k, v] of t.info.stats) {
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = v;
    dl.append(dt, dd);
  }
  const a = $<HTMLAnchorElement>('info-source');
  a.textContent = t.info.source.label;
  a.href = t.info.source.url;
  info.hidden = false;
}
function select(t: Target): void {
  engine.flyTo(t);
  showInfo(t);
  closePlaces();
}
$('info-close').addEventListener('click', () => (info.hidden = true));

const places = $('places');
const btnPlaces = $('btn-places');
const PLACE_IDS = [
  'sun', 'mercury', 'venus', 'earth', 'moon', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto', '-',
  'star:Rigil Kentaurus', 'star:Sirius', 'star:Vega', 'star:Betelgeuse', 'star:Polaris', '-',
  'sgr-a', 'lmc', 'm31', 'virgo', 'coma', 'sloan-wall',
];
function fillPlaces(): void {
  const list = $('places-list');
  list.replaceChildren();
  for (const id of PLACE_IDS) {
    const li = document.createElement('li');
    if (id === '-') {
      li.className = 'sep';
    } else {
      const t = engine.targets.get(id);
      if (!t) continue;
      const b = document.createElement('button');
      b.innerHTML = `<span></span><small></small>`;
      b.firstElementChild!.textContent = t.name;
      b.lastElementChild!.textContent = t.info.kind.split(' · ')[0].split(' (')[0];
      b.addEventListener('click', () => select(t));
      li.append(b);
    }
    list.append(li);
  }
}
function closePlaces(): void {
  places.hidden = true;
  btnPlaces.setAttribute('aria-expanded', 'false');
}
btnPlaces.addEventListener('click', () => {
  if (places.hidden) fillPlaces();
  places.hidden = !places.hidden;
  btnPlaces.setAttribute('aria-expanded', String(!places.hidden));
});

// ---- toggles ----------------------------------------------------------------------------------
const btnGuides = $('btn-guides');
const btnExposure = $('btn-exposure');
function toggleGuides(): void {
  engine.setGuides(!engine.guides);
  btnGuides.setAttribute('aria-pressed', String(engine.guides));
}
function toggleExposure(): void {
  engine.setLongExposure(!engine.longExposure);
  btnExposure.setAttribute('aria-pressed', String(engine.longExposure));
}
btnGuides.addEventListener('click', toggleGuides);
btnExposure.addEventListener('click', toggleExposure);

const about = $<HTMLDialogElement>('about');
$('btn-about').addEventListener('click', () => about.showModal());
$('about-close').addEventListener('click', () => about.close());
about.addEventListener('click', (e) => {
  if (e.target === about) about.close();
});

elPlay.addEventListener('click', () => engine.toggleJourney());
engine.onJourney = (playing) => {
  elPlay.classList.toggle('on', playing);
  text(elPlay.querySelector<HTMLElement>('.txt')!, playing ? 'Pause' : 'Play the journey');
  if (playing) {
    info.hidden = true;
    hideHint();
  }
};
engine.onFocus = (t) => {
  if (t.id === 'earth' && !info.hidden && $('info-title').textContent !== 'Earth') info.hidden = true;
};
engine.onFrame = onFrame;
engine.invalidate();

const hint = $('hint');
function hideHint(): void {
  hint.classList.add('gone');
}
if (matchMedia('(pointer: coarse)').matches) hint.textContent = 'Pinch to pull back · drag to look around · tap anything';

// ---- pointer, wheel, touch --------------------------------------------------------------------
const pointers = new Map<number, { x: number; y: number }>();
let moved = 0;
let pinchDist = 0;
let downAt = 0;

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  engine.stopInertia();
  moved = 0;
  downAt = performance.now();
  canvas.classList.add('dragging');
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
  }
  closePlaces();
});
canvas.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  const dx = e.clientX - p.x;
  const dy = e.clientY - p.y;
  p.x = e.clientX;
  p.y = e.clientY;
  moved += Math.abs(dx) + Math.abs(dy);
  if (pointers.size === 1) {
    if (moved > 4) {
      const k = 0.0055;
      engine.orbitBy(-dx * k, dy * k, true);
      hideHint();
    }
  } else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinchDist > 0 && d > 0) {
      // Amplified: a full pinch covers about three orders of magnitude.
      engine.zoomBy(-Math.log10(d / pinchDist) * 4.5);
      hideHint();
    }
    pinchDist = d;
  }
});
function pointerUp(e: PointerEvent): void {
  if (!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);
  canvas.classList.toggle('dragging', pointers.size > 0);
  if (pointers.size === 0 && moved < 6 && performance.now() - downAt < 500) {
    const hit = engine.pickAt(e.clientX, e.clientY, e.pointerType === 'touch' ? 24 : 14);
    if (hit) select(hit);
  }
  pinchDist = 0;
}
canvas.addEventListener('pointerup', pointerUp);
canvas.addEventListener('pointercancel', pointerUp);

let lastWheel = 0;
let wheelGain = 1;
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
    const dy = e.deltaY * unit;
    // Keep scrolling and it speeds up: twenty orders of magnitude is a long way.
    const now = performance.now();
    wheelGain = now - lastWheel < 140 ? Math.min(3.2, wheelGain + 0.08) : 1;
    lastWheel = now;
    const k = e.ctrlKey ? 0.006 : 0.0016;
    engine.zoomBy(Math.max(-1.2, Math.min(1.2, dy * k * wheelGain)));
    hideHint();
  },
  { passive: false },
);

// Hold buttons for touch and mouse.
for (const [id, rate] of [['btn-out', 1.3], ['btn-in', -1.3]] as const) {
  const b = $(id);
  const stop = () => engine.holdZoomRate(0);
  b.addEventListener('pointerdown', (e) => {
    b.setPointerCapture(e.pointerId);
    engine.holdZoomRate(rate);
    hideHint();
  });
  b.addEventListener('pointerup', stop);
  b.addEventListener('pointercancel', stop);
  b.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      engine.zoomBy(rate * 0.4);
    }
  });
}

// Rail: click or drag anywhere on it to scrub through the scales.
const rail = $('rail');
function railScrub(e: PointerEvent): void {
  const r = rail.getBoundingClientRect();
  const t = 1 - (e.clientY - r.top) / r.height;
  engine.scrubScale(LOG_MIN + Math.min(1, Math.max(0, t)) * (LOG_MAX - LOG_MIN));
}
rail.addEventListener('pointerdown', (e) => {
  if ((e.target as HTMLElement).closest('button')) return;
  rail.setPointerCapture(e.pointerId);
  railScrub(e);
  hideHint();
});
rail.addEventListener('pointermove', (e) => {
  if (rail.hasPointerCapture(e.pointerId)) railScrub(e);
});

// ---- keyboard ---------------------------------------------------------------------------------
const held = new Set<string>();
addEventListener('keydown', (e) => {
  if (about.open) return;
  const tag = (e.target as HTMLElement).tagName;
  const onButton = tag === 'BUTTON' || tag === 'A';
  switch (e.key) {
    case 'ArrowUp': case 'w': case '-': case '_':
      e.preventDefault();
      if (!held.has(e.key)) { held.add(e.key); engine.holdZoomRate(1.3); }
      break;
    case 'ArrowDown': case 's': case '+': case '=':
      e.preventDefault();
      if (!held.has(e.key)) { held.add(e.key); engine.holdZoomRate(-1.3); }
      break;
    case 'ArrowLeft': case 'a': engine.orbitBy(-0.09, 0, true); break;
    case 'ArrowRight': case 'd': engine.orbitBy(0.09, 0, true); break;
    case 'PageUp': engine.orbitBy(0, 0.09, true); break;
    case 'PageDown': engine.orbitBy(0, -0.09, true); break;
    case ' ':
      if (onButton) return;
      e.preventDefault();
      engine.toggleJourney();
      break;
    case 'g': case 'G': toggleGuides(); break;
    case 'e': case 'E': toggleExposure(); break;
    case 'h': case 'H': case 'Home': select(engine.targets.get('earth')!); break;
    case 'Escape': info.hidden = true; closePlaces(); break;
    default: return;
  }
  hideHint();
});
addEventListener('keyup', (e) => {
  if (held.delete(e.key) && held.size === 0) engine.holdZoomRate(0);
});
addEventListener('blur', () => {
  held.clear();
  engine.holdZoomRate(0);
});
$('info').addEventListener('wheel', (e) => e.stopPropagation());
document.querySelector('.mark')!.addEventListener('click', (e) => {
  e.preventDefault();
  select(engine.targets.get('earth')!);
});

addEventListener('resize', () => engine.resize());

// ---- measurement overlay (?stats) and a handle for automated checks ---------------------------
if (params.has('stats')) {
  const el = $('stats');
  el.hidden = false;
  setInterval(() => {
    const s = engine.stats();
    el.textContent =
      `${s.idle ? 'idle (not drawing)' : `${s.fps.toFixed(0)} fps  ${s.frameMs.toFixed(1)} ms`}\n` +
      `draw calls ${s.drawCalls}  points ${s.points.toLocaleString()}\n` +
      `textures ${s.textures}  geometries ${s.geometries}  dpr ${s.dpr}\n` +
      `stars ${s.stars.toLocaleString()}${weak ? ' (light mode)' : ''}\n` +
      `heap ${s.heapMb ? s.heapMb.toFixed(0) + ' MB' : 'n/a'}  network ${s.transferredMb.toFixed(2)} MB`;
  }, 500);
}
(window as unknown as { lookback: Engine }).lookback = engine;

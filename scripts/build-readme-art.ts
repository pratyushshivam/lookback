/**
 * Writes the README graphics: hand-built SVG with CSS animation, in a light and a dark variant.
 *   assets/hero-{light,dark}.svg    the title beside a dot sky drawn from the app's own star catalogue
 *   assets/scale-{light,dark}.svg   the whole journey on one logarithmic axis, to scale
 * Every position and number in them is computed here from the same data and constants the app uses.
 * Run with `npm run readme`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { HORIZON, lookbackTime } from '../src/core/cosmology.ts';
import { apparentMagnitude } from '../src/core/photometry.ts';
import { decodeCatalogue } from '../src/core/starcodec.ts';
import { AU, C, formatDistance, formatDuration, LY } from '../src/core/units.ts';
import { cross, dot, fromRaDec, normalize, type Vec3 } from '../src/core/vec.ts';
import { DEEP_SKY } from '../src/data/deepsky.ts';

const root = new URL('../', import.meta.url);
const font = readFileSync(new URL('assets/fonts/Geist-readme.woff2', root)).toString('base64');
const buf = readFileSync(new URL('public/data/stars-a.bin', root));
const stars = decodeCatalogue(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
const names = JSON.parse(readFileSync(new URL('public/data/star-names.json', root), 'utf8')) as {
  name: string;
  index: number;
}[];

const THEMES = {
  light: { paper: '#f2eee5', ink: '#15140f', mute: 'rgba(21,20,15,.6)', rule: 'rgba(21,20,15,.16)', accent: '#d4491a' },
  dark: { paper: '#15140f', ink: '#f2eee5', mute: 'rgba(242,238,229,.6)', rule: 'rgba(242,238,229,.2)', accent: '#ff6b3d' },
};
type Theme = (typeof THEMES)['light'];

const style = (t: Theme, extra = '') => `<style>
@font-face{font-family:G;font-weight:100 900;src:url(data:font/woff2;base64,${font}) format("woff2")}
text{font-family:G,"Helvetica Neue",Helvetica,Arial,sans-serif;fill:${t.ink}}
.cap{font-size:13px;letter-spacing:.18em;font-weight:500}
.sm{font-size:12px;letter-spacing:.04em}
.mute{fill:${t.mute}}
.acc{fill:${t.accent}}
.ln{stroke:${t.ink};fill:none;stroke-width:1.25}
.hair{stroke:${t.rule};fill:none;stroke-width:1}
.ring{fill:none;stroke:${t.accent};stroke-width:1.5;transform-box:fill-box;transform-origin:center;animation:ring 4.8s cubic-bezier(.16,1,.3,1) infinite}
@keyframes ring{from{transform:scale(.03);opacity:1}70%{opacity:.5}to{transform:scale(1);opacity:0}}
.rise{animation:rise 1.2s cubic-bezier(.16,1,.3,1) both}
@keyframes rise{from{transform:translateY(40px);opacity:0}}
.rule{stroke-dasharray:1300;animation:draw 1.6s cubic-bezier(.87,0,.13,1) both}
@keyframes draw{from{stroke-dashoffset:1300}}
${extra}
@media (prefers-reduced-motion:reduce){*{animation:none!important}}
</style>`;

const n1 = (v: number) => v.toFixed(1);

// ------------------------------------------------------------------ hero
function hero(t: Theme): string {
  const W = 1280;
  const H = 560;
  const cx = 1010;
  const cy = 280;
  const R = 219;
  // The winter sky around Orion, as seen from Earth: an orthographic view of one hemisphere.
  const centre = fromRaDec(88, 2);
  const north: Vec3 = [0, 0, 1];
  const east = normalize(cross(north, centre));
  const up = cross(centre, east);
  const dots: string[] = [];
  const placed = new Map<number, [number, number]>();
  for (let i = 0; i < stars.count; i++) {
    const p: Vec3 = [stars.positions[i * 3], stars.positions[i * 3 + 1], stars.positions[i * 3 + 2]];
    const d = Math.hypot(...p);
    const mag = apparentMagnitude(stars.a[i], d);
    if (mag > 5.3) continue;
    const v: Vec3 = [p[0] / d, p[1] / d, p[2] / d];
    const depth = dot(v, centre);
    if (depth < 0.05) continue;
    // East is to the left, as it is when you look up.
    const x = cx - dot(v, east) * R;
    const y = cy - dot(v, up) * R;
    const r = Math.max(0.55, 3.7 - 0.62 * (mag + 1.5));
    const o = Math.min(1, Math.max(0.28, 1.05 - 0.14 * (mag + 1.5))) * Math.min(1, depth * 3);
    dots.push(`<circle cx="${n1(x)}" cy="${n1(y)}" r="${r.toFixed(2)}" opacity="${o.toFixed(2)}"/>`);
    placed.set(i, [x, y]);
  }
  const labels = [
    ['Sirius', 12, 4], ['Betelgeuse', 10, -8], ['Rigel', 10, 14], ['Aldebaran', 10, -8], ['Procyon', -10, -9], ['Capella', 10, -8],
  ]
    .map(([name, dx, dy]) => {
      const s = names.find((n) => n.name === name);
      const at = s && placed.get(s.index);
      if (!at) return '';
      return `<text class="sm mute" x="${n1(at[0] + (dx as number))}" y="${n1(at[1] + (dy as number))}"${(dx as number) < 0 ? ' text-anchor="end"' : ''}>${name}</text>`;
    })
    .join('');
  const rings = [0, 1.6, 3.2]
    .map((delay) => `<circle class="ring" style="animation-delay:-${delay}s" cx="${cx}" cy="${cy}" r="${R}"/>`)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img">
${style(t)}
<rect width="${W}" height="${H}" fill="${t.paper}"/>
<circle class="hair" cx="${cx}" cy="${cy}" r="${R}"/>
<circle class="hair" cx="${cx}" cy="${cy}" r="${R * 0.62}"/>
<circle class="hair" cx="${cx}" cy="${cy}" r="${R * 0.28}"/>
<g fill="${t.ink}">${dots.join('')}</g>
${labels}
${rings}
<circle cx="${cx}" cy="${cy}" r="5" fill="${t.accent}"/>
<text class="cap" x="56" y="72">THE UNIVERSE AT TRUE SCALE</text>
<g class="rise"><text x="46" y="326" font-size="168" font-weight="500" letter-spacing="-10">Lookback</text><circle cx="702" cy="316" r="11" fill="${t.accent}"/></g>
<path class="ln rule" d="M56 384H690"/>
<text x="56" y="430" font-size="25" letter-spacing="-.5">Start above Earth and pull back, in one motion,</text>
<text x="56" y="463" font-size="25" letter-spacing="-.5">past <tspan class="acc">109,400 real stars</tspan> and 157,000 real galaxies,</text>
<text x="56" y="496" font-size="25" letter-spacing="-.5">to the edge of everything light has had time to show.</text>
</svg>
`;
}

// ------------------------------------------------------------------ the scale
function scaleArt(t: Theme): string {
  const W = 1280;
  const H = 320;
  const x0 = 56;
  const x1 = W - 56;
  const lo = 7;
  const hi = Math.log10(HORIZON);
  const X = (m: number) => x0 + ((Math.log10(m) - lo) / (hi - lo)) * (x1 - x0);
  const deep = (id: string) => DEEP_SKY.find((d) => d.id === id)!.distance;
  const light = (m: number) => (m < 3e22 ? formatDuration(m / C) : formatDuration(lookbackTime(m)));
  const marks: [string, number][] = [
    ['The Moon', 384_400_000],
    ['The Sun', AU],
    ['Neptune', 30.07 * AU],
    ['Alpha Centauri', 4.37 * LY],
    ['Centre of the galaxy', deep('sgr-a')],
    ['Andromeda', deep('m31')],
    ['Virgo Cluster', deep('virgo')],
    ['The edge', HORIZON],
  ];
  const y = 168;
  let out = '';
  // One tick per power of ten.
  for (let k = lo; k <= hi; k++) {
    const x = x0 + ((k - lo) / (hi - lo)) * (x1 - x0);
    out += `<path class="hair" d="M${n1(x)} ${y - 5}V${y + 5}"/>`;
  }
  marks.forEach(([name, m], i) => {
    const x = X(m);
    const above = i % 2 === 0;
    const anchor = i === marks.length - 1 ? 'end' : i === 0 ? 'start' : 'middle';
    const tx = i === marks.length - 1 ? x + 6 : i === 0 ? x - 6 : x;
    const yStem = above ? y - 34 : y + 34;
    out += `<path class="ln" d="M${n1(x)} ${y}V${yStem}"/><circle cx="${n1(x)}" cy="${y}" r="4.5" fill="${t.ink}" stroke="${t.paper}" stroke-width="1.5"/>`;
    const y1 = above ? y - 78 : y + 56;
    out += `<text x="${n1(tx)}" y="${y1}" font-size="17" font-weight="600" letter-spacing="-.3" text-anchor="${anchor}">${name}</text>`;
    out += `<text class="sm mute" x="${n1(tx)}" y="${y1 + 18}" text-anchor="${anchor}">${formatDistance(m)}</text>`;
    out += `<text class="sm acc" x="${n1(tx)}" y="${y1 + 34}" text-anchor="${anchor}">light: ${light(m)}</text>`;
  });
  const extra = `.go{animation:go 14s cubic-bezier(.45,0,.55,1) infinite}
@keyframes go{from{transform:translateX(0)}92%,to{transform:translateX(${x1 - x0}px)}}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img">
${style(t, extra)}
<rect width="${W}" height="${H}" fill="${t.paper}"/>
<text class="cap" x="56" y="40">ONE AXIS, TWENTY ORDERS OF MAGNITUDE</text>
<text class="sm mute" x="${x1}" y="40" text-anchor="end">each tick is ten times farther than the last</text>
<path class="ln rule" d="M${x0} ${y}H${x1}"/>
${out}
<circle cx="${x0}" cy="${y}" r="6" fill="${t.accent}"/>
<circle class="go" cx="${x0}" cy="${y}" r="6" fill="${t.accent}"/>
<text class="sm acc" x="${x0}" y="${y + 26}">Earth</text>
</svg>
`;
}

for (const [name, t] of Object.entries(THEMES)) {
  writeFileSync(new URL(`assets/hero-${name}.svg`, root), hero(t));
  writeFileSync(new URL(`assets/scale-${name}.svg`, root), scaleArt(t));
}
console.log('README graphics written');

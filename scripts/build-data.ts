/**
 * Turns the raw public catalogues in raw/ into the compact binaries the page loads.
 * Run `npm run data` after `scripts/fetch-raw.sh`. Sources and licences: CREDITS.md.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { comovingDistance } from '../src/core/cosmology.ts';
import { prng } from '../src/core/galaxy.ts';
import { encodeCatalogue } from '../src/core/starcodec.ts';
import { MPC } from '../src/core/units.ts';
import { fromRaDec } from '../src/core/vec.ts';

const RAW = new URL('../raw/', import.meta.url);
const OUT = new URL('../public/data/', import.meta.url);
mkdirSync(OUT, { recursive: true });

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === ',' && !quoted) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

// --- Stars: HYG 4.1 -------------------------------------------------------------------------
{
  const lines = readFileSync(new URL('hyg.csv', RAW), 'utf8').split(/\r?\n/).filter(Boolean);
  const head = parseCsvLine(lines[0]);
  const col = (name: string) => head.indexOf(name);
  const [cProper, cDist, cMag, cAbs, cSpect, cCi, cX, cY, cZ, cCon, cBf, cHip] = [
    'proper', 'dist', 'mag', 'absmag', 'spect', 'ci', 'x', 'y', 'z', 'con', 'bf', 'hip',
  ].map(col);
  interface Star {
    name: string; x: number; y: number; z: number; mag: number; abs: number; bv: number;
    spect: string; con: string; bf: string; hip: string; dist: number;
  }
  const stars: Star[] = [];
  let skipped = 0;
  for (const line of lines.slice(1)) {
    const f = parseCsvLine(line);
    const dist = Number(f[cDist]);
    if (f[cProper] === 'Sol') continue; // the Sun is a body, not a catalogue entry
    // HYG writes 100000 pc for stars with no usable parallax. Their distance is unknown, so they are left out.
    if (!(dist > 0) || dist >= 100000) {
      skipped++;
      continue;
    }
    stars.push({
      name: f[cProper], x: Number(f[cX]), y: Number(f[cY]), z: Number(f[cZ]),
      mag: Number(f[cMag]), abs: Number(f[cAbs]), bv: f[cCi] === '' ? 0.65 : Number(f[cCi]),
      spect: f[cSpect], con: f[cCon], bf: f[cBf].trim(), hip: f[cHip], dist,
    });
  }
  // Brightest as seen from Earth first, so a weak device can stop early and still get the familiar sky.
  stars.sort((a, b) => a.mag - b.mag);
  const SPLIT = 30000;
  const encode = (part: Star[]) =>
    encodeCatalogue({
      positions: part.flatMap((s) => [s.x, s.y, s.z]),
      a: part.map((s) => s.abs),
      bv: part.map((s) => s.bv),
    });
  writeFileSync(new URL('stars-a.bin', OUT), Buffer.from(encode(stars.slice(0, SPLIT))));
  writeFileSync(new URL('stars-b.bin', OUT), Buffer.from(encode(stars.slice(SPLIT))));
  const named = stars
    .map((s, index) => ({ s, index }))
    .filter(({ s }) => s.name)
    .map(({ s, index }) => ({
      name: s.name, index, mag: s.mag, abs: s.abs, spect: s.spect, con: s.con, bf: s.bf,
      hip: s.hip ? Number(s.hip) : null, pc: s.dist, bv: s.bv,
    }));
  writeFileSync(new URL('star-names.json', OUT), JSON.stringify(named));
  console.log(`stars: ${stars.length} kept (${SPLIT} + ${stars.length - SPLIT}), ${skipped} without a distance left out, ${named.length} named`);
}

// --- Galaxies: SDSS DR17 spectroscopic sample ------------------------------------------------
{
  const lines = readFileSync(new URL('sdss.csv', RAW), 'utf8').split(/\r?\n/).filter((l) => /^[0-9-]/.test(l));
  const rows = lines.map((l) => l.split(',').map(Number));
  // Shuffle so that any prefix of the file is an unbiased sample of the survey.
  const rand = prng(17);
  for (let i = rows.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [rows[i], rows[j]] = [rows[j], rows[i]];
  }
  const positions: number[] = [];
  for (const [ra, dec, z] of rows) {
    const d = comovingDistance(z) / MPC;
    const v = fromRaDec(ra, dec);
    positions.push(v[0] * d, v[1] * d, v[2] * d);
  }
  const zeros = rows.map(() => 0);
  writeFileSync(new URL('galaxies.bin', OUT), Buffer.from(encodeCatalogue({ positions, a: zeros, bv: zeros })));
  console.log(`galaxies: ${rows.length}`);
}

// --- Small bodies: JPL SBDB -------------------------------------------------------------------
function smallBodies(file: string, out: string, limit: number) {
  const json = JSON.parse(readFileSync(new URL(file, RAW), 'utf8')) as { fields: string[]; data: string[][] };
  const idx = (n: string) => json.fields.indexOf(n);
  const cols = ['a', 'e', 'i', 'om', 'w', 'ma', 'epoch'].map(idx);
  const rows = json.data
    .map((r) => cols.map((c) => Number(r[c])))
    // Closed orbits only, and nothing so far out that it would stretch the frame.
    .filter((r) => r.every(Number.isFinite) && r[1] < 0.98 && r[0] > 0 && r[0] < 2000)
    .slice(0, limit);
  const buf = new Float32Array(rows.length * 7);
  rows.forEach((r, i) => buf.set(r, i * 7));
  writeFileSync(new URL(out, OUT), Buffer.from(buf.buffer));
  console.log(`${out}: ${rows.length}`);
}
smallBodies('tno.json', 'tno.bin', 100000);
smallBodies('mba.json', 'mba.bin', 8000);

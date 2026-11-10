/**
 * Resizes the source planet maps in raw/ into stepped WebP tiers and records each body's mean
 * colour (averaged in linear light), which is what the page draws while a body is only a dot.
 * Sources and licences: CREDITS.md.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const RAW = new URL('../raw/', import.meta.url);
const OUT = new URL('../public/tex/', import.meta.url);
mkdirSync(OUT, { recursive: true });

const maps: { name: string; file: string; tiers: number[]; hiFile?: string }[] = [
  { name: 'sun', file: 'sss_2k_sun.jpg', tiers: [512, 2048] },
  { name: 'mercury', file: 'sss_2k_mercury.jpg', tiers: [512, 2048] },
  { name: 'venus', file: 'sss_2k_venus_atmosphere.jpg', tiers: [512, 2048] },
  { name: 'earth', file: 'sss_2k_earth_daymap.jpg', tiers: [512, 2048, 4096], hiFile: 'sss_8k_earth_daymap.jpg' },
  { name: 'earth_night', file: 'sss_2k_earth_nightmap.jpg', tiers: [512, 2048] },
  { name: 'moon', file: 'sss_2k_moon.jpg', tiers: [512, 2048] },
  { name: 'mars', file: 'sss_2k_mars.jpg', tiers: [512, 2048] },
  { name: 'jupiter', file: 'sss_2k_jupiter.jpg', tiers: [512, 2048] },
  { name: 'saturn', file: 'sss_2k_saturn.jpg', tiers: [512, 2048] },
  { name: 'uranus', file: 'sss_2k_uranus.jpg', tiers: [512, 2048] },
  { name: 'neptune', file: 'sss_2k_neptune.jpg', tiers: [512, 2048] },
];

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const toSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

const manifest: Record<string, { tiers: number[]; bytes: number[]; mean: [number, number, number] }> = {};

for (const m of maps) {
  const bytes: number[] = [];
  for (const w of m.tiers) {
    const src = fileURLToPath(new URL(w > 2048 && m.hiFile ? m.hiFile : m.file, RAW));
    const info = await sharp(src)
      .resize(w, w / 2, { kernel: 'lanczos3' })
      .webp({ quality: w <= 512 ? 78 : 84, effort: 6 })
      .toFile(fileURLToPath(new URL(`${m.name}_${w}.webp`, OUT)));
    bytes.push(info.size);
  }
  // Area-weighted mean colour: rows near the poles cover less of the sphere.
  const { data, info } = await sharp(fileURLToPath(new URL(m.file, RAW)))
    .resize(256, 128)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const sum = [0, 0, 0];
  let weight = 0;
  for (let y = 0; y < info.height; y++) {
    const wgt = Math.cos(((y + 0.5) / info.height - 0.5) * Math.PI);
    for (let x = 0; x < info.width; x++) {
      const o = (y * info.width + x) * 3;
      for (let k = 0; k < 3; k++) sum[k] += toLinear(data[o + k] / 255) * wgt;
      weight += wgt;
    }
  }
  const mean = sum.map((s) => Math.round(toSrgb(s / weight) * 255)) as [number, number, number];
  manifest[m.name] = { tiers: m.tiers, bytes, mean };
  console.log(m.name, m.tiers.join('/'), bytes.map((b) => `${(b / 1024).toFixed(0)} KB`).join(' '), mean);
}

// Saturn's rings: a radial strip with transparency.
{
  const info = await sharp(fileURLToPath(new URL('sss_2k_saturn_ring_alpha.png', RAW)))
    .resize(1024, 8, { fit: 'fill' })
    .webp({ quality: 88, alphaQuality: 90 })
    .toFile(fileURLToPath(new URL('saturn_ring_1024.webp', OUT)));
  console.log('saturn_ring', `${(info.size / 1024).toFixed(0)} KB`);
}

writeFileSync(
  new URL('../src/data/textures.json', import.meta.url),
  JSON.stringify(manifest, null, 2) + '\n',
);

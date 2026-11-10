/**
 * Things beyond the star catalogue that get a label and a description.
 * Positions: J2000 right ascension and declination in degrees, from the NASA/IPAC Extragalactic
 * Database (https://ned.ipac.caltech.edu). Distances and diameters are rounded literature values
 * (sources per entry); diameters are approximate and only set how large the soft glow is drawn.
 */
import { LY } from '../core/units.ts';

export interface DeepSkyDef {
  id: string;
  name: string;
  kind: string;
  ra: number;
  dec: number;
  /** metres */
  distance: number;
  /** approximate diameter, metres; 0 for a point marker */
  diameter: number;
  /** warm or cool tint of the glow, sRGB */
  color: [number, number, number];
  /** Visible to the unaided eye from Earth under a dark sky. */
  nakedEye?: boolean;
  /** Label shown while the camera is between these distances from Earth (log10 metres). */
  window: [number, number];
  facts: string;
  stats: [string, string][];
  source: { label: string; url: string };
}

const kly = 1e3 * LY;
const mly = 1e6 * LY;

export const DEEP_SKY: DeepSkyDef[] = [
  {
    id: 'sgr-a',
    name: 'Sagittarius A*',
    kind: 'Centre of the Milky Way',
    ra: 266.4168,
    dec: -29.0078,
    distance: 26.67 * kly,
    diameter: 0,
    color: [255, 214, 160],
    window: [19.4, 22.2],
    facts:
      'The centre of our galaxy: a black hole with about four million times the mass of the Sun. The Sun takes roughly 230 million years to circle it once. The Event Horizon Telescope published the first image of it in 2022.',
    stats: [['Distance', '26,700 light-years'], ['Mass', '4 million Suns']],
    source: { label: 'GRAVITY Collaboration 2019', url: 'https://doi.org/10.1051/0004-6361/201935656' },
  },
  {
    id: 'lmc',
    name: 'Large Magellanic Cloud',
    kind: 'Satellite galaxy',
    ra: 80.894,
    dec: -69.756,
    distance: 162 * kly,
    diameter: 32 * kly,
    color: [214, 224, 255],
    nakedEye: true,
    window: [20.6, 23.2],
    facts:
      'A satellite galaxy of the Milky Way, about 160,000 light-years away and easy to see without a telescope from the southern hemisphere. The supernova of 1987, the closest seen since the telescope was invented, exploded here.',
    stats: [['Distance', '162,000 light-years']],
    source: { label: 'Pietrzyński et al. 2019', url: 'https://doi.org/10.1038/s41586-019-0999-4' },
  },
  {
    id: 'smc',
    name: 'Small Magellanic Cloud',
    kind: 'Satellite galaxy',
    ra: 13.187,
    dec: -72.829,
    distance: 203 * kly,
    diameter: 19 * kly,
    color: [214, 224, 255],
    nakedEye: true,
    window: [20.9, 23.2],
    facts:
      'A dwarf galaxy about 200,000 light-years away, companion to the Large Magellanic Cloud. In 1912 Henrietta Leavitt’s study of its pulsating stars gave astronomers their first reliable way to measure the distance to other galaxies.',
    stats: [['Distance', '200,000 light-years']],
    source: { label: 'Graczyk et al. 2020', url: 'https://doi.org/10.3847/1538-4357/abbb2b' },
  },
  {
    id: 'm31',
    name: 'Andromeda Galaxy',
    kind: 'Spiral galaxy (M31)',
    ra: 10.6847,
    dec: 41.2687,
    distance: 2.5 * mly,
    diameter: 152 * kly,
    color: [255, 232, 204],
    nakedEye: true,
    window: [21.6, 24.4],
    facts:
      'The nearest large galaxy, 2.5 million light-years away, and the most distant thing most people can see without a telescope. It holds roughly a trillion stars and is closing on the Milky Way at about 110 km every second.',
    stats: [['Distance', '2.5 million light-years'], ['Stars', 'about a trillion']],
    source: { label: 'NASA Science: Messier 31', url: 'https://science.nasa.gov/mission/hubble/science/explore-the-night-sky/hubble-messier-catalog/messier-31/' },
  },
  {
    id: 'm33',
    name: 'Triangulum Galaxy',
    kind: 'Spiral galaxy (M33)',
    ra: 23.4621,
    dec: 30.6599,
    distance: 2.73 * mly,
    diameter: 61 * kly,
    color: [214, 224, 255],
    window: [21.9, 24.2],
    facts:
      'The third-largest galaxy of the Local Group, after Andromeda and the Milky Way: a spiral about 2.7 million light-years away holding some 40 billion stars.',
    stats: [['Distance', '2.7 million light-years']],
    source: { label: 'NASA Science: Messier 33', url: 'https://science.nasa.gov/mission/hubble/science/explore-the-night-sky/hubble-messier-catalog/messier-33/' },
  },
  {
    id: 'm81',
    name: 'Bode’s Galaxy',
    kind: 'Spiral galaxy (M81)',
    ra: 148.8882,
    dec: 69.0653,
    distance: 11.8 * mly,
    diameter: 90 * kly,
    color: [255, 232, 204],
    window: [22.7, 24.4],
    facts:
      'A bright spiral galaxy about 12 million light-years away in Ursa Major. It leads one of the nearest groups of galaxies beyond our own.',
    stats: [['Distance', '11.8 million light-years']],
    source: { label: 'NASA Science: Messier 81', url: 'https://science.nasa.gov/mission/hubble/science/explore-the-night-sky/hubble-messier-catalog/messier-81/' },
  },
  {
    id: 'cen-a',
    name: 'Centaurus A',
    kind: 'Radio galaxy (NGC 5128)',
    ra: 201.3651,
    dec: -43.0191,
    distance: 12.4 * mly,
    diameter: 60 * kly,
    color: [255, 224, 190],
    window: [22.7, 24.4],
    facts:
      'The nearest giant radio galaxy, about 12 million light-years away. The dark band of dust across it is what remains of a spiral galaxy it swallowed.',
    stats: [['Distance', '12 million light-years']],
    source: { label: 'Harris, Rejkuba and Harris 2010', url: 'https://doi.org/10.1071/AS09061' },
  },
  {
    id: 'virgo',
    name: 'Virgo Cluster',
    kind: 'Galaxy cluster (centred on M87)',
    ra: 187.7059,
    dec: 12.3911,
    distance: 53.8 * mly,
    diameter: 0,
    color: [255, 232, 204],
    window: [23.4, 25.3],
    facts:
      'The nearest large cluster of galaxies, about 54 million light-years away, with well over a thousand members. At its heart the galaxy M87 holds the first black hole ever photographed, in 2019.',
    stats: [['Distance', '54 million light-years'], ['Galaxies', 'more than 1,300']],
    source: { label: 'Mei et al. 2007', url: 'https://doi.org/10.1086/509598' },
  },
  {
    id: 'fornax',
    name: 'Fornax Cluster',
    kind: 'Galaxy cluster',
    ra: 54.6209,
    dec: -35.4507,
    distance: 62 * mly,
    diameter: 0,
    color: [255, 232, 204],
    window: [23.6, 25.1],
    facts:
      'A compact cluster of galaxies about 62 million light-years away in the southern sky, the second richest within 100 million light-years after Virgo.',
    stats: [['Distance', '62 million light-years']],
    source: { label: 'Blakeslee et al. 2009', url: 'https://doi.org/10.1088/0004-637X/694/1/556' },
  },
  {
    id: 'coma',
    name: 'Coma Cluster',
    kind: 'Galaxy cluster',
    ra: 194.9529,
    dec: 27.9806,
    distance: 321 * mly,
    diameter: 0,
    color: [255, 232, 204],
    window: [24.3, 25.9],
    facts:
      'More than a thousand galaxies about 320 million light-years away. In 1933 Fritz Zwicky measured how fast they move and found they should fly apart: the first evidence for dark matter.',
    stats: [['Distance', '320 million light-years']],
    source: { label: 'NASA/IPAC Extragalactic Database', url: 'https://ned.ipac.caltech.edu/byname?objname=Coma+Cluster' },
  },
  {
    id: 'sloan-wall',
    name: 'Sloan Great Wall',
    kind: 'Wall of galaxies',
    ra: 195,
    dec: 3,
    distance: 1.05e9 * LY,
    diameter: 0,
    color: [255, 232, 204],
    window: [25.0, 26.3],
    facts:
      'A wall of galaxies about 1.4 billion light-years long and roughly a billion light-years away, found in this survey’s data in 2003. It is among the largest structures known.',
    stats: [['Length', '1.4 billion light-years']],
    source: { label: 'Gott et al. 2005', url: 'https://doi.org/10.1086/428890' },
  },
];

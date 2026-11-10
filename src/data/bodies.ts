/**
 * The solar system bodies drawn as true-size spheres.
 *
 * Radii: NASA Planetary Fact Sheets (equatorial and polar, km), https://nssdc.gsfc.nasa.gov/planetary/factsheet/
 * Rotation: IAU Working Group on Cartographic Coordinates and Rotational Elements (Archinal et al. 2018):
 * pole right ascension and declination at J2000, prime meridian W = w0 + rate * days since J2000.
 * Facts: NASA Science solar system pages, https://science.nasa.gov/solar-system/
 */

export interface BodyDef {
  id: string;
  name: string;
  kind: 'Star' | 'Planet' | 'Moon' | 'Dwarf planet';
  parent: 'sun' | 'earth' | null;
  /** Equatorial and polar radius, km. */
  radius: [number, number];
  /** Key into the texture manifest; absent means a plain sphere in `color`. */
  texture?: string;
  /** sRGB colour used when there is no texture. */
  color?: [number, number, number];
  pole: [number, number];
  /** [w0, degrees per day], or 'locked' for the Moon (same face to Earth). */
  spin: [number, number] | 'locked';
  emissive?: boolean;
  /** Mean orbital distance in metres from its parent: used to decide when its label has room. */
  orbit: number;
  facts: string;
  stats: [string, string][];
  source: { label: string; url: string };
}

const nasa = (slug: string) => ({
  label: 'NASA Science',
  url: `https://science.nasa.gov/${slug}/`,
});

export const BODIES: BodyDef[] = [
  {
    id: 'sun',
    name: 'Sun',
    kind: 'Star',
    parent: null,
    radius: [695_700, 695_700],
    texture: 'sun',
    pole: [286.13, 63.87],
    spin: [84.176, 14.1844],
    emissive: true,
    orbit: 0,
    facts:
      'The Sun holds 99.8 percent of the mass of the solar system. It is 1.39 million km across: 109 Earths side by side. Its light takes about 8 minutes 20 seconds to reach Earth.',
    stats: [['Diameter', '1,391,400 km'], ['Surface', 'about 5,500 °C'], ['Age', '4.6 billion years']],
    source: nasa('sun'),
  },
  {
    id: 'mercury',
    name: 'Mercury',
    kind: 'Planet',
    parent: 'sun',
    radius: [2440.5, 2438.3],
    texture: 'mercury',
    pole: [281.0103, 61.4155],
    spin: [329.5988, 6.1385108],
    orbit: 5.79e10,
    facts:
      'The smallest planet and the closest to the Sun, going round it once every 88 days. With almost no atmosphere to hold heat, its surface swings from about 430 °C in the day to −180 °C at night.',
    stats: [['Diameter', '4,879 km'], ['Year', '88 days'], ['From the Sun', '58 million km']],
    source: nasa('mercury'),
  },
  {
    id: 'venus',
    name: 'Venus',
    kind: 'Planet',
    parent: 'sun',
    radius: [6051.8, 6051.8],
    texture: 'venus',
    pole: [272.76, 67.16],
    spin: [160.2, -1.4813688],
    orbit: 1.082e11,
    facts:
      'Almost the size of Earth, under a carbon dioxide atmosphere about 90 times as dense as ours at the surface. The greenhouse effect keeps the ground near 465 °C, hotter than Mercury. What you see here is the cloud tops; the surface is hidden.',
    stats: [['Diameter', '12,104 km'], ['Year', '225 days'], ['From the Sun', '108 million km']],
    source: nasa('venus'),
  },
  {
    id: 'earth',
    name: 'Earth',
    kind: 'Planet',
    parent: 'sun',
    radius: [6378.137, 6356.752],
    texture: 'earth',
    pole: [0, 90],
    spin: [190.147, 360.9856235],
    orbit: 1.496e11,
    facts:
      'The only place known to have life. It is 12,742 km across and 149.6 million km from the Sun on average. The day and night sides shown here are the real ones for this moment.',
    stats: [['Diameter', '12,742 km'], ['Year', '365.25 days'], ['From the Sun', '149.6 million km']],
    source: nasa('earth'),
  },
  {
    id: 'moon',
    name: 'Moon',
    kind: 'Moon',
    parent: 'earth',
    radius: [1738.1, 1736.0],
    texture: 'moon',
    pole: [269.9949, 66.5392],
    spin: 'locked',
    orbit: 3.844e8,
    facts:
      'Earth’s only natural satellite, 3,475 km across and on average 384,400 km away: about thirty Earth diameters. It always keeps the same face towards Earth. Twelve people walked on it between 1969 and 1972.',
    stats: [['Diameter', '3,475 km'], ['Orbit', '27.3 days'], ['From Earth', '384,400 km']],
    source: nasa('moon'),
  },
  {
    id: 'mars',
    name: 'Mars',
    kind: 'Planet',
    parent: 'sun',
    radius: [3396.2, 3376.2],
    texture: 'mars',
    pole: [317.68143, 52.8865],
    spin: [176.63, 350.89198226],
    orbit: 2.279e11,
    facts:
      'About half the width of Earth, with a thin carbon dioxide atmosphere. Its red colour is iron oxide dust: rust. Olympus Mons, its largest volcano, stands about 22 km high.',
    stats: [['Diameter', '6,779 km'], ['Year', '687 days'], ['From the Sun', '228 million km']],
    source: nasa('mars'),
  },
  {
    id: 'jupiter',
    name: 'Jupiter',
    kind: 'Planet',
    parent: 'sun',
    radius: [71_492, 66_854],
    texture: 'jupiter',
    pole: [268.056595, 64.495303],
    spin: [284.95, 870.536],
    orbit: 7.786e11,
    facts:
      'The largest planet: eleven Earths wide and more than twice as massive as all the other planets together. The Great Red Spot is a storm wider than Earth that has been watched for at least 150 years.',
    stats: [['Diameter', '139,820 km'], ['Year', '11.9 years'], ['From the Sun', '778 million km']],
    source: nasa('jupiter'),
  },
  {
    id: 'saturn',
    name: 'Saturn',
    kind: 'Planet',
    parent: 'sun',
    radius: [60_268, 54_364],
    texture: 'saturn',
    pole: [40.589, 83.537],
    spin: [38.9, 810.7939024],
    orbit: 1.4335e12,
    facts:
      'A gas giant nine times as wide as Earth and, on average, less dense than water. Its main rings are about 270,000 km across yet mostly only around ten metres thick.',
    stats: [['Diameter', '116,460 km'], ['Year', '29.4 years'], ['From the Sun', '1.43 billion km']],
    source: nasa('saturn'),
  },
  {
    id: 'uranus',
    name: 'Uranus',
    kind: 'Planet',
    parent: 'sun',
    radius: [25_559, 24_973],
    texture: 'uranus',
    pole: [257.311, -15.175],
    spin: [203.81, -501.1600928],
    orbit: 2.8725e12,
    facts:
      'An ice giant four times as wide as Earth, tipped on its side: its axis is tilted 98 degrees, so it rolls around the Sun. One orbit takes 84 years.',
    stats: [['Diameter', '50,724 km'], ['Year', '84 years'], ['From the Sun', '2.87 billion km']],
    source: nasa('uranus'),
  },
  {
    id: 'neptune',
    name: 'Neptune',
    kind: 'Planet',
    parent: 'sun',
    radius: [24_764, 24_341],
    texture: 'neptune',
    pole: [299.36, 43.46],
    spin: [253.18, 536.3128492],
    orbit: 4.4951e12,
    facts:
      'The farthest planet, thirty times as far from the Sun as Earth. One orbit takes 165 years, so it has completed only one since it was discovered in 1846. Sunlight takes about four hours to arrive.',
    stats: [['Diameter', '49,244 km'], ['Year', '165 years'], ['From the Sun', '4.5 billion km']],
    source: nasa('neptune'),
  },
  {
    id: 'pluto',
    name: 'Pluto',
    kind: 'Dwarf planet',
    parent: 'sun',
    radius: [1188.3, 1188.3],
    // No freely licensed global map is bundled, so Pluto is a plain sphere in an approximate mean colour.
    color: [190, 164, 138],
    pole: [132.993, -6.163],
    spin: [302.695, 56.3625225],
    orbit: 5.9064e12,
    facts:
      'A dwarf planet in the Kuiper belt, 2,377 km across: smaller than the Moon. NASA’s New Horizons flew past it in July 2015. Its orbit is tilted 17 degrees and stretched enough that it sometimes comes closer to the Sun than Neptune. Shown here as a plain sphere, without surface detail.',
    stats: [['Diameter', '2,377 km'], ['Year', '248 years'], ['From the Sun', '5.9 billion km on average']],
    source: nasa('dwarf-planets/pluto'),
  },
];

/** Saturn's main rings, km from the planet's centre (C ring inner edge to A ring outer edge). */
export const SATURN_RINGS = { inner: 74_500, outer: 136_780 };

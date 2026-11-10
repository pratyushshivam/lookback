/**
 * The story of the pull-back: which caption belongs to which scale, where the rail stops are,
 * and the timing of the guided journey. Distances are log10 of metres from Earth's centre.
 */
import { HORIZON } from '../core/cosmology.ts';
import type { Key } from '../core/zoom.ts';

export const LOG_MIN = Math.log10(6.378e6 * 1.2);
export const LOG_MAX = Math.log10(HORIZON);

export interface Chapter {
  id: string;
  title: string;
  /** This chapter's caption applies from this distance outward, until the next chapter. */
  from: number;
  /** Where the rail stop and the journey key sit. */
  stop: number;
  text: string;
}

export const CHAPTERS: Chapter[] = [
  {
    id: 'earth',
    title: 'Earth',
    from: -Infinity,
    stop: 7.28,
    text: 'Home, as it is right now: the line between day and night is where it really falls at this moment. Scroll, pinch or press play to pull back.',
  },
  {
    id: 'moon',
    title: 'The Moon’s orbit',
    from: 8.05,
    stop: 8.95,
    text: 'The Moon is about 384,400 km away: thirty Earths would fit in the gap. Light crosses it in 1.3 seconds. This is as far as people have ever been.',
  },
  {
    id: 'inner',
    title: 'The inner planets',
    from: 9.7,
    stop: 11.62,
    text: 'Mercury, Venus, Earth and Mars. At true scale the planets are far too small to see from here, so each one is marked with a ring. Sunlight takes eight minutes to reach Earth.',
  },
  {
    id: 'outer',
    title: 'The outer planets',
    from: 12.0,
    stop: 12.88,
    text: 'Jupiter, Saturn, Uranus and Neptune. The dots between Mars and Jupiter are real asteroids. Sunlight takes about four hours to reach Neptune.',
  },
  {
    id: 'kuiper',
    title: 'The Kuiper belt',
    from: 13.08,
    stop: 13.42,
    text: 'Every dot is a real icy body with a measured orbit, Pluto among them: about 8,300 are plotted from the JPL Small-Body Database.',
  },
  {
    id: 'gap',
    title: 'The long gap',
    from: 14.1,
    stop: 15.6,
    text: 'Nothing here but distance. Voyager 1, launched in 1977, is only about one light-day out. A vast cloud of comets, the Oort cloud, is thought to surround the Sun this far out, but no one has seen it directly, so nothing is drawn.',
  },
  {
    id: 'stars',
    title: 'The nearest stars',
    from: 16.25,
    stop: 17.05,
    text: 'The closest star system, Alpha Centauri, is 4.2 light-years away. Every point is a real star at its measured position and colour. The Sun is now just one of them.',
  },
  {
    id: 'neighbourhood',
    title: 'The solar neighbourhood',
    from: 17.75,
    stop: 18.95,
    text: 'About 109,000 stars with measured distances, from the HYG catalogue. The constellations have dissolved: they only exist from home. This ball is not a real cluster, it is simply how far precise measurement reaches.',
  },
  {
    id: 'galaxy',
    title: 'The Milky Way',
    from: 19.75,
    stop: 21.35,
    text: 'Our galaxy: a few hundred billion stars in a disc about 100,000 light-years across. Every star you just passed is inside the small marker around the Sun. The spiral is generated from the accepted model, not mapped star by star.',
  },
  {
    id: 'local-group',
    title: 'The Local Group',
    from: 22.0,
    stop: 22.95,
    text: 'The Milky Way and Andromeda are the two large galaxies in a group of several dozen. The light now arriving from Andromeda left 2.5 million years ago.',
  },
  {
    id: 'clusters',
    title: 'Nearby clusters',
    from: 23.45,
    stop: 24.35,
    text: 'From here on, every dot is a whole galaxy measured by the Sloan Digital Sky Survey. The Virgo Cluster, 54 million light-years away, is the nearest big gathering.',
  },
  {
    id: 'web',
    title: 'The cosmic web',
    from: 24.75,
    stop: 25.75,
    text: '157,000 galaxies, one in seven of those the survey measured at these distances. They gather in walls and threads around empty voids. The wedge shapes are where the telescope looked: the dark elsewhere is unmapped, not empty.',
  },
  {
    id: 'edge',
    title: 'The observable universe',
    from: 26.3,
    stop: LOG_MAX,
    text: 'The edge of what can be seen: 46 billion light-years away today. Light arriving from here set out 13.8 billion years ago, and nothing from farther away has had time to reach us.',
  },
];

export function chapterAt(logD: number): Chapter {
  let current = CHAPTERS[0];
  for (const c of CHAPTERS) if (logD >= c.from) current = c;
  return current;
}

/** Guided journey: seconds at which each stop is reached. One continuous eased motion. */
const TIMES = [0, 7, 15, 22, 28, 36, 44, 52, 61, 69, 77, 85, 94];
export const JOURNEY_KEYS: Key[] = CHAPTERS.map((c, i) => ({ t: TIMES[i], v: c.stop }));
export const JOURNEY_SECONDS = TIMES[TIMES.length - 1];

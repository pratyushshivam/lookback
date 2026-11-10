# Credits and licences

Everything drawn in Lookback comes from public, freely licensed data. Nothing is invented; where
something is illustrative rather than measured, it is listed under "What is not measured data".

## Data

| What | Source | Licence | Notes |
| --- | --- | --- | --- |
| 109,400 stars | [HYG database 4.1](https://www.astronexus.com/projects/hyg) by David Nash ([GitHub](https://github.com/astronexus/HYG-Database)), compiled from the Hipparcos, Yale Bright Star and Gliese catalogues | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) | Re-encoded to an 8-byte binary (`public/data/stars-*.bin`, `star-names.json`). 10,225 catalogue entries with no usable distance are left out. The derived files are shared under the same licence. |
| 156,940 galaxies | [Sloan Digital Sky Survey](https://www.sdss.org/) Data Release 17, `SpecObj` table: galaxies with clean redshifts between 0.003 and 0.35, one in seven | Public domain (SDSS data releases) | Distances computed from redshift with the cosmology below. Funding and collaboration acknowledgement: https://www.sdss4.org/collaboration/citing-sdss/ |
| Planet positions | [NASA JPL Solar System Dynamics, Approximate Positions of the Planets](https://ssd.jpl.nasa.gov/planets/approx_pos.html), Table 1 | US Government work, public domain | Valid 1800 to 2050. |
| 8,301 Kuiper belt objects, 8,000 main-belt asteroids, Pluto | [JPL Small-Body Database Query API](https://ssd-api.jpl.nasa.gov/doc/sbdb_query.html), fetched 10 November 2026 | US Government work, public domain | Osculating elements, propagated as two-body orbits. |
| Moon position | Low-precision series from *The Astronomical Almanac* | Formula | About 0.3 degrees in direction. |
| Planet and Moon maps | [Solar System Scope textures](https://www.solarsystemscope.com/textures/) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Based on NASA elevation and imagery data. Resized to 512, 2048 and (Earth) 4096 pixels, converted to WebP. The author notes that unmapped gaps are filled in to match their surroundings. |
| Sizes, facts | [NASA Planetary Fact Sheets](https://nssdc.gsfc.nasa.gov/planetary/factsheet/), [NASA Science](https://science.nasa.gov/solar-system/) | US Government work | Each object's panel links its source. |
| Rotation of the planets | IAU Working Group on Cartographic Coordinates and Rotational Elements (Archinal et al. 2018) | Published constants | Pole directions and prime meridians. |
| Deep-sky positions | [NASA/IPAC Extragalactic Database](https://ned.ipac.caltech.edu/) | Public | Distances from the papers linked in `src/data/deepsky.ts`. |
| Cosmology | Planck Collaboration 2018, results VI: H0 = 67.4 km/s/Mpc, matter density 0.315 | Published constants | Used for distances and light-travel times beyond the Local Group. |
| Galactic geometry | GRAVITY Collaboration 2019 (Sun to galactic centre, 8.178 kpc); IAU galactic coordinate system | Published constants | |

## Software and type

- [three.js](https://threejs.org/) (MIT), [Vite](https://vite.dev/) (MIT), [Vitest](https://vitest.dev/) (MIT), [sharp](https://sharp.pixelplumbing.com/) (Apache 2.0, build only).
- [Geist](https://vercel.com/font) typeface, SIL Open Font License 1.1, via `@fontsource-variable/geist`.

## What is not measured data

- **The Milky Way's shape.** No catalogue maps the whole galaxy, so its 64,000 points are generated in the browser from the accepted model (central bar, four arms, exponential disc, Sun 8.178 kpc from the centre). Proportions and orientation are real; individual points are not stars.
- **Glows of named galaxies** (Andromeda, the Magellanic Clouds and others) mark real positions and approximate diameters, not true shapes.
- **Pluto** is a plain sphere in an approximate colour: no freely licensed global map is bundled.
- **Rotation phase** of the gas giants and the alignment of Saturn's ring texture are approximate. The Moon's libration is ignored.
- **Guides** (orbit lines, labels, distance rings, marker rings) and **long exposure** are aids and can each be switched off.

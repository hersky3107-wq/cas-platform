# Astrology engine — pre-build verification

Reference: **Steve Jobs**, 1955-02-24 19:15 PST, San Francisco, California,
37.77° N, 122.42° W. Birth time is rated AA (birth certificate).

- Absolute instant: `1955-02-25T03:15:00.000Z`
- Zodiac: tropical
- Houses: Placidus
- Public calculators:
  - [Astro-Charts](https://astro-charts.com/persons/chart/steve-jobs/)
  - [TropicalAstro](https://tropicalastro.com/birth-chart/steve-jobs)
  - [Astrotheme](https://www.astrotheme.com/astrology/Steve_Jobs) (second
    cross-check for the True Node because Astro-Charts publishes a materially
    different node value)

The probe used `astronomy-engine@2.1.19`:

- apparent geocentric planet vector: `GeoVector(body, instant, true)`
- tropical ecliptic-of-date longitude: `Ecliptic(vector).elon`
- true lunar node: ascending node of the instantaneous lunar orbital plane,
  from `GeoMoonState` rotated with `Rotation_EQJ_ECT`
- sidereal time: `SiderealTime`
- Ascendant and MC: standard spherical formula using apparent local sidereal
  time and mean obliquity-of-date
- intermediate Placidus cusps: iterative semi-diurnal/semi-nocturnal arc
  trisection (documented in the coverage note)

## Comparison

All positions are absolute tropical longitude in degrees (0° Aries = 0).
Public values are shown at their published minute precision. Delta is the
shortest angular difference from the engine probe.

| Point | Engine | Astro-Charts | Δ | TropicalAstro | Δ |
|---|---:|---:|---:|---:|---:|
| Sun | 335.7481 | 335.7500 | 0.0019° | 335.7333 | 0.0148° |
| Moon | 7.7477 | 7.7500 | 0.0023° | 7.7333 | 0.0144° |
| Mercury | 314.3613 | 314.3667 | 0.0054° | 314.3500 | 0.0113° |
| Venus | 291.1724 | 291.1667 | 0.0058° | 291.1667 | 0.0058° |
| Mars | 29.0904 | 29.0833 | 0.0071° | 29.0833 | 0.0071° |
| Jupiter | 110.5074 | 110.5000 | 0.0074° | 110.5000 | 0.0074° |
| Saturn | 231.1627 | 231.1667 | 0.0040° | 231.1500 | 0.0127° |
| Uranus | 114.1341 | 114.1333 | 0.0007° | 114.1333 | 0.0007° |
| Neptune | 208.0485 | 208.0500 | 0.0015° | 208.0500 | 0.0015° |
| Pluto | 145.3231 | 145.3167 | 0.0064° | 145.3167 | 0.0064° |
| Ascendant | 172.2913 | 172.2833 | 0.0079° | 172.2833 | 0.0079° |
| Midheaven | 81.3151 | 81.3167 | 0.0016° | 81.3000 | 0.0151° |

### True Node cross-check

The engine probe gives **273.4100° = 3°24.6′ Capricorn**.

- TropicalAstro: 3°24′ Capricorn = 273.4000°, delta **0.0100°**
- Astrotheme chart data: 3°25′ Capricorn = 273.4167°, delta **0.0066°**
- Astro-Charts displays 2°30′ Capricorn. That is a different node convention
  (consistent with a mean/alternate node rather than the requested true
  instantaneous node), so it is documented but not used as a true-node
  acceptance reference.

## Placidus cusp probe

Astro-Charts publishes all 12 cusps. The independent scratch solver returned:

| House | Engine | Astro-Charts | Δ |
|---|---:|---:|---:|
| 1 | 172.2913 | 172.2833 | 0.0079° |
| 2 | 198.2428 | 198.2500 | 0.0072° |
| 3 | 228.3532 | 228.3500 | 0.0032° |
| 4 | 261.3151 | 261.3167 | 0.0016° |
| 5 | 294.4740 | 294.4667 | 0.0074° |
| 6 | 325.2091 | 325.2167 | 0.0076° |
| 7 | 352.2913 | 352.2833 | 0.0079° |
| 8 | 18.2428 | 18.2500 | 0.0072° |
| 9 | 48.3532 | 48.3500 | 0.0032° |
| 10 | 81.3151 | 81.3167 | 0.0016° |
| 11 | 114.4740 | 114.4667 | 0.0074° |
| 12 | 145.2091 | 145.2167 | 0.0076° |

## Gate result

**PASS.** Maximum classical-planet delta is 0.0148° (< 0.1°).
Maximum Ascendant/MC delta is 0.0151° (< 0.5°). All published Placidus cusp
deltas are below 0.01°. The full engine API may be built.

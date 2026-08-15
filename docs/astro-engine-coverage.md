# Pure astrology engine — coverage note

Module: `lib/oracle/engines/astro/`

- Pure functions only: no DB, network, LLM, or implicit current time.
- Parallel/additive: it is not imported by any route and does not modify the
  existing Oracle Astro implementation or its Ascendant formula.
- `ASTRO_ENGINE_VERSION = '1.0.0'`; bump it for every output change.
- Fixed exported conventions live in `conventions.ts`: tropical zodiac,
  Placidus houses, whole-sign fallback above |66.5°|, and the requested orb
  table.

## Native `astronomy-engine` coverage

| Output | Native primitive |
|---|---|
| Apparent geocentric Sun–Pluto vectors | `GeoVector(body, instant, true)` |
| True tropical ecliptic-of-date longitude | `Ecliptic(vector).elon` |
| Moon state for the true node | `GeoMoonState`, `Rotation_EQJ_ECT`, `RotateState` |
| Apparent Greenwich sidereal time | `SiderealTime` |
| Coordinate constants | `DEG2RAD`, `RAD2DEG` |

`EclipticLongitude()` is intentionally **not** used for planets: in
Astronomy Engine that function is heliocentric for planets, which would
eliminate apparent retrograde motion.

## Implemented by this module

### Time and zodiac

- Explicit local date/time + IANA timezone → UTC with `date-fns-tz`.
- Unknown birth time uses local noon only for date-dependent body positions.
  It never produces angles or houses.
- Longitude → tropical sign / degree-in-sign.
- Centered finite-difference longitude speed (±0.25 day), retrograde flag.
- Unknown-time Moon carries `uncertaintyDegrees`, the current full-day
  longitudinal motion (normally about 13°).

### True/South lunar nodes

The True Node is the ascending node of the Moon's instantaneous geocentric
orbital plane. The implementation rotates the Moon's position/velocity state
to true ecliptic-of-date coordinates, computes orbital angular momentum
`h = r × v`, then the ascending-node vector `n = k × h`. South Node is exactly
180° opposite. This matches the true-node references in
`docs/astro-verification.md`; it is not a mean-node formula.

### Angles

- Mean obliquity-of-date: IAU/Meeus polynomial.
- MC: ecliptic intersection for local apparent sidereal right ascension.
- Ascendant: standard horizon/ecliptic spherical intersection.
- Descendant and IC: exact opposites.

These formulas are new and isolated in this module. The existing
`lib/oracle/western-chart.ts` Ascendant implementation is untouched.

### Placidus cusp solver

Astronomy Engine does not calculate astrology houses. `houses.ts` implements
Placidus from scratch:

1. Calculate each candidate ecliptic point's declination.
2. Calculate its semi-diurnal arc:
   `H0 = acos(-tan(latitude) × tan(declination))`.
3. Trisect that arc for cusps 11/12 and the corresponding setting arc for
   cusps 9/8.
4. Convert the target right ascension back to ecliptic longitude.
5. Repeat as a fixed-point iteration (40 iterations).
6. Derive opposite cusps by +180°; use Asc/MC for cusps 1/10.

All twelve Steve Jobs reference cusps are within 0.01° of Astro-Charts.
At |latitude| > 66.5°, or if the semi-arc equation is numerically undefined,
the engine returns whole-sign cusps based on the Ascendant sign and explicitly
reports `houseSystemUsed: 'WHOLE_SIGN'`.

### Aspects

- Natal aspects: unordered body pairs inside one chart.
- Transits: transit-to-natal pairs only; transit-to-transit pairs are excluded.
- Synastry: chart-A-to-chart-B pairs only; intra-chart pairs are excluded.
- Applying/separating: project both longitudes 0.01 day with their instantaneous
  speeds and compare future absolute orb with current absolute orb.
- Boundary is inclusive at exactly the configured orb and excluded at
  `orb + 0.01`.

### Derived values

- Elements and modalities count all returned bodies, including the node axis.
- Rough chart shape uses only the ten classical planets (nodes excluded):
  Bundle, Bowl, Locomotive, Splash, or Splay based on occupied arc and largest
  gap. It returns null only when too few bodies exist to classify.
- House assignment walks each cusp-to-next-cusp forward modulo 360.

## Tests

`lib/oracle/engines/astro/__tests__/astro.test.ts` covers:

- published reference planet, node, Ascendant, MC, and all 12 Placidus cusps
- high-latitude whole-sign fallback
- documented Mercury retrograde
- aspect orb exclusion at `orb + 0.01`
- applying versus separating motion
- unknown birth time limitations and null houses/angles
- cusp monotonicity modulo 360
- transit-only and synastry-only cross aspects

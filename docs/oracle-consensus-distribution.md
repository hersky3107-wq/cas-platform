# Axis-layer consensus distribution

Synthetic N = 20,000 subjects, run TWICE (locale `ko` and locale `en`) = 40,000 subject-runs total.

- birth datetime: year uniform 1950–2010, month/day uniform (leap years handled), time of day uniform HH:mm
- 10% of subjects have an unknown birth time (`time: null`), to exercise the degraded/unreadable paths
- timezone: uniform over `Asia/Seoul`, `Asia/Tokyo`, `America/New_York`
- sex: uniform male/female; MBTI: uniform over the 16 types; colors: 3 distinct, uniform over the 24 PRISM colors; microCheck: 4 uniform integers 1–5
- tarot: 3-card spread, uniform distinct positions 1–78; runes: 3 drawn from the 24 Elder Futhark; iching: standard 6-line coin draw — all from per-subject seeded draws (no shared seed across subjects)
- numerology `latinName`: present for 70% of subjects (to exercise the expression-number blend vs. life-path-only fallback), independent of locale
- locale `ko`: random single-character Korean surname + 2-syllable given name (valid Hangul syllables) → `name` projector active. locale `en`: random English name → `name` projector `supported: false` (`name.locale_unsupported`)
- `atDate` fixed at **2026-08-20**
- phase consensus computed three times per subject: `readingScope` life / today / question (timescale weights in conventions.ts)
- this run also records `coreVerdict` (era+annual subset) and an era-only (saju+ziwei) subset. No thresholds applied.

Elapsed: ko 136.8s, en 134.8s, total 271.6s.

## Core-subset phase (last structural attempt)

Full-12 `fullTally` is the existing scope-weighted life tally (unchanged). `coreVerdict` uses saju / ziwei / prism / numerology / ninestar, confidence weight only, no scope multiplier. Era-only is saju + ziwei. No thresholds applied.

| Lens | mean leader | 35–44% band | consensus@60 | lean@45 | split | unanimity (≥2) | 50/50 voters (≥2) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| full-12 (life) | 44.1% | 59.8% | 1.57% | 36.75% | 61.68% | — | — |
| core (era+annual) | 47.6% | 42.0% | 8.33% | 48.51% | 43.16% | 2.22% | 2.16% |
| era-only (saju+ziwei) | 56.3% | 23.4% | 27.76% | 48.56% | 23.67% | 36.33% | 63.67% |

### coreVerdict — era + annual (5 systems)

- systems: saju, ziwei, prism, numerology, ninestar
- mean participating: **4.90** of 5
- mean leader share: **47.6%**
- 35–44% band: **42.0%**
- unanimity (all participating voters share one dominant axis, among N with ≥2 voters): **2.22%** (888 / 40000)
- 50/50 voter split (exactly two dominant axes, equal voter counts, among N with ≥2 voters): **2.16%** (864 / 40000)

#### Leader-share histogram (bucketed by 5)

| Leader share | Count | Share | |
| --- | ---: | ---: | --- |
|   0–  4 |      0 |   0.00% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
|   5–  9 |      0 |   0.00% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
|  10– 14 |      0 |   0.00% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
|  15– 19 |      0 |   0.00% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
|  20– 24 |      0 |   0.00% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
|  25– 29 |      0 |   0.00% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
|  30– 34 |    461 |   1.15% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
|  35– 39 |   6137 |  15.34% | ████░░░░░░░░░░░░░░░░░░░░ |
|  40– 44 |  10665 |  26.66% | ██████░░░░░░░░░░░░░░░░░░ |
|  45– 49 |   9654 |  24.14% | ██████░░░░░░░░░░░░░░░░░░ |
|  50– 54 |   6193 |  15.48% | ████░░░░░░░░░░░░░░░░░░░░ |
|  55– 59 |   3557 |   8.89% | ██░░░░░░░░░░░░░░░░░░░░░░ |
|  60– 64 |   2002 |   5.00% | █░░░░░░░░░░░░░░░░░░░░░░░ |
|  65– 69 |    829 |   2.07% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
|  70– 74 |    352 |   0.88% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
|  75– 79 |     92 |   0.23% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
|  80– 84 |     40 |   0.10% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
|  85– 89 |     18 |   0.04% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
|  90– 94 |      0 |   0.00% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
|  95–100 |      0 |   0.00% | ░░░░░░░░░░░░░░░░░░░░░░░░ |

#### Verdict distribution if thresholds were 60/45 (NOT applied)

| Verdict | Count | Share | |
| --- | ---: | ---: | --- |
| consensus | 3333 | 8.33% | ██░░░░░░░░░░░░░░░░░░░░░░ |
| lean | 19404 | 48.51% | ████████████░░░░░░░░░░░░ |
| split | 17263 | 43.16% | ██████████░░░░░░░░░░░░░░ |

#### Which phase axis leads

| Axis | Count | Share | |
| --- | ---: | ---: | --- |
| advance | 19861 | 49.65% | ████████████░░░░░░░░░░░░ |
| hold | 8142 | 20.36% | █████░░░░░░░░░░░░░░░░░░░ |
| release | 11997 | 29.99% | ███████░░░░░░░░░░░░░░░░░ |

### era-only — saju + ziwei

- systems: saju, ziwei
- mean participating: **1.90** of 2
- mean leader share: **56.3%**
- 35–44% band: **23.4%**
- unanimity (all participating voters share one dominant axis, among N with ≥2 voters): **36.33%** (13071 / 35978)
- 50/50 voter split (exactly two dominant axes, equal voter counts, among N with ≥2 voters): **63.67%** (22907 / 35978)

#### Leader-share histogram (bucketed by 5)

| Leader share | Count | Share | |
| --- | ---: | ---: | --- |
|   0–  4 |      0 |   0.00% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
|   5–  9 |      0 |   0.00% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
|  10– 14 |      0 |   0.00% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
|  15– 19 |      0 |   0.00% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
|  20– 24 |      0 |   0.00% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
|  25– 29 |      0 |   0.00% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
|  30– 34 |     97 |   0.24% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
|  35– 39 |   3789 |   9.47% | ██░░░░░░░░░░░░░░░░░░░░░░ |
|  40– 44 |   5584 |  13.96% | ███░░░░░░░░░░░░░░░░░░░░░ |
|  45– 49 |   7791 |  19.48% | █████░░░░░░░░░░░░░░░░░░░ |
|  50– 54 |   8023 |  20.06% | █████░░░░░░░░░░░░░░░░░░░ |
|  55– 59 |   3611 |   9.03% | ██░░░░░░░░░░░░░░░░░░░░░░ |
|  60– 64 |   3719 |   9.30% | ██░░░░░░░░░░░░░░░░░░░░░░ |
|  65– 69 |   2059 |   5.15% | █░░░░░░░░░░░░░░░░░░░░░░░ |
|  70– 74 |    654 |   1.64% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
|  75– 79 |    437 |   1.09% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
|  80– 84 |    181 |   0.45% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
|  85– 89 |     30 |   0.07% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
|  90– 94 |      3 |   0.01% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
|  95–100 |   4022 |  10.05% | ██░░░░░░░░░░░░░░░░░░░░░░ |

#### Verdict distribution if thresholds were 60/45 (NOT applied)

| Verdict | Count | Share | |
| --- | ---: | ---: | --- |
| consensus | 11105 | 27.76% | ███████░░░░░░░░░░░░░░░░░ |
| lean | 19425 | 48.56% | ████████████░░░░░░░░░░░░ |
| split | 9470 | 23.67% | ██████░░░░░░░░░░░░░░░░░░ |

#### Which phase axis leads

| Axis | Count | Share | |
| --- | ---: | ---: | --- |
| advance | 17353 | 43.38% | ██████████░░░░░░░░░░░░░░ |
| hold | 9776 | 24.44% | ██████░░░░░░░░░░░░░░░░░░ |
| release | 12871 | 32.18% | ████████░░░░░░░░░░░░░░░░ |

## Before / after

| Metric | Before softenPhase (life, equal weights) | After timescale + element fix (life scope) |
| --- | ---: | ---: |
| consensus % | 0.18% | **1.57%** |
| lean % | 22.99% | **36.75%** |
| split % | 76.83% | **61.68%** |
| mean leader share (life) | 41.7% | **44.1%** |
| polarized % (life) | — | **21.87%** |
| aggregate wood % | 16.4% | see element supply § |

## Phase by readingScope

### readingScope `life` (combined ko + en, N = 40,000)

- mean leader share: **44.1%**

#### Leader-share histogram (bucketed by 5)

| Leader share | Count | Share | |
| --- | ---: | ---: | --- |
|   0–  4 |      0 |   0.00% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
|   5–  9 |      0 |   0.00% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
|  10– 14 |      0 |   0.00% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
|  15– 19 |      0 |   0.00% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
|  20– 24 |      0 |   0.00% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
|  25– 29 |      0 |   0.00% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
|  30– 34 |    733 |   1.83% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
|  35– 39 |  10422 |  26.05% | ██████░░░░░░░░░░░░░░░░░░ |
|  40– 44 |  13517 |  33.79% | ████████░░░░░░░░░░░░░░░░ |
|  45– 49 |   8863 |  22.16% | █████░░░░░░░░░░░░░░░░░░░ |
|  50– 54 |   4247 |  10.62% | ███░░░░░░░░░░░░░░░░░░░░░ |
|  55– 59 |   1591 |   3.98% | █░░░░░░░░░░░░░░░░░░░░░░░ |
|  60– 64 |    504 |   1.26% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
|  65– 69 |    109 |   0.27% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
|  70– 74 |     14 |   0.03% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
|  75– 79 |      0 |   0.00% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
|  80– 84 |      0 |   0.00% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
|  85– 89 |      0 |   0.00% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
|  90– 94 |      0 |   0.00% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
|  95–100 |      0 |   0.00% | ░░░░░░░░░░░░░░░░░░░░░░░░ |

#### Verdict distribution (current thresholds: consensus≥60 / lean≥45 / split<45)

| Verdict | Count | Share | |
| --- | ---: | ---: | --- |
| consensus | 627 | 1.57% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
| lean | 14701 | 36.75% | █████████░░░░░░░░░░░░░░░ |
| split | 24672 | 61.68% | ███████████████░░░░░░░░░ |

- polarized (tally bimodal, annotation only): **21.87%**

#### Opposition pairs (top 5)

| Pair | Count | Share of N |
| --- | ---: | ---: |
| sukuyou ↔ tzolkin | 20941 | 52.35% |
| ninestar ↔ sukuyou | 16091 | 40.23% |
| prism ↔ tzolkin | 13347 | 33.37% |
| numerology ↔ tzolkin | 13242 | 33.11% |
| ninestar ↔ tzolkin | 12469 | 31.17% |

- subjects with at least one opposite-pole pair: **94.09%**

#### Which phase axis leads

| Axis | Count | Share | |
| --- | ---: | ---: | --- |
| advance | 17650 | 44.13% | ███████████░░░░░░░░░░░░░ |
| hold | 12422 | 31.05% | ███████░░░░░░░░░░░░░░░░░ |
| release | 9928 | 24.82% | ██████░░░░░░░░░░░░░░░░░░ |

Note: 59.8% of subjects fall in the 35–44% leader-share band.

### readingScope `today` (combined ko + en, N = 40,000)

- mean leader share: **41.8%**

#### Leader-share histogram (bucketed by 5)

| Leader share | Count | Share | |
| --- | ---: | ---: | --- |
|   0–  4 |      0 |   0.00% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
|   5–  9 |      0 |   0.00% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
|  10– 14 |      0 |   0.00% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
|  15– 19 |      0 |   0.00% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
|  20– 24 |      0 |   0.00% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
|  25– 29 |      0 |   0.00% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
|  30– 34 |   1284 |   3.21% | █░░░░░░░░░░░░░░░░░░░░░░░ |
|  35– 39 |  14769 |  36.92% | █████████░░░░░░░░░░░░░░░ |
|  40– 44 |  14518 |  36.30% | █████████░░░░░░░░░░░░░░░ |
|  45– 49 |   6808 |  17.02% | ████░░░░░░░░░░░░░░░░░░░░ |
|  50– 54 |   2185 |   5.46% | █░░░░░░░░░░░░░░░░░░░░░░░ |
|  55– 59 |    395 |   0.99% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
|  60– 64 |     40 |   0.10% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
|  65– 69 |      1 |   0.00% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
|  70– 74 |      0 |   0.00% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
|  75– 79 |      0 |   0.00% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
|  80– 84 |      0 |   0.00% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
|  85– 89 |      0 |   0.00% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
|  90– 94 |      0 |   0.00% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
|  95–100 |      0 |   0.00% | ░░░░░░░░░░░░░░░░░░░░░░░░ |

#### Verdict distribution (current thresholds: consensus≥60 / lean≥45 / split<45)

| Verdict | Count | Share | |
| --- | ---: | ---: | --- |
| consensus | 41 | 0.10% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
| lean | 9388 | 23.47% | ██████░░░░░░░░░░░░░░░░░░ |
| split | 30571 | 76.43% | ██████████████████░░░░░░ |

- polarized (tally bimodal, annotation only): **14.24%**

#### Opposition pairs (top 5)

| Pair | Count | Share of N |
| --- | ---: | ---: |
| sukuyou ↔ tzolkin | 20941 | 52.35% |
| ninestar ↔ sukuyou | 16091 | 40.23% |
| prism ↔ tzolkin | 13347 | 33.37% |
| numerology ↔ tzolkin | 13242 | 33.11% |
| ninestar ↔ tzolkin | 12469 | 31.17% |

- subjects with at least one opposite-pole pair: **94.09%**

#### Which phase axis leads

| Axis | Count | Share | |
| --- | ---: | ---: | --- |
| advance | 22777 | 56.94% | ██████████████░░░░░░░░░░ |
| hold | 11109 | 27.77% | ███████░░░░░░░░░░░░░░░░░ |
| release | 6114 | 15.29% | ████░░░░░░░░░░░░░░░░░░░░ |

Note: 73.2% of subjects fall in the 35–44% leader-share band.

### readingScope `question` (combined ko + en, N = 40,000)

- mean leader share: **42.5%**

#### Leader-share histogram (bucketed by 5)

| Leader share | Count | Share | |
| --- | ---: | ---: | --- |
|   0–  4 |      0 |   0.00% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
|   5–  9 |      0 |   0.00% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
|  10– 14 |      0 |   0.00% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
|  15– 19 |      0 |   0.00% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
|  20– 24 |      0 |   0.00% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
|  25– 29 |      0 |   0.00% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
|  30– 34 |   1105 |   2.76% | █░░░░░░░░░░░░░░░░░░░░░░░ |
|  35– 39 |  13134 |  32.84% | ████████░░░░░░░░░░░░░░░░ |
|  40– 44 |  14563 |  36.41% | █████████░░░░░░░░░░░░░░░ |
|  45– 49 |   7679 |  19.20% | █████░░░░░░░░░░░░░░░░░░░ |
|  50– 54 |   2680 |   6.70% | ██░░░░░░░░░░░░░░░░░░░░░░ |
|  55– 59 |    707 |   1.77% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
|  60– 64 |    121 |   0.30% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
|  65– 69 |      9 |   0.02% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
|  70– 74 |      2 |   0.01% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
|  75– 79 |      0 |   0.00% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
|  80– 84 |      0 |   0.00% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
|  85– 89 |      0 |   0.00% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
|  90– 94 |      0 |   0.00% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
|  95–100 |      0 |   0.00% | ░░░░░░░░░░░░░░░░░░░░░░░░ |

#### Verdict distribution (current thresholds: consensus≥60 / lean≥45 / split<45)

| Verdict | Count | Share | |
| --- | ---: | ---: | --- |
| consensus | 132 | 0.33% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
| lean | 11066 | 27.66% | ███████░░░░░░░░░░░░░░░░░ |
| split | 28802 | 72.00% | █████████████████░░░░░░░ |

- polarized (tally bimodal, annotation only): **14.98%**

#### Opposition pairs (top 5)

| Pair | Count | Share of N |
| --- | ---: | ---: |
| sukuyou ↔ tzolkin | 20941 | 52.35% |
| ninestar ↔ sukuyou | 16091 | 40.23% |
| prism ↔ tzolkin | 13347 | 33.37% |
| numerology ↔ tzolkin | 13242 | 33.11% |
| ninestar ↔ tzolkin | 12469 | 31.17% |

- subjects with at least one opposite-pole pair: **94.09%**

#### Which phase axis leads

| Axis | Count | Share | |
| --- | ---: | ---: | --- |
| advance | 17390 | 43.48% | ██████████░░░░░░░░░░░░░░ |
| hold | 15976 | 39.94% | ██████████░░░░░░░░░░░░░░ |
| release | 6634 | 16.59% | ████░░░░░░░░░░░░░░░░░░░░ |

Note: 69.2% of subjects fall in the 35–44% leader-share band.

## Phase by readingScope (summary)

| Scope | mean leader | consensus | lean | split | polarized | 35–44% band |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| life | 44.1% | 1.57% | 36.75% | 61.68% | 21.87% | 59.8% |
| today | 41.8% | 0.10% | 23.47% | 76.43% | 14.24% | 73.2% |
| question | 42.5% | 0.33% | 27.66% | 72.00% | 14.98% | 69.2% |

## Element supply by projector (combined ko + en)

Mean element vector each projector contributes (weighted by its element confidence), plus aggregate consensus totals.

| Projector | wood | fire | earth | metal | water |
| --- | ---: | ---: | ---: | ---: | ---: |
| saju | 18.5 | 18.4 | 26.6 | 18.4 | 18.1 |
| astro | 18.8 | 25.1 | 17.4 | 13.7 | 24.9 |
| prism | 14.5 | 16.6 | 14.9 | 38.9 | 15.2 |
| ziwei | 19.7 | 18.8 | 20.9 | 19.4 | 21.2 |
| numerology | — | — | — | — | — |
| name | 15.5 | 16.2 | 22.1 | 21.0 | 25.1 |
| iching | 16.3 | 16.8 | 33.5 | 16.9 | 16.5 |
| tarot | 18.6 | 25.0 | 17.4 | 13.7 | 25.4 |
| runes | 36.3 | 18.1 | 9.3 | 18.1 | 18.3 |
| ninestar | 22.5 | 10.5 | 33.9 | 21.7 | 11.4 |
| sukuyou | 20.7 | 20.9 | 20.7 | 17.4 | 20.3 |
| tzolkin | — | — | — | — | — |

Aggregate mean element total (from consensus, N=40,000): **19.4 / 17.7 / 23.3 / 21.1 / 18.5**

★ Aggregate wood (**19.4%**) is within ~2 pts of the other elements' average after mapping fixes.

## Locale `ko` (N = 20,000)

Korean name supplied → name participates in traits + elements (phase unreadable).

### Element deficiency

| Element | Top-deficiency % | Mean deficiency | |
| --- | ---: | ---: | --- |
| wood | 23.34% | 3.53 | ██████░░░░░░░░░░░░░░░░░░ |
| fire | 29.72% | 4.27 | ███████░░░░░░░░░░░░░░░░░ |
| earth | 7.85% | 1.47 | ██░░░░░░░░░░░░░░░░░░░░░░ |
| metal | 14.63% | 2.40 | ████░░░░░░░░░░░░░░░░░░░░ |
| water | 24.47% | 3.63 | ██████░░░░░░░░░░░░░░░░░░ |

★ No single element exceeds 35% top-deficiency share (max observed: 29.72%). The deficiency vector is varied.

- flat deficiency vectors (max deficiency < 5): 8.80%

### Traits

#### How many of the 6 axes are contested

| Contested axes | Count | Share | |
| --- | ---: | ---: | --- |
| 0 of 6 | 1309 | 6.54% | ██░░░░░░░░░░░░░░░░░░░░░░ |
| 1 of 6 | 4837 | 24.19% | ██████░░░░░░░░░░░░░░░░░░ |
| 2 of 6 | 7254 | 36.27% | █████████░░░░░░░░░░░░░░░ |
| 3 of 6 | 4700 | 23.50% | ██████░░░░░░░░░░░░░░░░░░ |
| 4 of 6 | 1640 | 8.20% | ██░░░░░░░░░░░░░░░░░░░░░░ |
| 5 of 6 | 248 | 1.24% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
| 6 of 6 | 12 | 0.06% | ░░░░░░░░░░░░░░░░░░░░░░░░ |

- mean contested axes: **2.07** of 6

#### Per-axis contested rate

| Axis | Contested % | |
| --- | ---: | --- |
| drive | 38.89% | █████████░░░░░░░░░░░░░░░ |
| stability | 24.47% | ██████░░░░░░░░░░░░░░░░░░ |
| relation | 28.23% | ███████░░░░░░░░░░░░░░░░░ |
| control | 32.85% | ████████░░░░░░░░░░░░░░░░ |
| exploration | 30.38% | ███████░░░░░░░░░░░░░░░░░ |
| reflection | 51.77% | ████████████░░░░░░░░░░░░ |

#### Centered profile spread distribution

| Centered spread | Count | Share | |
| --- | ---: | ---: | --- |
|    0–1 |       0 |   0.00% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
|    2–3 |      73 |   0.06% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
|    4–5 |    2461 |   2.05% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
|    6–7 |   16484 |  13.74% | ███░░░░░░░░░░░░░░░░░░░░░ |
|    8–9 |   37149 |  30.96% | ███████░░░░░░░░░░░░░░░░░ |
|  10–11 |   37742 |  31.45% | ████████░░░░░░░░░░░░░░░░ |
|  12–13 |   18876 |  15.73% | ████░░░░░░░░░░░░░░░░░░░░ |
|  14–15 |    5421 |   4.52% | █░░░░░░░░░░░░░░░░░░░░░░░ |
|  16–17 |    1404 |   1.17% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
|  18–19 |     327 |   0.27% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
|    20+ |      63 |   0.05% | ░░░░░░░░░░░░░░░░░░░░░░░░ |

- samples: 120,000 (6 axes × 20,000 subjects)
- mean: **10.24**
- median (p50): **10.10**
- p90: **13.20**
- current TRAIT_CONTESTED_SPREAD = **11**

### Participation

| Space | Mean systems participating (of 12) |
| --- | ---: |
| traits | 10.90 |
| elements | 9.54 |
| phase | 10.90 |

#### Unreadable systems, by space and code

| System | Space | Code | Count | Share of N | |
| --- | --- | --- | ---: | ---: | --- |
| tzolkin | elements | `maya.no_wuxing_mapping` | 20000 | 100.00% | ████████████████████████ |
| iching | traits | `iching.no_trait_reading` | 20000 | 100.00% | ████████████████████████ |
| numerology | elements | `numerology.no_wuxing_mapping` | 20000 | 100.00% | ████████████████████████ |
| name | phase | `name.no_time_axis` | 20000 | 100.00% | ████████████████████████ |
| sukuyou | elements | `sukuyou.no_wuxing_for_luminary` | 5951 | 29.75% | ███████░░░░░░░░░░░░░░░░░ |
| runes | elements | `rune.no_element_consensus` | 2777 | 13.88% | ███░░░░░░░░░░░░░░░░░░░░░ |
| ziwei | traits | `ziwei.no_birth_time` | 2067 | 10.33% | ██░░░░░░░░░░░░░░░░░░░░░░ |
| ziwei | phase | `ziwei.no_birth_time` | 2067 | 10.33% | ██░░░░░░░░░░░░░░░░░░░░░░ |
| tarot | elements | `tarot.no_minor_cards` | 400 | 2.00% | ░░░░░░░░░░░░░░░░░░░░░░░░ |

#### Unknown-birth-time cohort (10%) vs. the rest

| Cohort | N | traits participating | elements participating | phase participating | mean contested axes | mean leader share |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| birth time known | 17933 | 11.00 | 9.54 | 11.00 | 2.02 | 43.8 |
| birth time UNKNOWN | 2067 | 10.00 | 9.54 | 10.00 | 2.47 | 46.2 |

- unknown-birth-time share of subjects: 10.33% (target ~10%)
- `ziwei` traits unreadable count: 2067 — should equal the unknown-birth-time count (2067), since `ziwei` is the only system whose traits/phase go fully `unreadable` (not merely degraded) on unknown birth time.
- `ziwei` phase unreadable count: 2067 (ziwei.no_current_daxian may add a small amount on top when `atDate` falls outside the computed 大限 range even with a known birth time).

## Locale `en` (N = 20,000)

No CJK name supplied → name is entirely unreadable (non-CJK locale).

### Element deficiency

| Element | Top-deficiency % | Mean deficiency | |
| --- | ---: | ---: | --- |
| wood | 21.34% | 3.56 | █████░░░░░░░░░░░░░░░░░░░ |
| fire | 29.01% | 4.50 | ███████░░░░░░░░░░░░░░░░░ |
| earth | 7.65% | 1.63 | ██░░░░░░░░░░░░░░░░░░░░░░ |
| metal | 14.19% | 2.62 | ███░░░░░░░░░░░░░░░░░░░░░ |
| water | 27.82% | 4.42 | ███████░░░░░░░░░░░░░░░░░ |

★ No single element exceeds 35% top-deficiency share (max observed: 29.01%). The deficiency vector is varied.

- flat deficiency vectors (max deficiency < 5): 5.95%

### Traits

#### How many of the 6 axes are contested

| Contested axes | Count | Share | |
| --- | ---: | ---: | --- |
| 0 of 6 | 1020 | 5.10% | █░░░░░░░░░░░░░░░░░░░░░░░ |
| 1 of 6 | 4092 | 20.46% | █████░░░░░░░░░░░░░░░░░░░ |
| 2 of 6 | 6955 | 34.77% | ████████░░░░░░░░░░░░░░░░ |
| 3 of 6 | 5338 | 26.69% | ██████░░░░░░░░░░░░░░░░░░ |
| 4 of 6 | 2152 | 10.76% | ███░░░░░░░░░░░░░░░░░░░░░ |
| 5 of 6 | 407 | 2.04% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
| 6 of 6 | 36 | 0.18% | ░░░░░░░░░░░░░░░░░░░░░░░░ |

- mean contested axes: **2.24** of 6

#### Per-axis contested rate

| Axis | Contested % | |
| --- | ---: | --- |
| drive | 40.22% | ██████████░░░░░░░░░░░░░░ |
| stability | 28.85% | ███████░░░░░░░░░░░░░░░░░ |
| relation | 33.30% | ████████░░░░░░░░░░░░░░░░ |
| control | 36.03% | █████████░░░░░░░░░░░░░░░ |
| exploration | 32.21% | ████████░░░░░░░░░░░░░░░░ |
| reflection | 53.76% | █████████████░░░░░░░░░░░ |

#### Centered profile spread distribution

| Centered spread | Count | Share | |
| --- | ---: | ---: | --- |
|    0–1 |       0 |   0.00% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
|    2–3 |      80 |   0.07% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
|    4–5 |    2817 |   2.35% | █░░░░░░░░░░░░░░░░░░░░░░░ |
|    6–7 |   16049 |  13.37% | ███░░░░░░░░░░░░░░░░░░░░░ |
|    8–9 |   34676 |  28.90% | ███████░░░░░░░░░░░░░░░░░ |
|  10–11 |   37026 |  30.86% | ███████░░░░░░░░░░░░░░░░░ |
|  12–13 |   20557 |  17.13% | ████░░░░░░░░░░░░░░░░░░░░ |
|  14–15 |    6431 |   5.36% | █░░░░░░░░░░░░░░░░░░░░░░░ |
|  16–17 |    1751 |   1.46% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
|  18–19 |     462 |   0.39% | ░░░░░░░░░░░░░░░░░░░░░░░░ |
|    20+ |     151 |   0.13% | ░░░░░░░░░░░░░░░░░░░░░░░░ |

- samples: 120,000 (6 axes × 20,000 subjects)
- mean: **10.38**
- median (p50): **10.30**
- p90: **13.50**
- current TRAIT_CONTESTED_SPREAD = **11**

### Participation

| Space | Mean systems participating (of 12) |
| --- | ---: |
| traits | 9.90 |
| elements | 8.54 |
| phase | 10.90 |

#### Unreadable systems, by space and code

| System | Space | Code | Count | Share of N | |
| --- | --- | --- | ---: | ---: | --- |
| tzolkin | elements | `maya.no_wuxing_mapping` | 20000 | 100.00% | ████████████████████████ |
| iching | traits | `iching.no_trait_reading` | 20000 | 100.00% | ████████████████████████ |
| numerology | elements | `numerology.no_wuxing_mapping` | 20000 | 100.00% | ████████████████████████ |
| name | traits | `name.locale_unsupported` | 20000 | 100.00% | ████████████████████████ |
| name | elements | `name.locale_unsupported` | 20000 | 100.00% | ████████████████████████ |
| name | phase | `name.locale_unsupported` | 20000 | 100.00% | ████████████████████████ |
| sukuyou | elements | `sukuyou.no_wuxing_for_luminary` | 5918 | 29.59% | ███████░░░░░░░░░░░░░░░░░ |
| runes | elements | `rune.no_element_consensus` | 2854 | 14.27% | ███░░░░░░░░░░░░░░░░░░░░░ |
| ziwei | traits | `ziwei.no_birth_time` | 1955 | 9.78% | ██░░░░░░░░░░░░░░░░░░░░░░ |
| ziwei | phase | `ziwei.no_birth_time` | 1955 | 9.78% | ██░░░░░░░░░░░░░░░░░░░░░░ |
| tarot | elements | `tarot.no_minor_cards` | 418 | 2.09% | █░░░░░░░░░░░░░░░░░░░░░░░ |

#### Unknown-birth-time cohort (10%) vs. the rest

| Cohort | N | traits participating | elements participating | phase participating | mean contested axes | mean leader share |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| birth time known | 18045 | 10.00 | 8.54 | 11.00 | 2.20 | 43.8 |
| birth time UNKNOWN | 1955 | 9.00 | 8.54 | 10.00 | 2.66 | 46.3 |

- unknown-birth-time share of subjects: 9.78% (target ~10%)
- `ziwei` traits unreadable count: 1955 — should equal the unknown-birth-time count (1955), since `ziwei` is the only system whose traits/phase go fully `unreadable` (not merely degraded) on unknown birth time.
- `ziwei` phase unreadable count: 1955 (ziwei.no_current_daxian may add a small amount on top when `atDate` falls outside the computed 大限 range even with a known birth time).

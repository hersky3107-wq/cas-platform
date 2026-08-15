# Calendar engine — coverage report

New, additive module: `lib/oracle/engines/calendar/`. No existing oracle file was modified.
Pure functions only — no DB, no network, no LLM, no `Date.now()`. Every instant-resolving
function takes an explicit date/time + IANA timezone. Valid range 1900–2100, enforced via a
typed `CalendarRangeError`. `CALENDAR_ENGINE_VERSION = '1.0.0'` (bump on any output change).

See `docs/calendar-verification.md` for the Step-1 verification and the two critical
library-behavior findings (timezone frame + date-vs-datetime precision) this engine corrects for.

## Files

| File | Purpose |
|---|---|
| `types.ts` | Shared types |
| `tables.ts` | All lookup tables (천간/지지/오행/십신/9성/27수/20나왈), separate from logic |
| `utils.ts` | Date/time/timezone helpers, JDN, range assertion |
| `errors.ts` | `CalendarRangeError`, `CalendarInputError` |
| `lunar-adapter.ts` | The only file that touches `lunar-javascript` untyped; re-exposes a typed subset |
| `ganzhi.ts` | `toLunar`, `toSolar`, `solarTerms`, `fourPillars` |
| `five-elements.ts` | `fiveElementBalance` |
| `ten-gods.ts` | `tenGods` |
| `great-luck.ts` | `greatLuck` (대운) |
| `nine-star.ts` | `nineStar` (구성) |
| `sukuyou.ts` | `sukuyou` (27수) |
| `season-element.ts` | `seasonElement` |
| `tzolkin.ts` | `tzolkin` |
| `index.ts` | Barrel export + `CALENDAR_ENGINE_VERSION` |
| `__tests__/*.test.ts` | Vitest suite (37 tests, all passing) |

Vitest was not previously in the repo; added as a devDependency with `vitest.config.mts` and
`npm run test` (`vitest run`). The existing `scripts/verify-*.ts` convention (`npx tsx`) was kept
for the one-off Step-1 verification script (`scripts/verify-calendar-engine.ts`) since it's a
throwaway diagnostic, not a maintained unit test.

## What the library (`lunar-javascript@1.7.7`) covers natively vs. what was implemented from scratch

| Function | Source |
|---|---|
| `toLunar` / `toSolar` | **Library**, thin wrapper (`Solar.fromYmd`/`Lunar.fromYmd`, leap-month via negative month number) |
| `solarTerms` | **Library** provides the underlying jieqi computation; **implemented**: per-year chronological walk (`getNextJieQi()`) + CST→UTC instant correction + position-based metadata assignment (see below) |
| `fourPillars` year/month | **Library** (`getYearInGanZhiExact`/`getMonthInGanZhiExact`), fed through a **hand-built Beijing-equivalent-frame adapter** (implemented) |
| `fourPillars` day | **Library** (`getDayGan`/`getDayZhi`), used directly off the true local date |
| `fourPillars` hour | **Implemented from scratch** (五鼠遁 formula), bypassing the library's `getTimeGan`/`getTimeZhi` — see finding below |
| `fiveElementBalance` | **Implemented from scratch** from `tables.ts`'s stem/branch element assignments |
| `tenGods` | **Implemented from scratch**, simplified (지지 principal element, not 지장간-weighted — see below) |
| `greatLuck` (대운) | **Library** (`EightChar.getYun()`), verified to already use the `*Exact` jieqi convention internally; **implemented**: Beijing-frame feed + true-local-year `startYear`/`endYear` recomputation |
| `nineStar` year/month (본명성/월명성) | **Implemented from scratch** from documented digit-reduction formulas, validated against a published worked example (1951년생 → 사록목성/4) |
| `nineStar` day (일명성) | **Library** (`getDayNineStar()`, 玄空飛星 Flying-Star numbering) — explicitly flagged as a different school, see below |
| `sukuyou` (27수) | **Implemented from scratch** via `astronomy-engine` real moon ecliptic longitude — the library has no 27-mansion concept at all (only 28宿 `getXiu()`, a different, calendrical system) |
| `seasonElement` | **Implemented from scratch**, built on `solarTerms()`'s real per-year jie instants |
| `tzolkin` | **Implemented from scratch** (Maya calendar; wholly outside the library's scope), validated against the well-documented public correlation date 2012-12-21 = "4 Ajaw" |

## Critical findings (full detail in `docs/calendar-verification.md`)

1. **lunar-javascript's internal jieqi table is in China Standard Time (UTC+8)**, regardless of
   the caller's intended timezone. Verified by independently computing the 1988 LiChun instant
   via `astronomy-engine` (14:43:18 UTC) and showing it matches the library's own timestamp only
   after relabeling as UTC+8, not UTC+9. The engine corrects this by converting the true birth
   UTC instant to its Beijing-equivalent civil-time label before asking the library to resolve
   year/month pillars — day/hour pillars are computed from the true local date/time and are
   never shifted (they don't depend on jieqi at all).
2. **The library's default/`ByLiChun` accessors compare by calendar DATE, not datetime** —
   a birth minutes before a term boundary still gets the post-boundary pillar if it's the same
   calendar day. The engine exclusively uses the `*Exact` accessor family.
3. **`getTimeGan()`/`getTimeZhi()` (hour pillar) silently apply a "late zi-hour" (야자시) day+1
   rollover for the last two hours of the day**, even though `getDayGan()`/`getDayZhi()` (day
   pillar) do NOT roll over at the same point — producing an internally inconsistent
   (day=A, hour-stem-as-if-day=A+1) result near midnight. Verified: for day 己巳, hour-stem at
   00:00 is 甲 (consistent, 甲己日→子시甲), but at 23:59 it's 丙 (matches 乙庚日→子시丙, i.e. computed
   as if the day were already 庚午 — the next day). The engine bypasses this entirely and derives
   the hour pillar itself via the standard 五鼠遁 formula from the day stem that is actually
   displayed, verified to reproduce the library's own non-boundary results exactly (04:30 → 丙寅,
   00:00 → 甲子) while staying self-consistent at the boundary.
4. **`getJieQiTable()`'s dict keys are unreliable for programmatic term identification** — they
   mix simplified Chinese term names with pinyin-uppercase fallback keys (`DA_XUE`, `LI_CHUN`,
   ...) for terms that repeat across the table's ~13-month window. The engine never reads that
   table by key; `solarTerms()` walks the sequence chronologically and assigns metadata by
   fixed cyclical position instead.

## 유파 (school) differences — flagged, not silently resolved

| Area | Decision made | Alternative(s) not implemented |
|---|---|---|
| 진태양시 (true solar time) | Not applied (matches lunar-javascript default and the reference sites' default mode) | ~32-min longitude correction for Seoul (offered as an opt-in by 사주프라임/SAZU) |
| 자시/야자시 (midnight rollover) | Day rolls at true local midnight (조자시 default) | 야자시: day rolls at 23:00 |
| Hour-branch boundaries | Whole-hour bins (23:00–01:00 = 子, ...) | `:30`-offset bins seen in some references (23:30–01:30 = 子, ...) |
| 십신 for branches | Branch's own principal element (地支本氣) | **Verified concrete divergence**: for the reference chart, this engine's `tenGods` gives day-branch 巳 → 편인, but lunar-javascript's `getBaZiShiShenZhi()` gives 正印(정인) for the identical chart. Root cause: the library evidently uses the branch's dominant 지장간 (hidden stem, 丙-fire-yang for 巳) rather than the branch's own nominal element+parity (fire-yin). This is a real, verified school difference, not a bug in either implementation — reconciling requires an explicit decision on which convention the product wants. |
| 일명성 (day nine-star) | Falls back to lunar-javascript's 玄空飛星 (Xuan Kong Flying Star) numbering | No simple from-scratch digit-formula for day-star was found in the sources checked (unlike year/month, which do have one); the traditional method uses a 60-day 上元/中元/下元 (三元) cycle keyed to the nearest 冬至. Flying-Star and 구성기학 day-star are related but not guaranteed identical. |
| 27수 (sukuyou) calibration | Tropical moon ecliptic longitude, 0° = mansion 1 (昴宿), 27 equal 13°20′ segments | Not independently verified against a trusted 宿曜道/Nakshatra reference implementation. Open questions: (a) tropical vs. sidereal longitude (ayanamsa choice), (b) whether traditional practice actually uses a fixed 27-day repeating count anchored to 음력 new-moon dates rather than true longitude at all (one source found shows exactly such a lookup table). Treat current output as an internally-consistent placeholder pending a domain-expert-approved calibration constant. |
| 9성 (nine-star) system identity | 본명성/월명성 use the digit-reduction 구성기학 (Kyusei Kigaku) formulas | lunar-javascript's `getYearNineStar()` etc. implement 玄空飛星 (Flying Star Feng Shui), a DIFFERENT 9-star system that happens to share the same 1-9/five-color/five-element vocabulary. Do not treat the two as interchangeable. |

## Test coverage (37 tests, `npm run test`)

- 입춘 boundary: Feb 3 vs Feb 5 1988 get different year pillars — ✅ (`pillars.test.ts`)
- 절기 boundary within 1 hour lands correctly (23:30 vs 23:50 KST around the true LiChun instant) — ✅
- Day pillar continuity (+1 stem, +1 branch) across a month boundary, a year boundary, and a
  leap-year Feb 29 boundary — ✅
- 대운 direction differs by sex AND by year-stem polarity (1988 戊-yang vs 1987 丁-yin, both sexes) — ✅
- 9성 uses 절기 boundaries, not calendar months/Jan 1 (Jan 15 vs Mar 15 year-star; Feb 1 vs Feb 10
  month-star straddling 입춘) — ✅
- Timezone correctness: identical wall-clock time in Asia/Seoul vs Asia/Tokyo (same UTC+9 offset)
  gives identical pillars; the same wall-clock digits in Asia/Kolkata (UTC+5:30, a genuinely
  different instant) correctly crosses the boundary differently — ✅
- Unknown birth time returns `hour: null, hourUnknown: true` without throwing (checked across
  `fourPillars`, `nineStar`, `sukuyou`); `greatLuck` throws a typed `CalendarInputError` instead,
  since 대운수 fundamentally requires a known birth time — ✅
- Plus: toLunar/toSolar round-trip (incl. leap month), solarTerms exactly-24/chronological/jie-qi
  split, fiveElementBalance against the verified reference chart, seasonElement's 18-day Earth
  buffer, tzolkin against the public 2012-12-21 "4 Ajaw" reference, range-error on out-of-range years.

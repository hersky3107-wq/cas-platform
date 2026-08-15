/**
 * 자미두수 (Zi Wei Dou Shu) PART 1 — star placement only.
 *
 * Pure functions. Lunar conversion is delegated to `lib/oracle/engines/calendar`.
 * This module does NOT implement 四化, 大限, 流年, or interpretation (PART 2).
 *
 * ── TRAP 1 — lunar month, not 절기 ─────────────────────────────────────
 * `fourPillars()` switches the *month pillar* at 節 boundaries (입춘/경칩/…).
 * Zi Wei 命宮/身宮/左輔/右弼 use the lunar calendar month number from
 * `toLunar()`, never the ganzhi month. Using 절기 here is the most common
 * way to get a wrong chart.
 *
 * ── TRAP 2 — leap months (閏月) ────────────────────────────────────────
 * Schools differ. This engine treats a leap month as the SAME month number
 * as the preceding (non-leap) month. `toLunar()` already returns
 * `month = abs(raw)` and `isLeapMonth`; we use that month number as-is and
 * expose `flags.leapMonth` so a "count leap as next month" or iztro-style
 * "day>15 → next month" convention can be added later without a rewrite.
 *
 * ── TRAP 3 — 子時 split ────────────────────────────────────────────────
 * Follows the calendar engine's `dayBoundary` (default `zi_start`):
 *   - `lateZiHour` is true at 23:00–23:59 (晚子時). It does NOT mean the
 *     day rolled — that is `lunarDayRolled`.
 *   - `zi_start`: lunar day used for 紫微 advances to the next civil
 *     date's Chinese `toLunar` (iztro 晚子时). Day pillar from fourPillars
 *     also advances.
 *   - `civil_midnight`: lunar day stays on the civil date; day pillar
 *     does not advance. Hour is still 子.
 *
 * ── TRAP 4 — computation order ─────────────────────────────────────────
 * 五行局 depends on the 命宮 stem-branch, which depends on the year stem
 * (五虎遁). Do not shortcut. Order:
 *   1. lunar date + year stem/branch + 時支 (calendar engine)
 *   2. 命宮 from lunar month + 時支
 *   3. 身宮
 *   4. 十二宮 names from 命宮, decreasing 地支 (counterclockwise on the
 *      standard 巳-午-未-申 chart)
 *   5. 宮干 via 五虎遁 from the year stem
 *   6. 五行局 from 命宮 干支 纳音
 *   7. 紫微 from 五行局 + lunar day
 *   8–12. remaining stars
 *
 * Year stem/branch come from `fourPillars()` (立春 year), not the lunar
 * new-year label. That is the usual 三合/中州 convention and matches the
 * calendar engine's year pillar.
 *
 * Hour branch uses the same whole-hour bins as the calendar engine
 * (23:00–01:00 = 子, 01:00–03:00 = 丑, …).
 *
 * `sex` is accepted for API stability with PART 2 (大限 direction) but is
 * unused for star placement.
 */
export const ZIWEI_ENGINE_VERSION = '1.1.0'

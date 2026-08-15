/**
 * 자미두수 (Zi Wei Dou Shu). PART 1 = star placement, PART 2 = 四化 / 大限 /
 * 流年 / 廟旺. Pure functions. Lunar conversion is delegated to
 * `lib/oracle/engines/calendar`.
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
 * `sex` is used for 大限/小限 direction (PART 2) but is unused for star
 * placement.
 *
 * ════════════════════════════════════════════════════════════════════
 * PART 2 — 四化 / 大限 / 流年 / 廟旺
 * ════════════════════════════════════════════════════════════════════
 *
 * ── 生年四化 (natal Four Transformations) ─────────────────────────────
 * From the birth YEAR STEM (立春 year, via fourPillars). Table lives in
 * `tables.ts` (`MUTAGEN_BY_STEM`). It is the iztro DEFAULT table, so we
 * match iztro when verifying.
 *
 * 庚干 SCHOOL SPLIT — the single most famous divergence. All schools agree
 * 太陽化祿 + 武曲化權; they differ on 科/忌:
 *   - 全書系 / iztro default (CHOSEN):  庚 = 太陽祿 武曲權 太陰科 天同忌
 *   - 中州派:                           庚 = 太陽祿 武曲權 天府科 天同忌
 *   - iztro config-doc example:         庚 = 太陽祿 武曲權 天同科 天相忌
 * We pick the iztro default because verification is against iztro. The
 * alternatives are in `MUTAGEN_GENG_VARIANTS` for later switching.
 *
 * 流年四化 uses the SAME table keyed by the target year's stem.
 *
 * 飛星四化 (宮干四化, flying-star transformations from each palace's own
 * stem) is a SEPARATE school/feature and is intentionally NOT implemented.
 * Charts carry the `no_feixing_sihua` limitation.
 *
 * ── 大限 (decade periods) ─────────────────────────────────────────────
 *   - Start at 命宮; first 大限 begins at 虚岁 = the 五行局 number
 *     (水二局 → 2–11, 木三局 → 3–12, 金四局 → 4–13, 土五局 → 5–14,
 *      火六局 → 6–15), then +10 per palace.
 *   - Direction from the birth YEAR STEM yin/yang × sex: 陽男陰女 順行
 *     (increasing 地支), 陰男陽女 逆行. (Year stem and year branch always
 *     share parity, so iztro's branch-based test is equivalent.)
 *   - Matches current iztro (`getHoroscope`: `start = FiveElementsClass +
 *     10*i`, `FiveElementsClass.wood3rd = 3`). NOTE: iztro's *older* docs
 *     example page shows 木三局 命宮 as [4,13]; the current library uses
 *     [3,12], which is what we implement.
 *
 * ── 小限 (minor limit) ────────────────────────────────────────────────
 * Unambiguous, so implemented. 虚岁 1 sits in 辰/戌/未/丑 by birth year
 * branch group (`XIAO_XIAN_START_BY_YEAR_BRANCH`); then 男順女逆, one
 * palace per 虚岁 year. Matches iztro `getAgeIndex` + the ages loop.
 *
 * ── 廟旺利陷 (brightness) ─────────────────────────────────────────────
 * The 三合 庙旺利陷 matrix (`STAR_DEFS[*].brightness`, iztro `STARS_INFO`
 * rotated 寅→子) covers the 14 主星 plus 文昌 文曲 火星 铃星 擎羊 陀罗.
 * iztro has NO brightness for 左輔 右弼 天魁 天鉞 地空 地劫 or the 小星,
 * so those return null rather than a guess. Charts carry `brightness_gaps`.
 *
 * 虚岁 (nominal age): `atDate` lunar year − birth lunar year + 1 (natural-
 * year divide, iztro default `ageDivide: 'normal'`).
 */
export const ZIWEI_ENGINE_VERSION = '1.2.0'

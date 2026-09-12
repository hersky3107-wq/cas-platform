/**
 * Calendar-engine school choices that affect numeric output.
 * Bump CALENDAR_ENGINE_VERSION in index.ts when any of these change.
 *
 * ════════════════════════════════════════════════════════════════════
 * TWO LUNAR CALENDARS COEXIST BY DESIGN.
 *   ziwei uses the Chinese lunar date (toLunar).
 *   sukuyou uses the Japanese 旧暦 (JST new-moon civil date).
 *   They differ (e.g. 1988-03-15 = CN 1/28 vs JP 1/27). Do not unify them —
 *   doing so silently breaks sukuyou.
 * ════════════════════════════════════════════════════════════════════
 *
 * ── 숙요 27수 (sukuyou) ──────────────────────────────────────────────
 * Japanese 宿曜経 / 宿曜道: each lunar month has a fixed 朔日宿, then the
 * mansion advances one per lunar day (27-mansion cycle, 牛宿 omitted).
 * The 朔日宿 table is the 国立天文台 暦Wiki / 月宿傍通暦 table
 * (正月室 … 十二月虚). Leap months reuse the preceding month's 朔日宿.
 *
 * Japanese 旧暦 (JST new-moon civil date) is used, not the calendar
 * engine's Chinese `toLunar` day number. Those two can differ by one day
 * when the new moon falls in the CST/JST midnight gap — that is why
 * 1988-03-15 is 旧1/27 危宿 in Japanese sources and 旧1/28 in `toLunar`.
 *
 * ── 구성 일명성 (nine-star day) ─────────────────────────────────────
 * 気学 日盤, K.Oka / Calend Mate / nobml variant (not 玄空飛星):
 *   - 冬至 nearest 甲子 → 陽遁 start, star 1 (一白), count forward
 *   - 夏至 nearest 甲子 → 陰遁 start, star 9 (九紫), count backward
 *   - nearest 甲子: if the solstice's 干支 index K is 0–28, use the
 *     甲子 K days earlier; if 29–59, use the 甲子 (60−K) days later
 *   - 九星閏: when two consecutive 甲子 switches are 240 days apart,
 *     replace the later 甲子 with the 甲午 30 days before it.
 *     Winter 閏 starts 陽遁 at 7 (七赤); summer 閏 starts 陰遁 at 3 (三碧).
 *   - 120-day compression (attested only far outside 1900–2100) is not
 *     implemented; if it appears the engine throws rather than guess.
 *   - 구궁 비성: 年·月·日 LAYOUT is 陽遁 順飛 (the nine 中宮図). Verified
 *     uic.jp 1988 年盤. 日盤 陽/陰遁 is the 중궁 counting direction, not
 *     奇門 逆飛 of the palaces — some 飛星 schools reverse 陰遁 days; we
 *     do not, so a 二黒 day matches the 二黒 中宮図 (오황 북동).
 *
 * ── 사주 억부 용신 ────────────────────────────────────────────────
 * 일간 강약 = 득령(월지 본기 왕=3 / 상생=2) + 득지(지장간 통근 기둥 수)
 * + 득세(년·월·시 천간 조력 + 중복되지 않은 년·일·시 본기 조력).
 * 신약 ≤2, 중화 3–4, 신강 ≥5. 종격은 ceil(글자×5/8) 이상이고 2 이상
 * 앞설 때만 (8글자 → 5). 4/8 + 격차 2는 辰戌丑未 토를 종격으로 남발한다.
 * 조후·병약·통관은 이 패스에 없음.
 *
 *
 * Solstice calendar dates are the Asia/Tokyo civil date of the instant
 * from `solarTerms()` (Japanese 気学 practice).
 *
 * ── 子時 / day pillar ───────────────────────────────────────────────
 * fourPillars() default is `zi_start`: at 23:00–23:59 the DAY pillar
 * advances to the next civil date; hour branch is still 子, and the hour
 * stem is 五鼠遁 from the advanced day stem. `civil_midnight` keeps the
 * previous (조자시) behaviour. Year/month pillars, weekday, 구성 日盤,
 * 숙요, 절기, 대운, and 촐킨 do not read this switch.
 */
export const NINE_STAR_DAY_SCHOOL = 'kigaku-nichiban-oka' as const
export const SUKUYOU_SCHOOL = 'shukuyokyo-sakujitsu' as const
export const DEFAULT_DAY_BOUNDARY = 'zi_start' as const

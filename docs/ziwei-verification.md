# Zi Wei Dou Shu engine — PART 1 verification

Star-placement only (`lib/oracle/engines/ziwei`, `ZIWEI_ENGINE_VERSION` 1.1.0).
Lunar conversion is the calendar engine (`toLunar` + `fourPillars`). 四化 / 大限 / 流年 are not implemented.

Two public calculators, used for both charts:

1. **iztro / 紫微研习社** — published worked example at [iztro.com/quick-start](https://iztro.com/quick-start) (`astro.bySolar("2000-8-16", 2, "女")`). Same 三合安星口诀 this engine implements.
2. **星尘算命 (kvov)** — independent public 紫微排盘:
   - Chart A: <http://mfsm.kvov.com/fx/2000-08-16/mfsmm-5-2.html>
   - Chart B: <http://mfsm.kvov.com/fx/1988-03-15/mfsmm-5-1.html>

Checked on 2026-08-15. 14 主星 placement matches both references on both charts. No step diverged.

Conventions used (see `conventions.ts`): lunar month not 节气; leap month keeps the preceding month number; `dayBoundary` default `zi_start` (iztro 晚子时 rolls the Chinese lunar day used for 紫微); year stem from `fourPillars` (立春).

Charts A and B are 04:00 / 04:30 births. Re-run 2026-08-15: **identical** to the 1.0.0 placement under both `zi_start` and `civil_midnight`.

---

## Chart A — female, 木三局

| Field | Value |
| --- | --- |
| Civil | 2000-08-16 04:00 `Asia/Seoul` (寅时) |
| Sex | female |
| Lunar (calendar engine) | 2000-7-17, not leap; year 庚辰 |

| | This engine | iztro.com | 星尘算命 |
| --- | --- | --- | --- |
| 命宮 branch | 午 (壬午) | 午 | 壬午 |
| 身宮 branch | 戌 | 戌 | 戌 (官禄 / 身宫) |
| 五行局 | 木三局 | 木三局 | 木三局 |
| 紫微 position | 午 | 午 | 午 |

14 主星 (branch → stars):

| Branch | Palace | Engine | iztro | 星尘 |
| --- | --- | --- | --- | --- |
| 子 | 遷移 | 贪狼 | 贪狼 | 贪狼 |
| 丑 | 疾厄 | 天同 巨门 | 天同 巨门 | 天同 巨门 |
| 寅 | 財帛 | 武曲 天相 | 武曲 天相 | 武曲 天相 |
| 卯 | 子女 | 太阳 天梁 | 太阳 天梁 | 太阳 天梁 |
| 辰 | 夫妻 | 七杀 | 七杀 | 七杀 |
| 巳 | 兄弟 | 天机 | 天机 | 天机 |
| 午 | 命 | 紫微 | 紫微 | 紫微 |
| 未 | 父母 | — | — | — |
| 申 | 福德 | 破军 | 破军 | 破军 |
| 酉 | 田宅 | — | — | — |
| 戌 | 官祿 | 廉贞 天府 | 廉贞 天府 | 廉贞 天府 |
| 亥 | 交友 | 太阴 | 太阴 | 太阴 |

命宮 壬午 纳音 杨柳木 → 木三局. 农历十七 / 木三局: 18÷3=6, offset 1 (odd) → from 寅 进 6 逆 1 → 午.

---

## Chart B — male, 金四局

| Field | Value |
| --- | --- |
| Civil | 1988-03-15 04:30 `Asia/Seoul` (寅时) |
| Sex | male |
| Lunar (calendar engine) | 1988-1-28, not leap; year 戊辰 |

iztro.com does not publish this date. Cross-check: same 口诀 as Chart A (already matching iztro) plus 星尘算命.

| | This engine | 星尘算命 | iztro 口诀 (recomputed) |
| --- | --- | --- | --- |
| 命宮 branch | 子 (甲子) | 甲子 | 子 |
| 身宮 branch | 辰 | 辰 (官禄 / 身宫) | 辰 |
| 五行局 | 金四局 | 金四局 | 金四局 |
| 紫微 position | 申 | 申 (财帛 紫微+天府) | 申 |

14 主星:

| Branch | Palace | Engine | 星尘 | 口诀 |
| --- | --- | --- | --- | --- |
| 子 | 命 | 廉贞 天相 | 廉贞 天相 | same |
| 丑 | 父母 | 天梁 | 天梁 | same |
| 寅 | 福德 | 七杀 | 七杀 | same |
| 卯 | 田宅 | 天同 | 天同 | same |
| 辰 | 官祿 | 武曲 | 武曲 | same |
| 巳 | 交友 | 太阳 | 太阳 | same |
| 午 | 遷移 | 破军 | 破军 | same |
| 未 | 疾厄 | 天机 | 天机 | same |
| 申 | 財帛 | 紫微 天府 | 紫微 天府 | same |
| 酉 | 子女 | 太阴 | 太阴 | same |
| 戌 | 夫妻 | 贪狼 | 贪狼 | same |
| 亥 | 兄弟 | 巨门 | 巨门 | same |

命宮 甲子 纳音 海中金 → 金四局. 农历廿八 / 金四局: 28÷4=7, offset 0 → from 寅 进 7 → 申. 天府 mirrors 紫微 across 寅–申, so 天府 also 申.

星尘 命主 is 贪狼 because 命宮地支 子 (命主表), not because 贪狼 sits in 命宮.

---

## Notes

- Minor stars included (tables are unambiguous): 禄存 天马 红鸾 天喜, plus 六吉 / 六煞.
- Brightness is the common 三合 庙旺利陷 table (iztro `STARS_INFO`, 寅-first rotated to 子-first). 星尘 uses 地 for what we label 得; labels differ, positions do not.
- 交友 is the palace 星尘/iztro call 仆役.
- Leap-month behaviour is covered by unit tests.

---

## Chart C — female, 水二局, 23:30 (both conventions)

Civil: 2000-08-16 23:30 `Asia/Seoul` (晚子時), female.

Chinese lunar of the civil date is still 2000-7-17. Under `zi_start` the engine uses the next civil date’s `toLunar` → 2000-7-18 (iztro 晚子时). Under `civil_midnight` it keeps 7/17.

Hour is 子 either way, so 命宮/身宮 stay 申. 紫微 moves because the lunar day used for placement changes.

| | Engine `zi_start` | iztro `bySolar("2000-8-16", 12, "女")` | 星尘 2000-08-17 0–1 女 |
| --- | --- | --- | --- |
| Lunar day used | 7/18 | next-day 农历 (晚子归入翌日) | 2000年7月18日 |
| 命宮 | 甲申 | 申 (same 口诀) | 甲申 命+身 |
| 身宮 | 申 | 申 | 申 |
| 五行局 | 水二局 | 水二局 | 水二局 |
| 紫微 | 戌 (with 天相) | 戌 (口诀: 18 / 水二) | 戌 紫微+天相 (福德) |

iztro issue [#187](https://github.com/SylarLong/iztro/issues/187): 当日晚子时 and 翌日早子时 share the same 天盘. 星尘’s [08-17 0–1 女](http://mfsm.kvov.com/fx/2000-08-17/mfsmm-1-2.html) is that next-day 早子 chart (水二局, 农历七月十八, 命宮 甲申 贪狼, 紫微+天相 in 戌). 14 主星 match this engine’s `zi_start` map.

| Branch | Palace (from 申命) | Engine `zi_start` | 星尘 08-17 0–1 |
| --- | --- | --- | --- |
| 子 | 官祿 | 七杀 | 七杀 |
| 丑 | 交友 | — | — |
| 寅 | 遷移 | 廉贞 | 廉贞 |
| 卯 | 疾厄 | — | — |
| 辰 | 財帛 | 破军 | 破军 |
| 巳 | 子女 | 天同 | 天同 |
| 午 | 夫妻 | 武曲 天府 | 武曲 天府 |
| 未 | 兄弟 | 太阳 太阴 | 太阳 太阴 |
| 申 | 命 / 身 | 贪狼 | 贪狼 |
| 酉 | 父母 | 天机 巨门 | 天机 巨门 |
| 戌 | 福德 | 紫微 天相 | 紫微 天相 |
| 亥 | 田宅 | 天梁 | 天梁 |

`civil_midnight` on the same 23:30 birth keeps lunar day 17, 紫微 at 酉 (with 贪狼). 星尘 documents that 子时 schools split and tells the user to open the previous day’s 23–24 page for the other convention. That map is recorded in `ziwei.test.ts`; it is **not** iztro’s default.

Flags at 23:30: `lateZiHour = true` under both conventions; `lunarDayRolled = true` only for `zi_start`.

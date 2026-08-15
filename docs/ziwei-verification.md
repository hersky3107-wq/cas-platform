# Zi Wei Dou Shu engine — verification

`lib/oracle/engines/ziwei`, `ZIWEI_ENGINE_VERSION` **1.2.0**.
Lunar conversion is the calendar engine (`toLunar` + `fourPillars`).

- **PART 1** (below): star placement.
- **PART 2** (bottom of file): 生年四化 / 大限 / 流年 (+小限) / 廟旺利陷.

飛星四化 (宮干四化) is intentionally not implemented (`no_feixing_sihua`).

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

---

# PART 2 — 四化 / 大限 / 流年 / 廟旺 (v1.2.0)

Same charts as PART 1. Star placement is **unchanged** — the 04:00 / 04:30 charts A and B are byte-for-byte identical to v1.1.0 (asserted by `ziwei.test.ts › 04:00 / 04:30 charts must not move`).

References:

1. **iztro** — primary. Verified against the current library source (`SylarLong/iztro`, checked 2026-08-15): 四化 table (`data/heavenlyStems.ts`), decadal (`getHoroscope` → `start = FiveElementsClass + 10·i`), 小限 (`getAgeIndex` + ages loop), brightness (`data/stars.ts` `STARS_INFO`).
2. **星尘算命 (kvov)** — independent 紫微排盘 (same charts as PART 1). Publishes the same 通行 三合 廟旺 table and the standard 十天干四化.

Chart identifiers: A = 2000-08-16 04:00 女 (庚辰, 木三局, 命宮 午). B = 1988-03-15 04:30 男 (戊辰, 金四局, 命宮 子). C = 2000-08-16 23:30 女 `zi_start` (庚辰, 水二局, 命宮 申, lunar 7/18).

## 1. 生年四化

Table (`MUTAGEN_BY_STEM`) is the **iztro default**, so it matches iztro by construction. Cross-checked against the 星尘/通行 十天干四化 table — identical for all ten stems.

| 天干 | 化祿 | 化權 | 化科 | 化忌 |
| --- | --- | --- | --- | --- |
| 甲 | 廉貞 | 破軍 | 武曲 | 太陽 |
| 乙 | 天機 | 天梁 | 紫微 | 太陰 |
| 丙 | 天同 | 天機 | 文昌 | 廉貞 |
| 丁 | 太陰 | 天同 | 天機 | 巨門 |
| 戊 | 貪狼 | 太陰 | 右弼 | 天機 |
| 己 | 武曲 | 貪狼 | 天梁 | 文曲 |
| **庚** | 太陽 | 武曲 | **太陰** | 天同 |
| 辛 | 巨門 | 太陽 | 文曲 | 文昌 |
| 壬 | 天梁 | 紫微 | 左輔 | 武曲 |
| 癸 | 破軍 | 巨門 | 太陰 | 貪狼 |

### 庚干 school split (reported, not silently picked)

All schools agree 太陽化祿 + 武曲化權; they differ on 科/忌:

| School | 化科 | 化忌 | Chosen? |
| --- | --- | --- | --- |
| 全書系 / **iztro default** | **太陰** | 天同 | ✅ (we match iztro) |
| 中州派 (task-cited) | 天府 | 天同 | exposed as `MUTAGEN_GENG_VARIANTS.zhongzhou` |
| iztro config-doc example | 天同 | 天相 | exposed as `MUTAGEN_GENG_VARIANTS.iztroDoc` |

We use 太陰化科 (全書系) because verification is against iztro's default. The alternatives live in `MUTAGEN_GENG_VARIANTS` and can be swapped into `MUTAGEN_BY_STEM[6]` later without touching logic.

### Per-chart 生年四化

| Chart | 年干 | 化祿 | 化權 | 化科 | 化忌 | iztro | 星尘 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A | 庚 | 太陽 | 武曲 | 太陰 | 天同 | ✅ | ✅ |
| B | 戊 | 貪狼 | 太陰 | 右弼 | 天機 | ✅ | ✅ |
| C | 庚 | 太陽 | 武曲 | 太陰 | 天同 | ✅ | ✅ |

## 2. 大限

Rule: start at 命宮 at 虚岁 = 五行局 number, +10 per palace; 陽男陰女 順行 (increasing 地支), 陰男陽女 逆行.

**Discrepancy reported (not silently matched):** iztro's *old docs example* page (`iztro.com/quick-start`, cached in agent-tools) shows Chart A's 命宮 大限 as **[4,13]**. The *current* iztro library uses `FiveElementsClass.wood3rd = 3` with `start = FiveElementsClass + 10·i` → **[3,12]**, and its source comment says "木三局 就从3岁开始起运". We implement [3,12], which matches current iztro and the classic 起運 rule. Every subsequent period is likewise shifted −1 vs the stale doc page but lands on the **same palace**.

| Chart | 局 | dir | 大限 #1 | #2 | #3 | current (2026, 虚岁) |
| --- | --- | --- | --- | --- | --- | --- |
| A | 木三局 | 逆 (庚陽·女) | 午 命 3–12 | 巳 兄弟 13–22 | 辰 夫妻 23–32 | 辰 夫妻 23–32 (虚岁 27) |
| B | 金四局 | 順 (戊陽·男) | 子 命 4–13 | 丑 父母 14–23 | 寅 福德 24–33 | 卯 田宅 34–43 (虚岁 39) |
| C | 水二局 | 逆 (庚陽·女) | 申 命 2–11 | 未 兄弟 12–21 | 午 夫妻 22–31 | 午 夫妻 22–31 (虚岁 27) |

Direction & palace order match iztro for all three (A/C 逆行 down 午→巳→辰 and 申→未→午; B 順行 up 子→丑→寅). 虚岁 = target lunar year − birth lunar year + 1 (iztro `ageDivide: 'normal'`).

## 3. 流年 (2026 = 丙午)

流年宮 = palace whose branch matches the year branch (午). 流年四化 from the year stem (丙) using the same table. 小限 = 起宮 by birth-year branch group then 男順女逆.

| Chart | 流年宮 (午) | 流年四化 (丙: 祿/權/科/忌) | 小限 (虚岁) |
| --- | --- | --- | --- |
| A | 午 = 命 | 天同 / 天機 / 文昌 / 廉貞 | 申 福德 (27) |
| B | 午 = 遷移 | 天同 / 天機 / 文昌 / 廉貞 | 子 命 (39) |
| C | 午 = 夫妻 | 天同 / 天機 / 文昌 / 廉貞 | 申 命 (27) |

Cross-check with iztro's example chart (2000-08-16 女, `astro.horoscope`): 小限 age-27 palace is 福德 (申), matching the published `ages` array (福德 holds `[3,15,27,…]`). Chart B 小限 虚岁 39 → 子 命, per the 申子辰→戌 起宮 with 男順行. All consistent.

小限 is implemented (rule unambiguous). Its own 四化 (from the 小限 palace 宮干) is **not** produced — that is 宮干四化 / 飛星四化, deliberately omitted (see `no_feixing_sihua`).

## 4. 廟旺利陷 (14 主星)

Matrix (`STAR_DEFS[*].brightness`) is iztro `STARS_INFO` rotated 寅→子. Verified **element-by-element against the current iztro `data/stars.ts`** (2026-08-15): all 14 主星 arrays are identical, as are 文昌/文曲/火星/鈴星/擎羊/陀羅. 星尘 publishes the same 三合 table (it labels 得 as 地; positions are identical).

Brightness of the 14 主星 per chart (from the engine):

| Chart | 主星 : 亮度 |
| --- | --- |
| A | 子 貪狼 旺 / 丑 天同 不 / 丑 巨門 不 / 寅 武曲 得 / 寅 天相 廟 / 卯 太陽 廟 / 卯 天梁 廟 / 辰 七殺 廟 / 巳 天機 平 / 午 紫微 廟 / 申 破軍 得 / 戌 廉貞 利 / 戌 天府 廟 / 亥 太陰 廟 |
| B | 子 廉貞 平 / 子 天相 廟 / 丑 天梁 旺 / 寅 七殺 廟 / 卯 天同 平 / 辰 武曲 廟 / 巳 太陽 旺 / 午 破軍 廟 / 未 天機 陷 / 申 紫微 旺 / 申 天府 得 / 酉 太陰 不 / 戌 貪狼 廟 / 亥 巨門 旺 |
| C | 子 七殺 旺 / 寅 廉貞 廟 / 辰 破軍 旺 / 巳 天同 廟 / 午 武曲 旺 / 午 天府 旺 / 未 太陽 得 / 未 太陰 不 / 申 貪狼 平 / 酉 天機 旺 / 酉 巨門 廟 / 戌 紫微 得 / 戌 天相 得 / 亥 天梁 陷 |

Spot-checked against iztro's published Chart A palaces (agent-tools quick-start dump): 命宮 紫微 廟, 財帛 武曲 得 / 天相 廟, 子女 太陽 廟 / 天梁 廟, 夫妻 七殺 廟, 官祿 廉貞 利 / 天府 廟, 交友 太陰 廟 — all match. A known **廟** (Chart A 紫微 午) and a known **陷** (Chart B 天機 未) are asserted as tests.

### Brightness gaps (returned as null, `brightness_gaps` limitation)

iztro's `STARS_INFO` has **no** brightness for these, so this engine returns no `brightness` key rather than guessing:

- 六吉 without a table: **左輔, 右弼, 天魁, 天鉞** (only 文昌/文曲 have brightness).
- 六煞 without a table: **地空, 地劫** (擎羊/陀羅/火星/鈴星 have brightness).
- 小星: 祿存, 天馬, 紅鸞, 天喜.

## 5. Output & limitations

The chart return object is **extended, not restructured**: added `sex`, `siHua`, `daXian`, `liuNian`. New standalone exports: `ziweiLiuNian`, `siHuaForStem`, `daXianForward`, `buildDaXianPeriods`, `xiaoXianFor`, `yearStemBranch`.

`limitations` entries now emitted:

- `no_feixing_sihua` — 飛星四化 (宮干四化) not implemented (always).
- `brightness_gaps` — the stars listed above have null brightness (always).
- `no_birth_time` — when 出生時 unknown (then 大限/流年 are null, but 生年四化 is still computed from the year stem).

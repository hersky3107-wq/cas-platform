# Nine-star day (일명성 / 日家九星) verification

`CALENDAR_ENGINE_VERSION` 1.1.0. Day star is 気学 **日盤**, not `lunar-javascript` `getDayNineStar()` (玄空飛星).

Year and month stars are unchanged (digit-reduction + 입춘 / 절).

School notes are in `lib/oracle/engines/calendar/conventions.ts`.

## Rule chosen

K.Oka / Calend Mate / [nobml 改訂版](https://nobml.hatenablog.jp/entry/20180113/1515770790):

1. Tokyo civil date of 冬至 / 夏至 from `solarTerms()`.
2. Nearest 甲子: solstice 干支 `K = (MJD + 50) mod 60`. If `K ≤ 28` go back `K` days; if `K ≥ 29` go forward `60 − K`.
3. 冬至 甲子 → 陽遁 start **1**; 夏至 甲子 → 陰遁 start **9**.
4. **九星閏 (240-day variant):** if two consecutive raw 甲子 switches are 240 days apart, replace the later 甲子 with the 甲午 30 days earlier. Winter 閏 starts 陽遁 at **7**; summer 閏 starts 陰遁 at **3**.
5. 120-day compression is **not** implemented (nobml: 40c–85c only). The engine throws rather than guess.

Other schools (e.g. [koyomi8](https://koyomi8.com/doc/mlwa/201912170.html)) treat `K = 29` (癸巳) as “go back” rather than “go forward”. [kyusei.co3.jp](http://www.kyusei.co3.jp/nichiban.html) also notes extra 2019 / 2031 patches on top of the nobml story. Those variants are **not** used here.

## Dates

Checked 2026-08-15.

| Civil date | Engine | 9rando.info | Second source | Notes |
| --- | --- | --- | --- | --- |
| 1988-03-15 | **3** | [三碧](https://9rando.info/k9/1988/) | [watashino 三碧](https://watashino.net/y1988m3d15/) | Acceptance |
| 1987-12-22 | **1** | [一白](https://9rando.info/k9/1987/) | [watashino 一白](https://watashino.net/y1987m12d22/) | 冬至 |
| 1988-06-21 | **2** | [二黒](https://9rando.info/k9/1988/) | [watashino 二黒](https://watashino.net/y1988m6d21/) | 夏至 |
| 1988-06-22 | **3** | [三碧](https://9rando.info/k9/1988/) | (day after 夏至; follows 9rando) | Switching neighbourhood |
| 1988-12-21 | **5** | [五黄](https://9rando.info/k9/1988/) | (冬至; follows 9rando) | Switching neighbourhood |
| 2008-12-20 | **7** | [七赤](https://9rando.info/k9/2008/) | [nobml 甲午 七赤](https://nobml.hatenablog.jp/entry/20180113/1515770790) | Winter 閏 start |
| 2008-12-31 | **9** | [九紫](https://9rando.info/k9/2008/) | [nobml 九紫](https://nobml.hatenablog.jp/entry/20180113/1515770790) | 11 days into that 閏 陽遁 |
| 1997-06-21 | **3** | [三碧](https://9rando.info/k9/1997/) | nobml lists 1997 as a summer 閏 year; 9rando shows 甲午 三碧 | Summer 閏 / 夏至 |
| 2000-01-01 | **6** | (not re-fetched) | [watashino 六白](https://watashino.net/y2000m1d1/) | Mid-range |
| 1986-10-19 | **7** | (not re-fetched) | [watashino 七赤](https://watashino.net/y1986m10d19/) | Mid-range |

No date in this set disagrees with the cited Japanese 気学 tools.

## 120-day 閏 compression (not implemented)

Scan of `nineStar` for one mid-year date in each year 1900–2100 (the day-star switch table is per-year; a 120-day gap would throw for every civil date in that year). Years 1900 and 2100 can throw `CalendarRangeError` from `solarTerms(y±1)` — that is a range-edge issue, not a 120-day hit, and was not counted.

| | Result |
| --- | --- |
| Dates that hit the 120-day throw | **0** |
| First few dates | none |

This matches nobml: the 120-day case is attested only in the 40th–85th centuries. Compression is still not implemented; the engine continues to throw if it ever appears.

Dates where other schools are expected to diverge (not silent-matched, not treated as bugs):

- Any solstice whose `K` is **29** (癸巳), vs koyomi8’s “前半 includes 癸巳” rule.
- **2019 winter / 2031 winter** 閏, where kyusei.co3.jp applies extra patches on top of nobml. This engine follows nobml as written.

# Sukuyou (27수) verification

`CALENDAR_ENGINE_VERSION` 1.1.0. Method: Japanese 宿曜経 **朔日宿**, not tropical lunar longitude.

School notes are in `lib/oracle/engines/calendar/conventions.ts`.

## Method

1. Convert the civil `YYYY-MM-DD` to **Japanese 旧暦** (JST civil date of the true new moon). This is not `toLunar()`, which is Chinese (CST). The two day numbers differ by one when the new moon falls in the CST/JST midnight gap.
2. Look up that month's 朔日宿 (leap months reuse the same-number month).
3. Advance one mansion per lunar day on the 27-mansion cycle (牛宿 omitted, 昴 first).

朔日宿 table, checked against [国立天文台 暦Wiki「二十八宿」](http://eco.mtk.nao.ac.jp/koyomi/wiki/C6F3BDBDC8ACBDC9.html) and [senjutsu.jp](https://www.senjutsu.jp/labo/shukuyo-calc):

| 月 | 正 | 二 | 三 | 四 | 五 | 六 | 七 | 八 | 九 | 十 | 十一 | 十二 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 朔日宿 | 室 | 奎 | 胃 | 畢 | 参 | 鬼 | 張 | 角 | 氐 | 心 | 斗 | 虚 |

Formula: `(sakujitsuIndex + lunarDay − 1) mod 27`.

## Dates

Checked 2026-08-15.

| Civil date | JP 旧暦 | Engine | watashino.net | Second source | Notes |
| --- | --- | --- | --- | --- | --- |
| 1988-03-15 | 1988/1/27 | **危宿** | [危宿](https://watashino.net/y1988m3d15/) | [9rando 旧1/27](https://9rando.info/calendar/koyomi/1012/5/1988/); NAO table → 室+26 = 危 | Acceptance. Chinese `toLunar` is 1/28; using that day would give 室宿. |
| 1986-10-19 | 1986/9/16 | **畢宿** | [畢宿](https://watashino.net/y1986m10d19/) | [senjutsu.jp worked example](https://www.senjutsu.jp/labo/shukuyo-calc) (氐+15 → 畢) | CN and JP 旧暦 agree here. |
| 2000-01-01 | 1999/11/25 | **心宿** | [心宿](https://watashino.net/y2000m1d1/) | NAO table: 十一月斗 + 24 = 心 | |
| 1990-08-16 | 1990/6/26 | **參宿** | [参宿](https://watashino.net/y1990m8d16/) | NAO table: 六月鬼 + 25 = 参 | |
| 1987-12-22 | 1987/11/2 | **女宿** | [女宿](https://watashino.net/y1987m12d22/) | NAO table: 十一月斗 + 1 = 女 | |
| 1988-06-21 | 1988/5/8 | **軫宿** | [軫宿](https://watashino.net/y1988m6d21/) | NAO table: 五月参 + 7 = 軫 | |
| 1988-08-25 | 1988/7/14 | **危宿** | [危宿](https://watashino.net/y1988m8d25/) | NAO table: 七月張 + 13 = 危 | Extra |
| 1988-04-01 | 1988/2/15 | **角宿** | [角宿](https://watashino.net/y1988m4d1/) | NAO table: 二月奎 + 14 = 角 | Extra |

No date in this set disagrees with both Japanese references.

## 三九の秘法

Implemented: the 11 named relations from 命, advancing in 昴-order (逆時計 = +index), matching [senjutsu.jp](https://www.senjutsu.jp/labo/shukuyo-calc) (`業 = +9`, `胎 = +18`) and the 6-pair grouping 命 / 業胎 / 栄親 / 友衰 / 安壊 / 危成.

Helper: `sukuyouRelation(fromIndex, toIndex)` with public 1–27 indices.

**Not implemented** (schools disagree or the mapping is not a single table):

- 近 / 中 / 遠 distance bands
- 凌犯
- 六害宿

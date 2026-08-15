# Day-boundary (`zi_start` / `civil_midnight`) verification

`CALENDAR_ENGINE_VERSION` 1.2.0. The switch applies **only** to the 干支 day pillar and what is derived from that stem (hour stem via 五鼠遁, 십신, 오행 counts of the pillars).

## Scope (what must not move)

Checked in code and tests. None of these read `fourPillars().day`:

| System | Keys off | 23:30 vs noon same civil date |
| --- | --- | --- |
| `weekday` | civil instant in the given TZ | same weekday (1988-03-15 23:30 is still Tuesday) |
| `nineStar` day | civil Y-M-D 気学 日盤 | same 3 |
| `sukuyou` | Japanese 旧暦 of the civil date | same 危宿 |
| year / month pillars | birth instant + 节气 | unchanged by `dayBoundary` |
| `greatLuck` | library `EightChar.getYun()` + 节 distance | **not wired** to `dayBoundary` (see below) |
| `tzolkin` | civil JDN | civil date only |
| `seasonElement` | birth instant + 四立 | unchanged |

`greatLuck` still goes through lunar-javascript’s eight-character path. That library has its own 晚子时 hour-stem behaviour. We did **not** propagate `dayBoundary` into 대운, because 대운수 is a solar-term distance, not a day-pillar date. If a future check shows the library shifting 대운수 at 23:xx, treat that as a library quirk — do not “fix” it by rolling the civil date into `greatLuck`.

## Pair used

- **A:** 1988-03-15 23:30 `Asia/Seoul` (晚子時)
- **B:** 1988-03-16 00:30 `Asia/Seoul` (早子時 the next civil day)

1988-03-15 noon is the existing triple-checked chart **戊辰 乙卯 己巳 丙寅**. That chart is unchanged under both conventions (asserted).

| Input | `zi_start` (default) | `civil_midnight` |
| --- | --- | --- |
| 1988-03-15 23:30 | 戊辰 乙卯 **庚午 丙子** | 戊辰 乙卯 **己巳 甲子** |
| 1988-03-16 00:30 | 戊辰 乙卯 庚午 丙子 | 戊辰 乙卯 庚午 丙子 |

Hour branch is 子 in every 23:30 / 00:30 row. Only the day stem (and therefore the 五鼠遁 hour stem) differs at 23:30.

`alternate` is filled only for 23:00–23:59 and is the other convention’s pillar set.

## Which public tools use which convention

Checked 2026-08-15.

| Tool | Market | Default at 23:00–23:59 | Notes |
| --- | --- | --- | --- |
| [四柱推命ネクスト](https://fourpillars.app/post/yakodoki) | JP | **civil_midnight** (0:00) | Form offers “日柱切り替え時刻”; they say 0:00 is more common in JP 四柱 |
| [参天 AI](https://www.cantian.ai/wiki/ja/other_words_explanations/zaowanzishi/) | JP / CN | **zi_start** (子初) | Optional 子正 = civil_midnight. Year/month stay on 节气 |
| [iztro](https://github.com/SylarLong/iztro/issues/187) | CN (used in JP/KR too) | **zi_start** | 晚子时 is folded into the next civil day; same 天盘 as next-day 早子时 |
| Typical KR 조자시 / “야자시 적용” 만세력 | KR | **civil_midnight** | Keep the civil day’s 일주; 시지 is still 子 |

No tool in this set disagreed with the 8-character pairs above once its stated convention was applied. Tools that do not expose the switch were classified from their docs, not by silently picking a match.

## Cascade inside the calendar engine

At 1988-03-15 23:30:

- `zi_start` day stem 庚 → hour 丙子; `tenGods(p.day.stem, p)` uses 庚 as 일간
- `civil_midnight` day stem 己 → hour 甲子; 십신 uses 己

`fiveElementBalance` follows the pillars it is given (day + hour stems change). That is the intended cascade, not a leak into weekday / 구성 / 숙요.

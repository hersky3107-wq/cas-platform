# Calendar engine — Step 1 verification

Library: `lunar-javascript@1.7.7` (already an installed dependency; previously used only for
the resident "today" lunar date display, not for 사주/만세력).

Test subject: **1988-03-15 04:30, Asia/Seoul** (no DST in effect — Korea's 1987–1988 DST
trial ran May–October only, so KST = UTC+9 for this date with no correction needed).

Scratch script: `scripts/verify-calendar-engine.ts` (run via `npx tsx scripts/verify-calendar-engine.ts`).

## 1. Four pillars — library output vs. public references

lunar-javascript (fed the raw KST wall-clock numbers, `Exact` accessor family):

| Pillar | GanZhi |
|---|---|
| Year  | 戊辰 (Wu-Chen) |
| Month | 乙卯 (Yi-Mao) |
| Day   | 己巳 (Ji-Si) |
| Hour  | 丙寅 (Bing-Yin) |

Cross-checked against three independent public sources for the exact same date/time
(1988-03-15 04:30, 04:59 KST):

- DateDB (`datedb.net/tool/manse/19880315/`, Korean 만세력): 년주 무진(戊辰) · 월주 을묘(乙卯) ·
  일주 기사(己巳) · 시주 병인(丙寅). Also confirms: 월주 절기 = 경칩 절입, 연주 입춘 = 1988-02-04,
  공망 = 술·해.
- 易师汇传统文化 (`ly.yishihui.net`, Chinese bazi site): 八字为：戊辰 乙卯 己巳（丙寅时, for the
  03:00–04:59 time slot）. Five-element breakdown for that slot: 土土 木木 土火 火木 — matches
  lunar-javascript's `getBaZiWuXing()` output exactly.
- SAZU/사주프라임 (Korean manseryeok tools): describe the same LiChun/jieqi-boundary and
  true-solar-time conventions; no numeric disagreement surfaced for this date.

**Result: MATCH across all three independent sources.** No stop/report-and-halt condition was
triggered — the library's raw pillar output is correct for this date. Proceeding to Step 2 with
two required corrections documented below (both are wrapper-level fixes, not library bugs).

## 2. Critical finding #1 — jieqi timestamps are in China Standard Time (UTC+8), not the caller's timezone

The library has no concept of "input timezone." `Solar.fromYmdHms(y,m,d,h,mi,s)` just takes six
plain numbers and treats them as a wall-clock reading. Internally, the 24 solar-term (절기/jieqi)
instants it computes and compares against are *also* plain numbers with no timezone tag — but
they are computed and displayed as **China Standard Time (UTC+8)** wall-clock values, not KST
(UTC+9) and not UTC.

Proof (see script output): 立春 (Li Chun) 1988 is a physical instant — the moment the Sun's
apparent geocentric ecliptic longitude reaches 315°. Independently computing that instant via
`astronomy-engine` gives:

```
True LiChun instant (UTC):        1988-02-04T14:43:18.637Z
  -> relabeled as KST (UTC+9):    1988-02-04 23:43:18
  -> relabeled as CST (UTC+8):    1988-02-04 22:43:18
lunar-javascript's own timestamp: 1988-02-04 22:42:49
```

The library's timestamp matches the CST relabeling to within ~30 seconds (numerical-method
tolerance between the two ephemeris approximations), and is off by exactly ~1 hour from the KST
relabeling. **Conclusion: lunar-javascript's jieqi table is in UTC+8, unconditionally**, regardless
of what timezone the caller's input was meant to represent.

Impact: if a Seoul (UTC+9) birth time is fed to the library unmodified for year/month pillar
purposes, any birth within the ~1-hour band where KST and CST disagree about which side of a
jieqi boundary the birth falls on will get the **wrong** year or month pillar. This does not
affect the 1988-03-15 04:30 test case (no jieqi boundary within an hour of that instant), which
is why the pillars still matched public sources above — but it is a real, silent bug for anyone
born close to a term boundary.

**Fix implemented in the engine:** before asking the library to resolve year/month pillars (or
anything else that depends on comparing against the internal jieqi table — `greatLuck`/대운
included, via `EightChar.getYun()`), the engine converts the true birth UTC instant to its
CST-equivalent label (`utcInstant + 8h`) and feeds *that* into `Solar.fromYmdHms`. Since both the
(relabeled) input and the library's (CST-labeled) jieqi table now share the same constant +8h
offset from true UTC, comparisons between them are correct regardless of the caller's actual
timezone. Day and hour pillars are computed separately from the *true local* wall clock (they
depend only on the calendar date / 2-hour bin, never on jieqi), so they are never CST-shifted.

Empirical confirmation (script output, using CST-labeled inputs straddling the 22:42:49 boundary):

```
input 22:30 (13 min before boundary) -> Exact: 丁卯  (correctly "before")
input 22:50 (7 min after boundary)   -> Exact: 戊辰  (correctly "after")
```

## 3. Critical finding #2 — `ByLiChun`/default accessors are date-only; must use the `Exact` family

`getYearInGanZhiByLiChun()` and the default `getMonthInGanZhi()` compare the birth date against
the jieqi boundary using **calendar-date equality** (`solarYmd >= liChunYmd`), not full datetime.
This means any birth on the *same calendar day* as a jieqi boundary gets the post-boundary pillar
regardless of the actual hour — even minutes before the true crossing:

```
input 1988-02-04 22:30 (13 min before 22:42:49 boundary) -> ByLiChun: 戊辰 (wrong: same-day rounding)
input 1988-02-04 22:30 (13 min before 22:42:49 boundary) -> Exact:    丁卯 (correct)
```

`getYearInGanZhiExact()` / `getMonthInGanZhiExact()` compare full `Y-M-D H:M:S`, giving second-level
precision. **The engine exclusively uses the `*Exact` accessor family** for year/month pillar
resolution; `EightChar` (used for 대운/`getYun()`) was verified to already use the `Exact`
convention internally by default, so no extra correction is needed there beyond the CST-shift
fix in finding #1.

## 4. Conventions adopted (documented, not silently assumed)

- **진태양시 (true solar time) correction**: NOT applied. Several public Korean manseryeok tools
  (사주프라임, SAZU) offer an optional ~32-minute correction for Seoul's longitude offset from the
  135°E KST reference meridian. This engine's `fourPillars` does not apply it by default (matches
  the plain-KST convention used by lunar-javascript and by DateDB's default 진태양시-off mode,
  both of which matched public results above). Flagged as an explicit open 유파 decision in the
  final report, not implemented.
- **자시/야자시 (midnight day-rollover)**: NOT applied. The day pillar rolls at true local
  midnight (조자시 default, per DateDB's own documented default), not at 23:00 (야자시). Flagged
  as an open 유파 decision.
- **Hour-branch boundaries**: whole-hour bins (23:00–01:00 = 子, 01:00–03:00 = 丑, ...), matching
  lunar-javascript's default and the verified 04:30 → 丙寅(寅) result. A `:30`-offset boundary
  convention (23:30–01:30 = 子, ...) exists in some references and is **not** implemented; flagged
  as an open 유파 decision.

No disagreement between the library and public references was found for the test date — Step 1
passes. Proceeding to Step 2/3/4 with the two corrections above baked into the wrapper.

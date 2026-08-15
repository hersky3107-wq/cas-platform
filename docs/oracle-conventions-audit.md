# Oracle engine conventions audit (유파)

Audit date: 2026-08-15. **No code was changed** — this document reports current behaviour,
public-calculator cross-checks (where requested), and recommendations.

Primary market: **Japan**. Korean sources are included for items 2–4 as requested.

---

## Summary table

| # | Topic | Current school | Deliberate? | Public-tool majority (JP weighted) | Recommendation |
|---|--------|----------------|-------------|-----------------------------------|----------------|
| 1 | 십신 (branch) | 地支本气 only | **Yes** — documented open choice | Mixed; many Chinese/Korean tables use 지장간 dominant stem | **Keep as-is** (or add optional mode later) |
| 2 | 子時 day roll | 子正 / 조자시 — midnight | **Yes** — documented in calendar-verification | **23:00 (子初)** default on most JP/KR online 四柱 tools | **Switch** (or add configurable `dayBoundary`) |
| 3 | 27수 (sukuyou) | Tropical moon λ, 昴@0°, 27 equal arcs | **Implemented choice** — flagged unverified | **Japanese 宿曜経**: lunar 朔日宿 + day count | **Switch** |
| 4 | 일명성 (day nine-star) | lunar-javascript `getDayNineStar()` (玄空飛星) | **Known gap** — year/month are 구성기학, day is not | **구성기학 / 九星気学 日盤**: 冬至/夏至 nearest 甲子 + 陽遁/陰遁 + 閏 | **Switch** (implement explicit 日盤) |
| 5 | Ziwei 子時 + flag | Matches calendar 조자시; flag name misleading | Partially deliberate; flag semantics wrong | JP 紫微 (iztro): **晚子时 rolls lunar day** for stars | **Rename flag now**; **roll lunar day with item 2** if switching |

---

## 1. 십신 (ten gods) — branch stem source

### What the code does today

`tenGods()` labels each **branch** pillar by looking up the branch’s **single nominal
element + yin/yang** from `BRANCHES` (地支本气 table), then applying the ten-god matrix
relative to the day stem. It does **not** decompose 지장간 or weight hidden stems.

| Location | Behaviour |
|----------|-----------|
| `lib/oracle/engines/calendar/ten-gods.ts` L4–8 | Explicit comment: 지장간-weighted approach **not** implemented |
| `lib/oracle/engines/calendar/ten-gods.ts` L13–20 | `tenGodFor(dayStem, target)` uses `target.element` / `target.yinYang` directly |
| `lib/oracle/engines/calendar/ten-gods.ts` L25–29 | Branch labels: `tenGodFor(dayStem, pillars.*.branch)` |
| `lib/oracle/engines/calendar/tables.ts` L52–66 | `BRANCH_SEEDS`: each branch has one `element` + `yinYang` (e.g. 巳 → fire, **yin**) |

### Deliberate or library default?

**Deliberate.** Implemented from scratch; not taken from lunar-javascript’s
`getBaZiShiShenZhi()`. The divergence is documented in `docs/calendar-engine-report.md` L88.

### Verified example (1988-03-15 04:30, day master 己)

| Branch | Engine element used | Engine 십신 | lunar-javascript-style (丙 dominant hidden stem) |
|--------|---------------------|------------|--------------------------------------------------|
| 巳 (day) | fire, yin | **편인** | **정인** (丙 fire **yang** → producedBy, diff yinYang) |

Root cause: 巳 nominal = fire-yin → 편인; dominant 지장간 丙 = fire-yang → 정인.

### Downstream blast radius if switched

- `ten-gods.ts`, `tables.ts` (add 지장간 table + dominant-stem picker)
- `five-elements.ts` (same nominal branch elements today — would need alignment decision)
- `lib/oracle/engines/calendar/__tests__/misc.test.ts` (tenGods tests)
- Any future UI copy that shows branch 십신
- **Does not affect**: `fourPillars`, ziwei, name, prism (they don’t call `tenGods` today)

### Recommendation: **Keep as-is**

Both schools are valid; the engine already documents the choice. Switching to 지장간-dominant
would match lunar-javascript and many mainland 八字 sites, but Korean/Japanese popular
tables often show the simplified branch element anyway. **If** product wants parity with
lunar-javascript branch labels, add an optional `branchTenGodMode: 'nominal' | 'hiddenDominant'`
rather than silently changing output (would bump `CALENDAR_ENGINE_VERSION`).

---

## 2. 子時 — day pillar at 23:00–23:59

### What the code does today

**Day pillar does NOT advance at 23:00.** It uses the **local civil calendar date** passed
in `DateTimeInput.date` — midnight boundary (子正 / 조자시).

| Location | Behaviour |
|----------|-----------|
| `lib/oracle/engines/calendar/ganzhi.ts` L121–123 | Day pillar from `solarFromYmd(y,m,d)` — **date string only**, no hour-based roll |
| `lib/oracle/engines/calendar/ganzhi.ts` L28–32 | Hour branch: whole-hour bins; 23:00–00:59 → 子 (`floor(((h+1)%24)/2)`) |
| `lib/oracle/engines/calendar/ganzhi.ts` L125–126 | Hour **stem** via 五鼠遁 from **displayed** day stem (bypasses library 야자시 inconsistency) |
| `docs/calendar-verification.md` L111–112 | Documented: 조자시 default, **not** 23:00 roll |
| `docs/calendar-engine-report.md` L86 | 유파 table: day rolls at midnight vs 야자시 23:00 |

**Not configurable** — no flag or input field.

### Engine evidence (1988-03-15/16, Asia/Seoul)

| Wall clock | Day pillar | Hour pillar | Notes |
|------------|------------|-------------|-------|
| 1988-03-15 **23:30** | **己巳** (same civil day) | 甲子 | 23:00 school would use **庚午** day |
| 1988-03-16 **00:30** | **庚午** (next civil day) | 丙子 | Both schools agree from 00:00 on Mar 16 |

Hour stem at 23:30 correctly follows **己** day → 甲子; under 23:00-roll it would follow **庚** day → 丙子.

### Public calculator survey

| Source | Market | Default / stated rule | 23:00–23:59 day pillar |
|--------|--------|----------------------|-------------------------|
| [사주프라임](https://sajuprime.co.kr/manseryeok) | KR | **子時一日論**: true solar time then **23:00 → next day**; optional “야자시/조자시” keeps same day | **Next day** (default) |
| [Cantian AI wiki (KO)](https://www.cantian.ai/wiki/ko/other_words_explanations/zaowanzishi/) | KR/CN | Default **子初 23:00**; user can switch to midnight split | **Next day** (default) |
| [OpenFate Wiki (KO)](https://wiki.openfate.ai/ko/bazi/glossary/early-and-late-zi-hour) | JP/KR | Documents both; product default **23:00 change** | **Next day** (ZI_HOUR_23 mode) |
| [SAZA blog](https://www.sazasaju.com/blog/yajasi-jeongjasi-guide) | KR | Explains both; 야자시 = same day at 23:xx | Split school = same day |
| [8words.ai](https://www.8words.ai/cn/explain/questions/zi-hour-day-boundary-bazi) | CN | **子初换日 23:00** | **Next day** |
| [DateDB / calendar-verification.md](docs/calendar-verification.md) | KR ref | **Midnight** (조자시) | Same day |

**Majority of modern JP/KR online 四柱 tools that state a default use 23:00 (子初 / 子時一日論).**
Midnight split (야자시/早子) is widely documented and offered as an **option**, especially in Korea.
Japan-facing professional tools (OpenFate, many 九星/四柱 hybrids) also lean **23:00 default**.

### Recommendation: **Switch** (or add `dayBoundary: 'midnight' | 'zi_start'` with default `'zi_start'` for JP market)

**Reasoning:** Primary market Japan; Korean flagship calculators default to 23:00. Current
midnight rule matches DateDB’s plain mode but disagrees with what most users will cross-check.

**Blast radius if switched to 23:00 default:**

| Area | Files / tests |
|------|----------------|
| Calendar core | `ganzhi.ts` — derive “effective ganzhi date” when local hour ≥ 23 |
| Hour pillar | Already uses displayed day stem — stays consistent if day roll changes |
| `toLunar` | **Unchanged** (still civil date) unless product wants lunar roll too |
| Ziwei | `index.ts` — lunar day for 紫微/左辅/右弼; `ziShiRolledOver` semantics |
| Tests | `pillars.test.ts`, any boundary tests; **new** 23:30 day-pillar test |
| Docs | `calendar-verification.md`, `calendar-engine-report.md`, `ziwei-verification.md` |
| Version | `CALENDAR_ENGINE_VERSION` bump; likely `ZIWEI_ENGINE_VERSION` if lunar day follows |
| Other engines | Anything calling `fourPillars` (prism axis, future routes) |

**If keeping midnight:** document prominently in UI that we use DateDB/조자시 school —
users comparing to 사주프라임 defaults will see day-pillar mismatches near 23:00.

---

## 3. 숙요 27수 (sukuyou) — calculation lineage

### What the code does today

Computes **tropical** Moon ecliptic longitude (`astronomy-engine`) at the birth instant,
divides the circle into **27 equal 13°20′ segments**, and maps segment 0 to **昴宿** (index 1).

| Location | Behaviour |
|----------|-----------|
| `lib/oracle/engines/calendar/sukuyou.ts` L1–6 | Module doc: real ecliptic λ; **not verified** against 宿曜 reference |
| `lib/oracle/engines/calendar/sukuyou.ts` L25–27 | `index = floor(λ / (360/27)) % 27` |
| `lib/oracle/engines/calendar/tables.ts` L160–195 | 27 names in 昴-first order; comment flags ayanamsa/anchor caveat |

This is **neither**:

- **Japanese 宿曜経 traditional** — lunar month 朔日宿 lookup + advance one mansion per lunar day ([senjutsu.jp](https://www.senjutsu.jp/labo/shukuyo-calc), [OpenFate sukuyo](https://openfate.ai/zh-hans/sukuyo))
- **Indian nakshatra sidereal** — Lahiri ayanamsa, different division boundaries
- **Chinese 28宿 reduction** — lunar-javascript has `getXiu()` (28宿); engine explicitly does **not** use it

Closest label: **“modern ecliptic calculator with 昴@0° anchor”** — a minority technical approach ([nakshatra.tokyo](https://nakshatra.tokyo/01/suku1.html) uses ecliptic but **婁@0°**, not 昴@0°).

### Deliberate or library default?

**Deliberate implemented placeholder.** Built from scratch because lunar-javascript has no
27-mansion API. Flagged as unverified in `calendar-engine-report.md` L90.

### Public cross-check — 1988-03-15 04:30 Asia/Seoul

| Source | Method | Result |
|--------|--------|--------|
| **This engine** | Tropical λ ÷ 27, 昴@0° | **氐宿** (index 14, λ≈174.5°) |
| [watashino.net](https://watashino.net/y1988m3d15/) | JP 宿曜 (traditional) | **危宿** |
| [9rando.info](https://9rando.info/calendar/unfuun/1988/0315/) | JP calendar (lists 旧1月27日) | **危宿** implied via 二十七宿 tradition |
| [senjutsu.jp](https://www.senjutsu.jp/labo/shukuyo-calc) | Lunar 朔日宿 + day count | **危宿** (旧1月27日 → 室朔 +26 steps) |

Note: engine lunar = **1-28**; several JP calendars show **1-27** for the same civil date
(one-day lunar offset). Even after aligning lunar day, **longitude 昴@0° vs table method**
still diverges (氐 vs 危).

### Public-tool majority

| Market | Dominant method |
|--------|-----------------|
| **Japan** | **Lunar 朔日宿 table** per 《宿曜经》/ Japanese 宿曜道 ([大久保占い研究室](https://www.senjutsu.jp/labo/shukuyou-uranai/labo_etc01), OpenFate) |
| Korea | Few dedicated 27宿 apps; where present, **lunar table** ([技能提升网 28/27宿](https://jinengtisheng.com/apps/lunar-mansions/)) |
| Minority | Ecliptic λ calculators (multiple incompatible 0° anchors) |

### Recommendation: **Switch** to Japanese 宿曜経 lunar method

**Reasoning:** Japan primary market; every mainstream JP 宿曜 tool uses 朔日宿 + lunar day count,
not raw tropical longitude. Current output fails user cross-checks.

**Blast radius:**

| Area | Change |
|------|--------|
| `sukuyou.ts` | Replace λ division with lunar month/day → mansion |
| `tables.ts` | Add `SUKUYOU_MONTH_FIRST_MANSION` (12-month 朔日宿 table) |
| Reuse | `toLunar()` from calendar engine (same leap-month convention as ziwei) |
| Tests | `misc.test.ts` — pin 1988-03-15 → 危宿; optional senjutsu.jp cases |
| Docs | `calendar-engine-report.md`, new sukuyou verification section |
| Version | `CALENDAR_ENGINE_VERSION` bump |
| **No impact** on ziwei, name, tenGods, nineStar year/month |

Optional later: expose `sukuyouMode: 'lunar' | 'ecliptic'` for astronomically-minded users.

---

## 4. 구성 일명성 (nine-star day star) — 陽遁/陰遁 rule

### What the code does today

| Star | Implementation | School |
|------|----------------|--------|
| Year (본명성) | Digit reduction from 立春-adjusted year | **구성기학** — deliberate (`nine-star.ts` L52–64) |
| Month (월명성) | Year-branch group + jie month | **구성기학** — deliberate (`nine-star.ts` L66–74) |
| **Day (일명성)** | `lunar-javascript` → `getDayNineStar()` | **玄空飛星 (Xuan Kong Flying Star)** — library default |

| Location | Behaviour |
|----------|-----------|
| `lib/oracle/engines/calendar/nine-star.ts` L10–19 | Explicit **유파 gap** for day star |
| `lib/oracle/engines/calendar/nine-star.ts` L107–109 | Parses Chinese numeral from library string |

**No 陽遁/陰遁 logic** for day star in our code. The documented 구성기학 rule (not implemented):

1. Find **nearest 甲子** to **冬至** → start **陽遁** (1白→9紫 ascending).
2. Find **nearest 甲子** to **夏至** → start **陰遁** (9紫→1白 descending).
3. Every ~11–12 years: **九星の閏** — switch at 甲午 to 7赤 (陽) or 3碧 (陰) ([nobml blog](https://nobml.hatenablog.jp/entry/20180113/1515770790), [kyusei.co3.jp](http://www.kyusei.co3.jp/nichiban.html)).

Year/month already use 입춘 + 절 boundaries — consistent with JP/KR 구성/九星気学.

### Deliberate or library default?

**Day: library default**, acknowledged as wrong school in comments. Year/month: **deliberate**
from-scratch 구성기학.

### Public cross-check — 1988-03-15

| Source | 일명성 |
|--------|--------|
| **This engine** (library) | **3** (三碧 / 삼벽목성) |
| [9rando.info 1988/03/15](https://9rando.info/calendar/unfuun/1988/0315/) | **三碧木星** |
| [sajuplus 일명성 방법](https://sajuplus.tistory.com/2634) | 陽遁 count from 冬至 nearest 甲子 → **matches 3** for this date |
| [uic.io 구성 help](https://uic.io/ko/calendar/help/kyusei/) | Same 陽遁/陰遁 甲子 rule |

**Spot check agrees for this date**, but implementation is still the **wrong algorithm family**
(Flying Star vs 日盤 三元). Divergence expected on other dates — tests only assert `1–9` range
(`nine-star.test.ts` L35–40).

### Public-tool majority

| Market | Day-star method |
|--------|-----------------|
| **Japan** | 九星気学 **日盤** — 冬至/夏至 甲子 + 陽遁/陰遁 + 閏 ([shin-yu.net](https://shin-yu.net/kyuseikigaku/), [kanshiqsei.com](https://kanshiqsei.com/thinking-days-9star-calculation)) |
| Korea | Same **일정법** ([sajuplus.tistory.com/2634](https://sajuplus.tistory.com/2634), [uic.io](https://uic.io/ko/calendar/help/kyusei/)) |
| Feng shui / almanac | 玄空飛星 (what lunar-javascript implements) — **different product context** |

### Recommendation: **Switch** day star to explicit 구성기학 日盤

**Reasoning:** Year/month already claim 구성기학; day star should match the same school for
Japan/KR users. Library shortcut is documented as low-confidence. Implement 陽遁/陰遁 with
九星閏 (follow nobml / kyusei.co3.jp / sajuplus rules).

**Blast radius:**

| Area | Change |
|------|--------|
| `nine-star.ts` | Replace L107–109 library call with 日盤 algorithm |
| `tables.ts` | Optional 閏-year table or runtime 甲子/甲午 finder |
| Tests | `nine-star.test.ts` — pin days from 9rando + sajuplus worked examples; add 閏 edge case |
| Docs | Remove “library-derived day” caveat once implemented |
| Version | `CALENDAR_ENGINE_VERSION` bump |
| **No impact** on ziwei, name, prism |

---

## 5. Ziwei 子時 handling vs calendar engine; `ziShiRolledOver` meaning

### What the code does today

Ziwei **delegates** hour branch and year stem/branch to `fourPillars()` and lunar month/day
to `toLunar({ date: birthDate })` — **civil date string, no hour-based lunar roll**.

| Location | Behaviour |
|----------|-----------|
| `lib/oracle/engines/ziwei/conventions.ts` L20–26 | States 조자시 consistency with calendar |
| `lib/oracle/engines/ziwei/index.ts` L193–209 | `fourPillars` + `toLunar(birthDate)` |
| `lib/oracle/engines/ziwei/index.ts` L199–203 | `ziShiRolledOver = (hour >= 23)` |
| `lib/oracle/engines/ziwei/__tests__/ziwei.test.ts` L155–171 | 23:30 → flag true, lunar **unchanged**, hour 子 |

### Does ziwei match the calendar engine?

**Yes**, for all computed fields today:

- Hour branch: same bins as `fourPillars` (23:30 → 子)
- Day/lunar date: same civil day (23:30 on Aug 16 → lunar 7-17, not next day)
- Year stem/branch: same `fourPillars` 立春 year

### Does `ziShiRolledOver` mean what its name implies?

**No — the name is misleading.**

| Name suggests | Actual behaviour |
|---------------|------------------|
| “Day/lunar rolled over for late 子時” | **Nothing rolls.** Flag only marks **晚子時** (23:00–23:59) |
| User / original TRAP 3 text (“23:00+ rolls to next day”) | **Not implemented** — calendar uses midnight |

The flag is a **reservation hook** (“user was in late 子時; a future 야자시 school can roll
without guessing intent”) — see `conventions.ts` L24–26. It does **not** indicate that any
roll occurred.

### Divergence from Japanese 紫微 references

[iztro](https://iztro.com/quick-start) treats **timeIndex 12 (晚子时)** specially: for 紫微 placement
it can **add one to lunar day** (and adjusts leap-month handling). Our engine does **not**
do this — verified ziwei charts (e.g. 2000-08-16 寅时) match iztro for normal hours, but
**23:00–23:59 births would diverge** on lunar-day-sensitive steps (紫微/左辅/右弼/身宮 if month
boundary, etc.) even though hour branch matches.

### Recommendation

1. **Short term — rename (keep-as-is behaviour):** `ziShiRolledOver` → `lateZiShi` or
   `wanZiShi` (晚子時 marker). Blast: `types.ts`, `index.ts`, tests, docs only — no chart math change.

2. **If item 2 switches to 23:00 day roll:** extend ziwei to roll **effective lunar date**
   (and/or pass effective date into `toLunar`) in lockstep with `fourPillars`. Then rename flag to
   something like `effectiveDayAdvanced` or fold into calendar-level `dayBoundary` config.
   Blast: `ziwei/index.ts`, verification docs, all 23:xx ziwei tests, `ZIWEI_ENGINE_VERSION`.

3. **If item 2 stays midnight:** keep ziwei aligned with calendar but **document** that JP
   紫微 calculators using 晚子时 day+1 (iztro) will disagree for 23:xx births.

---

## Cross-engine dependency map (for planned switches)

```
fourPillars / toLunar (calendar)
  ├── prism / routes (future) — fourPillars
  ├── ziwei — fourPillars + toLunar(civil date)
  ├── nineStar — fourPillars implicit via jie; day star separate
  └── sukuyou — toLunar only (after switch)

Item 2 (子時) ──► calendar ganzhi ──► ziwei lunar + flags
Item 3 (27수) ──► sukuyou only
Item 4 (일명성) ──► nineStar.day only
Item 1 (십신) ──► tenGods (+ optionally fiveElementBalance)
Item 5 ──► naming + docs; math tied to Item 2
```

---

## Suggested implementation order (when code changes are approved)

1. **Rename `ziShiRolledOver`** — zero math risk, fixes misleading API.
2. **Add `dayBoundary` to calendar + ziwei follow** — largest user-visible 四柱/紫微 alignment win for JP/KR.
3. **Replace sukuyou with lunar 朔日宿 method** — isolated module.
4. **Replace nineStar day with 日盤 陽遁/陰遁** — completes 구성기학 trio.
5. **Optional: tenGods `hiddenDominant` mode** — only if users report 십신 mismatches.

---

## References checked

- Internal: `docs/calendar-engine-report.md`, `docs/calendar-verification.md`, `lib/oracle/engines/ziwei/conventions.ts`
- KR 子時: [사주프라임](https://sajuprime.co.kr/manseryeok), [Cantian AI KO](https://www.cantian.ai/wiki/ko/other_words_explanations/zaowanzishi/), [SAZA](https://www.sazasaju.com/blog/yajasi-jeongjasi-guide)
- JP 子時: [OpenFate KO/JP wiki](https://wiki.openfate.ai/ko/bazi/glossary/early-and-late-zi-hour)
- JP 宿曜: [senjutsu.jp](https://www.senjutsu.jp/labo/shukuyo-calc), [watashino.net 1988-03-15](https://watashino.net/y1988m3d15/)
- JP/KR 九星 day: [9rando 1988-03-15](https://9rando.info/calendar/unfuun/1988/0315/), [sajuplus 일명성](https://sajuplus.tistory.com/2634), [uic.io](https://uic.io/ko/calendar/help/kyusei/)
- JP 紫微 晚子: [iztro quick-start](https://iztro.com/quick-start) (timeIndex 0–12)

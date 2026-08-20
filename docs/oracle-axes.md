# Oracle axis projection

The axis layer sits **above** the engines and **below** any UI or LLM.
It does not modify engine output. It projects that output into three
shared coordinate spaces so systems that do not speak each other's
language can still vote.

This document covers:

- **Part 1**: the contract, the aggregator, and three projectors
  (`saju`, `astro`, `prism`).
- **Part 2a**: an aggregator amendment (`contested` now runs on centered
  trait profiles, not raw values) and four more projectors (`ziwei`,
  `nine-star` / `ninestar`, `sukuyou`, `maya` / `tzolkin`).
- **Part 2b**: a third phase-verdict band (`lean`, between `consensus`
  and `split`) and the final five projectors (`tarot`, `runes`, `iching`,
  `numerology`, `name`) — all twelve `SYSTEM_IDS` now have a projector.

There are no routes and no LLM calls in this layer.

---

## Three coordinate spaces

| Space | Axes | Range | Normalization |
|---|---|---|---|
| **TRAITS** | drive, stability, relation, control, exploration, reflection | each 0–100 | not required to sum to 100 |
| **ELEMENTS** | wood, fire, earth, metal, water | shares of 100 | **must sum to 100** (or the space is `null`) |
| **PHASE** | advance, hold, release | shares of 100 | **must sum to 100** (or the space is `null`) |

Elements are renormalized so a star-heavy system cannot outweigh a
four-pillar system. Phase is renormalized for the same reason.

---

## The vote contract

Every projector returns an `AxisVote`:

```
{
  system, traits | null, elements | null, phase | null,
  confidence: {
    traits:   { weight: 1 | 0.5, basis: 'direct' | 'derived' | 'degraded' } | null,
    elements: same,
    phase:    same
  },
  unreadable: [ { space, code } ],
  reasons:    { traits?: code[], elements?: code[], phase?: code[] },
  engineVersion
}
```

### `basis` is load-bearing

| basis | weight | Meaning | UI |
|---|---|---|---|
| `direct` | 1.0 | The system natively reads this space | full-voice copy |
| `derived` | 0.5 | We mapped it indirectly | "mapped from …" copy |
| `degraded` | 0.5 | The system reads it, but input was missing | "incomplete chart" copy |

`derived` and `degraded` must not be collapsed. A Western chart's 오행
vote is derived even on a timed birth. A 사주 chart with no hour is
degraded even though 오행 is native.

### Codes only

`unreadable[].code` and every `reasons.*` entry are machine codes
(`saju.tengods.wealth_dominant`, `iching.no_trait_reading`). The i18n
layer turns them into Korean / English / … copy. The consensus map can
explain itself in any language without a second model call.

---

## Aggregator

`computeConsensus(votes)` walks each space independently.

### Traits

`traits` carries two different reads, computed from the same votes:

| Field | Computed from | Purpose |
|---|---|---|
| `mean` | raw weighted mean per axis | display — "where the six axes sit" |
| `profile` | weighted mean of each vote's **centered** values | shape — "which axes this vote emphasizes, level removed" |
| `spread` | weighted SD of the **centered** values | how much systems disagree on shape |
| `contested` | axes where `spread` exceeds `TRAIT_CONTESTED_SPREAD` | flag for the UI |

**Why centering exists (Part 2a).** The Part-1 worked example flagged 5
of 6 trait axes as `contested` using raw-value SD. That was a false
signal: `prism` is normalized to mean 50 / SD 12, while `saju` and
`astro` are not — the systems were on different absolute *scales*, not
in disagreement about the person. With 3 systems this happened to look
dramatic; with 12 systems on assorted scales it would fire on every
single axis for every single user, making `contested` useless.

The fix (`lib/oracle/axes/consensus.ts` `traitConsensus`, `math.ts`
`centeredTraits`): before computing spread, subtract each vote's own
6-axis mean from itself —

```
centered[axis] = vote.traits[axis] − mean(vote.traits across all 6 axes)
```

— then take the weighted mean (`profile`) and weighted SD (`spread`)
of those centered values, per axis, across votes. A vote that is
uniformly offset from another (e.g. `+20` on every one of its 6 axes)
becomes numerically identical after centering, so a pure scale/offset
mismatch can never register as `contested`. `mean` is left untouched —
it is still the raw weighted mean, used for display, and is expected to
carry each system's absolute scale.

`TRAIT_CONTESTED_SPREAD` was re-tuned from 15 (a raw-value threshold) to
**10** (a centered-value threshold) in `lib/oracle/axes/conventions.ts`;
see that file's comment for why the two numbers are not comparable.

A regression test (`__tests__/consensus.test.ts`, "same shape at
different absolute levels is NOT contested") locks this in: three votes
sharing one fixed shape at levels 30 / 50 / 70 must report `contested:
[]`.

### Elements

Weighted sum, renormalized to 100.

- `deficiency[e] = max(0, 20 − total[e])` — the talisman prescription
- `excess[e]     = max(0, total[e] − 20)`
- If nobody voted, both stay 0 (no prescription from silence)

### Phase

Weighted tally, renormalized to 100. `leader` is the max pole.

Verdict thresholds (also in `conventions.ts`, never inlined):

| verdict | rule |
|---|---|
| `consensus` | leader share ≥ `PHASE_CONSENSUS_MIN` (60) |
| `lean` | leader share ≥ `PHASE_LEAN_MIN` (45) and < 60 |
| `split` | leader share < 45 |
| `clash` | any two systems sit on opposite ends: one `advance ≥ 60`, the other `release ≥ 60` |

**`lean` (Part 2b).** The 7-projector worked example gave `hold 53.3` vs
`advance 32.4` — a clear lean that the old binary consensus/split verdict
mislabelled as `split`, understating it. `lean` names that middle case.
The two thresholds are placeholders — `conventions.ts` says explicitly
they will be re-tuned from a distribution simulation once all 12
projectors exist, not eyeballed from one worked example; this change
adds the band without touching that later step.

**Clash takes priority.** A 66% hold majority that still contains a
60/60 advance–release pair is a clash. That pair is the interesting
object on the screen; it must not be hidden by an overall majority, a
`lean`, or a `split`. Pairs go in `oppositions: [{ a, b, gap }]`, `a` =
the advancing system, `gap` = `min(advance, release)`.

### Participation

Per space: a system with a non-null vector is `participating`; a system
with `null` is `unreadable`. Unreadable systems never appear in
`participating`. A degraded vote stays in `participating` at weight 0.5.

`systemCount.partial` counts systems that filled 1 or 2 of the 3 spaces.

---

## Projector mappings

### `saju` — all three spaces **direct**

Input: civil date, time or `null`, IANA timezone, sex, as-of date.
Calls the calendar engine; does not change it.

| Space | Source | Notes |
|---|---|---|
| traits | 십신 distribution of the four pillars (year/month/day/hour stems+branches; 일간 excluded) | 비겁 / 식상 / 재성 / 관성 / 인성 → 6 axes via `TEN_GOD_GROUP_TRAITS` |
| elements | 오행 counts of the same characters, renormalized | |
| phase | 십신 of the current 대운 + 세운 | `TEN_GOD_PHASE` |

Unknown birth time: three pillars only. Traits and elements stay
readable with `basis: 'degraded'`. 대운 is skipped (`greatLuck` needs
an hour); phase falls back to 세운 only, also degraded. Reason code
`saju.hour_unknown`.

십신 → trait rationale (each group row sums to 1):

- **비겁 (peer)** — drive 0.45 / relation 0.35 / control 0.20. Self-assertion and peer rivalry.
- **식상 (output)** — exploration 0.50 / drive 0.25 / relation 0.25. Talent going outward.
- **재성 (wealth)** — drive 0.40 / control 0.40 / exploration 0.20. Acquiring and directing resources.
- **관성 (officer)** — control 0.45 / stability 0.40 / relation 0.15. Structure, career, constraint.
- **인성 (resource)** — reflection 0.50 / stability 0.35 / control 0.15. Study, support, inward digestion.

Relation has no exclusive 십신; it is split across peer / output / officer.

### `astro` — traits **direct**, elements **derived**, phase **direct**

| Space | Source | Notes |
|---|---|---|
| traits | Classical planets × house weight × aspect count | Angular 1.4 / succedent 1.0 / cadent 0.7. Nodes excluded. |
| elements | 4 classical elements mapped onto 5 오행 | **Always `derived`**, even with a timed birth. |
| phase | Applying transit-to-natal aspects | Hard applying → release; applying to Sun/Mars/Jupiter → advance; Saturn / separating → hold. |

Unknown birth time: no houses, no angles, Moon approximate. Traits
`degraded`. Elements stay `derived` (signs do not need houses).

**Why elements cannot be direct.** Fire / earth / water keep their
names. Air has no 오행 seat. The chosen split:

```
fire  → fire  1.00
earth → earth 0.70 + metal 0.30   (earth "contains" ore)
air   → wood  0.50 + metal 0.50   (movement + heaven/structure)
water → water 1.00
```

Metal would otherwise exist only when air is present, which over-punishes
earth-heavy charts. This is a convention, not a claim that Ptolemy spoke 오행.

### `prism` — all three spaces **direct**

| Space | Source | Notes |
|---|---|---|
| traits | `coreMatrix` | Already the 6 axes, 1:1 |
| elements | birth-season 오행 + current-season 오행, tilted by `elementRelation` | |
| phase | 12-cycle → advance / hold / release | Annual 70% + monthly 30%. Table in `PRISM_CYCLE_PHASE`. |

12-cycle → phase:

| id | name | phase |
|---|---|---|
| 0 Ignition | advance | outgoing start |
| 1 Ascent | advance | |
| 2 Bloom | hold | relating in place |
| 3 Tension | release | something has to give |
| 4 Harvest | hold | |
| 5 Recalibrate | release | cutting a drain |
| 6 Breakthrough | advance | |
| 7 Bond | hold | |
| 8 Command | advance | |
| 9 Restore | release | empty the block |
| 10 Distill | hold | |
| 11 Threshold | release | close a door |

### `ziwei` — traits **derived**, elements **direct** (or **degraded**), phase **direct**

Input: birth date, time or `null`, IANA timezone, sex, as-of date. Calls
the ziwei engine (star placement + 四化/大限/流年); does not change it.

| Space | Source | Notes |
|---|---|---|
| traits | 主星 (major stars) in 命宮 (65%) and 身宮 (35%), weighted by 廟旺利陷 brightness | `ZIWEI_STAR_TRAITS`, `ZIWEI_BRIGHTNESS_WEIGHT` |
| elements | 五行局 (anchor, 70 of the raw total) tilted by the same palace stars' native 五行 | `ZIWEI_JU_ELEMENT`, `ZIWEI_STAR_ELEMENT` |
| phase | current 大限's own 四化 + this year's 流年四化, each transformation weighted by its target star's brightness where it currently sits | `ziwei.phase.daxian_and_liunian_sihua` |

**Unknown birth time** → no 命宮/身宮 → traits and phase `null`
(`ziwei.no_birth_time`). Elements degrade to a single-source read: a
`ZIWEI_JU_ELEMENT`-style boost on just the birth YEAR STEM's own native
element (`basis: 'degraded'`, weight 0.5) — 五行局 itself needs 命宮 and
so is unavailable.

**Trait rationale (judgement call, documented in `tables.ts`).** There
is no single canonical "star → 6 axes" table in 紫微斗數. Each of the 14
主星's classical 星情 (temperament) is bucketed onto the axes it is most
commonly described by (e.g. 紫微 authority → control+drive; 太陰 inward
emotional depth → reflection+relation; 破軍 disruptive/pioneering →
drive+exploration). 命宮 outweighs 身宮 2-to-1 (命宮 is the conventional
seat of core personality; 身宮 colors how it acts in the world) — also a
judgement call.

**Element rationale.** 五行局 is the direct, birth-time-independent
anchor (raw value 70). Palace stars' native element (`ZIWEI_STAR_ELEMENT`,
the classical 十四主星分属五行 assignment) then tilts the read — weighted
by brightness and by the same 命宮/身宮 split used for traits. Because
五行局 always contributes a large flat anchor, this can still land very
lopsided when a star's native element AGREES with 五行局 (see the worked
example below — a 金四局 chart with 武曲 seated in 身宮 reads 89% metal).

**Phase rationale.** 大限 and 流年 each carry their own 四化 (化祿/化權/
化科/化忌 land on 4 different stars). 化祿/化權 lean advance, 化科 leans
hold, 化忌 leans release — literally counting occurrences would produce
a CONSTANT 50/25/25 split for every chart (every stem produces exactly
one of each), so as a documented refinement each occurrence is weighted
by the brightness of the star it lands on, in the palace it currently
occupies. Both the decade's own 四化 (from the decade palace's own 宮干)
and this year's 流年四化 vote; there is no explicit weighting between
the two (each transformation contributes equally, so decade and year
carry equal total weight by construction — 4 transformations each).

### `ninestar` — traits **derived**, elements **direct**, phase **direct**

Input: birth date, time or `null` (falls back to noon — the exact
instant rarely matters for 본명성), IANA timezone, as-of date. Calls the
calendar engine's `nineStar`; does not change it. Always fully
readable — a nine-star reading only needs a civil date.

| Space | Source | Notes |
|---|---|---|
| traits | 본명성 (natal year star, 1–9) alone | `NINE_STAR_TRAITS` |
| elements | natal 년/월/일盤 stars' own 五行, blended 50/30/20 (year/month/day) | person's innate composition, like `fiveElementBalance` for saju |
| phase | five-element relation between 본명성 and the CURRENT 년/월/일盤 stars, blended 20/30/50 (year/month/day) | `NINE_STAR_RELATION_PHASE` |

**Trait rationale.** 구성기학 personality archetypes are popular-
astrology material, not from one canonical source; each of the 9 stars'
commonly cited character (1 water: adaptable/introspective … 9 fire:
passionate/intellectual) is bucketed onto the 6 axes — a judgement call,
documented per-star in `tables.ts`.

**Element rationale.** Rather than reading only the single year star,
all three of the person's own natal year/month/day stars are blended,
year-weighted heaviest since it is the broadest, slowest-moving signal.

**Phase rationale — the interesting one.** "The relationship between
본명星 and the current 년/월/일盤 position" classically means a full
방위 (direction) grid — the moving magic square that produces 五黄殺 /
暗剣殺 / 本命殺. That grid is NOT implemented in the calendar engine, and
this is an additive layer that must not touch engines. Documented
simplification: we proxy that relationship with the same five-element
same/produces/producedBy/dominates/dominatedBy classification already
used for 사주 ten-gods (`TEN_GOD_MATRIX`), comparing 본명성's element
against each of the CURRENT year/month/day stars' elements, then
blending those three comparisons 20/30/50 (day is the most immediate
방위 signal). This is explicitly a proxy, not the classical calculation
— see the comment on `NINE_STAR_RELATION_PHASE` in `tables.ts`.

### `sukuyou` — traits **derived**, elements **derived or unreadable**, phase **direct**

Input: birth date, time or `null` (does not affect the mansion — purely
civil-date), a timezone (structurally required by the engine's
`DateTimeInput`, unused for mansion placement), as-of date. Calls the
calendar engine's `sukuyou` / `sukuyouRelation`; does not change them.

| Space | Source | Notes |
|---|---|---|
| traits | natal mansion's paired 七曜 (seven luminary) temperament | reuses `ASTRO_BODY_TRAITS` — no second Sun/Moon/… scale invented |
| elements | luminary → 五行, only for the 5 element-planets | `null` when the luminary is 日 or 月 |
| phase | `sukuyouRelation(본명宿, 오늘宿)`'s 三九 relation | `SUKUYOU_RELATION_PHASE` |

**Trait rationale.** Each of the 27 mansions classically pairs with one
of the 七曜 (日月火水木金土), the traditional 二十八宿 cycle
(角木亢金氐土房日心月尾火箕水…) reindexed onto this engine's 昴-first,
牛-omitted order (`SUKUYOU_MANSION_LUMINARY`). Rather than inventing a
second personality scale for the same seven classical bodies, the
mansion's temperament reuses the exact `ASTRO_BODY_TRAITS` row already
defined for the `astro` projector's Sun/Moon/Mars/Mercury/Jupiter/Venus/
Saturn.

**Element rationale — the null case in action.** 火星/水星/木星/金星/
土星 (Mars/Mercury/Jupiter/Venus/Saturn) map cleanly onto 五行 (the
classical 五星 assignment: fire/water/wood/metal/earth). 日 (Sun) and 月
(Moon) sit OUTSIDE that five-planet system and have no unambiguous 오행
seat. Rather than guessing one, mansions paired with Sun or Moon (8 of
the 27) get `elements: null` with code `sukuyou.no_wuxing_for_luminary`
— exactly the "unreadable is better than fabricated" rule in action. A
test (`__tests__/projectors-part2.test.ts`) walks 30 consecutive
mansions and asserts both branches are reachable.

**Phase rationale.** Per the task's explicit lean: 栄/親/友 (flourishing
/ closeness / friendship) → advance; 命/安 (self / repose) → hold;
業/胎/衰/壊/危 (karma / gestation / decline / ruin / danger) → release.
成 was not named in the source instruction; it pairs with 危 in this
engine's own `SUKUYOU_RELATION_PAIR` grouping, so it inherits 危's
release lean rather than being guessed independently.

### `tzolkin` (Maya, file `projectors/maya.ts`) — traits **derived**, elements **always unreadable**, phase **direct**

Input: birth date, as-of date. No birth time, no timezone — the
Tzolk'in day count is a pure civil-date function
(`SolarCalendarDate`), so there is no unknown-time degradation path.
Calls the calendar engine's `tzolkin`; does not change it.

| Space | Source | Notes |
|---|---|---|
| traits | natal 20-nawal character | `MAYA_NAWAL_TRAITS` |
| elements | — | always `null`, code `maya.no_wuxing_mapping` |
| phase | CURRENT date's 13-tone position in the building/holding/releasing arc | `MAYA_TONE_PHASE` |

**Why elements is always unreadable.** Maya cosmology has its own
four-direction / colour scheme that does not map onto 五行 at all —
forcing a translation would be exactly the fabrication the contract
exists to prevent. This is the one projector where a whole space is
unconditionally `null`, by design, not as a fallback.

**Trait rationale.** The 20 nawales' widely circulated popular-Maya-
astrology characterizations (Imix primal/nurturing … Ajaw culmination/
radiant leadership) are bucketed onto the 6 axes — a judgement call,
documented per-nawal in `tables.ts`.

**Phase rationale.** The 13 galactic tones are classically read as one
narrative arc: Magnetic(1)→Self-Existing(4) = building; Overtone(5)→
Solar(9) = the sustained peak; Planetary(10)→Cosmic(13) = release. The
exact 4/5/4 split is a judgement call (13 does not divide evenly by 3).
Phase reads the CURRENT date's tone (not the natal one), mirroring how
every other projector reads phase from "now."

### `tarot` — traits **derived**, elements **derived (or unreadable)**, phase **direct**

Input: a seed, a spread size (1/3/5/10), and the picker's 1-based
positions into the shuffled deck. Calls the draw engine's `tarotDraw`;
does not change it. This is a divination draw, not a birth-data system —
there is no "unknown birth time" path, only "how many cards, which suits."

| Space | Source | Notes |
|---|---|---|
| traits | Major Arcana archetype, or suit for minors, reflected on reversal | `TAROT_MAJOR_TRAITS`, `TAROT_SUIT_TRAITS`, `reflectTraitMix` |
| elements | suit → classical 4-element → 오행, reusing astro's `CLASSICAL_TO_OHENG` | Majors have no suit and are skipped, not zeroed; `null` if a draw is all majors |
| phase | each card's forward/hold/ending character | `TAROT_MAJOR_PHASE` (22), `TAROT_MINOR_RANK_PHASE` (14 ranks × 4 suits) |

**Trait rationale.** Each of the 22 Major Arcana carries a widely-cited
surface archetype (Chariot = drive+control, Hanged Man = reflection+hold,
etc. — bucketed in `tables.ts`). The 56 minors do not get individual
archetypes; per the task, only "suit balance" counts for them, so all 14
ranks of one suit share that suit's single trait row
(`TAROT_SUIT_TRAITS`: wands=fire→drive, cups=water→relation, swords=
air→control, pentacles=earth→stability). **Reversal** does not re-look-up
a second table — it reflects whichever mix was found around that mix's
own min/max range (`math.ts` `reflectTraitMix`), so a reversed Chariot's
drive+control emphasis becomes its own weakest axes instead, not a
hand-picked "shadow Chariot" row.

**Element rationale.** The four suits are the SAME classical fire/earth/
air/water astro already reads, so `tarot.ts` reuses `CLASSICAL_TO_OHENG`
verbatim rather than inventing a second suit→五行 table — exactly the
"do not invent a second one" instruction. Majors carry no suit and
contribute nothing; a draw of only majors (rare but possible, especially
at `spread: 1`) reports `elements: null` with code `tarot.no_minor_cards`
rather than fabricating a suit.

**Phase rationale.** Ranks follow the same beginning/building/completing
arc used for numerology's personal year (Ace–3 advance, 4–6 hold, 7–10
release), extended to court cards by their own character (Page/Knight =
young and active = advance; Queen/King = settled = hold). Reversal is
NOT applied to phase — the task's reversal instruction is specific to
traits, and a fixed 78-card table already exists for phase.

### `rune` (file `projectors/rune.ts`, `system: 'runes'`) — traits **derived**, elements **derived (or unreadable)**, phase **direct**

Input: a seed and a rune count (1–24). Calls the draw engine's
`runeDraw`; does not change it.

| Space | Source | Notes |
|---|---|---|
| traits | each drawn rune's own character | `RUNE_TRAITS`, all 24 covered |
| elements | rune → 五行, only for runes with a fairly agreed association | `RUNE_ELEMENT`, 9 of 24 covered; the rest are left OUT of the blend |
| phase | each rune's own directional meaning; merkstave/reversed flips advance↔release | `RUNE_PHASE` |

**Trait rationale.** All 24 staves get a personality row from the
widely-cited common-rune-guide character for each (Uruz = primal
strength/vitality, Perthro = fate/hidden pattern, etc.). Reversal is
NOT applied here — the task's reversal instruction for runes covers
phase only, so a second reversed-traits table would be an unrequested
judgement call.

**Element rationale — the "leave it out" case in action.** Unlike tarot's
suits (an undisputed correspondence), Elder Futhark has no single
agreed rune→element system across rune-lore traditions. `RUNE_ELEMENT`
only covers the 9 runes where the association is close to unambiguous —
mostly where the rune's own name or central image directly names a
classical element (Kenaz = torch/fire, Isa = ice/water, Laguz =
lake/water, …). The other 15 are deliberately absent. A draw where NONE
of the drawn runes fall in that set of 9 reports `elements: null` with
code `rune.no_element_consensus`, never a guessed value — a test walks
30 seeds and asserts both the readable and unreadable branch occur.

**Phase rationale.** Each rune has its own base direction (Fehu = advance,
Isa = hold, Laguz = release, …). Reversed or merkstave flips advance↔
release; `hold` has no opposite among the three axes, so it is
unaffected by the flip.

### `iching` (file `projectors/iching.ts`) — traits **always unreadable**, elements **direct**, phase **direct**

Input: a seed and an optional day-stem (only affects the 六獸/beast
assignment, which this projector does not use). Calls the draw engine's
`ichingDraw`; does not change it. This is a divination draw, not a
birth-data system.

| Space | Source | Notes |
|---|---|---|
| traits | — | always `null`, code `iching.no_trait_reading` |
| elements | 납갑 五行 already assigned per line by the draw engine, 세효 weighted 2× | `elementsFromLines` |
| phase | changing lines' 육친, remapped through the SAME relation table `ninestar` uses | `SIX_RELATIVE_TO_RELATION` → `FIVE_ELEMENT_RELATION_PHASE` |

**Why traits is always unreadable.** 육효 answers a question about a
situation — it does not describe a person's disposition. There is no
"disposition" signal anywhere in a 육효 cast to bucket onto 6 axes; the
task calls this out explicitly, and a fabricated read here would be
exactly the thing the contract exists to prevent.

**Element rationale — a genuinely direct mapping.** The draw engine
already assigns each of the six lines a 五行 via 납갑 (`IchingLine.element`).
This projector does not invent anything; it sums those six existing
elements, weighting the 세효 (the line the reader's fate is bound to)
2× an ordinary line before renormalizing — the one explicit weighting
instruction in the task.

**Phase rationale — reuse, not a new classify function.** No changing
lines → `hold` 100% (nothing is moving). Otherwise, "which lines change"
IS what turns 본괘 into 지괘 (the resulting hexagram is fully determined by
them), so each CHANGING line's own 육친 — already computed by the engine
relative to the palace element, before this projector ever runs — is the
signal. 육친 (兄弟/子孙/妻财/官鬼/父母) is the exact same same/produces/
producedBy/dominates/dominatedBy classification `FIVE_ELEMENT_RELATION_PHASE`
already encodes for `ninestar`, just under Chinese names
(`SIX_RELATIVE_TO_RELATION` is the direct relabeling, documented in
`tables.ts`, not a second judgement call). Renamed from
`NINE_STAR_RELATION_PHASE` to `FIVE_ELEMENT_RELATION_PHASE` for this
reuse — the mapping itself is unchanged.

### `numerology` — traits **derived**, elements **always unreadable**, phase **direct**

Input: birth date, an optional Latin name, and an as-of date. Calls the
numerology engine's `numerology`; does not change it.

| Space | Source | Notes |
|---|---|---|
| traits | life path (60%) blended with expression (40%) | `NUMEROLOGY_NUMBER_TRAITS`; falls back to life path alone with no Latin name |
| elements | — | always `null`, code `numerology.no_wuxing_mapping` |
| phase | personal year's explicit 1-9 "beginning/building/completing" cycle | `NUMEROLOGY_PERSONAL_YEAR_PHASE` |

**Trait rationale.** Standard Pythagorean-numerology character sketches
(1 leader, 2 diplomat, 3 creative communicator, … 9 humanitarian) are
bucketed onto the 6 axes, keyed 1–9 plus the master numbers 11/22/33 —
this engine's own `reducePythagorean` preserves masters rather than
reducing them further, so life path/expression/personal year can all
legitimately land on one. Life path is read as the whole-life core
(60%), expression as how it plays out day to day (40%); with no Latin
name, expression is `null` and traits fall back to life path alone
(`numerology.traits.lifepath_only` + `numerology.no_latin_name`).

**Why elements is always unreadable.** Pythagorean numerology has no
element system that maps onto 五行 — full stop. This is deliberately
NOT the same thing as 성명판단's 수리 오행 (see `name` below), which IS a
real, direct mapping; the task calls out this exact confusion to avoid.

**Phase rationale.** The personal year number is explicitly described
(by the task) as a 1-9 cycle of beginning/building/completing. Mapped
literally: 1-3 = beginning = advance, 4-6 = building = hold, 7-9 =
completing = release. Master-number personal years (rare, but possible
given this engine's `reducePythagorean`) look up their reduced base
digit (11→2, 22→4, 33→6) for this table only.

### `name` (성명판단) — traits **derived**, elements **direct**, phase **always unreadable**

Input: surname, given name, locale, optional stroke convention. Calls
the name engine's `nameReading`; does not change it. The engine's own
`axes: null` field and conventions.ts comment ("axis projection is a
separate content layer, not computed here") is exactly this projector's
reason to exist.

| Space | Source | Notes |
|---|---|---|
| traits | each of the five 격's own 오행 nature, weighted by 격 | `NAME_ELEMENT_TRAITS`, `NAME_GYEOK_WEIGHT` (人格 heaviest) |
| elements | 수리 오행 (last-digit → 五行) across all five 격 | 天/人/地 from the engine's own `fiveElements`; 外/總 via the SAME exported `elementForGyeok` |
| phase | — | always `null`, code `name.no_time_axis` |

**Non-CJK locales.** The engine returns `supported: false` for any
locale that is not `ko` / `ja` / `zh*` (its own "no Latin-alphabet stroke
system" rule — Latin names are numerology's job). This projector mirrors
that with all three spaces unreadable, code `name.locale_unsupported`.

**Trait rationale.** The engine stores a 1–81 luck GRADE (대길/길/평/흉/
대흉) per 격, not a personality write-up, so "수리 character" is read
through each 격's elemental nature instead — a small, generic 오행
personality archetype (`NAME_ELEMENT_TRAITS`), the same kind of move
`ASTRO_BODY_TRAITS` and the ziwei/nine-star star tables already make
(read personality off an underlying classical category, not a bespoke
per-number table of 81 entries). 人格 (人, the classical seat of core
personality, 主格) is weighted 2× each of the other four 격.

**Element rationale — genuinely direct, not derived.** The engine already
computes 수리 오행 for 天/人/地 (`fiveElements`); the SAME exported
`elementForGyeok` function (not a second formula) covers the two it
doesn't (外格, 總格) so all five 격 vote. Weighted evenly (20% each) —
the task gives no weighting instruction here, unlike traits.

**Why phase is always unreadable.** A name is fixed for life. There is
no time axis to derive a "current phase" from without inventing one out
of thin air — exactly the kind of manufactured signal the contract
forbids.

---

## Worked example — three projectors (Part 1)

Birth: **1988-03-15 04:30 Asia/Seoul** (the verified 사주 reference case:
戊辰 / 乙卯 / 己巳 / 丙寅). Sex male. As-of **2026-08-20**.
Astro location Seoul (37.5665, 126.9780). Prism: INFJ, impulse crimson /
need sage / identity indigo, micro-check `[3,3,3,3]`.

### Three votes

```json
{
  "saju": {
    "system": "saju",
    "traits": { "drive": 12.9, "stability": 27.1, "relation": 16.4, "control": 29.3, "exploration": 0, "reflection": 14.3 },
    "elements": { "wood": 37.5, "fire": 25, "earth": 37.5, "metal": 0, "water": 0 },
    "phase": { "advance": 0, "hold": 100, "release": 0 },
    "confidence": {
      "traits": { "weight": 1, "basis": "direct" },
      "elements": { "weight": 1, "basis": "direct" },
      "phase": { "weight": 1, "basis": "direct" }
    },
    "unreadable": [],
    "reasons": {
      "traits": ["saju.tengods.officer_dominant"],
      "elements": ["saju.elements.four_pillars"],
      "phase": ["saju.phase.daewoon_sewoon"]
    },
    "engineVersion": "1.2.0"
  },
  "astro": {
    "system": "astro",
    "traits": { "drive": 17.6, "stability": 14.9, "relation": 15.5, "control": 17.2, "exploration": 19.9, "reflection": 14.8 },
    "elements": { "wood": 8.3, "fire": 0, "earth": 40.8, "metal": 25.9, "water": 25 },
    "phase": { "advance": 5.4, "hold": 61.5, "release": 33.1 },
    "confidence": {
      "traits": { "weight": 1, "basis": "direct" },
      "elements": { "weight": 0.5, "basis": "derived" },
      "phase": { "weight": 1, "basis": "direct" }
    },
    "unreadable": [],
    "reasons": {
      "traits": ["astro.traits.houses_and_aspects"],
      "elements": ["astro.elements.classical_to_oheng"],
      "phase": ["astro.phase.applying_transits"]
    },
    "engineVersion": "1.0.0"
  },
  "prism": {
    "system": "prism",
    "traits": { "drive": 44, "stability": 54.7, "relation": 51.9, "control": 54.1, "exploration": 52.8, "reflection": 65 },
    "elements": { "wood": 42.3, "fire": 7.7, "earth": 7.7, "metal": 34.6, "water": 7.7 },
    "phase": { "advance": 0, "hold": 70, "release": 30 },
    "confidence": {
      "traits": { "weight": 1, "basis": "direct" },
      "elements": { "weight": 1, "basis": "direct" },
      "phase": { "weight": 1, "basis": "direct" }
    },
    "unreadable": [],
    "reasons": {
      "traits": ["prism.traits.core_matrix"],
      "elements": ["prism.element.pressure"],
      "phase": ["prism.cycle.bloom"]
    },
    "engineVersion": "1.2.1"
  }
}
```

사주 reads 관성-dominant (control / stability), a wood–earth chart with
no metal or water in the four pillars, and a hold-only current 대운+세운.
Astro's 오행 vote is marked **derived** (weight 0.5) and is the only
system putting real metal and water on the table. Prism's coreMatrix is
already the six axes; its current season relation is `PRESSURE`; Bloom
is a hold cycle.

### Consensus

This is the CURRENT aggregator output (post Part-2a centering amendment)
for the same three votes:

```json
{
  "traits": {
    "mean": { "drive": 24.8, "stability": 32.2, "relation": 27.9, "control": 33.5, "exploration": 24.2, "reflection": 31.4 },
    "profile": { "drive": -4.2, "stability": 3.2, "relation": -1.1, "control": 4.5, "exploration": -4.8, "reflection": 2.3 },
    "spread": { "drive": 4.4, "stability": 5.2, "relation": 0.6, "control": 5.7, "exploration": 8.6, "reflection": 6.3 },
    "contested": [],
    "participating": ["saju", "astro", "prism"],
    "unreadable": []
  },
  "elements": {
    "total": { "wood": 33.6, "fire": 13.1, "earth": 26.2, "metal": 19, "water": 8.1 },
    "deficiency": { "wood": 0, "fire": 6.9, "earth": 0, "metal": 1, "water": 11.9 },
    "excess": { "wood": 13.6, "fire": 0, "earth": 6.2, "metal": 0, "water": 0 },
    "participating": ["saju", "astro", "prism"],
    "unreadable": []
  },
  "phase": {
    "tally": { "advance": 1.8, "hold": 77.2, "release": 21 },
    "leader": "hold",
    "verdict": "consensus",
    "oppositions": [],
    "participating": ["saju", "astro", "prism"],
    "unreadable": []
  },
  "systemCount": { "total": 3, "participating": 3, "partial": 0, "unreadable": 0 }
}
```

Reading this object (no model required):

- **Phase** is a hold consensus (77.2 ≥ 60). No clash pair.
- **Traits**: `mean` still shows Prism sitting ~20–30 points above
  사주/astro on every axis — that is display-level scale, unchanged.
  `spread`/`contested` now run on `profile` (centered), and the three
  systems' *shapes* turn out to agree closely: every centered spread is
  under 9, so **`contested` is empty**. Under the OLD (Part-1, raw-value)
  logic this same data reported `contested: ["stability", "relation",
  "control", "exploration", "reflection"]` — five of six axes — purely
  because Prism's mean-50/SD-12 normalization sits on a different
  absolute scale than 사주/astro's raw shares. That was the scale-mismatch
  bug the amendment fixes; see "Aggregator → Traits" above.
- **오행** prescription: water 11.9 and fire 6.9 below the 20% baseline;
  metal is essentially even. Wood is the excess. A talisman layer
  would start from `deficiency`, not from any one system's raw counts.

Astro's derived 오행 vote pulled metal and water into the total that
사주 alone would have left at zero. That is why `basis: 'derived'`
weighs 0.5 rather than being dropped or promoted to direct.

---

## Worked example — seven projectors (Part 2a)

Same birth (**1988-03-15 04:30 Asia/Seoul**, male) and as-of date
(**2026-08-20**), now with `ziwei`, `ninestar`, `sukuyou`, and `tzolkin`
(maya) added to the three Part-1 votes. Full vote and consensus JSON
generated directly from the projectors (not hand-computed).

### Four new votes (abridged — traits/elements/phase only)

```json
{
  "ziwei": {
    "traits": { "drive": 17.8, "stability": 17.4, "relation": 17.6, "control": 35.3, "exploration": 7.2, "reflection": 4.6 },
    "elements": { "wood": 0, "fire": 3.1, "earth": 0, "metal": 89, "water": 7.9 },
    "phase": { "advance": 41.4, "hold": 41.3, "release": 17.3 }
  },
  "ninestar": {
    "traits": { "drive": 40, "stability": 0, "relation": 10, "control": 10, "exploration": 40, "reflection": 0 },
    "elements": { "wood": 100, "fire": 0, "earth": 0, "metal": 0, "water": 0 },
    "phase": { "advance": 80, "hold": 0, "release": 20 }
  },
  "sukuyou": {
    "traits": { "drive": 5, "stability": 40, "relation": 35, "control": 5, "exploration": 5, "reflection": 10 },
    "elements": null,
    "phase": { "advance": 0, "hold": 100, "release": 0 }
  },
  "tzolkin": {
    "traits": { "drive": 25, "stability": 30, "relation": 15, "control": 30, "exploration": 0, "reflection": 0 },
    "elements": null,
    "phase": { "advance": 100, "hold": 0, "release": 0 }
  }
}
```

`ziwei`'s 89% metal is not a bug: this chart's 五行局 is 金四局 (metal)
AND 武曲 (also native metal) sits in 身宮, so anchor and tilt reinforce
each other instead of pulling apart. `sukuyou` and `tzolkin` both come
back `elements: null` — the natal 宿 pairs with 月 (Moon, no 오행 seat),
and Maya cosmology never maps onto 오행 at all.

### Consensus (seven systems)

```json
{
  "traits": {
    "mean": { "drive": 23.7, "stability": 28.1, "relation": 24.5, "control": 28.2, "exploration": 19.8, "reflection": 20.3 },
    "profile": { "drive": -0.4, "stability": 4, "relation": 0.4, "control": 4.1, "exploration": -4.3, "reflection": -3.8 },
    "spread": { "drive": 9.8, "stability": 10.3, "relation": 6.3, "control": 9.3, "exploration": 12, "reflection": 9.3 },
    "contested": ["stability", "exploration"],
    "participating": ["saju", "astro", "prism", "ziwei", "ninestar", "sukuyou", "tzolkin"],
    "unreadable": []
  },
  "elements": {
    "total": { "wood": 40.9, "fire": 8, "earth": 14.6, "metal": 30.3, "water": 6.2 },
    "deficiency": { "wood": 0, "fire": 12, "earth": 5.4, "metal": 0, "water": 13.8 },
    "excess": { "wood": 20.9, "fire": 0, "earth": 0, "metal": 10.3, "water": 0 },
    "participating": ["saju", "astro", "prism", "ziwei", "ninestar"],
    "unreadable": ["sukuyou", "tzolkin"]
  },
  "phase": {
    "tally": { "advance": 32.4, "hold": 53.3, "release": 14.3 },
    "leader": "hold",
    "verdict": "split",
    "oppositions": [],
    "participating": ["saju", "astro", "prism", "ziwei", "ninestar", "sukuyou", "tzolkin"],
    "unreadable": []
  },
  "systemCount": { "total": 7, "participating": 7, "partial": 2, "unreadable": 0 }
}
```

**Report:**

- **Contested trait axes: 2 of 6** (`stability`, `exploration`) under
  the new centered logic — up from 0 of 6 with three systems, but still
  a small minority of axes, not the 5-of-6 the old raw-value logic would
  have produced at 3 systems and would only have gotten worse at 7.
  Adding `ziwei` (control-heavy), `ninestar` (drive+exploration-heavy),
  `sukuyou` (stability+relation-heavy), and `tzolkin` (stability+control
  -heavy) surfaces genuine shape disagreement on `stability` and
  `exploration` specifically — that is the aggregator doing its job,
  not a scale artifact.
- **Phase verdict: `split`** (was `consensus` at 3 systems). Tally
  `advance 32.4 / hold 53.3 / release 14.3` — `hold` still leads but at
  53.3% it falls under the 60% `PHASE_CONSENSUS_MIN`, so the verdict
  drops to `split`. No `oppositions`: `ninestar` (advance 80) and
  `tzolkin` (advance 100) pull hard toward advance, but no single vote
  puts `release` ≥ 60, so there is no clash pair — just a broader spread
  of opinion than 3 systems showed.
- **Deficiency vector**: `{ wood: 0, fire: 12, earth: 5.4, metal: 0,
  water: 13.8 }` — was `{ wood: 0, fire: 6.9, earth: 0, metal: 1, water:
  11.9 }` at 3 systems. `ziwei`'s heavy metal vote flips metal from a
  slight deficiency (1) to a real excess (10.3 — visible in `excess`,
  not shown in `deficiency`), and pulls fire's deficiency up (12, from
  6.9) and opens a new small earth deficiency (5.4, from 0 excess)
  since nothing else in the new votes props earth up. `sukuyou` and
  `tzolkin` sit out `elements` entirely (both `null`), so only 5 of 7
  systems vote in that space — visible in `elements.participating` /
  `elements.unreadable`.

**What changed vs. the three-projector run:** `systemCount.partial`
goes from 0 to 2 (sukuyou and tzolkin each fill only 2 of 3 spaces —
traits and phase, not elements). `phase.verdict` moved from `consensus`
to `split` purely because more systems broadened the tally, not because
any two systems clashed. `traits.contested` went from a meaningless
5-of-6 (the pre-amendment scale bug) to a meaningful 2-of-6 that
survives centering.

---

## Worked example — twelve systems (Part 2b)

Same birth (**1988-03-15 04:30 Asia/Seoul**, male) and as-of date
(**2026-08-20**), now with `tarot`, `runes`, `iching`, `numerology`, and
`name` added to the seven Part-2a votes — all twelve `SYSTEM_IDS`. Full
vote and consensus JSON generated directly from the projectors (not
hand-computed). The five new votes needed inputs the birth-data systems
don't: a fixed seed `"axes-worked-example"` for the three draw-based
systems (tarot 3-card spread at positions `[1,2,3]`; 3 runes; one 육효
cast with no day-stem), no Latin name for numerology (exercises its
`no_latin_name` fallback), and a Korean name (김민준, locale `ko`) for
`name`.

### Five new votes (abridged — traits/elements/phase only)

```json
{
  "tarot": {
    "traits": { "drive": 6.9, "stability": 26, "relation": 22.4, "control": 7.5, "exploration": 17.1, "reflection": 20.2 },
    "elements": { "wood": 25, "fire": 50, "earth": 0, "metal": 25, "water": 0 },
    "phase": { "advance": 33.4, "hold": 33.3, "release": 33.3 }
  },
  "runes": {
    "traits": { "drive": 13.3, "stability": 36.7, "relation": 10, "control": 20, "exploration": 3.3, "reflection": 16.7 },
    "elements": { "wood": 0, "fire": 0, "earth": 0, "metal": 0, "water": 100 },
    "phase": { "advance": 0, "hold": 100, "release": 0 }
  },
  "iching": {
    "traits": null,
    "elements": { "wood": 14.3, "fire": 28.6, "earth": 28.5, "metal": 14.3, "water": 14.3 },
    "phase": { "advance": 100, "hold": 0, "release": 0 }
  },
  "numerology": {
    "traits": { "drive": 40, "stability": 10, "relation": 0, "control": 45, "exploration": 5, "reflection": 0 },
    "elements": null,
    "phase": { "advance": 100, "hold": 0, "release": 0 }
  },
  "name": {
    "traits": { "drive": 0, "stability": 28, "relation": 20.5, "control": 11.3, "exploration": 8.3, "reflection": 32 },
    "elements": { "wood": 0, "fire": 0, "earth": 45, "metal": 0, "water": 55 },
    "phase": null
  }
}
```

`iching` comes back `traits: null` (always, by design) and `numerology`
comes back `elements: null` (always, by design — no Latin name was even
needed for that; numerology's `elements` is unconditionally
unreadable). `numerology`'s `traits` used the `no_latin_name` fallback
(`reasons.traits: ["numerology.traits.lifepath_only",
"numerology.no_latin_name"]`) since no Latin name was supplied. `name`
comes back `phase: null` (always, by design). This seed's 육효 cast
happened to draw changing lines, so `iching`'s phase leans fully
`advance` rather than the no-changing-lines `hold` case (both branches
are exercised in `__tests__/projectors-part3.test.ts`).

### Consensus (twelve systems)

```json
{
  "traits": {
    "mean": { "drive": 21.2, "stability": 27.3, "relation": 21.3, "control": 26.1, "exploration": 16.5, "reflection": 19.4 },
    "profile": { "drive": -0.7, "stability": 5.3, "relation": -0.7, "control": 4.1, "exploration": -5.4, "reflection": -2.6 },
    "spread": { "drive": 11.6, "stability": 10.3, "relation": 7.4, "control": 11.1, "exploration": 10.7, "reflection": 10.2 },
    "contested": ["drive", "stability", "control", "exploration", "reflection"],
    "participating": ["saju", "astro", "prism", "ziwei", "ninestar", "sukuyou", "tzolkin", "tarot", "runes", "numerology", "name"],
    "unreadable": ["iching"]
  },
  "elements": {
    "total": { "wood": 28.1, "fire": 11.9, "earth": 18.5, "metal": 21.8, "water": 19.7 },
    "deficiency": { "wood": 0, "fire": 8.1, "earth": 1.5, "metal": 0, "water": 0.3 },
    "excess": { "wood": 8.1, "fire": 0, "earth": 0, "metal": 1.8, "water": 0 },
    "participating": ["saju", "astro", "prism", "ziwei", "ninestar", "tarot", "runes", "iching", "name"],
    "unreadable": ["sukuyou", "tzolkin", "numerology"]
  },
  "phase": {
    "tally": { "advance": 41.8, "hold": 46, "release": 12.2 },
    "leader": "hold",
    "verdict": "lean",
    "oppositions": [],
    "participating": ["saju", "astro", "prism", "ziwei", "ninestar", "sukuyou", "tzolkin", "tarot", "runes", "iching", "numerology"],
    "unreadable": ["name"]
  },
  "systemCount": { "total": 12, "participating": 12, "partial": 5, "unreadable": 0 }
}
```

**Report:**

- **Contested trait axes: 5 of 6** (`drive`, `stability`, `control`,
  `exploration`, `reflection`) — only `relation` survives centering
  uncontested. This is a real jump from 2-of-6 at 7 systems, and it is a
  genuine finding, not a scale artifact: `numerology` (drive+control
  heavy, no relation/reflection at all in this chart), `name`
  (stability+reflection heavy, near-zero drive), and `runes`
  (stability-dominant) each pull in a different direction on axes the
  7-system run had not yet tested. Centering is doing exactly its job —
  these are shape disagreements, confirmed by `spread` values of
  10.2–11.6 on the five contested axes vs 7.4 on `relation`.
- **Phase verdict: `lean`** (was `split` at 7 systems) — the FIRST
  worked-example run to exercise the new middle band. Tally `advance
  41.8 / hold 46 / release 12.2`: `hold` still leads, now at 46%, which
  falls in `[PHASE_LEAN_MIN 45, PHASE_CONSENSUS_MIN 60)`. Two new votes
  (`iching` advance 100, `numerology` advance 100) pushed `advance` up
  from 32.4 to 41.8, narrowing the gap between `hold` and `advance` —
  `runes` (hold 100) is the main new vote propping `hold` up in the
  other direction. No `oppositions`: nothing puts `release` ≥ 60.
- **Deficiency vector**: `{ wood: 0, fire: 8.1, earth: 1.5, metal: 0,
  water: 0.3 }` — smaller across the board than the 7-system run's
  `{ fire: 12, earth: 5.4, water: 13.8 }`. `name` (55% water) and
  `iching` (28.6/28.5 fire/earth) both add real water and fire/earth
  weight that the 7-system run's votes did not supply, closing most of
  the earth and water gaps; `tarot`'s 50% fire vote does the same for
  fire's deficiency (12 → 8.1). `metal` flips from a 10.3 excess (visible
  in `excess`, not `deficiency`) to a much smaller 1.8 excess as the
  denominator of participating votes grows from 5 to 9.
- **Unreadable counts per space**: traits 1 (`iching`, always, by
  design); elements 3 (`sukuyou`, `tzolkin`, `numerology`, all by
  design — no fabricated 오행 for any of them); phase 1 (`name`, always,
  by design). `systemCount.partial` rises from 2 (at 7 systems) to 5 (at
  12): `sukuyou`, `tzolkin`, `iching`, `numerology`, and `name` each fill
  exactly 2 of the 3 spaces.

### Comparison across all three runs

| | 3 systems (Part 1) | 7 systems (Part 2a) | 12 systems (Part 2b) |
|---|---|---|---|
| Contested trait axes | 0 / 6 | 2 / 6 (`stability`, `exploration`) | 5 / 6 (all but `relation`) |
| Phase tally (advance / hold / release) | 1.8 / 77.2 / 21 | 32.4 / 53.3 / 14.3 | 41.8 / 46 / 12.2 |
| Phase verdict | `consensus` | `split` | `lean` |
| Elements deficiency | fire 6.9, water 11.9, metal 1 | fire 12, earth 5.4, water 13.8 | fire 8.1, earth 1.5, water 0.3 |
| Elements: participating / unreadable | 3 / 0 | 5 / 2 (`sukuyou`, `tzolkin`) | 9 / 3 (+`numerology`) |
| Traits: participating / unreadable | 3 / 0 | 7 / 0 | 11 / 1 (`iching`) |
| Phase: participating / unreadable | 3 / 0 | 7 / 0 | 11 / 1 (`name`) |
| `systemCount.partial` | 0 | 2 | 5 |

Two trends hold across all three runs: adding systems monotonically
**broadens** the phase tally (hold's share keeps dropping — 77.2 → 53.3
→ 46 — as more systems disagree about timing) and **shrinks** the
elements deficiency vector (more direct/derived votes fill in gaps that
fewer systems left at zero). Trait contestation is NOT monotonic in the
same simple sense — it tracks how many genuinely different *shapes* have
been added, not just system count, which is why it jumped sharply from
2/6 to 5/6 once numerology/name/runes (three very differently-shaped
trait profiles) joined.

---

## Files

```
lib/oracle/axes/
  types.ts
  conventions.ts
  tables.ts
  math.ts
  validate.ts
  consensus.ts
  projectors/saju.ts
  projectors/astro.ts
  projectors/prism.ts
  projectors/ziwei.ts
  projectors/nine-star.ts
  projectors/sukuyou.ts
  projectors/maya.ts
  projectors/tarot.ts
  projectors/rune.ts
  projectors/iching.ts
  projectors/numerology.ts
  projectors/name.ts
  index.ts
```

Engines under `lib/oracle/engines/*` are not modified.

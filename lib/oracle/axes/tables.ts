/**
 * Mapping tables for the projectors.
 * Comments explain each choice — these are conventions, not engine facts.
 */

import type { CycleId } from '../engines/prism/tables'
import type { AstroBodyName } from '../engines/astro/tables'
import type { SukuyouRelationName, TenGodName } from '../engines/calendar/types'
import type { StarBrightness, WuXingJuName } from '../engines/ziwei/types'
import type { ElementAxis, PhaseAxis, TraitVector } from './types'

export type TenGodGroup = 'peer' | 'output' | 'wealth' | 'officer' | 'resource'

/**
 * 십신 → 오행 group. Day-master is excluded from the count (it is the
 * reference, not a relation).
 */
export const TEN_GOD_GROUP: Record<Exclude<TenGodName, never>, TenGodGroup> = {
  비견: 'peer',
  겁재: 'peer',
  식신: 'output',
  상관: 'output',
  편재: 'wealth',
  정재: 'wealth',
  편관: 'officer',
  정관: 'officer',
  편인: 'resource',
  정인: 'resource',
}

/**
 * 십신 group → 6 trait axes.
 *
 * Why these weights (each row sums to 1):
 * - peer (비겁): self-assertion + peer rivalry. Drive first, then the social
 *   field those peers occupy, then a little control (not yielding).
 * - output (식상): talent going outward. Exploration is the native read;
 *   drive is the push; relation is speech/children facing others.
 * - wealth (재성): acquiring and directing resources. Drive + control, with
 *   a remainder of exploration (hunting the next resource).
 * - officer (관성): structure, career, being constrained. Control and
 *   stability dominate; a little relation (the other who imposes form).
 * - resource (인성): study, support, inward digestion. Reflection first,
 *   then stability (being held), then a little control (standards).
 *
 * Relation has no exclusive 십신 — it is split across peer / output / officer
 * rather than inventing a sixth group.
 */
export const TEN_GOD_GROUP_TRAITS: Record<TenGodGroup, TraitVector> = {
  peer: { drive: 0.45, stability: 0, relation: 0.35, control: 0.2, exploration: 0, reflection: 0 },
  output: { drive: 0.25, stability: 0, relation: 0.25, control: 0, exploration: 0.5, reflection: 0 },
  wealth: { drive: 0.4, stability: 0, relation: 0, control: 0.4, exploration: 0.2, reflection: 0 },
  officer: { drive: 0, stability: 0.4, relation: 0.15, control: 0.45, exploration: 0, reflection: 0 },
  resource: { drive: 0, stability: 0.35, relation: 0, control: 0.15, exploration: 0, reflection: 0.5 },
}

export const TEN_GOD_GROUP_REASON: Record<TenGodGroup, string> = {
  peer: 'saju.tengods.peer_dominant',
  output: 'saju.tengods.output_dominant',
  wealth: 'saju.tengods.wealth_dominant',
  officer: 'saju.tengods.officer_dominant',
  resource: 'saju.tengods.resource_dominant',
}

/**
 * Current 대운 / 세운 십신 → phase.
 * - 식상 / 재성: output and pursuit = advance
 * - 비견 / 정인 / 정관: same-as-self, proper resource, proper officer = hold
 * - 겁재 / 편인 / 편관 / 상관: rivalry, overflow resource, seven-killings,
 *   and overflowing speech = release (something has to give)
 */
export const TEN_GOD_PHASE: Record<TenGodName, PhaseAxis> = {
  식신: 'advance',
  편재: 'advance',
  정재: 'advance',
  비견: 'hold',
  정인: 'hold',
  정관: 'hold',
  겁재: 'release',
  편인: 'release',
  편관: 'release',
  상관: 'release',
}

/** Classical planet → trait mix (rows sum to 1). Nodes are excluded. */
export const ASTRO_BODY_TRAITS: Partial<Record<AstroBodyName, TraitVector>> = {
  Sun: { drive: 0.45, stability: 0.05, relation: 0.05, control: 0.35, exploration: 0.05, reflection: 0.05 },
  Moon: { drive: 0.05, stability: 0.4, relation: 0.35, control: 0.05, exploration: 0.05, reflection: 0.1 },
  Mercury: { drive: 0.1, stability: 0.05, relation: 0.1, control: 0.1, exploration: 0.35, reflection: 0.3 },
  Venus: { drive: 0.05, stability: 0.25, relation: 0.5, control: 0.05, exploration: 0.05, reflection: 0.1 },
  Mars: { drive: 0.5, stability: 0, relation: 0.05, control: 0.3, exploration: 0.15, reflection: 0 },
  Jupiter: { drive: 0.25, stability: 0.1, relation: 0.1, control: 0.05, exploration: 0.45, reflection: 0.05 },
  Saturn: { drive: 0.05, stability: 0.4, relation: 0.05, control: 0.4, exploration: 0, reflection: 0.1 },
  Uranus: { drive: 0.15, stability: 0, relation: 0.05, control: 0.05, exploration: 0.6, reflection: 0.15 },
  Neptune: { drive: 0, stability: 0.1, relation: 0.25, control: 0, exploration: 0.15, reflection: 0.5 },
  Pluto: { drive: 0.3, stability: 0.05, relation: 0.05, control: 0.45, exploration: 0.05, reflection: 0.1 },
}

/**
 * House weight. Angular houses carry the chart; cadent houses are quieter.
 * Used only when birth time is known (houses exist).
 */
export const ASTRO_HOUSE_WEIGHT: Record<number, number> = {
  1: 1.4,
  2: 1,
  3: 0.7,
  4: 1.4,
  5: 1,
  6: 0.7,
  7: 1.4,
  8: 1,
  9: 0.7,
  10: 1.4,
  11: 1,
  12: 0.7,
}

/**
 * 4 classical elements → 5 오행. This is DERIVED, never direct.
 *
 * Western fire/earth/water sit on the same names. Air has no direct 오행
 * homonym but the standard Western→East-Asian correspondence maps air
 * primarily to wood (movement, speech, spring qi); a minority share goes
 * to metal (heaven, structure, dryness). Earth keeps a sliver of metal
 * because classical earth "contains" ore.
 *
 *   fire  → fire  1.00
 *   earth → earth 0.70 + metal 0.30
 *   air   → wood  0.75 + metal 0.25
 *   water → water 1.00
 */
export const CLASSICAL_TO_OHENG: Record<'fire' | 'earth' | 'air' | 'water', Partial<Record<ElementAxis, number>>> = {
  fire: { fire: 1 },
  earth: { earth: 0.7, metal: 0.3 },
  air: { wood: 0.75, metal: 0.25 },
  water: { water: 1 },
}

/**
 * PRISM 12-cycle → phase. Advance = outgoing / starting; hold = gathering /
 * relating / ruling in place; release = cutting, restoring, crossing out.
 */
export const PRISM_CYCLE_PHASE: Record<CycleId, PhaseAxis> = {
  0: 'advance',
  1: 'advance',
  2: 'hold',
  3: 'release',
  4: 'hold',
  5: 'release',
  6: 'advance',
  7: 'hold',
  8: 'advance',
  9: 'release',
  10: 'hold',
  11: 'release',
}

export const PRISM_CYCLE_REASON: Record<CycleId, string> = {
  0: 'prism.cycle.ignition',
  1: 'prism.cycle.ascent',
  2: 'prism.cycle.bloom',
  3: 'prism.cycle.tension',
  4: 'prism.cycle.harvest',
  5: 'prism.cycle.recalibrate',
  6: 'prism.cycle.breakthrough',
  7: 'prism.cycle.bond',
  8: 'prism.cycle.command',
  9: 'prism.cycle.restore',
  10: 'prism.cycle.distill',
  11: 'prism.cycle.threshold',
}

export const PRISM_RELATION_REASON: Record<string, string> = {
  RESONANCE: 'prism.element.resonance',
  SUPPORT: 'prism.element.support',
  OUTPUT: 'prism.element.output',
  CHALLENGE: 'prism.element.challenge',
  PRESSURE: 'prism.element.pressure',
}

/* ════════════════════════════════════════════════════════════════════
 * PART 2a — ziwei / nine-star / sukuyou / maya
 * ════════════════════════════════════════════════════════════════════ */

/**
 * 十四主星 → 6 trait axes (rows sum to 1). JUDGEMENT CALL: there is no
 * single canonical "star = trait vector" table in 紫微斗數 — this reads
 * each star's classical 星情 (temperament) description and buckets it.
 * Where a star is dual-natured (e.g. 破軍 destructive-yet-pioneering) the
 * more commonly cited primary trait gets the larger share.
 *
 * - 紫微 (emperor): authority + composure → control, drive
 * - 天機 (strategist): mercurial, analytical → reflection, exploration
 * - 太陽 (sun): generous, prominent, outward-giving → drive, relation
 * - 武曲 (military/wealth): decisive, results-driven → control, drive
 * - 天同 (harmony/blessing): easygoing, peace-seeking → stability, relation
 * - 廉貞 (complex/intense): sharp, ambitious, magnetic → drive, control
 * - 天府 (treasury): steady, managerial, accumulating → stability, control
 * - 太陰 (moon): inward, nurturing, emotionally deep → reflection, relation
 * - 貪狼 (desire): appetite for experience, versatile → exploration, drive
 * - 巨門 (big gate/mouth): argumentative, analytical, verbal → reflection, relation
 * - 天相 (minister): supportive, dutiful, mediating → stability/relation/control balanced
 * - 天梁 (elder/longevity): principled, protective, mentoring → stability, reflection
 * - 七殺 (seven killings/general): bold, decisive, risk-taking → drive, exploration
 * - 破軍 (army breaker): disruptive, pioneering, restless → drive, exploration
 */
export const ZIWEI_STAR_TRAITS: Record<string, TraitVector> = {
  紫微: { drive: 0.35, stability: 0.15, relation: 0.15, control: 0.35, exploration: 0, reflection: 0 },
  天机: { drive: 0.05, stability: 0.05, relation: 0.1, control: 0.05, exploration: 0.35, reflection: 0.4 },
  太阳: { drive: 0.4, stability: 0.05, relation: 0.35, control: 0.15, exploration: 0.05, reflection: 0 },
  武曲: { drive: 0.35, stability: 0.1, relation: 0, control: 0.45, exploration: 0.1, reflection: 0 },
  天同: { drive: 0, stability: 0.45, relation: 0.3, control: 0, exploration: 0.1, reflection: 0.15 },
  廉贞: { drive: 0.3, stability: 0, relation: 0.2, control: 0.3, exploration: 0.2, reflection: 0 },
  天府: { drive: 0.05, stability: 0.4, relation: 0.15, control: 0.3, exploration: 0, reflection: 0.1 },
  太阴: { drive: 0, stability: 0.2, relation: 0.25, control: 0, exploration: 0.05, reflection: 0.5 },
  贪狼: { drive: 0.3, stability: 0, relation: 0.15, control: 0.05, exploration: 0.5, reflection: 0 },
  巨门: { drive: 0.1, stability: 0, relation: 0.35, control: 0.05, exploration: 0.1, reflection: 0.4 },
  天相: { drive: 0, stability: 0.3, relation: 0.3, control: 0.3, exploration: 0, reflection: 0.1 },
  天梁: { drive: 0.05, stability: 0.35, relation: 0.1, control: 0.2, exploration: 0, reflection: 0.3 },
  七杀: { drive: 0.5, stability: 0, relation: 0, control: 0.2, exploration: 0.3, reflection: 0 },
  破军: { drive: 0.4, stability: 0, relation: 0, control: 0.1, exploration: 0.5, reflection: 0 },
}

/**
 * 廟旺利陷 brightness → weight. A 廟 star's temperament comes through at
 * full strength; a 陷 star's comes through faintly (present but muted),
 * never zero — even a dim star is still seated in that palace. Empty
 * string (no brightness data, e.g. 左輔/右弼/天魁/天鉞/地空/地劫) defaults
 * to the neutral 平 weight. Values are a monotonic judgement-call scale,
 * not a measured quantity.
 */
export const ZIWEI_BRIGHTNESS_WEIGHT: Record<StarBrightness | '', number> = {
  庙: 1,
  旺: 0.85,
  得: 0.7,
  利: 0.55,
  平: 0.4,
  不: 0.25,
  陷: 0.15,
  '': 0.4,
}

/**
 * 十四主星 → native 五行. Classical star-element assignment cited across
 * 紫微斗數 references (紫微/天府/天梁 土; 天機/貪狼 木; 太陽/廉貞 火;
 * 武曲/七殺 金; 天同/太陰/巨門/天相/破軍 水). Used only as a secondary
 * tilt on top of 五行局 — never the primary element source.
 */
export const ZIWEI_STAR_ELEMENT: Record<string, ElementAxis> = {
  紫微: 'earth',
  天机: 'wood',
  太阳: 'fire',
  武曲: 'metal',
  天同: 'water',
  廉贞: 'fire',
  天府: 'earth',
  太阴: 'water',
  贪狼: 'wood',
  巨门: 'water',
  天相: 'water',
  天梁: 'earth',
  七杀: 'metal',
  破军: 'water',
}

/** 五行局 name → its 五行, read from the Chinese character prefix. */
export const ZIWEI_JU_ELEMENT: Record<WuXingJuName, ElementAxis> = {
  水二局: 'water',
  木三局: 'wood',
  金四局: 'metal',
  土五局: 'earth',
  火六局: 'fire',
}

/**
 * 命宮 vs 身宮 weight for trait aggregation. JUDGEMENT CALL: 命宮 is the
 * conventional seat of core personality; 身宮 colors how that personality
 * acts in the world. We weigh 命宮 roughly 2x 身宮 rather than treating
 * them as equal or using 身宮 only as a tiebreaker.
 */
export const ZIWEI_PALACE_WEIGHT = { ming: 0.65, shen: 0.35 } as const

/* ── nine-star (구성기학) ──────────────────────────────────────────── */

/**
 * 본명성 (1-9) → 6 trait axes (rows sum to 1). JUDGEMENT CALL: 구성기학
 * personality archetypes are popular-astrology material, not a single
 * canonical source; this follows the commonly cited character sketch for
 * each star (1 water: adaptable/introspective; 2 earth: nurturing/
 * cooperative; 3 wood: pioneering/assertive; 4 wood: sociable/diplomatic;
 * 5 earth: central/commanding; 6 metal: principled/authoritative;
 * 7 metal: charming/expressive; 8 earth: accumulative/cautious;
 * 9 fire: passionate/intellectual).
 */
export const NINE_STAR_TRAITS: Record<number, TraitVector> = {
  1: { drive: 0.05, stability: 0.3, relation: 0.1, control: 0.05, exploration: 0.1, reflection: 0.4 },
  2: { drive: 0, stability: 0.35, relation: 0.4, control: 0.05, exploration: 0, reflection: 0.2 },
  3: { drive: 0.4, stability: 0, relation: 0.1, control: 0.1, exploration: 0.4, reflection: 0 },
  4: { drive: 0.1, stability: 0.05, relation: 0.4, control: 0, exploration: 0.35, reflection: 0.1 },
  5: { drive: 0.3, stability: 0.1, relation: 0, control: 0.5, exploration: 0.1, reflection: 0 },
  6: { drive: 0.1, stability: 0.3, relation: 0, control: 0.5, exploration: 0, reflection: 0.1 },
  7: { drive: 0.1, stability: 0, relation: 0.45, control: 0, exploration: 0.35, reflection: 0.1 },
  8: { drive: 0.05, stability: 0.45, relation: 0.1, control: 0.35, exploration: 0, reflection: 0.05 },
  9: { drive: 0.35, stability: 0, relation: 0.15, control: 0.1, exploration: 0.1, reflection: 0.3 },
}

/**
 * Weight of 년/월/일 star when blending the elements vote. Year is the
 * broadest, slowest-moving signal so it dominates; day is the most
 * volatile so it contributes least to a single vote's ELEMENT space
 * (contrast with phase below, where day dominates instead).
 */
export const NINE_STAR_ELEMENT_WEIGHT = { year: 0.5, month: 0.3, day: 0.2 } as const

/**
 * Weight of 년/월/일 star when blending the phase vote. Day is the most
 * immediate signal (today's 방위), matching how 기학 practice treats the
 * 日盤 as the actionable layer; year gives the broadest, slowest context.
 */
export const NINE_STAR_PHASE_WEIGHT = { year: 0.2, month: 0.3, day: 0.5 } as const

/**
 * "The relationship between 본명星 and the current 年/月/日盤 position."
 * A full 방위 (direction) grid — the moving magic square that actually
 * produces 五黄殺/暗剣殺/本命殺 — is not implemented in the calendar
 * engine (out of scope for an additive, engine-untouched layer). JUDGEMENT
 * CALL / documented simplification: we proxy that relationship with the
 * FIVE-ELEMENT interaction between 본명星's element (reference) and the
 * current year/month/day star's element (target), using the SAME
 * same/produces/producedBy/dominates/dominatedBy classification already
 * used for 사주 ten-gods (`TEN_GOD_MATRIX` in the calendar engine), just
 * without a yin-yang split (구성 has no yin-yang per star):
 *
 * - `producedBy` (환경이 나를 생함, target feeds reference) and
 *   `dominates` (내가 환경을 극함, reference actively directs target) both
 *   read as forward momentum → advance.
 * - `same` (比和, steady/no net push) → hold.
 * - `produces` (reference pours itself outward into target, exertion) and
 *   `dominatedBy` (target presses on reference, constraint) both read as
 *   "something has to give" → release, mirroring `PRISM_CYCLE_PHASE`.
 *
 * This mirrors the saju TEN_GOD_PHASE table's overall lean (wealth/output
 * toward advance, resource/officer toward hold-or-release) collapsed to 5
 * buckets since there is no yin-yang variant here to split further.
 */
export type FiveElementRelation = 'same' | 'produces' | 'producedBy' | 'dominates' | 'dominatedBy'

/**
 * Generic five-element relation → phase, shared by any projector that
 * reduces a reference/target element pair to this 5-way classification.
 * Named `FIVE_ELEMENT_RELATION_PHASE` (not `NINE_STAR_...`) because
 * `iching.ts` reuses it too — see there for how 육친 (which already IS
 * this same 5-way relation, just under Chinese names) is remapped onto it.
 * Renamed from the Part 2a `NINE_STAR_RELATION_PHASE` for that reuse; the
 * mapping itself is unchanged.
 */
export const FIVE_ELEMENT_RELATION_PHASE: Record<FiveElementRelation, PhaseAxis> = {
  same: 'hold',
  produces: 'release',
  producedBy: 'advance',
  dominates: 'advance',
  dominatedBy: 'release',
}

/* ── sukuyou (宿曜経, 27 mansions) ─────────────────────────────────── */

export type SukuyouLuminary = 'Sun' | 'Moon' | 'Mars' | 'Mercury' | 'Jupiter' | 'Venus' | 'Saturn'

/**
 * Mansion (hanja) → 七曜 (seven classical luminaries), the traditional
 * 二十八宿 assignment (角木亢金氐土房日心月尾火箕水, repeating), reindexed
 * onto this engine's 昴-first, 牛-omitted 27-mansion order. Read directly
 * from each mansion's own classical assignment (not a blind mod-7 walk,
 * since omitting 牛 breaks a naive cycle).
 */
export const SUKUYOU_MANSION_LUMINARY: Record<string, SukuyouLuminary> = {
  昴宿: 'Sun',
  畢宿: 'Moon',
  觜宿: 'Mars',
  參宿: 'Mercury',
  井宿: 'Jupiter',
  鬼宿: 'Venus',
  柳宿: 'Saturn',
  星宿: 'Sun',
  張宿: 'Moon',
  翼宿: 'Mars',
  軫宿: 'Mercury',
  角宿: 'Jupiter',
  亢宿: 'Venus',
  氐宿: 'Saturn',
  房宿: 'Sun',
  心宿: 'Moon',
  尾宿: 'Mars',
  箕宿: 'Mercury',
  斗宿: 'Jupiter',
  女宿: 'Saturn',
  虛宿: 'Sun',
  危宿: 'Moon',
  室宿: 'Mars',
  壁宿: 'Mercury',
  奎宿: 'Jupiter',
  婁宿: 'Venus',
  胃宿: 'Saturn',
}

/**
 * Luminary → 오행, the classical 五星 (five-planet) assignment: 火星 fire,
 * 水星 water, 木星 wood, 金星 metal(太白), 土星 earth(鎮星). 日 (Sun) and
 * 月 (Moon) sit OUTSIDE the five-element-planet system and have no
 * unambiguous 오행 seat — intentionally absent here rather than guessed;
 * the projector marks elements unreadable for those mansions.
 */
export const SUKUYOU_LUMINARY_ELEMENT: Partial<Record<SukuyouLuminary, ElementAxis>> = {
  Mars: 'fire',
  Mercury: 'water',
  Jupiter: 'wood',
  Venus: 'metal',
  Saturn: 'earth',
}

/**
 * 三九の秘法 relation name → phase, per the task's explicit lean:
 * 栄/親/友 (flourishing / closeness / friendship) → advance;
 * 命/安 (self / repose) → hold;
 * 業/胎/衰/壊/危 (karma / gestation / decline / ruin / danger) → release.
 * 成 is not named in the source instruction; it pairs with 危 in this
 * engine's own grouping (`SUKUYOU_RELATION_PAIR['危'] === '危成'`), so it
 * inherits 危's release lean rather than being left to guesswork.
 */
export const SUKUYOU_RELATION_PHASE: Record<SukuyouRelationName, PhaseAxis> = {
  栄: 'advance',
  親: 'advance',
  友: 'advance',
  命: 'hold',
  安: 'hold',
  業: 'release',
  胎: 'release',
  衰: 'release',
  壊: 'release',
  危: 'release',
  成: 'release',
}

/* ── maya (tzolkin: 20 nawales × 13 tones) ────────────────────────── */

/**
 * 20 nawales → 6 trait axes (rows sum to 1). JUDGEMENT CALL: these follow
 * the widely circulated popular-Maya-astrology day-sign characterizations
 * (e.g. Imix = primal/nurturing, Kimi = release/surrender, Ajaw =
 * culmination/radiant leadership). Keyed by the exact names in
 * `TZOLKIN_NAWAL`.
 */
export const MAYA_NAWAL_TRAITS: Record<string, TraitVector> = {
  Imix: { drive: 0, stability: 0.35, relation: 0.25, control: 0, exploration: 0.1, reflection: 0.3 },
  "Ik'": { drive: 0.1, stability: 0, relation: 0.3, control: 0, exploration: 0.25, reflection: 0.35 },
  "Ak'b'al": { drive: 0, stability: 0.25, relation: 0.1, control: 0, exploration: 0.15, reflection: 0.5 },
  "K'an": { drive: 0.2, stability: 0.3, relation: 0, control: 0, exploration: 0.2, reflection: 0.3 },
  Chikchan: { drive: 0.45, stability: 0, relation: 0.1, control: 0.15, exploration: 0.3, reflection: 0 },
  Kimi: { drive: 0, stability: 0.1, relation: 0.1, control: 0, exploration: 0.2, reflection: 0.6 },
  "Manik'": { drive: 0.2, stability: 0.3, relation: 0.2, control: 0.1, exploration: 0, reflection: 0.2 },
  Lamat: { drive: 0.05, stability: 0.15, relation: 0.45, control: 0, exploration: 0.2, reflection: 0.15 },
  Muluk: { drive: 0, stability: 0.15, relation: 0.25, control: 0, exploration: 0, reflection: 0.6 },
  Ok: { drive: 0.05, stability: 0.25, relation: 0.5, control: 0.1, exploration: 0, reflection: 0.1 },
  Chuwen: { drive: 0.1, stability: 0, relation: 0.25, control: 0, exploration: 0.45, reflection: 0.2 },
  "Eb'": { drive: 0.15, stability: 0.25, relation: 0.3, control: 0.1, exploration: 0.2, reflection: 0 },
  Ben: { drive: 0.25, stability: 0.3, relation: 0.15, control: 0.3, exploration: 0, reflection: 0 },
  Ix: { drive: 0.3, stability: 0.1, relation: 0, control: 0.2, exploration: 0.15, reflection: 0.25 },
  Men: { drive: 0.25, stability: 0, relation: 0.05, control: 0.15, exploration: 0.4, reflection: 0.15 },
  "K'ib'": { drive: 0, stability: 0.2, relation: 0.1, control: 0.1, exploration: 0, reflection: 0.6 },
  Kaban: { drive: 0.35, stability: 0.35, relation: 0, control: 0.1, exploration: 0.2, reflection: 0 },
  "Etz'nab'": { drive: 0.15, stability: 0, relation: 0, control: 0.25, exploration: 0.1, reflection: 0.5 },
  Kawak: { drive: 0.4, stability: 0, relation: 0.1, control: 0.15, exploration: 0.35, reflection: 0 },
  Ajaw: { drive: 0.35, stability: 0.1, relation: 0.25, control: 0.3, exploration: 0, reflection: 0 },
}

/**
 * 13 galactic tones → phase. The tones are classically read as a single
 * narrative arc — Magnetic(1) unifies through Self-Existing(4) defines
 * = BUILDING; Overtone(5) empowers through Solar(9) realizes = the
 * sustained PEAK; Planetary(10) perfects through Cosmic(13) transcends
 * = RELEASE/completion. The exact 4/5/4 split is a judgement call (13
 * does not divide evenly by 3), placed at the tones most commonly
 * described as "foundation complete" (4) and "peak realized" (9).
 */
export const MAYA_TONE_PHASE: Record<number, PhaseAxis> = {
  1: 'advance',
  2: 'advance',
  3: 'advance',
  4: 'advance',
  5: 'hold',
  6: 'hold',
  7: 'hold',
  8: 'hold',
  9: 'hold',
  10: 'release',
  11: 'release',
  12: 'release',
  13: 'release',
}

/* ════════════════════════════════════════════════════════════════════
 * PART 2b — tarot / rune / iching / numerology / name
 * ════════════════════════════════════════════════════════════════════ */

/* ── tarot ─────────────────────────────────────────────────────────── */

/**
 * 22 Major Arcana → 6 trait axes (rows sum to 1). JUDGEMENT CALL: tarot
 * has no single canonical "card = trait vector" table either; this reads
 * each card's widely-cited surface archetype (not a specific school's
 * esoteric correspondences) and buckets it. Reversed cards do NOT look
 * this table up a second time — the projector reflects whichever mix it
 * finds via `reflectTraitMix` (see math.ts), so upright/reversed share
 * one row each rather than needing 44 entries.
 */
export const TAROT_MAJOR_TRAITS: Record<string, TraitVector> = {
  'The Fool': { drive: 0.25, stability: 0, relation: 0, control: 0, exploration: 0.6, reflection: 0.15 },
  'The Magician': { drive: 0.4, stability: 0, relation: 0, control: 0.4, exploration: 0.15, reflection: 0.05 },
  'The High Priestess': { drive: 0, stability: 0.1, relation: 0, control: 0, exploration: 0.1, reflection: 0.8 },
  'The Empress': { drive: 0, stability: 0.35, relation: 0.45, control: 0, exploration: 0.1, reflection: 0.1 },
  'The Emperor': { drive: 0.15, stability: 0.4, relation: 0, control: 0.4, exploration: 0, reflection: 0.05 },
  'The Hierophant': { drive: 0, stability: 0.45, relation: 0.1, control: 0.35, exploration: 0, reflection: 0.1 },
  'The Lovers': { drive: 0.05, stability: 0.05, relation: 0.7, control: 0, exploration: 0.1, reflection: 0.1 },
  'The Chariot': { drive: 0.5, stability: 0.05, relation: 0, control: 0.4, exploration: 0.05, reflection: 0 },
  Strength: { drive: 0.3, stability: 0.4, relation: 0.1, control: 0.15, exploration: 0, reflection: 0.05 },
  'The Hermit': { drive: 0, stability: 0.15, relation: 0, control: 0, exploration: 0.15, reflection: 0.7 },
  'Wheel of Fortune': { drive: 0.15, stability: 0, relation: 0, control: 0, exploration: 0.65, reflection: 0.2 },
  Justice: { drive: 0, stability: 0.15, relation: 0, control: 0.65, exploration: 0, reflection: 0.2 },
  'The Hanged Man': { drive: 0, stability: 0.3, relation: 0, control: 0, exploration: 0.1, reflection: 0.6 },
  Death: { drive: 0.1, stability: 0, relation: 0, control: 0.1, exploration: 0.55, reflection: 0.25 },
  Temperance: { drive: 0, stability: 0.4, relation: 0.15, control: 0.05, exploration: 0, reflection: 0.4 },
  'The Devil': { drive: 0.4, stability: 0, relation: 0.1, control: 0.45, exploration: 0.05, reflection: 0 },
  'The Tower': { drive: 0.55, stability: 0, relation: 0, control: 0, exploration: 0.35, reflection: 0.1 },
  'The Star': { drive: 0, stability: 0.1, relation: 0.15, control: 0, exploration: 0.35, reflection: 0.4 },
  'The Moon': { drive: 0, stability: 0.05, relation: 0.1, control: 0, exploration: 0.15, reflection: 0.7 },
  'The Sun': { drive: 0.4, stability: 0.05, relation: 0.35, control: 0, exploration: 0.15, reflection: 0.05 },
  Judgement: { drive: 0.1, stability: 0, relation: 0, control: 0.1, exploration: 0.3, reflection: 0.5 },
  'The World': { drive: 0.05, stability: 0.35, relation: 0.15, control: 0.3, exploration: 0, reflection: 0.15 },
}

/**
 * 4 Minor Arcana suits → 6 trait axes (rows sum to 1), for the 56 cards
 * that carry no individual archetype here — "suit balance" per the task,
 * not 56 separate rank readings. Standard suit temperaments: wands=fire
 * (action), cups=water (feeling), swords=air (intellect/conflict),
 * pentacles=earth (material/steady).
 */
export const TAROT_SUIT_TRAITS: Record<'wands' | 'cups' | 'swords' | 'pentacles', TraitVector> = {
  wands: { drive: 0.5, stability: 0, relation: 0.1, control: 0.05, exploration: 0.3, reflection: 0.05 },
  cups: { drive: 0, stability: 0.15, relation: 0.5, control: 0, exploration: 0.1, reflection: 0.25 },
  swords: { drive: 0.15, stability: 0, relation: 0, control: 0.45, exploration: 0.15, reflection: 0.25 },
  pentacles: { drive: 0.1, stability: 0.5, relation: 0.05, control: 0.25, exploration: 0, reflection: 0.1 },
}

/**
 * Suit → classical 4-element, the standard (undisputed across schools)
 * tarot correspondence. Feeds `CLASSICAL_TO_OHENG` — the SAME table
 * `astro.ts` uses for its classical→五行 conversion, per the task's "do
 * not invent a second one." Majors have no suit and contribute nothing
 * to elements (see `tarot.ts`), not a forced null.
 */
export const TAROT_SUIT_CLASSICAL: Record<'wands' | 'cups' | 'swords' | 'pentacles', 'fire' | 'earth' | 'air' | 'water'> = {
  wands: 'fire',
  cups: 'water',
  swords: 'air',
  pentacles: 'earth',
}

/**
 * 22 Major Arcana → phase, from each card's explicit forward/hold/ending
 * character (the task's own examples: Chariot advances, Hanged Man
 * holds, Death releases). Not affected by reversal — the task only asks
 * reversal to shift TRAITS, and a fixed 78-card table already exists for
 * phase, so reversal here would be a second, unrequested judgement call.
 */
export const TAROT_MAJOR_PHASE: Record<string, PhaseAxis> = {
  'The Fool': 'advance',
  'The Magician': 'advance',
  'The High Priestess': 'hold',
  'The Empress': 'advance',
  'The Emperor': 'hold',
  'The Hierophant': 'hold',
  'The Lovers': 'advance',
  'The Chariot': 'advance',
  Strength: 'hold',
  'The Hermit': 'hold',
  'Wheel of Fortune': 'advance',
  Justice: 'release',
  'The Hanged Man': 'hold',
  Death: 'release',
  Temperance: 'hold',
  'The Devil': 'hold',
  'The Tower': 'release',
  'The Star': 'advance',
  'The Moon': 'hold',
  'The Sun': 'advance',
  Judgement: 'release',
  'The World': 'release',
}

/**
 * Minor Arcana rank (1=Ace … 10=Ten, 11=Page, 12=Knight, 13=Queen,
 * 14=King, matching `TarotDrawnCard.number`) → phase. JUDGEMENT CALL:
 * mirrors the same beginning/building/completing arc used for numerology
 * personal years (1-3 advance, 4-6 hold, 7-10 release), extended to the
 * court cards by their own character (Page/Knight = young and active =
 * advance; Queen/King = settled maturity = hold). Applies identically to
 * all four suits — suit governs ELEMENT, not timing.
 */
export const TAROT_MINOR_RANK_PHASE: Record<number, PhaseAxis> = {
  1: 'advance',
  2: 'advance',
  3: 'advance',
  4: 'hold',
  5: 'hold',
  6: 'hold',
  7: 'release',
  8: 'release',
  9: 'release',
  10: 'release',
  11: 'advance',
  12: 'advance',
  13: 'hold',
  14: 'hold',
}

/* ── rune (Elder Futhark) ──────────────────────────────────────────── */

/**
 * 24 Elder Futhark runes → 6 trait axes (rows sum to 1). JUDGEMENT CALL:
 * follows the widely-cited common-rune-guide character for each stave.
 * Unlike elements below, every rune gets a trait row — the task's "leave
 * it out rather than guess" instruction is specific to the elements
 * mapping, where classical/rune-lore sources disagree; the personality
 * reading each rune carries is comparatively uncontroversial.
 */
export const RUNE_TRAITS: Record<string, TraitVector> = {
  Fehu: { drive: 0.3, stability: 0.3, relation: 0.1, control: 0.1, exploration: 0.15, reflection: 0.05 },
  Uruz: { drive: 0.45, stability: 0.35, relation: 0, control: 0.1, exploration: 0.1, reflection: 0 },
  Thurisaz: { drive: 0.4, stability: 0.1, relation: 0, control: 0.4, exploration: 0.1, reflection: 0 },
  Ansuz: { drive: 0, stability: 0, relation: 0.3, control: 0, exploration: 0.2, reflection: 0.5 },
  Raidho: { drive: 0.2, stability: 0.1, relation: 0, control: 0.2, exploration: 0.4, reflection: 0.1 },
  Kenaz: { drive: 0.3, stability: 0, relation: 0, control: 0.1, exploration: 0.4, reflection: 0.2 },
  Gebo: { drive: 0, stability: 0.1, relation: 0.6, control: 0, exploration: 0, reflection: 0.3 },
  Wunjo: { drive: 0, stability: 0.15, relation: 0.55, control: 0, exploration: 0.1, reflection: 0.2 },
  Hagalaz: { drive: 0.3, stability: 0, relation: 0, control: 0, exploration: 0.3, reflection: 0.4 },
  Nauthiz: { drive: 0.1, stability: 0.3, relation: 0, control: 0.2, exploration: 0, reflection: 0.4 },
  Isa: { drive: 0, stability: 0.5, relation: 0, control: 0.1, exploration: 0, reflection: 0.4 },
  Jera: { drive: 0, stability: 0.5, relation: 0.1, control: 0, exploration: 0, reflection: 0.4 },
  Eihwaz: { drive: 0.1, stability: 0.55, relation: 0, control: 0.15, exploration: 0, reflection: 0.2 },
  Perthro: { drive: 0, stability: 0, relation: 0.1, control: 0, exploration: 0.2, reflection: 0.7 },
  Algiz: { drive: 0.1, stability: 0.3, relation: 0.1, control: 0.35, exploration: 0, reflection: 0.15 },
  Sowilo: { drive: 0.5, stability: 0.1, relation: 0.1, control: 0, exploration: 0.1, reflection: 0.2 },
  Tiwaz: { drive: 0.15, stability: 0.15, relation: 0, control: 0.6, exploration: 0, reflection: 0.1 },
  Berkano: { drive: 0, stability: 0.35, relation: 0.35, control: 0, exploration: 0.1, reflection: 0.2 },
  Ehwaz: { drive: 0.1, stability: 0.1, relation: 0.5, control: 0, exploration: 0.2, reflection: 0.1 },
  Mannaz: { drive: 0.05, stability: 0.2, relation: 0.4, control: 0.15, exploration: 0, reflection: 0.2 },
  Laguz: { drive: 0, stability: 0, relation: 0.15, control: 0, exploration: 0.15, reflection: 0.7 },
  Ingwaz: { drive: 0.2, stability: 0.5, relation: 0, control: 0, exploration: 0, reflection: 0.3 },
  Dagaz: { drive: 0.25, stability: 0, relation: 0, control: 0, exploration: 0.45, reflection: 0.3 },
  Othala: { drive: 0, stability: 0.5, relation: 0.3, control: 0.1, exploration: 0, reflection: 0.1 },
}

/**
 * Rune → 오행, ONLY for runes whose element association is fairly
 * consistent across popular rune-lore sources. Growth/vegetation staves
 * (Berkano, Jera, Ingwaz, Eihwaz) map to wood; cutting/precision staves
 * (Tiwaz, Isa) map to metal. Runes with no agreed element stay absent —
 * unmapped means excluded from the blend, not defaulted to earth.
 */
export const RUNE_ELEMENT: Partial<Record<string, ElementAxis>> = {
  Uruz: 'earth',
  Kenaz: 'fire',
  Hagalaz: 'water',
  Isa: 'metal',
  Jera: 'wood',
  Eihwaz: 'wood',
  Sowilo: 'fire',
  Tiwaz: 'metal',
  Laguz: 'water',
  Berkano: 'wood',
  Ingwaz: 'wood',
}

/**
 * Rune → base (upright) phase, from each stave's own directional
 * meaning. Reversed/merkstave FLIPS advance↔release (`hold` has no
 * opposite among the three, so it is unchanged) — see `rune.ts`.
 */
export const RUNE_PHASE: Record<string, PhaseAxis> = {
  Fehu: 'advance',
  Uruz: 'advance',
  Thurisaz: 'hold',
  Ansuz: 'advance',
  Raidho: 'advance',
  Kenaz: 'advance',
  Gebo: 'hold',
  Wunjo: 'hold',
  Hagalaz: 'release',
  Nauthiz: 'hold',
  Isa: 'hold',
  Jera: 'hold',
  Eihwaz: 'hold',
  Perthro: 'release',
  Algiz: 'hold',
  Sowilo: 'advance',
  Tiwaz: 'advance',
  Berkano: 'advance',
  Ehwaz: 'advance',
  Mannaz: 'hold',
  Laguz: 'release',
  Ingwaz: 'hold',
  Dagaz: 'advance',
  Othala: 'hold',
}

/* ── iching (육효) ─────────────────────────────────────────────────── */

/**
 * 육친 (already computed per-line by the draw engine as `IchingLine.relative`,
 * comparing that line's element to the palace element) → the same
 * same/produces/producedBy/dominates/dominatedBy classification used by
 * `FIVE_ELEMENT_RELATION_PHASE`. This is a direct relabeling, not a new
 * judgement call: 兄弟=same element, 子孙=palace produces line (reference
 * produces target), 妻财=palace overcomes line (reference dominates
 * target), 官鬼=line overcomes palace (target dominates reference),
 * 父母=line produces palace (target produces reference) — see
 * `sixRelative` in the draw engine's tables.ts for the source definition.
 */
export const SIX_RELATIVE_TO_RELATION: Record<'兄弟' | '子孙' | '妻财' | '官鬼' | '父母', FiveElementRelation> = {
  兄弟: 'same',
  子孙: 'produces',
  妻财: 'dominates',
  官鬼: 'dominatedBy',
  父母: 'producedBy',
}

/* ── numerology (Pythagorean) ─────────────────────────────────────── */

/**
 * Numerology number (1-9, plus master numbers 11/22/33 — this engine's
 * `reducePythagorean` preserves those rather than reducing them further,
 * so life-path/expression/personal-year can all legitimately land on
 * one) → 6 trait axes (rows sum to 1). JUDGEMENT CALL: standard
 * Pythagorean-numerology character sketches (1 leader, 2 diplomat, 3
 * creative communicator, 4 builder, 5 free spirit, 6 nurturer, 7
 * introspective seeker, 8 achiever, 9 humanitarian; masters read as an
 * intensified version of their reduced digit — 11→2, 22→4, 33→6).
 */
export const NUMEROLOGY_NUMBER_TRAITS: Record<number, TraitVector> = {
  1: { drive: 0.55, stability: 0.05, relation: 0.05, control: 0.25, exploration: 0.1, reflection: 0 },
  2: { drive: 0, stability: 0.15, relation: 0.45, control: 0, exploration: 0, reflection: 0.4 },
  3: { drive: 0.1, stability: 0, relation: 0.3, control: 0, exploration: 0.45, reflection: 0.15 },
  4: { drive: 0.05, stability: 0.5, relation: 0, control: 0.35, exploration: 0, reflection: 0.1 },
  5: { drive: 0.3, stability: 0, relation: 0.05, control: 0, exploration: 0.55, reflection: 0.1 },
  6: { drive: 0, stability: 0.3, relation: 0.45, control: 0.05, exploration: 0, reflection: 0.2 },
  7: { drive: 0, stability: 0.1, relation: 0, control: 0.05, exploration: 0.15, reflection: 0.7 },
  8: { drive: 0.4, stability: 0.1, relation: 0, control: 0.45, exploration: 0.05, reflection: 0 },
  9: { drive: 0, stability: 0.05, relation: 0.45, control: 0, exploration: 0.1, reflection: 0.4 },
  11: { drive: 0.05, stability: 0, relation: 0.1, control: 0, exploration: 0.35, reflection: 0.5 },
  22: { drive: 0.15, stability: 0.3, relation: 0.05, control: 0.3, exploration: 0.2, reflection: 0 },
  33: { drive: 0, stability: 0.2, relation: 0.4, control: 0, exploration: 0, reflection: 0.4 },
}

/**
 * Master number → its reduced base digit, used ONLY to look up the
 * personal-year phase band below (11/22/33 are not valid keys in that
 * 1-9 band table, but the "1-9 cycle of beginning/building/completing"
 * the task describes still applies to them via their reduced form).
 */
export const NUMEROLOGY_MASTER_BASE_DIGIT: Record<number, number> = { 11: 2, 22: 4, 33: 6 }

/**
 * Personal year (1-9) → phase, from the task's own framing: "explicitly
 * a 1-9 cycle of beginning / building / completing." Mapped literally —
 * 1-3 = beginning = advance, 4-6 = building = hold, 7-9 = completing =
 * release — rather than a finer-grained per-number reading.
 */
export const NUMEROLOGY_PERSONAL_YEAR_PHASE: Record<number, PhaseAxis> = {
  1: 'advance',
  2: 'advance',
  3: 'advance',
  4: 'hold',
  5: 'hold',
  6: 'hold',
  7: 'release',
  8: 'release',
  9: 'release',
}

/* ── name (성명판단) ───────────────────────────────────────────────── */

/**
 * 오행 (from each 격's 수리, via the engine's own `elementForGyeok`) → 6
 * trait axes (rows sum to 1). JUDGEMENT CALL: the engine stores a 1-81
 * luck GRADE (대길/길/평/흉/대흉) per 격, not a personality write-up, so
 * "수리 character" is read here through each 격's elemental nature
 * instead — a generic 오행 personality archetype, analogous to how
 * `ASTRO_BODY_TRAITS` and the ziwei/nine-star star tables already read
 * personality off of an underlying classical category rather than a
 * per-number table of 81 individual entries.
 */
export const NAME_ELEMENT_TRAITS: Record<ElementAxis, TraitVector> = {
  wood: { drive: 0.15, stability: 0, relation: 0.1, control: 0, exploration: 0.55, reflection: 0.2 },
  fire: { drive: 0.4, stability: 0, relation: 0.35, control: 0.1, exploration: 0.15, reflection: 0 },
  earth: { drive: 0, stability: 0.5, relation: 0.15, control: 0.25, exploration: 0, reflection: 0.1 },
  metal: { drive: 0.1, stability: 0.15, relation: 0, control: 0.5, exploration: 0, reflection: 0.25 },
  water: { drive: 0, stability: 0.1, relation: 0.25, control: 0, exploration: 0.15, reflection: 0.5 },
}

/**
 * Weight of each 격 when blending traits AND elements. JUDGEMENT CALL:
 * 人格 (in) is classically regarded as the seat of core personality
 * (主格) in 성명학, so it gets double the others; 天/地/外/總格 split the
 * remainder evenly rather than inventing a finer ranking among them.
 */
export const NAME_GYEOK_WEIGHT = { cheon: 0.15, in: 0.4, ji: 0.15, oe: 0.15, chong: 0.15 } as const


/**
 * Native 궁합 (two-person) charts for layer-1 prompts.
 *
 * Same contract as native-chart.ts, applied to a PAIR: layer-1 readers get
 * each system's own vocabulary — 일주 합/충, 시나스트리 각, 三九 relation —
 * never the axis projection. The chart shape is uniform:
 *
 *   { 구도, 관계: <system's own pair relation>, 본인: <A's chart>, 상대: <B's chart> }
 *
 * Draw systems keep their single-draw chart (the DRAW is the relationship);
 * tzolkin carries both portraits and an explicit "no pair rule" note instead
 * of an invented score.
 *
 * Privacy: identical rule to native-chart.ts — no birth date/time/city, no
 * names, no coordinates, no instants. '본인'/'상대' are ROLE labels, chosen so
 * they cannot collide with real Korean name needles ('나'/'우리' could).
 */
import type { CrossAspect, NatalChart } from '../engines/astro'
import type { BranchPairRelation, PairElementRelation } from '../engines/calendar'
import type {
  BranchInfo,
  FiveElement,
  NineStarValue,
  StemInfo,
  SukuyouRelation,
} from '../engines/calendar/types'
import type { SuriEntry } from '../engines/name/types'
import type { PrismPairSketch } from '../engines/prism'
import {
  ASPECT_KO,
  BODY_KO,
  ELEMENT_KO,
  oneDecimal,
  PALACE_KO,
  PRISM_CYCLE_KO,
  PRISM_RELATION_KO,
  SIGN_KO,
  WEEKDAY_KO,
} from '../display-copy'
import type { JsonObject } from './types'

/* ------------------------------------------------------------------ */
/* Typed pair-relation shapes (stored on oracle_computations.result)   */
/* ------------------------------------------------------------------ */

export type SajuPairRelation = {
  dayStem: {
    a: StemInfo
    b: StemInfo
    /** 천간합 결과 오행, or null when the two day stems do not combine. */
    combination: FiveElement | null
    elements: PairElementRelation
  }
  dayBranch: { a: BranchInfo; b: BranchInfo; relation: BranchPairRelation }
  yearBranch: { a: BranchInfo; b: BranchInfo; relation: BranchPairRelation }
  complement: {
    aMissing: FiveElement[]
    filledByB: FiveElement[]
    bMissing: FiveElement[]
    filledByA: FiveElement[]
  }
}

export type ZiweiPairRelation = {
  ming: {
    aBranch: string
    bBranch: string
    relation: BranchPairRelation
  }
  spouseMajorsA: string[]
  spouseMajorsB: string[]
}

export type AstroPairRelation = {
  /** Prioritized subset (core luminaries/personal planets first, tight orbs). */
  aspects: CrossAspect[]
  totalAspects: number
}

export type NumerologyPairRelation = {
  lifePathA: number
  lifePathB: number
  /** reduce(lifePathA + lifePathB) — the classical relationship number. */
  relationshipNumber: number
  personalYearA: number
  personalYearB: number
}

export type NamePairRelation = {
  inGyeok: {
    aElement: FiveElement
    bElement: FiveElement
    relation: PairElementRelation
  }
  chongA: SuriEntry
  chongB: SuriEntry
}

export type NineStarPairRelation = {
  a: NineStarValue
  b: NineStarValue
  relation: PairElementRelation
}

export type SukuyouPairRelation = {
  /** 三九の秘法 from A's 本命宿 to B's. */
  fromA: SukuyouRelation
  /** and the reverse direction. */
  fromB: SukuyouRelation
}

/* ------------------------------------------------------------------ */
/* Korean rendering helpers                                            */
/* ------------------------------------------------------------------ */

const COMPAT_FRAME = '두 사람의 관계(궁합) 읽기 — 본인과 상대'

export const PAIR_ELEMENT_RELATION_KO: Record<PairElementRelation, string> = {
  same: '비화 — 같은 기운',
  a_generates_b: '상생 — 본인이 상대를 북돋움',
  b_generates_a: '상생 — 상대가 본인을 북돋움',
  a_overcomes_b: '상극 — 본인이 상대를 누름',
  b_overcomes_a: '상극 — 상대가 본인을 누름',
}

function elementKo(element: FiveElement): string {
  return ELEMENT_KO[element] ?? element
}

/** 육합/삼합/충/원진 as a human list; empty list means no special relation. */
export function branchRelationListKo(relation: BranchPairRelation): string[] {
  const out: string[] = []
  if (relation.yukhap) out.push('육합')
  if (relation.samhap) out.push(`삼합(${elementKo(relation.samhap)})`)
  if (relation.chung) out.push('충')
  if (relation.wonjin) out.push('원진')
  return out
}

function branchRelationKo(relation: BranchPairRelation): string {
  const list = branchRelationListKo(relation)
  return list.length > 0 ? list.join(' · ') : '특별한 합충 없음'
}

function elementListKo(list: FiveElement[]): string {
  return list.length > 0 ? list.map(elementKo).join('·') : '없음'
}

function stemKo(stem: StemInfo): string {
  return `${stem.hanja} (${stem.hangul})`
}

function branchKo(branch: BranchInfo): string {
  return `${branch.hanja} (${branch.hangul}·${branch.animal})`
}

/** 三九 relation names, Korean readings. */
const SUKUYOU_NAME_KO: Record<string, string> = {
  命: '명',
  業: '업',
  胎: '태',
  栄: '영',
  衰: '쇠',
  安: '안',
  危: '위',
  成: '성',
  壊: '괴',
  友: '우',
  親: '친',
}

const SUKUYOU_PAIR_KO: Record<string, string> = {
  命: '명 — 같은 자리, 거울 같은 사이',
  業胎: '업태 — 오래 이어진 인연의 사이',
  栄親: '영친 — 서로 살리고 북돋는 사이',
  友衰: '우쇠 — 벗처럼 편안한 사이',
  安壊: '안괴 — 강하게 끌리나 흔들리는 사이',
  危成: '위성 — 서로 자극하고 밀어붙이는 사이',
}

function sukuyouRelationKo(relation: SukuyouRelation): JsonObject {
  return {
    관계: `${relation.name} (${SUKUYOU_NAME_KO[relation.name] ?? relation.name})`,
    분류: SUKUYOU_PAIR_KO[relation.pair] ?? relation.pair,
  }
}

/* ------------------------------------------------------------------ */
/* Relation blocks (관계)                                              */
/* ------------------------------------------------------------------ */

export function sajuRelationChart(rel: SajuPairRelation): JsonObject {
  return {
    일간: {
      본인: stemKo(rel.dayStem.a),
      상대: stemKo(rel.dayStem.b),
      천간합: rel.dayStem.combination
        ? `합하여 ${elementKo(rel.dayStem.combination)} 기운을 이룸`
        : '합 없음',
      오행관계: PAIR_ELEMENT_RELATION_KO[rel.dayStem.elements],
    },
    일지: {
      본인: branchKo(rel.dayBranch.a),
      상대: branchKo(rel.dayBranch.b),
      관계: branchRelationKo(rel.dayBranch.relation),
    },
    띠지지: {
      본인: branchKo(rel.yearBranch.a),
      상대: branchKo(rel.yearBranch.b),
      관계: branchRelationKo(rel.yearBranch.relation),
    },
    오행보완: {
      본인에게없는기운: elementListKo(rel.complement.aMissing),
      상대가채워주는기운: elementListKo(rel.complement.filledByB),
      상대에게없는기운: elementListKo(rel.complement.bMissing),
      본인이채워주는기운: elementListKo(rel.complement.filledByA),
    },
  }
}

export function ziweiRelationChart(rel: ZiweiPairRelation): JsonObject {
  return {
    명궁지지: {
      본인: rel.ming.aBranch,
      상대: rel.ming.bBranch,
      관계: branchRelationKo(rel.ming.relation),
    },
    부부궁주성: {
      본인: rel.spouseMajorsA.length > 0 ? rel.spouseMajorsA : ['주성 없음(차성안궁)'],
      상대: rel.spouseMajorsB.length > 0 ? rel.spouseMajorsB : ['주성 없음(차성안궁)'],
    },
  }
}

function crossAspectKo(aspect: CrossAspect): JsonObject {
  return {
    본인행성: BODY_KO[aspect.a] ?? aspect.a,
    상대행성: BODY_KO[aspect.b] ?? aspect.b,
    각: ASPECT_KO[aspect.type] ?? aspect.type,
    오브: `${oneDecimal(aspect.orb)}도`,
  }
}

export function astroRelationChart(rel: AstroPairRelation): JsonObject {
  return {
    시나스트리: rel.aspects.map(crossAspectKo),
    전체각수: rel.totalAspects,
  }
}

export function numerologyRelationChart(rel: NumerologyPairRelation): JsonObject {
  return {
    라이프패스: { 본인: rel.lifePathA, 상대: rel.lifePathB },
    관계수: rel.relationshipNumber,
    개인연: {
      본인: rel.personalYearA,
      상대: rel.personalYearB,
      같은해: rel.personalYearA === rel.personalYearB,
    },
  }
}

export function nameRelationChart(rel: NamePairRelation): JsonObject {
  return {
    인격오행: {
      본인: elementKo(rel.inGyeok.aElement),
      상대: elementKo(rel.inGyeok.bElement),
      관계: PAIR_ELEMENT_RELATION_KO[rel.inGyeok.relation],
    },
    총격: {
      본인: { 수: rel.chongA.number, 길흉: rel.chongA.label, 키워드: rel.chongA.keyword },
      상대: { 수: rel.chongB.number, 길흉: rel.chongB.label, 키워드: rel.chongB.keyword },
    },
  }
}

export function ninestarRelationChart(rel: NineStarPairRelation): JsonObject {
  return {
    본명성: {
      본인: { 숫자: rel.a.number, 이름: rel.a.hangul, 오행: elementKo(rel.a.element) },
      상대: { 숫자: rel.b.number, 이름: rel.b.hangul, 오행: elementKo(rel.b.element) },
    },
    오행관계: PAIR_ELEMENT_RELATION_KO[rel.relation],
  }
}

export function sukuyouRelationChart(rel: SukuyouPairRelation): JsonObject {
  return {
    본인이본상대: sukuyouRelationKo(rel.fromA),
    상대가본본인: sukuyouRelationKo(rel.fromB),
    출전: '宿曜経 三九の秘法',
  }
}

/* ------------------------------------------------------------------ */
/* Custom side charts (astro / prism / ziwei need compat-specific ones)*/
/* ------------------------------------------------------------------ */

/**
 * Compact natal side for synastry. Houses only where the location is REAL
 * (person A); person B's chart runs on assumed coordinates, so house numbers
 * would be fabrication — they are omitted, and time-unknown charts have none.
 */
export function astroCompatSideChart(natal: NatalChart, includeHouses: boolean): JsonObject {
  const rows = Object.entries(natal.bodies).map(([key, position]) => {
    const row: JsonObject = {
      행성: BODY_KO[key] ?? key,
      별자리: SIGN_KO[position.sign] ?? position.sign,
      도수: `${oneDecimal(position.degreeInSign)}도`,
      역행: position.retrograde === true,
    }
    if (includeHouses && typeof position.house === 'number') row.하우스 = position.house
    return row
  })
  return {
    행성: rows,
    사원소: {
      불: natal.elementBalance.fire,
      흙: natal.elementBalance.earth,
      바람: natal.elementBalance.air,
      물: natal.elementBalance.water,
    },
  }
}

function prismSideKo(side: PrismPairSketch['a']): JsonObject {
  const cycle = PRISM_CYCLE_KO[side.annualCycle.name]
  return {
    계절: ELEMENT_KO[side.seasonElement] ?? side.seasonElement,
    요일: WEEKDAY_KO[side.weekday] ?? String(side.weekday),
    올해주기: cycle?.name ?? side.annualCycle.name,
  }
}

export function prismCompatChart(sketch: PrismPairSketch): JsonObject {
  return {
    구도: COMPAT_FRAME,
    관계: {
      공명지수: Math.round(sketch.anchorConcordance),
      공명풀이:
        sketch.anchorConcordance >= 67
          ? '결이 많이 겹침'
          : sketch.anchorConcordance >= 34
            ? '결이 부분적으로 겹침'
            : '결이 크게 다름',
      오행관계: {
        본인쪽에서: PRISM_RELATION_KO[sketch.relationForA] ?? sketch.relationForA,
        상대쪽에서: PRISM_RELATION_KO[sketch.relationForB] ?? sketch.relationForB,
      },
      올해주기일치: sketch.sameAnnualCycle,
    },
    본인: prismSideKo(sketch.a),
    상대: prismSideKo(sketch.b),
  }
}

export type ZiweiCompatSide = {
  wuXingJu: string | null
  mingBranch: string
  spouseMajors: string[]
  currentDaXian: { palaceName: string; ageFrom: number; ageTo: number } | null
}

export function ziweiCompatSideChart(side: ZiweiCompatSide): JsonObject {
  return {
    오행국: side.wuXingJu,
    명궁지지: side.mingBranch,
    부부궁주성: side.spouseMajors.length > 0 ? side.spouseMajors : ['주성 없음(차성안궁)'],
    대한: side.currentDaXian
      ? {
          궁: PALACE_KO[side.currentDaXian.palaceName] ?? side.currentDaXian.palaceName,
          나이대: `${side.currentDaXian.ageFrom}–${side.currentDaXian.ageTo}세`,
        }
      : null,
  }
}

/* ------------------------------------------------------------------ */
/* Assembly                                                            */
/* ------------------------------------------------------------------ */

/** Standard pair assembly: 관계 block + both side charts. */
export function pairChart(parts: { relation: JsonObject; a: JsonObject; b: JsonObject }): JsonObject {
  return {
    구도: COMPAT_FRAME,
    관계: parts.relation,
    본인: parts.a,
    상대: parts.b,
  }
}

/** Tzolkin: the tradition has no pair rule — say so, show both portraits. */
export function tzolkinCompatChart(a: JsonObject, b: JsonObject): JsonObject {
  return {
    구도: COMPAT_FRAME,
    안내:
      '마야 촐킨 전통에는 정해진 두 사람 궁합 규칙이 전해지지 않습니다. 두 초상을 나란히 놓고 각자의 기운이 만나는 장면을 읽되, 점수나 승패를 만들지 않습니다.',
    본인: a,
    상대: b,
  }
}

/** 육효 draw read for the relationship: 세효 = 본인, 응효 = 상대. */
export const ICHING_COMPAT_NOTE = '세효(世爻)는 본인, 응효(應爻)는 상대를 나타냅니다. 두 효의 육친·왕쇠와 상호 작용이 관계의 축입니다.'

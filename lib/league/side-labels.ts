import { isPropositionKind, sidePairForKind, type AnswerSide } from './answer-contract'
import type { PropositionKind } from './gateway/types'
import type { LeagueUiPack, SubjectOutcomeFamilyKey } from './i18n/dictionary'
import type { LeagueLocale } from './i18n/locales'
import type { DirectionTally, ModelSide, SideToken } from './card-types'
import { decodeAirankInstrument, isAirankInstrument, airankSubjectLabel } from './ai-ranking/instrument'
import { decodeSportsInstrument, opponentTeamOf } from './gateway/adapters/sports-catalog'
import { displaySportsTeam, drawOrLossLabel, sportsDrawPossible } from './sports-display'
import { techEventFromInstrument, techVerbPair } from './tech-labels'

export function iGa(name: string | null | undefined): '이' | '가' {
  if (!name || typeof name !== 'string' || name.length === 0) return '가'
  const last = name.charCodeAt(name.length - 1)
  if (last >= 0xac00 && last <= 0xd7a3) return (last - 0xac00) % 28 === 0 ? '가' : '이'
  return '가'
}

const AIRANK_SIDE_LABELS: Record<
  LeagueLocale,
  {
    rank1: { yes: string; no: string }
    topn: { yes: (n: string | number) => string; no: (n: string | number) => string }
    above: { a: (subject: string) => string; b: (param: string) => string }
  }
> = {
  ko: {
    rank1: { yes: '1위 함', no: '1위 못 함' },
    topn: { yes: (n) => `${n}위 안`, no: (n) => `${n}위 밖` },
    above: { a: (s) => `${s}${iGa(s)} 위`, b: (p) => `${p}${iGa(p)} 위` },
  },
  en: {
    rank1: { yes: '#1', no: 'Not #1' },
    topn: { yes: (n) => `Top ${n}`, no: (n) => `Outside top ${n}` },
    above: { a: (s) => `${s} ahead`, b: (p) => `${p} ahead` },
  },
  ja: {
    rank1: { yes: '1位達成', no: '1位ならず' },
    topn: { yes: (n) => `${n}位以内`, no: (n) => `${n}位圏外` },
    above: { a: (s) => `${s}が上位`, b: (p) => `${p}が上位` },
  },
  'zh-TW': {
    rank1: { yes: '第1名', no: '未獲第1' },
    topn: { yes: (n) => `前${n}名`, no: (n) => `前${n}名以外` },
    above: { a: (s) => `${s}領先`, b: (p) => `${p}領先` },
  },
  fr: {
    rank1: { yes: '1ère place', no: 'Pas 1er' },
    topn: { yes: (n) => `Top ${n}`, no: (n) => `Hors top ${n}` },
    above: { a: (s) => `${s} devant`, b: (p) => `${p} devant` },
  },
  es: {
    rank1: { yes: 'N.° 1', no: 'No n.° 1' },
    topn: { yes: (n) => `Top ${n}`, no: (n) => `Fuera del top ${n}` },
    above: { a: (s) => `${s} arriba`, b: (p) => `${p} arriba` },
  },
  pt: {
    rank1: { yes: '1º lugar', no: 'Não fica em 1º' },
    topn: { yes: (n) => `Top ${n}`, no: (n) => `Fora do top ${n}` },
    above: { a: (s) => `${s} à frente`, b: (p) => `${p} à frente` },
  },
  ar: {
    rank1: { yes: 'المركز الأول', no: 'ليس الأول' },
    topn: { yes: (n) => `ضمن أفضل ${n}`, no: (n) => `خارج أفضل ${n}` },
    above: { a: (s) => `${s} في المقدمة`, b: (p) => `${p} في المقدمة` },
  },
}

/**
 * AI Prediction League — THE side-label resolver (pure, client-safe).
 *
 * Every rendered side WORD and GLYPH derives from the round's
 * (proposition_kind, subject_label, side) through this module — never from
 * the stored token alone, and never from per-surface word tables. This is the
 * ONE place the three contracts' vocabularies meet the eight locales:
 *
 *   binary_close_higher    up|down      오른다/내린다, ▲/▼  (byte-identical to
 *                                       the pre-resolver dictionary fields —
 *                                       proven by the 71aedfd3 frozen-fixture
 *                                       parity test)
 *   binary_subject_outcome yes|no       "{subject} 승" / "{opponent} 승" (or "{subject} 패"),
 *                                       domain pair from the round's category
 *                                       (승/패, 당선/낙선, 수상/불발); sports tiles hide Y/N
 *   binary_threshold       above|below  상회/하회 (+ threshold when the round
 *                                       carries one), glyphs >/<
 *
 * GLYPH LAW (2026-08-24, extended 2026-08-31): a number on screen must be
 * unambiguously a SIDE count or a HIT count from its glyph alone. Hit counts
 * always carry ✓ and a total; side counts never use a slash-over-total and
 * never use ✓/✗. Each kind gets its own glyph pair so a side glyph can also
 * never impersonate another contract's answer: ▲▼ are price-only, Y/N are the
 * yes|no token initials (language-neutral by the same convention that keeps
 * ▲▼ untranslated), >/< read as above/below the stated line. '■' stays the
 * legacy-flat glyph and '–' the no-answer glyph, kind-independent.
 *
 * The QUALIFIER stays out of this module entirely: magnitude/scoreline/margin
 * rendering lives with the surfaces (as decoration next to a side badge) and
 * never enters a side label, a hit fraction, or a ✓/✗ mark.
 */

/** Legacy-flat and no-answer glyphs — kind-independent, historical. */
const FLAT_GLYPH = '\u25a0' // ■
const NO_CALL_GLYPH = '\u2013' // –

/** Per-kind side-A/side-B glyph pairs. ▲▼ byte-identical for price rounds. */
export const KIND_GLYPHS: Record<PropositionKind, readonly [string, string]> = {
  binary_close_higher: ['\u25b2', '\u25bc'], // ▲ ▼
  binary_subject_outcome: ['Y', 'N'],
  binary_threshold: ['>', '<'],
}

/**
 * Outcome-word family for binary_subject_outcome, derived from the round's
 * own persisted category — the adapter picked that category, so the pair is
 * still round-supplied, resolved per locale as an i18n key (never stored as
 * display text on the round).
 */
export type SubjectOutcomeFamily = SubjectOutcomeFamilyKey

export function subjectOutcomeFamily(category: string | null | undefined): SubjectOutcomeFamily {
  switch (category) {
    case 'sports':
      return 'win'
    case 'politics_election':
      return 'elected'
    case 'entertainment':
      return 'awarded'
    case 'real_estate':
      return 'indexRise'
    case 'tech':
      return 'achieved'
    default:
      return 'achieved'
  }
}

/**
 * THE token gate every read path uses (replaces the four per-file
 * `toDirection` copies that narrowed yes/no/above/below to null — which is
 * what made a subject-outcome round render as 40 abstentions). Passes every
 * valid contract side token through; keeps legacy 'flat' as its own value;
 * null ONLY for null/garbage — i.e. only a genuine no-answer is a no-answer.
 */
export function toSideToken(raw: string | null | undefined): ModelSide | null {
  switch (raw) {
    case 'up':
    case 'down':
    case 'yes':
    case 'no':
    case 'above':
    case 'below':
    case 'flat':
      return raw
    default:
      return null
  }
}

/**
 * A stored side that may appear on tiles and in camp/tier/book/weights
 * aggregates. Null, blank, garbage, and legacy `flat` are excluded — the
 * two-answers law never renders "no opinion".
 */
export function hasCallableSide(side: ModelSide | string | null | undefined): boolean {
  const slot = tallySlotOfToken(toSideToken(side))
  return slot === 'up' || slot === 'down'
}

/**
 * Token → tally slot WITHOUT round context. Sound because side tokens are
 * contract-exclusive and side A is always the pair's first token (up / yes /
 * above — see `answer-contract.ts`). This is what lets `DirectionTally`
 * (whose field names are the historical up/down slots) stay wire-compatible
 * while counting any contract's rows. null = no answer.
 */
export function tallySlotOfToken(side: ModelSide | null): 'up' | 'down' | 'flat' | null {
  switch (side) {
    case 'up':
    case 'yes':
    case 'above':
      return 'up'
    case 'down':
    case 'no':
    case 'below':
      return 'down'
    case 'flat':
      return 'flat'
    default:
      return null
  }
}

/** The round fields the resolver reads. Subset of `CardRoundMeta` — also satisfied by raw DB rows. */
export type SideRoundContext = {
  proposition_kind?: string | null
  subject_label?: string | null
  category?: string | null
  instrument?: string | null
}

/** The round's own side pair, [side A, side B]. Unknown/legacy kind → up/down. */
export function sidePairOf(round: SideRoundContext): readonly [AnswerSide, AnswerSide] {
  return sidePairForKind(propositionKindOf(round))
}

/**
 * Which tally slot a row's side lands in for THIS round's contract:
 * 'a' = first token of the pair (up/yes/above), 'b' = second, 'flat' = the
 * grandfathered legacy value, 'none' = no answer or a token from a different
 * contract (defensive: cross-contract tokens must never masquerade as sides).
 */
export type SideSlot = 'a' | 'b' | 'flat' | 'none'

export type SideLabels = {
  kind: PropositionKind
  /** The contract's two side tokens, in pair order [side A, side B]. */
  sides: readonly [AnswerSide, AnswerSide]
  /** Side-A/side-B glyph pair for compact tallies and distribution legends. */
  glyphs: readonly [string, string]
  /** Tally slot of a stored side value under this round's contract. */
  slot: (side: ModelSide | null) => SideSlot
  /** Short badge word for a model row / legend, e.g. 상승 · 승 · 상회. */
  badge: (side: ModelSide | null) => string
  /** Row glyph: side A/B glyph, ■ for legacy flat, – for no answer. */
  glyph: (side: ModelSide | null) => string
  /** Hero answer phrase, subject-aware, e.g. 오른다 · "맨유 승" · "3.4% 상회". */
  answer: (side: SideToken) => string
  /** Lowercase word for tally sentences (groupTallyLine style). */
  tallyWord: (side: ModelSide | null) => string
  /**
   * Sports win/lose (and any subject-outcome row that names WHO). Tiles and
   * the hero then show the named badge instead of a bare Y/N glyph.
   */
  namedSides: boolean
}

/** Narrow a persisted kind; unknown/legacy → close_higher (a fact — every pre-kind round is a price round). */
export function propositionKindOf(round: SideRoundContext): PropositionKind {
  return isPropositionKind(round.proposition_kind) ? round.proposition_kind : 'binary_close_higher'
}

/**
 * Build the label set every surface renders from. ONE resolver — components
 * never assemble side words themselves (same architecture as
 * `lib/league/compliance.ts` for directional sentences).
 */
function airankSideSubject(subjectOrParam: string, locale: LeagueLocale): string {
  const norm = subjectOrParam.trim()
  if (locale === 'ko') {
    if (norm.toLowerCase() === 'anthropic') return '앤트로픽'
    if (norm.toLowerCase() === 'openai') return '오픈AI'
    if (norm.toLowerCase() === 'google') return '구글'
    if (norm.toLowerCase() === 'meta') return '메타'
  }
  return norm
}

export function sideLabelsFor(
  round: SideRoundContext,
  t: LeagueUiPack,
  locale: LeagueLocale = 'en',
): SideLabels {
  const kind = propositionKindOf(round)
  const sides = sidePairForKind(kind)
  const glyphs = KIND_GLYPHS[kind]

  const slot = (side: ModelSide | null): SideSlot => {
    if (side === null) return 'none'
    if (side === 'flat') return 'flat'
    const tokenSlot = tallySlotOfToken(side)
    if (tokenSlot === 'up') return 'a'
    if (tokenSlot === 'down') return 'b'
    return 'none'
  }

  const glyph = (side: ModelSide | null): string => {
    const s = slot(side)
    if (s === 'a') return glyphs[0]
    if (s === 'b') return glyphs[1]
    if (s === 'flat') return FLAT_GLYPH
    return NO_CALL_GLYPH
  }

  if (kind === 'binary_subject_outcome') {
    if (round.category === 'ai_models' || (round.instrument && isAirankInstrument(round.instrument))) {
      const parts = round.instrument ? decodeAirankInstrument(round.instrument) : null
      const pack = AIRANK_SIDE_LABELS[locale] ?? AIRANK_SIDE_LABELS.en
      let yesWord = pack.rank1.yes
      let noWord = pack.rank1.no
      let named = false

      if (parts?.kind === 'brand_table') {
        const tableWord =
          locale === 'ko' ? '순위표' : locale === 'ja' ? '順位表' : locale === 'zh-TW' ? '排名表' : 'Top 5'
        const badge = (side: ModelSide | null): string => (slot(side) === 'a' ? tableWord : t.direction.noCallBadge)
        return {
          kind,
          sides,
          glyphs,
          slot,
          glyph,
          badge,
          answer: () => tableWord,
          tallyWord: (side) => (slot(side) === 'none' ? t.direction.noCallTally : tableWord),
          namedSides: true,
        }
      }
      if (parts?.kind === 'brand_above') {
        const subject = airankSideSubject(parts.subject, locale)
        const other = airankSideSubject(parts.param ?? '', locale)
        yesWord = pack.above.a(subject)
        noWord = pack.above.b(other)
        named = true
      } else if (parts?.kind === 'brand_topn' || parts?.kind === 'camp_topn') {
        const n = parts.param ?? '3'
        yesWord = pack.topn.yes(n)
        noWord = pack.topn.no(n)
      } else {
        yesWord = pack.rank1.yes
        noWord = pack.rank1.no
      }

      const badge = (side: ModelSide | null): string => {
        const s = slot(side)
        if (s === 'a') return yesWord
        if (s === 'b') return noWord
        return t.direction.noCallBadge
      }
      return {
        kind,
        sides,
        glyphs,
        slot,
        glyph,
        badge,
        answer: (side) => (side === 'yes' ? yesWord : noWord),
        tallyWord: (side) => (slot(side) === 'none' ? t.direction.noCallTally : badge(side)),
        namedSides: named,
      }
    }

    const techEvent = round.category === 'tech' ? techEventFromInstrument(round.instrument) : null
    if (techEvent) {
      const verbs = techVerbPair(techEvent, locale)
      const yesWord = verbs.yes
      const noWord = verbs.no
      const badge = (side: ModelSide | null): string => {
        const s = slot(side)
        if (s === 'a') return yesWord
        if (s === 'b') return noWord
        return t.direction.noCallBadge
      }
      return {
        kind,
        sides,
        glyphs,
        slot,
        glyph,
        badge,
        answer: (side) => (side === 'yes' ? yesWord : noWord),
        tallyWord: (side) => (slot(side) === 'none' ? t.direction.noCallTally : badge(side)),
        namedSides: true,
      }
    }

    const family = subjectOutcomeFamily(round.category)
    const pair = t.sides.subjectOutcome[family]
    const rawSubject = round.subject_label?.trim() || null
    const sports = round.category === 'sports' ? decodeSportsInstrument(round.instrument) : null
    const subject = rawSubject ? displaySportsTeam(rawSubject, locale, 'short') : null
    const opponentRaw = sports ? opponentTeamOf(sports) : null
    const opponent = opponentRaw ? displaySportsTeam(opponentRaw, locale, 'short') : null
    const named = Boolean(subject)
    const drawPossible = Boolean(sports && sportsDrawPossible(sports.league))
    const yesWord = subject ? pair.answer.yes(subject) : pair.badge.yes
    const noWord = drawPossible && subject
      ? drawOrLossLabel(subject, locale)
      : subject && opponent
        ? pair.answer.yes(opponent)
        : subject
          ? pair.answer.no(subject)
          : pair.badge.no
    const badge = (side: ModelSide | null): string => {
      const s = slot(side)
      if (s === 'a') return yesWord
      if (s === 'b') return noWord
      return t.direction.noCallBadge
    }
    return {
      kind,
      sides,
      glyphs,
      slot,
      glyph,
      badge,
      answer: (side) => (side === 'yes' ? yesWord : noWord),
      tallyWord: (side) => (slot(side) === 'none' ? t.direction.noCallTally : badge(side)),
      namedSides: named,
    }
  }

  if (kind === 'binary_threshold') {
    const threshold = round.subject_label?.trim() || null
    const badge = (side: ModelSide | null): string => {
      const s = slot(side)
      if (s === 'a') return t.sides.threshold.badge.above
      if (s === 'b') return t.sides.threshold.badge.below
      return t.direction.noCallBadge
    }
    return {
      kind,
      sides,
      glyphs,
      slot,
      glyph,
      badge,
      answer: (side) =>
        side === 'above' ? t.sides.threshold.answer.above(threshold) : t.sides.threshold.answer.below(threshold),
      tallyWord: (side) => (slot(side) === 'none' ? t.direction.noCallTally : badge(side)),
      namedSides: false,
    }
  }

  // binary_close_higher — the historical fields, verbatim, so every price
  // surface stays byte-identical (direction.badge/tally, hero.answerVerb).
  return {
    kind,
    sides,
    glyphs,
    slot,
    glyph,
    badge: (side) => {
      const s = slot(side)
      if (s === 'a') return t.direction.badge.up
      if (s === 'b') return t.direction.badge.down
      if (s === 'flat') return t.direction.badge.flat
      return t.direction.noCallBadge
    },
    answer: (side) => t.hero.answerVerb[side === 'up' ? 'up' : 'down'],
    tallyWord: (side) => {
      const s = slot(side)
      if (s === 'a') return t.direction.tally.up
      if (s === 'b') return t.direction.tally.down
      if (s === 'flat') return t.direction.tally.flat
      return t.direction.noCallTally
    },
    namedSides: false,
  }
}

/** Compact division/hero count. Named sports sides print WHO, not Y/N. */
export function compactSideTally(tally: DirectionTally, labels: SideLabels, t: LeagueUiPack): string {
  if (labels.namedSides) {
    const parts = [
      `${tally.up} ${labels.tallyWord(labels.sides[0])}`,
      `${tally.down} ${labels.tallyWord(labels.sides[1])}`,
    ]
    if (tally.flat) parts.push(`${tally.flat}\u25a0`)
    if (tally.abstain) parts.push(`${tally.abstain}\u2013`)
    return parts.join(' · ')
  }
  return t.bracket.compactTally(tally, labels.glyphs)
}


/**
 * Subjective success ("대박/흥행/1등/상") → objective metric picks.
 * Pure. Never grades the word 대박 itself.
 */

import { MAX_TARGET_PICKS, type TargetSearchResult } from '../target-resolve'
import {
  CHART_ARTISTS,
  ENTERTAINMENT_SLATE,
  PAST_SHOWS,
  withinShowHorizon,
  type ShowMetric,
} from '../../entertainment/slate'
import { instrumentForMetric, showChipLabel } from './entertainment-catalog'

const PRIVATE =
  /이혼|마약|열애|고소|사망|불륜|스캔들|임신|구속|divorce|arrested|dating rumor/i
const SUBJECTIVE = /재밌|재미있|명작|평점\s*좋|걸작|worth watching|good movie|fun movie/i
const SUCCESS = /대박|흥행|1등|1위|상\s*받|수상|오스카|그래미|에미|청룡|백상|박스오피스|box office|chart/i
const STREAM = /오징어\s*게임|squid game|넷플릭스\s*1위|netflix\s*(global\s*)?#?1/i
const CHART_WORD = /멜론|빌보드|써클|오리콘|hot\s*100|melon|billboard|oricon|circle chart/i

function norm(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim()
}

function aliasHit(text: string, aliases: readonly string[]): boolean {
  const hay = norm(text)
  return aliases.some((alias) => {
    const needle = norm(alias)
    return needle.length >= 2 && hay.includes(needle)
  })
}

function nextChartClose(now: Date, venue: 'melon' | 'billboard' | 'circle' | 'oricon'): string {
  const day = venue === 'billboard' ? 2 : 1 // Tue Billboard publish, Mon KR/JP
  const cursor = new Date(now.getTime())
  cursor.setUTCHours(6, 0, 0, 0)
  for (let i = 1; i <= 10; i += 1) {
    const next = new Date(cursor.getTime() + i * 86_400_000)
    if (next.getUTCDay() === day) return next.toISOString()
  }
  return new Date(now.getTime() + 7 * 86_400_000).toISOString()
}

function chartMetrics(subject: string, now: Date): ShowMetric[] {
  const venues = [
    ['melon', '멜론'],
    ['billboard', '빌보드'],
    ['circle', '써클'],
    ['oricon', '오리콘'],
  ] as const
  return venues.map(([venue]) => ({
    kind: 'chart' as const,
    venue,
    event: 'weekly_1',
    subject,
    resolvesAtIso: nextChartClose(now, venue),
    aliases: [subject],
    marketPct: null,
  }))
}

function picksFor(rows: readonly ShowMetric[]): TargetSearchResult {
  const options = []
  const seen = new Set<string>()
  for (const row of rows) {
    const id = instrumentForMetric(row)
    if (!id || seen.has(id)) continue
    seen.add(id)
    options.push({ id, label: showChipLabel(row) })
    if (options.length >= MAX_TARGET_PICKS) break
  }
  if (options.length === 0) return { kind: 'unsupported' }
  if (options.length === 1) {
    return { kind: 'ready', entityId: options[0]!.id, label: options[0]!.label, skipConfirm: true }
  }
  return { kind: 'picks', options }
}

function rowsForTitle(text: string, pool: readonly ShowMetric[]): ShowMetric[] {
  return pool.filter((row) => aliasHit(text, [row.subject, ...row.aliases]))
}

export function resolveEntertainmentTarget(
  raw: string,
  slate: readonly ShowMetric[],
  now: Date,
): TargetSearchResult {
  const text = raw.trim()
  if (!text) return { kind: 'vague' }
  if (PRIVATE.test(text)) return { kind: 'unsupported' }
  if (STREAM.test(text)) return { kind: 'unsupported' }
  if (SUBJECTIVE.test(text) && !SUCCESS.test(text) && !CHART_WORD.test(text)) return { kind: 'vague' }

  const window = slate.filter((row) => withinShowHorizon(Date.parse(row.resolvesAtIso), now))
  const upcoming = rowsForTitle(text, window)
  const past = rowsForTitle(text, PAST_SHOWS)

  const artist = CHART_ARTISTS.find((row) => aliasHit(text, row.aliases))
  const wantsChart = CHART_WORD.test(text) || (artist && SUCCESS.test(text))
  const wantsAward = /오스카|그래미|에미|청룡|백상|tga|게임\s*어워드|올해의\s*게임|oscar|grammy|emmy/i.test(text)

  if (artist && wantsChart) {
    const charts = chartMetrics(artist.subject, now).filter((row) => {
      if (/멜론|melon/i.test(text)) return row.venue === 'melon'
      if (/빌보드|billboard|hot\s*100/i.test(text)) return row.venue === 'billboard'
      if (/써클|circle/i.test(text)) return row.venue === 'circle'
      if (/오리콘|oricon/i.test(text)) return row.venue === 'oricon'
      return row.venue === 'melon' || row.venue === 'billboard'
    })
    return picksFor(charts)
  }

  if (upcoming.length > 0) {
    const narrowed = wantsAward ? upcoming.filter((row) => row.kind === 'award') : upcoming
    const pool = narrowed.length > 0 ? narrowed : upcoming
    const specific = pool.filter((row) => {
      if (/첫\s*주말|1위|opening/i.test(text) && row.event === 'opening_1') return true
      if (/만\s*관객|돌파|admissions/i.test(text) && row.event.startsWith('admissions_')) return true
      return false
    })
    return picksFor(specific.length > 0 ? specific : pool)
  }

  if (past.length > 0 && upcoming.length === 0) return { kind: 'past' }

  if (wantsAward) {
    const ceremony = /오스카|oscar/i.test(text)
      ? 'oscars'
      : /그래미|grammy/i.test(text)
        ? 'grammy'
        : /에미|emmy/i.test(text)
          ? 'emmy'
          : /청룡/i.test(text)
            ? 'blue_dragon'
            : /백상/i.test(text)
              ? 'baeksang'
              : 'tga'
    const awards = window.filter((row) => row.kind === 'award' && row.venue === ceremony)
    if (awards.length === 0) return { kind: 'unsupported' }
    return picksFor(awards)
  }

  if (SUCCESS.test(text) || CHART_WORD.test(text) || text.length < 12) return { kind: 'vague' }
  return { kind: 'vague' }
}

export function entertainmentSlate(): readonly ShowMetric[] {
  return ENTERTAINMENT_SLATE
}

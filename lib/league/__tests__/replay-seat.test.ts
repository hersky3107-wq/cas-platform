import { createElement } from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ReplayTrackTables } from '../../../components/admin/ReplayTrackTables'
import { ExtraCompare } from '../../../components/league/ExtraCompare'
import { ModelTile } from '../../../components/league/ModelTile'
import { parseBrandTablePick } from '../ai-ranking/brand-table'
import { buildCardData, type PredictionRow, type RoundRow } from '../card-aggregate'
import { buildExtraCompareView } from '../extra-compare'
import {
  computeLessonStats,
  lessonNoteTemplate,
  noteNumbersAreGrounded,
  resolvePhrasedNote,
  type LessonSourceRound,
} from '../extra/lesson-stats'
import {
  APPLIED_LESSON_MAX_WORDS,
  REPLAY_MODEL_OVERRIDE,
  REPLAY_TIMEOUT_MS,
  appliedLessonFromText,
  assertReplayInputShape,
  buildReplaySystemPrompt,
  buildReplayUserPrompt,
  clipAppliedLesson,
  normalizePickProbability,
  parseReplayOutput,
  type ReplayLeagueInput,
} from '../extra/replay'
import { getLeagueUiPack } from '../i18n/dictionary'
import { lookupRosterDisplay } from '../roster'
import { sideLabelsFor } from '../side-labels'

function lessonRound(over: Partial<LessonSourceRound> = {}): LessonSourceRound {
  return {
    category: 'stock',
    horizon: '1d',
    instrument: 'AAPL',
    openedAt: '2026-10-01T00:00:00.000Z',
    gradingStatus: 'graded',
    unresolvableReason: null,
    actualOutcome: 'up',
    consensusIsCorrect: true,
    majorityDirection: 'up',
    aggregateDirection: 'up',
    aggregateProbability: 72,
    majoritySharePct: 90,
    extras: { replay: true, crow: false, consensus: true, history: true, sentiment: false, divination: true },
    ...over,
  }
}

function replayInput(over: Partial<ReplayLeagueInput> = {}): ReplayLeagueInput {
  return {
    proposition: 'Will AAPL close higher?',
    instrument: 'AAPL',
    horizon: '1d',
    category: 'stock',
    subjectName: 'Apple',
    propositionKind: 'close_higher',
    packet: 'CLOSED BOOK FACTS ONLY',
    categoryNote: '채점 8라운드. AI 종합 적중 5/8.',
    globalNote: 'Graded rounds 20. AI ensemble hits 11/20.',
    ownHistory: [{ proposition: 'Will NVDA close higher?', side: 'up', correct: false, date: '2026-09-28' }],
    ...over,
  }
}

function cardRound(): RoundRow {
  return {
    id: 'round-replay',
    proposition_text: 'Will AAPL close higher 24h from now?',
    category: 'stock',
    color_bucket: 'green',
    instrument: 'AAPL',
    horizon: '1d',
    resolution_rule: 'NASDAQ regular-session close',
    resolves_at: '2026-10-06T15:31:00.000Z',
    opened_at: '2026-10-05T21:30:00.000Z',
    actual_outcome: null,
    resolved_at: null,
  }
}

function pred(overrides: Partial<PredictionRow>): PredictionRow {
  return {
    model_id: 'gpt-5.6-sol',
    brand: 'OpenAI',
    camp: 'us',
    league_tier: 'premier',
    predicted_direction: 'up',
    predicted_value: 70,
    reasoning_snippet: 'packet only',
    is_correct: null,
    cost_usd: 0.01,
    predicted_at: '2026-10-05T21:31:00.000Z',
    ...overrides,
  }
}

describe('lesson stats', () => {
  it('drops voided rounds and legacy same-day windows', () => {
    const stats = computeLessonStats([
      lessonRound(),
      lessonRound({ gradingStatus: 'voided', instrument: 'VOID', consensusIsCorrect: false }),
      lessonRound({
        unresolvableReason: 'legacy_same_day_window',
        instrument: 'LEGACY',
        consensusIsCorrect: false,
        actualOutcome: 'down',
      }),
      lessonRound({ gradingStatus: 'pending', instrument: 'OPEN' }),
    ])
    expect(stats.n).toBe(1)
    expect(stats.outcomeFrequencies).toEqual({ up: 1 })
    expect(stats.aiOverall).toEqual({ hits: 1, n: 1 })
    expect(stats.last5Wrong).toEqual([])
    expect(stats.extras.replay).toEqual({ hits: 1, n: 1 })
    expect(stats.replay).toEqual({ hits: 1, n: 1 })
  })

  it('bands confidence and majority share, and scores disagreement', () => {
    const stats = computeLessonStats([
      lessonRound({ aggregateProbability: 55, majoritySharePct: 88, consensusIsCorrect: true }),
      lessonRound({ aggregateProbability: 64, majoritySharePct: 74, consensusIsCorrect: false, openedAt: '2026-10-02T00:00:00.000Z', instrument: 'MSFT' }),
      lessonRound({
        aggregateProbability: 81,
        majoritySharePct: 60,
        consensusIsCorrect: false,
        majorityDirection: 'up',
        aggregateDirection: 'down',
        actualOutcome: 'up',
        openedAt: '2026-10-03T00:00:00.000Z',
        instrument: 'NVDA',
      }),
    ])
    expect(stats.byConfidenceBand['50-59']).toEqual({ hits: 1, n: 1 })
    expect(stats.byConfidenceBand['60-69']).toEqual({ hits: 0, n: 1 })
    expect(stats.byConfidenceBand['70+']).toEqual({ hits: 0, n: 1 })
    expect(stats.byMajorityShare.gte85).toEqual({ hits: 1, n: 1 })
    expect(stats.byMajorityShare.band70).toEqual({ hits: 0, n: 1 })
    expect(stats.byMajorityShare.lt70).toEqual({ hits: 0, n: 1 })
    expect(stats.disagreement).toEqual({ n: 1, majorityRight: 1, aggregateRight: 0 })
    expect(stats.extras.crow).toEqual({ hits: 0, n: 3 })
    expect(stats.last5Wrong.map((row) => row.instrument)).toEqual(['NVDA', 'MSFT'])
  })

  it('keeps only the five newest AI-종합 misses', () => {
    const wrong = Array.from({ length: 6 }, (_, i) =>
      lessonRound({
        instrument: `T${i}`,
        openedAt: `2026-10-0${i + 1}T00:00:00.000Z`,
        consensusIsCorrect: false,
        majorityDirection: 'down',
        actualOutcome: 'up',
      }),
    )
    const stats = computeLessonStats(wrong)
    expect(stats.last5Wrong).toHaveLength(5)
    expect(stats.last5Wrong[0]).toMatchObject({ instrument: 'T5', majoritySide: 'down', actual: 'up' })
    expect(stats.last5Wrong.map((row) => row.instrument)).not.toContain('T0')
  })
})

describe('lesson note phrasing', () => {
  it('omits n < 3, prefixes n < 5, and rejects numbers that are not in the stats', () => {
    const thin = computeLessonStats([lessonRound(), lessonRound({ instrument: 'MSFT' })])
    expect(thin.n).toBe(2)
    expect(lessonNoteTemplate(thin, 'ko')).toBe('')
    expect(lessonNoteTemplate(thin, 'en')).toBe('')

    const four = computeLessonStats([
      lessonRound(),
      lessonRound({ instrument: 'MSFT', openedAt: '2026-10-02T00:00:00.000Z' }),
      lessonRound({ instrument: 'NVDA', openedAt: '2026-10-03T00:00:00.000Z' }),
      lessonRound({ instrument: 'AMD', openedAt: '2026-10-04T00:00:00.000Z', consensusIsCorrect: false }),
    ])
    expect(four.n).toBe(4)
    expect(lessonNoteTemplate(four, 'ko')).toContain('참고(표본 4)')
    expect(noteNumbersAreGrounded(lessonNoteTemplate(four, 'ko'), four)).toBe(true)
    expect(noteNumbersAreGrounded('적중률 99%', four)).toBe(false)

    const invented = { ko: '적중 99', en: 'hits 99' }
    const grounded = { ko: lessonNoteTemplate(four, 'ko'), en: lessonNoteTemplate(four, 'en') }
    expect(resolvePhrasedNote(four, [invented, grounded])).toEqual(grounded)
    expect(resolvePhrasedNote(four, [invented, invented])).toEqual(grounded)
    expect(resolvePhrasedNote(thin, [grounded])).toEqual({ ko: '', en: '' })
  })
})

describe('replay seat isolation', () => {
  it('refuses other-seat outputs and keeps the applied lesson off the public rationale', () => {
    expect(() => assertReplayInputShape({ ...replayInput(), otherSeats: ['crow said down'] })).toThrow(/otherSeats/)
    const prompt = buildReplayUserPrompt(replayInput())
    expect(prompt).toContain('CLOSED BOOK FACTS ONLY')
    expect(prompt).toContain('채점 8라운드')
    expect(prompt).toContain('Will NVDA close higher?')
    expect(prompt).not.toMatch(/crow|divination|sentiment|consensus seat/i)
    const system = buildReplaySystemPrompt(false)
    expect(system).toContain('Never name another seat')
    expect(system).toContain('applied_lesson')
    expect(system).toContain('50–100')

    const parsed = parseReplayOutput(
      '{"direction":"up","probability":62,"rationale":"packet leans up","applied_lesson":"one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twentyone twentytwo twentythree twentyfour twentyfive twentysix"}',
    )
    expect(parsed?.verdict).toBe('up')
    expect(parsed?.confidence).toBe(62)
    expect(parsed?.rationale).toBe('packet leans up')
    expect(parsed?.appliedLesson?.split(/\s+/)).toHaveLength(APPLIED_LESSON_MAX_WORDS)
    expect(parsed?.rationale).not.toContain('twentysix')

    const runSrc = readFileSync(resolve('lib/league/extra/run.ts'), 'utf8')
    const history = runSrc.slice(runSrc.indexOf('async function loadReplayHistory'))
    expect(history).toContain(".eq('model_id', 'replay')")
    expect(runSrc).toContain("provider: 'anthropic'")
    expect(runSrc).toContain('modelOverride: REPLAY_MODEL_OVERRIDE')
    expect(runSrc).toContain('timeoutMs: REPLAY_TIMEOUT_MS')
    expect(REPLAY_MODEL_OVERRIDE).toBe('claude-opus-5-5')
    expect(REPLAY_TIMEOUT_MS).toBe(150_000)
    const cardSrc = readFileSync(resolve('lib/league/card.ts'), 'utf8')
    const publicCols = cardSrc.slice(cardSrc.indexOf('const PREDICTION_COLUMNS ='), cardSrc.indexOf('const PREDICTION_COLUMNS_ADMIN'))
    expect(publicCols).not.toContain('applied_lesson')
  })

  it('picks a brand-table #1 and flips a sub-50 probability onto the chosen side', () => {
    const picked = parseBrandTablePick(
      '{"pick":"OpenAI","probability":22,"rationale":"first on the list","applied_lesson":"thin sample"}',
      ['OpenAI', 'Google'],
    )
    expect(picked).toMatchObject({ ok: true, pick: 'OpenAI', probability: 22 })
    expect(normalizePickProbability(22)).toEqual({ probability: 78, probabilityFlipped: true })
    expect(appliedLessonFromText('{"pick":"OpenAI","applied_lesson":"thin sample"}')).toBe('thin sample')
    expect(clipAppliedLesson('thin sample')).toBe('thin sample')
    expect(buildReplaySystemPrompt(true)).toContain('#1 brand')
  })
})

describe('replay card and admin', () => {
  it('shows Claude Opus 5.5 on the tile and includes 복기 in the extra comparison', () => {
    expect(lookupRosterDisplay('replay')).toEqual({ brand: '🧠 복기', model_id: 'Claude Opus 5.5' })
    const t = getLeagueUiPack('ko')
    const card = buildCardData(cardRound(), [
      pred({}),
      pred({
        model_id: 'replay',
        brand: '🧠 복기',
        camp: 'other',
        league_tier: 'extra',
        predicted_direction: 'down',
        predicted_value: 64,
        reasoning_snippet: 'packet leans down',
      }),
    ])
    const tile = card.models.find((model) => model.model_id === 'replay')
    expect(tile?.model_identifier).toBe('Claude Opus 5.5')
    const html = renderToStaticMarkup(createElement(ModelTile, { model: tile!, t, labels: sideLabelsFor(card.round, t) }))
    expect(html).toContain('Claude Opus 5.5')
    expect(html).not.toContain('적용한 교훈')

    const compare = renderToStaticMarkup(
      createElement(ExtraCompare, {
        models: card.models,
        consensus: card.consensus,
        t,
        labels: sideLabelsFor(card.round, t),
      }),
    )
    expect(compare).toContain('data-extra-seat="replay"')
    expect(compare).toContain('복기 · Claude Opus 5.5')
    expect(compare).toContain('엑스트라 vs 40 AI')
    const view = buildExtraCompareView(card.models, card.consensus)
    expect(view.seats.find((seat) => seat.id === 'replay')?.vsCrowd).toBe('diverge')
  })

  it('renders 복기 vs AI 종합 with n and the per-round Opus cost', () => {
    const html = renderToStaticMarkup(
      createElement(ReplayTrackTables, {
        cells: [
          {
            category: 'stock',
            horizon: '1d',
            n: 8,
            replayHits: 2,
            replayN: 3,
            ensembleHits: 1,
            ensembleN: 4,
          },
        ],
        costs: [{ roundId: 'r1', instrument: 'AAPL', promptTokens: 1200, completionTokens: 80, costUsd: 0.024 }],
      }),
    )
    expect(html).toContain('data-testid="replay-vs-ensemble"')
    expect(html).toContain('복기 vs AI 종합')
    expect(html).toContain('stock')
    expect(html).toContain('1d')
    expect(html).toContain('2/3')
    expect(html).toContain('1/4')
    expect(html).toContain('>8<')
    expect(html).toContain('data-testid="replay-costs"')
    expect(html).toContain('AAPL')
    expect(html).toContain('1200')
    expect(html).toContain('80')
    expect(html).toContain('0.024')
  })
})

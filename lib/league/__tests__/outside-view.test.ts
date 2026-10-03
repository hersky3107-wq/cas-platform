import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ConsensusHero } from '../../../components/league/ConsensusHero'
import {
  OUTSIDE_VIEW_PREMORTEM_GUIDANCE,
  answerContractFor,
  buildRoundPrompts,
  systemPromptFor,
} from '../answer-contract'
import type { ConsensusSummary } from '../card-types'
import { LEAGUE_LOCALES } from '../i18n/locales'
import { getLeagueUiPack } from '../i18n/dictionary'

const FORBIDDEN =
  'Do not pick a direction to be contrarian, to balance other models, or with any reference to what other models might answer.'

const ROUND = {
  proposition_text: 'Will AAPL close higher by 2026-10-06 than its last close?',
  instrument: 'AAPL',
  category: 'stock',
  horizon: '1d',
  resolution_rule: 'up iff resolution close > anchor close',
  resolves_at: '2026-10-06T20:00:00.000Z',
}

function consensus(up: number, down: number, weightedConfidencePct: number): ConsensusSummary {
  return {
    tally: { up, down, flat: 0, abstain: Math.max(0, 40 - up - down) },
    majorityDirection: up >= down ? 'up' : 'down',
    totalModels: 40,
    respondedModels: up + down,
    avgProbability: weightedConfidencePct,
    aggregateDirection: 'up',
    aggregateProbability: weightedConfidencePct,
    aggregateMagnitudePct: 1.1,
    aggregateMagnitudeN: up,
  }
}

describe('outside view + pre-mortem — one instruction, every official prompt', () => {
  it('system and round prompts carry both steps and the forbidden-behaviors line', () => {
    const closeHigher = answerContractFor('binary_close_higher')
    const subject = answerContractFor('binary_subject_outcome')
    for (const [contract, category, tier] of [
      [closeHigher, 'stock', 'premier'],
      [closeHigher, 'stock', 'scout'],
      [subject, 'sports', 'world'],
      [answerContractFor('binary_threshold'), 'real_estate', 'scout'],
    ] as const) {
      const system = systemPromptFor({ league_tier: tier }, contract, category)
      expect(system, `${category}/${tier}`).toContain('Outside view first:')
      expect(system, `${category}/${tier}`).toContain('Pre-mortem:')
      expect(system, `${category}/${tier}`).toContain(FORBIDDEN)
      expect(system, `${category}/${tier}`).toContain('about 50%')
      expect(system.indexOf('Outside view first:')).toBeGreaterThan(system.indexOf('55-65%'))
    }
    const prompts = buildRoundPrompts(closeHigher, ROUND, 'BASE RATE: 53%')
    for (const text of [prompts.price, prompts.scout]) {
      expect(text).toContain(OUTSIDE_VIEW_PREMORTEM_GUIDANCE)
      expect(text).toContain(FORBIDDEN)
      expect(text.indexOf(OUTSIDE_VIEW_PREMORTEM_GUIDANCE)).toBeGreaterThan(text.indexOf('55-65%'))
    }
  })
})

describe('strongest_counter — accepted when present or absent', () => {
  const closeHigher = answerContractFor('binary_close_higher')

  it('keeps the direction and stores a clipped counter', () => {
    const words = Array.from({ length: 25 }, (_, i) => `w${i + 1}`).join(' ')
    const text = `{"direction":"down","probability":61,"magnitude":-0.4,"rationale":"Soft tape.","strongest_counter":"${words}"}`
    const answer = closeHigher.parse(text)
    const validation = closeHigher.validate(answer, '1d')
    expect(validation).toMatchObject({ ok: true, side: 'down' })
    expect(answer?.counterMissing).toBe(false)
    expect(answer?.strongestCounter?.split(/\s+/)).toHaveLength(20)
    expect(answer?.strongestCounter?.startsWith('w1 ')).toBe(true)
    expect(answer?.strongestCounter).not.toContain('w21')
  })

  it('still accepts a valid answer that omits strongest_counter', () => {
    const text = '{"direction":"up","probability":58,"magnitude":0.6,"rationale":"Small edge over the base rate."}'
    const answer = closeHigher.parse(text)
    expect(closeHigher.validate(answer, '1d')).toMatchObject({ ok: true, side: 'up' })
    expect(answer?.strongestCounter).toBeNull()
    expect(answer?.counterMissing).toBe(true)
    const subject = answerContractFor('binary_subject_outcome')
    const yes = subject.parse('{"side":"yes","probability":64,"qualifier":"2-1","rationale":"Form edge."}')
    expect(subject.validate(yes, '1d')).toMatchObject({ ok: true, side: 'yes', qualifierText: '2-1' })
    expect(yes?.counterMissing).toBe(true)
    expect(yes?.strongestCounter).toBeNull()
  })
})

describe('weak-confidence crowding badge', () => {
  const t = getLeagueUiPack('ko')

  function htmlFor(up: number, down: number, confidence: number) {
    return renderToStaticMarkup(
      createElement(ConsensusHero, {
        consensus: consensus(up, down, confidence),
        horizon: '1d',
        t,
      }),
    )
  }

  it('shows beside 36:3 at 58% and hides at 36:3 / 75% and 24:16 / 58%', () => {
    const crowded = htmlFor(36, 3, 58)
    const countLine = t.hero.countLine(40, 36, t.hero.answerVerb.up, 3, t.hero.answerVerb.down)
    expect(countLine).toBe('AI 40개 중 36개가 오른다 · 3개가 내린다')
    expect(crowded).toContain(countLine)
    expect(crowded).toContain('약한 확신의 쏠림 — 박빙일 수 있음')
    expect(crowded).toContain('data-testid="weak-confidence-crowding"')

    const confident = htmlFor(36, 3, 75)
    expect(confident).toContain(countLine)
    expect(confident).not.toContain('data-testid="weak-confidence-crowding"')

    const split = htmlFor(24, 16, 58)
    const splitLine = t.hero.countLine(40, 24, t.hero.answerVerb.up, 16, t.hero.answerVerb.down)
    expect(split).toContain(splitLine)
    expect(split).not.toContain('data-testid="weak-confidence-crowding"')
  })

  it('translates the badge in every locale', () => {
    expect(t.hero.weakConfidenceCrowding).toBe('약한 확신의 쏠림 — 박빙일 수 있음')
    for (const locale of LEAGUE_LOCALES) {
      expect(getLeagueUiPack(locale).hero.weakConfidenceCrowding.trim().length).toBeGreaterThan(0)
    }
  })
})

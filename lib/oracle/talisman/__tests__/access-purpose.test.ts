import { describe, expect, it } from 'vitest'
import { canComputeTalisman } from '../access'
import { computeTalisman } from '../index'
import { fudanSpec, purposeBundle } from '../purpose'
import { extractNativeFindings } from '../native'
import { describeCentre, describeCentreFromDeficiency } from '../copy'
import { LAYER1_PROMPT_VERSION } from '../../ai/prompts/layer1'
import { ORACLE_PROMPT_VERSION } from '../../runner/conventions'
import { charts1988, EMPTY_CHARTS, fakeConsensus, LIVE_ACCESS } from './fixture'

describe('access gate', () => {
  it('refuses partial, stub, and missing consensus', () => {
    expect(canComputeTalisman({ status: 'partial', promptVersion: 'layer1-live', hasConsensus: true })).toBe(false)
    expect(canComputeTalisman({ status: 'done', promptVersion: ORACLE_PROMPT_VERSION, hasConsensus: true })).toBe(false)
    expect(canComputeTalisman({ status: 'done', promptVersion: 'layer1-live', hasConsensus: false })).toBe(false)
    expect(canComputeTalisman(LIVE_ACCESS)).toBe(true)
  })

  it('allows the current live prompt and older live prompts, and refuses the stub stamp', () => {
    expect(canComputeTalisman({ status: 'done', promptVersion: LAYER1_PROMPT_VERSION, hasConsensus: true })).toBe(true)
    expect(canComputeTalisman({ status: 'done', promptVersion: 'layer1-v3', hasConsensus: true })).toBe(true)
    expect(canComputeTalisman({ status: 'done', promptVersion: ORACLE_PROMPT_VERSION, hasConsensus: true })).toBe(false)
  })

  it('computeTalisman returns null when the gate fails', () => {
    expect(
      computeTalisman({
        access: { status: 'partial', promptVersion: 'layer1-live', hasConsensus: true },
        charts: charts1988(),
        consensus: fakeConsensus({ fire: 8 }),
      }),
    ).toBeNull()
  })
})

describe('purpose filters', () => {
  it('returns none where a system has no basis, and names the 符膽 glyphs', () => {
    const findings = extractNativeFindings(charts1988())
    const bundle = purposeBundle(findings, { active: 'wealth', prismScores: charts1988().prism?.domainScores })
    expect(bundle.tables.love.saju).toEqual({ status: 'none' })
    expect(bundle.tables.health.saju).toEqual({ status: 'none' })
    expect(bundle.tables.wealth.ninestar).toEqual({ status: 'none' })
    expect(bundle.tables.wealth.saju.status).toBe('hit')
    expect(bundle.tables.wealth.ziwei.status).toBe('hit')
    expect(bundle.tables.wealth.prism.status).toBe('hit')
    expect(bundle.tables.wealth.iching.status).toBe('hit')
    expect(bundle.tables.exorcism.ninestar.status).toBe('hit')
    expect(bundle.tables.exorcism.saju).toEqual({ status: 'none' })
    expect(bundle.tables.exorcism.prism).toEqual({ status: 'none' })
    expect(bundle.tables.exorcism.iching.status).toBe('hit')
    if (bundle.tables.exorcism.iching.status === 'hit') {
      expect(bundle.tables.exorcism.iching.value.map((row) => row.relative)).toEqual(['子孙', '官鬼'])
    }
    expect(fudanSpec('wealth').glyph).toBe('財')
    expect(fudanSpec('love').glyph).toBe('和合')
    expect(fudanSpec('promotion').glyph).toBe('登科')
    expect(fudanSpec('health').glyph).toBe('康寧')
    expect(fudanSpec('exorcism').glyph).toBe('鎭')
    expect(fudanSpec(null)).toEqual({ kind: 'bindrune', purpose: null, glyph: 'BINDRUNE' })
  })
})

describe('centre copy', () => {
  it('never claims twelve systems independently found the centre', () => {
    const consensus = describeCentreFromDeficiency({ wood: 0, fire: 12, earth: 0, metal: 0, water: 0 })
    expect(consensus.headline).toContain('화(火)')
    expect(consensus.body).not.toContain('열두 체계의 오행 합산')
    expect(consensus.body).toContain('투영 한 줄')
    const fill = describeCentre({ source: 'eokbu', mode: 'fill', element: 'fire', strength: 'weak', intensity: 'full' })
    expect(fill.body).toContain('신약')
    expect(fill.body).toContain('열두 체계가 합의한 값이 아닙니다')
    const drain = describeCentre({ source: 'eokbu', mode: 'drain', element: 'fire', strength: 'strong', intensity: 'full' })
    expect(drain.body).toContain('속이 빈 핵')
    const lean = describeCentre({
      source: 'eokbu-lean',
      mode: 'fill',
      element: 'fire',
      strength: 'balanced',
      intensity: 'soft',
    })
    expect(lean.headline).toContain('경향')
    const follow = describeCentre({ source: 'jonggyeok', mode: 'follow', element: 'earth', intensity: 'full' })
    expect(follow.headline).toContain('종격')
  })
})

describe('computeTalisman', () => {
  it('returns the SVG-facing shape with BINDRUNE when no purpose is set', () => {
    const result = computeTalisman({
      access: LIVE_ACCESS,
      charts: charts1988(),
      consensus: fakeConsensus({ water: 20 }),
    })
    expect(result).not.toBeNull()
    expect(result!.centre).toEqual({ source: 'eokbu', mode: 'fill', element: 'fire', strength: 'weak', intensity: 'full' })
    expect(result!.fudan).toEqual({ kind: 'bindrune', purpose: null, glyph: 'BINDRUNE' })
    expect(result!.seals.some((seal) => seal.kind === 'ninestar-killing')).toBe(true)
    expect(result!.layers.ninestar?.killings.some((k) => k.name === '오황살')).toBe(false)
    expect(result!.independence).toEqual({
      native: 9,
      formOnly: 3,
      nativeIds: ['saju', 'astro', 'prism', 'ziwei', 'numerology', 'name', 'iching', 'tarot', 'ninestar'],
      formOnlyIds: ['runes', 'sukuyou', 'tzolkin'],
    })
  })

  it('still computes from empty native charts when the gate passes (form-only + consensus centre)', () => {
    const result = computeTalisman({
      access: LIVE_ACCESS,
      charts: EMPTY_CHARTS,
      consensus: fakeConsensus({ earth: 7 }),
      purpose: 'exorcism',
    })
    expect(result?.centre).toEqual({ source: 'consensus', mode: 'fill', element: 'earth', intensity: 'full' })
    expect(result?.fudan.glyph).toBe('鎭')
    expect(result?.seals).toEqual([])
  })

  it('does not seal reversed tarot or runes; reversals stay on the layer', () => {
    const charts = charts1988()
    const reversedCards = charts.tarot?.cards.filter((card) => card.reversed).length ?? 0
    const reversedRunes = charts.runes?.runes.filter((rune) => rune.reversed).length ?? 0
    expect(reversedCards + reversedRunes).toBeGreaterThan(0)
    const result = computeTalisman({
      access: LIVE_ACCESS,
      charts,
      consensus: fakeConsensus({ water: 8 }),
    })
    expect(result!.seals.some((seal) => (seal.kind as string) === 'tarot-reversed' || (seal.kind as string) === 'rune-reversed')).toBe(false)
    expect(result!.seals.every((seal) => ['ninestar-killing', 'ziwei-malefic', 'ziwei-huaji', 'name-daehyung'].includes(seal.kind))).toBe(true)
    expect(result!.layers.tarot?.reversed).toHaveLength(reversedCards)
  })
})

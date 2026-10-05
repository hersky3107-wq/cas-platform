import { describe, expect, it } from 'vitest'
import { LEAGUE_LOCALES } from '../../i18n/locales'
import { getLeagueUiPack } from '../../i18n/dictionary'
import { detectBettingFraming } from '../betting-framing'
import { prefilterRejects } from '../prefilter'

const FREEFORM_HUBS = ['sports', 'politics_election', 'entertainment', 'real_estate', 'tech'] as const

function layer0Refuse(raw: string, category?: string): 'low_confidence' | 'betting_framing' | null {
  if (prefilterRejects(raw)) return 'low_confidence'
  if (detectBettingFraming(raw, { category })) return 'betting_framing'
  return null
}

describe('detectBettingFraming — product vs parlay slang', () => {
  it('does not refuse foldable-phone prompts', () => {
    expect(detectBettingFraming('삼성이 연말까지 3단 폴더블을 출시할까?')).toBe(false)
    expect(detectBettingFraming('폴더블폰')).toBe(false)
    expect(detectBettingFraming('갤럭시 Z 폴드8')).toBe(false)
    expect(detectBettingFraming('Will Samsung ship a foldable by year-end?')).toBe(false)
    expect(detectBettingFraming('Galaxy Z Fold 8 launch')).toBe(false)
  })

  it('still refuses real betting phrases', () => {
    expect(detectBettingFraming('다폴더 픽')).toBe(true)
    expect(detectBettingFraming('토토 단폴 추천')).toBe(true)
    expect(detectBettingFraming('손흥민 토토 픽')).toBe(true)
    expect(detectBettingFraming('아스날 핸디캡 오버언더')).toBe(true)
  })

  it('treats bare parlay slang as a hit only in sports/politics or with betting context', () => {
    expect(detectBettingFraming('오늘 단폴')).toBe(false)
    expect(detectBettingFraming('오늘 단폴', { category: 'sports' })).toBe(true)
    expect(detectBettingFraming('오늘 단폴 배당')).toBe(true)
    expect(detectBettingFraming('다폴더', { category: 'tech' })).toBe(false)
  })
})

describe('hub example prompts — layer-0 gateway refusals', () => {
  it('refuses none of the published hub examples in any locale', () => {
    const hits: string[] = []
    for (const locale of LEAGUE_LOCALES) {
      const pack = getLeagueUiPack(locale)
      for (const text of pack.catalog.techSamples) {
        const code = layer0Refuse(text, 'tech')
        if (code) hits.push(`${locale} techSamples: ${code} — ${text}`)
      }
      for (const hub of FREEFORM_HUBS) {
        const category = hub === 'sports' ? 'sports' : hub === 'politics_election' ? 'politics_election' : hub
        for (const text of pack.catalog.freeformPanel[hub].examples) {
          const code = layer0Refuse(text, category)
          if (code) hits.push(`${locale} ${hub}: ${code} — ${text}`)
        }
      }
    }
    expect(hits).toEqual([])
  })
})

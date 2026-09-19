import { describe, expect, it } from 'vitest'
import { compactReaderPack } from '../compact-pack'
import { computeLeagueDivination } from '../compute'
import { fallbackRationale } from '../fallback'
import { parseLeagueReaderRationale } from '../parse-reader'
import { runLeagueReader, type LeagueReaderCall } from '../reader'
import { LEAGUE_READER_BRAND, LEAGUE_READER_MAX_COMPLETION_TOKENS } from '../conventions'

const FOUR_OK = [
  '육효 용신 妻财는 월령 왕이다.',
  '타로 결과 패는 The Sun 정방향이다.',
  '룬 미래는 Fehu 정방향이다.',
  '택일 일진이 용신을 생한다.',
].join('\n')

describe('runLeagueReader', () => {
  const computed = computeLeagueDivination({
    roundId: 'reader-round',
    firstViewIso: '2026-09-19T08:52:00.000Z',
    categoryId: 'stocks',
    axis: 'direction',
  })
  const pack = compactReaderPack(computed, { proposition: 'q', subjectName: 's' })

  it('retries once on parse miss then falls back', async () => {
    const texts = ['시세가 오른다.\n두\n세\n네', '시세가 또 있다.\n두\n세\n네']
    let i = 0
    const call: LeagueReaderCall = async (input) => {
      expect(input.maxCompletionTokens).toBe(LEAGUE_READER_MAX_COMPLETION_TOKENS)
      expect(input.maxCompletionTokens).toBeLessThan(700)
      return { text: texts[i++] ?? null }
    }
    const result = await runLeagueReader(pack, call)
    expect(result.attempts).toBe(2)
    expect(result.source).toBe('fallback')
    expect(result.brand).toBe(LEAGUE_READER_BRAND)
    expect(result.rationale).toBe(fallbackRationale(pack))
    expect(parseLeagueReaderRationale(result.rationale, pack.codeVerdict).ok).toBe(true)
  })

  it('accepts a clean first call without retry', async () => {
    let calls = 0
    const call: LeagueReaderCall = async () => {
      calls += 1
      return { text: FOUR_OK }
    }
    const result = await runLeagueReader(pack, call)
    expect(calls).toBe(1)
    expect(result.source).toBe('ai')
    expect(result.rationale).toBe(FOUR_OK)
  })
})

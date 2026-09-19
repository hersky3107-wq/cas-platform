import { describe, expect, it } from 'vitest'
import { parseLeagueReaderRationale, MARKET_LANGUAGE_BAN, CUSTOMER_ABSTENTION_BAN } from '../parse-reader'

const FOUR = [
  '육효 용신 妻财는 월령 왕이다.',
  '타로 결과 패는 The Sun 정방향이다.',
  '룬 미래는 Fehu 정방향이다.',
  '택일 일진이 용신을 생한다.',
].join('\n')

describe('parseLeagueReaderRationale', () => {
  it('accepts 4–5 clean divination lines', () => {
    expect(parseLeagueReaderRationale(FOUR, 'up').ok).toBe(true)
    expect(parseLeagueReaderRationale(FOUR + '\n세효가 응효보다 뚜렷하다.', 'up').ok).toBe(true)
  })

  it('rejects line counts outside 4–5 — parser, not prompt', () => {
    expect(parseLeagueReaderRationale('한 줄만.', 'up')).toMatchObject({ ok: false, reason: 'line_count' })
    const six = [FOUR, '여섯째 줄이다.', '일곱은 아니지만 여섯.'].join('\n')
    expect(parseLeagueReaderRationale(six, 'up')).toMatchObject({ ok: false, reason: 'line_count' })
  })

  it('rejects every banned market word in Korean and English', () => {
    for (const word of ['시세', '가격', '거래량', '뉴스', '실적', '금리', '시장', '전망', '투자', 'price', 'volume', 'news', 'market']) {
      const text = `${FOUR.split('\n')[0]}\n${FOUR.split('\n')[1]}\n이 줄에 ${word} 가 있다.\n${FOUR.split('\n')[3]}`
      const parsed = parseLeagueReaderRationale(text, 'up')
      expect(parsed.ok).toBe(false)
      if (!parsed.ok) expect(parsed.reason).toBe('market_language')
    }
    expect(MARKET_LANGUAGE_BAN).toContain('차트')
    expect(MARKET_LANGUAGE_BAN).toContain('chart')
  })

  it('rejects a rationale that affirms the opposite of the code ballot', () => {
    const down = [
      '육효 용신이 약하다.',
      '타로 결과 패는 Death 정방향이다.',
      '룬 미래는 Hagalaz 정방향이다.',
      '그래서 하락이 맞다.',
    ].join('\n')
    expect(parseLeagueReaderRationale(down, 'up')).toMatchObject({ ok: false, reason: 'direction_mismatch' })
    expect(parseLeagueReaderRationale(down, 'down').ok).toBe(true)
  })

  it('rejects customer-facing 결번 / voter-roll wording', () => {
    expect(CUSTOMER_ABSTENTION_BAN).toContain('결번')
    expect(CUSTOMER_ABSTENTION_BAN).toContain('말을 아낌')
    const leaked = [
      FOUR.split('\n')[0],
      FOUR.split('\n')[1],
      '타로는 말을 아꼈고 육효가 홀로 표를 냈다.',
      FOUR.split('\n')[3],
    ].join('\n')
    expect(parseLeagueReaderRationale(leaked, 'up')).toMatchObject({
      ok: false,
      reason: 'customer_abstention',
    })
  })
})

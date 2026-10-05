import { describe, expect, it } from 'vitest'
import { getLeagueUiPack } from '../../i18n/dictionary'
import { LEAGUE_LOCALES } from '../../i18n/locales'
import { decodeSportsInstrument, encodeSportsInstrument } from '../../gateway/adapters/sports-catalog'
import { drawOrLossLabel, sportsDrawPossible, sportsPropositionDisplay } from '../../sports-display'
import {
  displayDomesticTeam,
  formatDomesticBaseballPacket,
  gamesFromSearchText,
  parseDomesticBaseballIntent,
  resolveDomesticBaseball,
} from '../domestic-baseball'
import { isDomesticBaseballLeague, LAUNCH_SPORTS_LEAGUES } from '../types'

const NOW = new Date('2026-10-05T03:00:00.000Z')

describe('domestic baseball', () => {
  it('stays off the paid Odds launch slate', () => {
    expect(LAUNCH_SPORTS_LEAGUES).not.toContain('baseball_kbo')
    expect(LAUNCH_SPORTS_LEAGUES).not.toContain('baseball_cpbl')
    expect(isDomesticBaseballLeague('baseball_kbo')).toBe(true)
  })

  it('names KBO and CPBL clubs in Korean, Japanese, and Traditional Chinese', () => {
    expect(displayDomesticTeam('KIA Tigers', 'ko')).toBe('KIA 타이거즈')
    expect(displayDomesticTeam('Kiwoom Heroes', 'ko')).toBe('키움 히어로즈')
    expect(displayDomesticTeam('CTBC Brothers', 'ko')).toBe('중신 브라더스')
    expect(displayDomesticTeam('Rakuten Monkeys', 'ja')).toBeTruthy()
    expect(displayDomesticTeam('Wei Chuan Dragons', 'zh-TW')).toBeTruthy()
  })

  it('resolves the next KBO game inside 7 days and asks the user to confirm', () => {
    const intent = parseDomesticBaseballIntent('기아 다음 경기')
    expect(intent?.league).toBe('baseball_kbo')
    const games = gamesFromSearchText(
      '2026-10-07 18:30 KIA Tigers vs LG Twins 장소: 광주',
      NOW,
      intent!,
    )
    expect(games).toHaveLength(1)
    const hit = resolveDomesticBaseball(intent!, games, NOW)
    expect(hit.kind).toBe('ready')
    if (hit.kind !== 'ready') return
    const parts = decodeSportsInstrument(hit.instrument)
    expect(parts?.league).toBe('baseball_kbo')
    expect(encodeSportsInstrument(parts!).split(':')).toHaveLength(6)
    expect(hit.instrument).not.toMatch(/skip/)
  })

  it('offers a pick when two games fall inside the window', () => {
    const intent = parseDomesticBaseballIntent('LG 두산')
    const games = gamesFromSearchText(
      ['2026-10-06 18:30 LG Twins vs Doosan Bears', '2026-10-08 18:30 LG Twins vs Doosan Bears'].join('\n'),
      NOW,
      intent!,
    )
    const hit = resolveDomesticBaseball(intent!, games, NOW)
    expect(hit.kind).toBe('picks')
  })

  it('drops games outside 7 days', () => {
    const intent = parseDomesticBaseballIntent('삼성 라이온즈')
    const games = gamesFromSearchText('2026-10-20 18:30 Samsung Lions vs KT Wiz', NOW, intent!)
    expect(games).toHaveLength(0)
    expect(resolveDomesticBaseball(intent!, games, NOW).kind).toBe('none')
  })

  it('labels a tie as draw-or-loss and filters third-party tips', () => {
    expect(sportsDrawPossible('baseball_kbo')).toBe(true)
    expect(drawOrLossLabel('KIA 타이거즈', 'ko')).toBe('KIA 타이거즈 무·패')
    const intent = parseDomesticBaseballIntent('한화 이글스')!
    const [game] = gamesFromSearchText('2026-10-06 18:30 Hanwha Eagles vs NC Dinos', NOW, intent)
    const packet = formatDomesticBaseballPacket(game!, [
      '선발 투수 문동주',
      '엔트리 말소 김서현',
      '배당 1.85 pick 추천',
      '최근 3연승',
    ])
    expect(packet).toContain('search-based, unverified')
    expect(packet).toContain('none measured')
    expect(packet).toContain('선발 투수 문동주')
    expect(packet).not.toMatch(/배당|pick 추천/)
    expect(packet).toContain('A tie is No')
    const text = sportsPropositionDisplay(encodeSportsInstrument(decodeSportsInstrument(
      `MATCH:baseball_kbo:2026-10-06T1830:${encodeURIComponent('Hanwha Eagles')}:${encodeURIComponent('NC Dinos')}:${encodeURIComponent('Hanwha Eagles')}`,
    )!), '', 'ko')
    expect(text).toContain('연장')
  })

  it('does not treat the Portuguese verb vence as NC Dinos', () => {
    expect(parseDomesticBaseballIntent('O Arsenal vence o próximo jogo?')).toBeNull()
    expect(parseDomesticBaseballIntent('NC 다이노스 다음 경기')?.subject.canonical).toBe('NC Dinos')
    expect(parseDomesticBaseballIntent('vence NC 다음 경기')?.subject.canonical).toBe('NC Dinos')
  })

  it('publishes no KBO hub chip, because a next-game prompt does not resolve in the offseason', () => {
    for (const locale of LEAGUE_LOCALES) {
      const examples = getLeagueUiPack(locale).catalog.freeformPanel.sports.examples.join('\n')
      expect(examples).not.toMatch(/KBO|CPBL|타이거즈|KIA Tigers/)
    }
  })
})

import { describe, expect, it } from 'vitest'
import {
  EXPECTED_LEGACY_SAME_DAY_24H_COUNT,
  isLegacy24hSpotInstrument,
  isLegacySameDay24hRound,
  selectLegacySameDay24hRounds,
  type LegacySameDay24hRow,
} from '../legacy-same-day-24h'

function row(over: Partial<LegacySameDay24hRow> & Pick<LegacySameDay24hRow, 'id' | 'instrument'>): LegacySameDay24hRow {
  return {
    category: 'gold_metal',
    horizon: '1d',
    grading_status: 'graded',
    actual_outcome: 'yes',
    consensus_is_correct: true,
    anchor_session_date: '2026-10-01',
    resolution_session_date: '2026-10-01',
    ...over,
  }
}

describe('legacy same-day 24h 1d selector', () => {
  it('includes winners and losers in the class', () => {
    const selected = selectLegacySameDay24hRounds([
      row({ id: 'xau-win', instrument: 'XAU/USD', consensus_is_correct: true, actual_outcome: 'up' }),
      row({ id: 'xag-lose', instrument: 'XAG/USD', consensus_is_correct: false, actual_outcome: 'down' }),
      row({ id: 'xpt', instrument: 'XPT/USD', consensus_is_correct: null }),
      row({ id: 'jpy', instrument: 'USD/JPY', category: 'fx' }),
      row({ id: 'btc', instrument: 'BTC/USD', category: 'crypto_spot' }),
      row({ id: 'eth', instrument: 'ETH/USD', category: 'crypto_spot', consensus_is_correct: false }),
      row({ id: 'doge', instrument: 'DOGE/USD', category: 'memecoin', consensus_is_correct: true }),
    ])
    expect(selected.map((r) => r.id)).toEqual(['xau-win', 'xag-lose', 'xpt', 'jpy', 'btc', 'eth', 'doge'])
    expect(selected).toHaveLength(EXPECTED_LEGACY_SAME_DAY_24H_COUNT)
    expect(selected.some((r) => r.consensus_is_correct === true)).toBe(true)
    expect(selected.some((r) => r.consensus_is_correct === false)).toBe(true)
  })

  it('excludes 1w/1m even when the session dates match', () => {
    expect(
      isLegacySameDay24hRound(row({ id: 'xau-1w', instrument: 'XAU/USD', horizon: '1w' })),
    ).toBe(false)
    expect(
      isLegacySameDay24hRound(row({ id: 'btc-1m', instrument: 'BTC/USD', category: 'crypto_spot', horizon: '1m' })),
    ).toBe(false)
  })

  it('excludes equities, KRSTOCK, and session-clock ETFs', () => {
    expect(isLegacy24hSpotInstrument('stock', 'AAPL')).toBe(false)
    expect(isLegacy24hSpotInstrument('kr_stock', '005930')).toBe(false)
    expect(isLegacy24hSpotInstrument('gold_metal', 'GLD')).toBe(false)
    expect(isLegacy24hSpotInstrument('commodity_energy', 'UNG')).toBe(false)
    expect(
      isLegacySameDay24hRound(row({ id: 'aapl', instrument: 'AAPL', category: 'stock' })),
    ).toBe(false)
    expect(
      isLegacySameDay24hRound(row({ id: 'gld', instrument: 'GLD', category: 'gold_metal' })),
    ).toBe(false)
  })

  it('excludes 24h spots whose resolution session is a later bar', () => {
    expect(
      isLegacySameDay24hRound(
        row({
          id: 'fixed',
          instrument: 'XAU/USD',
          anchor_session_date: '2026-10-01',
          resolution_session_date: '2026-10-02',
        }),
      ),
    ).toBe(false)
  })

  it('recognizes the 24h spots in the operator class', () => {
    expect(isLegacy24hSpotInstrument('gold_metal', 'XAU/USD')).toBe(true)
    expect(isLegacy24hSpotInstrument('fx', 'USD/JPY')).toBe(true)
    expect(isLegacy24hSpotInstrument('crypto_spot', 'ETH/USD')).toBe(true)
    expect(isLegacy24hSpotInstrument('memecoin', 'DOGE/USD')).toBe(true)
    expect(isLegacy24hSpotInstrument('commodity_energy', 'WTI/USD')).toBe(true)
    expect(isLegacy24hSpotInstrument('commodity_energy', 'XBR/USD')).toBe(true)
  })
})

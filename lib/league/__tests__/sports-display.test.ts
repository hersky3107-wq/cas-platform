import { describe, expect, it } from 'vitest'
import { encodeSportsInstrument } from '../gateway/adapters/sports-catalog'
import { sideLabelsFor } from '../side-labels'
import {
  displaySportsTeam,
  formatSportsPropositionLocalized,
  sportsPropositionDisplay,
  sportsVsLabel,
} from '../sports-display'
import { getLeagueUiPack } from '../i18n/dictionary'

const DODGERS_MATCH = encodeSportsInstrument({
  league: 'baseball_mlb',
  eventId: '12345',
  side: 'away',
  kickoffMs: 1790535960000,
  home: 'San Francisco Giants',
  away: 'Los Angeles Dodgers',
})

describe('sports display i18n', () => {
  it('maps common MLB names to Korean short + full forms; unmapped stay English', () => {
    expect(displaySportsTeam('Los Angeles Dodgers', 'ko', 'short')).toBe('LA 다저스')
    expect(displaySportsTeam('Los Angeles Dodgers', 'ko', 'full')).toBe('로스앤젤레스 다저스')
    expect(displaySportsTeam('San Francisco Giants', 'ko', 'short')).toBe('SF 자이언츠')
    expect(displaySportsTeam('Some Obscure Club', 'ko', 'short')).toBe('Some Obscure Club')
    expect(displaySportsTeam('Los Angeles Dodgers', 'en', 'short')).toBe('Los Angeles Dodgers')
  })

  it('localizes the stored English proposition without rewriting the ledger string', () => {
    const stored = 'Will Los Angeles Dodgers win the MLB game against San Francisco Giants?'
    expect(sportsPropositionDisplay(DODGERS_MATCH, stored, 'en')).toBe(stored)
    expect(sportsPropositionDisplay(DODGERS_MATCH, stored, 'ko')).toBe(
      '로스앤젤레스 다저스가 샌프란시스코 자이언츠와의 MLB 경기에서 이길까?',
    )
    expect(sportsVsLabel(DODGERS_MATCH, 'ko')).toBe('LA 다저스 vs SF 자이언츠')
    expect(formatSportsPropositionLocalized(
      {
        league: 'soccer_epl',
        eventId: 'e',
        side: 'away',
        kickoffMs: 1,
        home: 'Arsenal',
        away: 'Tottenham Hotspur',
      },
      'ko',
    )).toContain('정규시간')
  })
})

describe('sports named sides', () => {
  it('badges name WHO wins, not bare Y/N', () => {
    const t = getLeagueUiPack('ko')
    const labels = sideLabelsFor(
      {
        proposition_kind: 'binary_subject_outcome',
        category: 'sports',
        subject_label: 'Los Angeles Dodgers',
        instrument: DODGERS_MATCH,
      },
      t,
      'ko',
    )
    expect(labels.namedSides).toBe(true)
    expect(labels.badge('yes')).toBe('LA 다저스 승')
    expect(labels.badge('no')).toBe('SF 자이언츠 승')
    expect(labels.answer('yes')).toBe('LA 다저스 승')
    expect(labels.tallyWord('yes')).toBe('LA 다저스 승')
    expect(labels.glyph('yes')).toBe('Y')
  })

  it('price rounds stay unnamed ▲▼', () => {
    const t = getLeagueUiPack('en')
    const labels = sideLabelsFor({ proposition_kind: 'binary_close_higher' }, t)
    expect(labels.namedSides).toBe(false)
    expect(labels.badge('up')).toBe('UP')
    expect(labels.glyphs[0]).toBe('\u25b2')
  })
})

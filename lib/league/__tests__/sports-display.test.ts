import { describe, expect, it } from 'vitest'
import { encodeSportsInstrument } from '../gateway/adapters/sports-catalog'
import { sideLabelsFor } from '../side-labels'
import {
  displaySportsTeam,
  drawOrLossLabel,
  formatSportsPropositionLocalized,
  sportsAllPropositions,
  sportsCardHeaderLine,
  sportsPropositionDisplay,
  sportsVsLabel,
} from '../sports-display'
import { buildSportsRankedRoundInput } from '../gateway/adapters/sports-compose'
import { LEAGUE_LOCALES } from '../i18n/locales'
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

  it('labels a draw-possible match as subject win / subject draw-or-loss', () => {
    const kickoffMs = Date.parse('2026-10-11T05:00:00.000Z')
    const instrument = encodeSportsInstrument({
      league: 'soccer_korea_kleague1',
      eventId: '1507081',
      side: 'away',
      kickoffMs,
      home: 'Gwangju FC',
      away: 'Ulsan Hyundai FC',
    })
    const ko = sideLabelsFor(
      {
        proposition_kind: 'binary_subject_outcome',
        category: 'sports',
        subject_label: 'Ulsan Hyundai FC',
        instrument,
      },
      getLeagueUiPack('ko'),
      'ko',
    )
    expect(ko.badge('yes')).toBe('울산 HD 승')
    expect(ko.badge('no')).toBe('울산 HD 무·패')
    expect(ko.badge('no')).not.toContain('광주')
    const en = sideLabelsFor(
      {
        proposition_kind: 'binary_subject_outcome',
        category: 'sports',
        subject_label: 'Ulsan Hyundai FC',
        instrument,
      },
      getLeagueUiPack('en'),
      'en',
    )
    expect(en.badge('yes')).toBe('Ulsan Hyundai FC win')
    expect(en.badge('no')).toBe('Ulsan Hyundai FC draw or loss')
    for (const locale of LEAGUE_LOCALES) {
      const subject = displaySportsTeam('Ulsan Hyundai FC', locale, 'short')
      const labels = sideLabelsFor(
        {
          proposition_kind: 'binary_subject_outcome',
          category: 'sports',
          subject_label: 'Ulsan Hyundai FC',
          instrument,
        },
        getLeagueUiPack(locale),
        locale,
      )
      expect(labels.badge('yes')).toContain(subject)
      expect(labels.badge('no')).toBe(drawOrLossLabel(subject, locale))
      expect(labels.badge('no')).not.toMatch(/Gwangju FC 승|광주FC 승/)
    }
    const header = sportsCardHeaderLine(instrument, 'ko')
    expect(header).toContain('광주FC vs 울산 HD')
    expect(header).toContain('K리그1')
    expect(header).toContain('14:00')
    expect(header).not.toContain('sports')
    expect(header).not.toContain('1일')
  })

  it('maps API club names in Korean and Japanese and localizes the confirm proposition', () => {
    expect(displaySportsTeam('Ulsan Hyundai FC', 'ko', 'full')).toBe('울산 HD')
    expect(displaySportsTeam('Gwangju FC', 'ko')).toBe('광주FC')
    expect(displaySportsTeam('Jeonbuk Motors', 'ko', 'full')).toBe('전북 현대')
    expect(displaySportsTeam('Pohang Steelers', 'ko', 'full')).toBe('포항 스틸러스')
    expect(displaySportsTeam('FC Seoul', 'ko')).toBe('FC서울')
    expect(displaySportsTeam('Kashima Antlers', 'ko', 'full')).toBe('가시마 앤틀러스')
    expect(displaySportsTeam('Kashima Antlers', 'ja')).toBe('鹿島アントラーズ')
    expect(displaySportsTeam('Unknown Town FC', 'ko')).toBe('Unknown Town FC')
    const parts = {
      league: 'soccer_korea_kleague1',
      eventId: '1507081',
      side: 'away' as const,
      kickoffMs: Date.parse('2026-10-11T05:00:00.000Z'),
      home: 'Gwangju FC',
      away: 'Ulsan Hyundai FC',
    }
    const props = sportsAllPropositions(parts)
    expect(props.ko).toContain('울산 HD')
    expect(props.ko).toContain('광주FC')
    expect(props.ko).not.toContain('Will ')
    expect(props.ja).toContain('蔚山HD')
    expect(props.en).toContain('Will Ulsan Hyundai FC win')
    const round = buildSportsRankedRoundInput(encodeSportsInstrument(parts))
    expect(round?.propositions?.ko).toBe(props.ko)
    expect(formatSportsPropositionLocalized(parts, 'ko')).toContain('정규시간')
  })

  it('price rounds stay unnamed ▲▼', () => {
    const t = getLeagueUiPack('en')
    const labels = sideLabelsFor({ proposition_kind: 'binary_close_higher' }, t)
    expect(labels.namedSides).toBe(false)
    expect(labels.badge('up')).toBe('UP')
    expect(labels.glyphs[0]).toBe('\u25b2')
  })
})

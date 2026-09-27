import { describe, expect, it } from 'vitest'
import { directionForVerdict, formatManualOutcome, isManualVerdict } from '../types'
import { buildManualGradeTelegramText, telegramConfigured } from '../telegram'
import { parseSuggestionPayload } from '../types'

describe('manual verdict mapping', () => {
  it('maps YES to engine up (side A) and NO to down (side B)', () => {
    expect(directionForVerdict('yes')).toBe('up')
    expect(directionForVerdict('no')).toBe('down')
  })

  it('writes the contract winner token into actual_outcome', () => {
    expect(formatManualOutcome({
      propositionKind: 'binary_subject_outcome',
      verdict: 'yes',
      evidenceUrl: 'https://premierleague.com/match/1',
      note: '2-1',
    })).toBe('yes · 2-1 · https://premierleague.com/match/1')
    expect(formatManualOutcome({
      propositionKind: 'binary_subject_outcome',
      verdict: 'no',
      evidenceUrl: '',
      note: 'draw 1-1',
    })).toBe('no · draw 1-1')
  })

  it('accepts only yes/no/void', () => {
    expect(isManualVerdict('yes')).toBe(true)
    expect(isManualVerdict('up')).toBe(false)
  })
})

describe('telegram optional wiring', () => {
  it('is off when env is unset', () => {
    expect(telegramConfigured({})).toBe(false)
    expect(telegramConfigured({ TELEGRAM_BOT_TOKEN: 'x' })).toBe(false)
  })

  it('is on only with both token and chat id', () => {
    expect(telegramConfigured({ TELEGRAM_BOT_TOKEN: 'bot', TELEGRAM_ADMIN_CHAT_ID: '1' })).toBe(true)
  })

  it('builds a grade link message without echoing a betting frame', () => {
    const text = buildManualGradeTelegramText({
      proposition: 'Tottenham beat Arsenal',
      category: 'sports',
      resolvesAt: '2026-10-04T18:00:00Z',
      gradeUrl: 'https://www.aimani.ai/admin/league/grade?id=abc',
    })
    expect(text).toContain('채점 요청')
    expect(text).toContain('/admin/league/grade?id=abc')
    expect(text).not.toMatch(/토토|배당|베팅/)
  })
})

describe('AI suggestion parser', () => {
  it('never auto-applies — unknown on garbage', () => {
    expect(parseSuggestionPayload(null).verdict).toBe('unknown')
    expect(parseSuggestionPayload({ verdict: 'maybe', confidence: 9 }).verdict).toBe('unknown')
  })

  it('clamps 0-100 confidence into 0-1', () => {
    const parsed = parseSuggestionPayload({
      verdict: 'yes',
      confidence: 85,
      summary: 'Tottenham won 2-1',
      source_url: 'https://premierleague.com/x',
    })
    expect(parsed.verdict).toBe('yes')
    expect(parsed.confidence).toBe(0.85)
    expect(parsed.source_url).toContain('https://')
  })
})

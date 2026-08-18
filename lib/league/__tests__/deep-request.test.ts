import { describe, expect, it } from 'vitest'
import { parseDeepRequest } from '../deep-request'

describe('parseDeepRequest', () => {
  it('accepts { roundId } only', () => {
    const r = parseDeepRequest({ roundId: 'abc-123' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.request.roundId).toBe('abc-123')
      expect(r.request.locale).toBeNull()
      expect(r.request.sessionId).toBeNull()
    }
  })

  it('accepts optional locale', () => {
    const r = parseDeepRequest({ roundId: 'abc', locale: 'ko-KR' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.request.locale).toBe('ko')
  })

  it('rejects a free-text question', () => {
    const r = parseDeepRequest({ roundId: 'abc', question: 'Will AAPL go up?' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.response.status).toBe(400)
  })

  it('rejects instrument / proposition / prompt', () => {
    for (const extra of [{ instrument: 'AAPL' }, { proposition: 'x' }, { prompt: 'x' }, { proposition_text: 'x' }]) {
      const r = parseDeepRequest({ roundId: 'abc', ...extra })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.response.status).toBe(400)
    }
  })

  it('rejects unknown extra keys', () => {
    const r = parseDeepRequest({ roundId: 'abc', councilMode: 'trade' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.response.status).toBe(400)
  })

  it('rejects a missing roundId', () => {
    const r = parseDeepRequest({ locale: 'en' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.response.status).toBe(400)
  })

  it('accepts optional sessionId (debate continue) and nothing else', () => {
    const r = parseDeepRequest({ roundId: 'abc', locale: 'en', sessionId: 'sess-1' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.request.sessionId).toBe('sess-1')
  })
})

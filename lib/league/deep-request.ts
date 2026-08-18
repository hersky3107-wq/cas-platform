import { NextResponse } from 'next/server'
import { normalizeLeagueLocale, type LeagueLocale } from './i18n/locales'

/**
 * League deep-analysis request gate.
 *
 * REGULATORY: these endpoints must never accept a caller-supplied
 * proposition / instrument / free-text prompt. All context is loaded
 * server-side from the round row. Extra text fields are a 400, not ignored.
 */

const ALLOWED_KEYS = new Set(['roundId', 'locale', 'sessionId', 'supabaseAccessToken'])

export type DeepRequest = {
  roundId: string
  locale: LeagueLocale | null
  sessionId: string | null
}

export type DeepRequestResult = { ok: true; request: DeepRequest } | { ok: false; response: NextResponse }

export function parseDeepRequest(body: Record<string, unknown>): DeepRequestResult {
  const extra = Object.keys(body).filter((k) => !ALLOWED_KEYS.has(k))
  if (extra.length > 0) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: 'Unexpected fields. Deep analysis accepts only { roundId, locale?, sessionId? }.',
          code: 'unexpected_fields',
          fields: extra,
        },
        { status: 400 }
      ),
    }
  }

  const banned = ['question', 'prompt', 'instrument', 'proposition', 'proposition_text', 'supplements', 'text', 'query', 'message', 'content']
  const presentBanned = banned.filter((k) => k in body)
  if (presentBanned.length > 0) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: 'Free-text input is not accepted. Deep analysis inherits the round proposition server-side.',
          code: 'free_text_rejected',
          fields: presentBanned,
        },
        { status: 400 }
      ),
    }
  }

  const roundId = typeof body.roundId === 'string' ? body.roundId.trim() : ''
  if (!roundId) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Provide { roundId }', code: 'missing_target' }, { status: 400 }),
    }
  }

  const localeRaw = typeof body.locale === 'string' ? body.locale : null
  const locale = localeRaw ? normalizeLeagueLocale(localeRaw) : null
  const sessionId = typeof body.sessionId === 'string' && body.sessionId.trim() ? body.sessionId.trim() : null

  return { ok: true, request: { roundId, locale, sessionId } }
}

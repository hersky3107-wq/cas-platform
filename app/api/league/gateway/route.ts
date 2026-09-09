import { NextResponse } from 'next/server'
import { LEAGUE_GATEWAY_RATE_RULE } from '@/lib/league/access-policy'
import { PUBLIC_CATEGORY_IDS, visibleChipInstrumentIds } from '@/lib/league/catalog'
import { admissionForPublicCategory } from '@/lib/league/gateway/admission'
import { issueGatewayReceipt } from '@/lib/league/gateway/charge-receipt'
import { writeGatewayAudit } from '@/lib/league/gateway/abuse.server'
import { createLiveGatewayDeps, reserveNormalizeQuota } from '@/lib/league/gateway/live-deps.server'
import { prefilterRejects } from '@/lib/league/gateway/prefilter'
import { refusalMessageForKey, refusalMessageKey } from '@/lib/league/gateway/refusal-copy'
import { runLeagueGateway } from '@/lib/league/gateway/shell'
import type { ClarifyingQuestion, RefusalCode } from '@/lib/league/gateway/types'
import { getLeagueUiPack } from '@/lib/league/i18n/dictionary'
import { normalizeLeagueLocale, type LeagueLocale } from '@/lib/league/i18n/locales'
import { enforceRateLimit, resolveLeagueViewer } from '@/lib/league/public-access'

/**
 * POST /api/league/gateway
 *
 * Freeform prompt → refuse | clarify | ready. Never streams the 40 models.
 * A ready payload includes a short-lived receipt so generate-stream can
 * skip a second charge.
 */
export async function POST(req: Request) {
  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const auth = await resolveLeagueViewer(req, body)
  if (!auth.ok) return auth.response
  const { viewer } = auth

  const limited = enforceRateLimit(viewer, 'league_gateway', LEAGUE_GATEWAY_RATE_RULE)
  if (limited) return limited

  const categoryId = typeof body.category_id === 'string' ? body.category_id.trim() : ''
  const rawText = typeof body.raw_text === 'string' ? body.raw_text : ''
  const localeTag = typeof body.locale === 'string' ? body.locale : 'en'
  const locale: LeagueLocale = normalizeLeagueLocale(localeTag) ?? 'en'
  const answered = parseAnswered(body.answered_slots)
  const clarifyRound = Number.isFinite(Number(body.clarify_round)) ? Math.max(0, Math.floor(Number(body.clarify_round))) : 0

  if (!(PUBLIC_CATEGORY_IDS as readonly string[]).includes(categoryId)) {
    return jsonRefused('category_unavailable', locale)
  }

  const gatewayViewer = { userId: viewer.userId, isAdmin: viewer.isAdmin, jurisdiction: viewer.jurisdiction }
  const admission = admissionForPublicCategory(gatewayViewer, categoryId)
  if (admission) return jsonRefused(admission, locale, categoryId)

  void writeGatewayAudit({
    userId: viewer.userId,
    categoryId,
    locale,
    rawText,
  })

  if (prefilterRejects(rawText)) return jsonRefused('low_confidence', locale)

  const reserved = await reserveNormalizeQuota({
    userId: viewer.userId,
    categoryId,
    rawText,
    locale,
    isClarification: Object.keys(answered).length > 0,
  })
  if (!reserved.ok) return jsonRefused('low_confidence', locale)

  const result = await runLeagueGateway(
    {
      viewer: gatewayViewer,
      category_id: categoryId,
      raw_text: rawText,
      locale,
      answered_slots: answered,
      clarify_round: clarifyRound,
    },
    createLiveGatewayDeps(viewer.userId),
  )

  const pack = getLeagueUiPack(locale)

  if (result.status === 'refused') {
    return NextResponse.json({
      status: 'refused',
      refusal: {
        code: result.refusal.code,
        message: refusalCopy(pack, result.refusal.code, result.refusal.message),
      },
      catalog_chips: localizeChips(result.catalog_chips, pack),
    })
  }

  if (result.status === 'clarify') {
    return NextResponse.json({
      status: 'clarify',
      confirm: result.questions[0]?.slot === 'entity_confirmed',
      preview_proposition: result.preview_proposition ?? null,
      questions: result.questions.map((q) => localizeQuestion(q, pack, locale)),
    })
  }

  const receipt = issueGatewayReceipt(viewer.userId, result.round.instrument, result.round.horizon)
  return NextResponse.json({
    status: 'ready',
    instrument: result.round.instrument,
    horizon: result.round.horizon,
    proposition_text: result.round.proposition_text,
    charged_credits: result.charged_credits,
    gateway_receipt: receipt,
  })
}

function jsonRefused(code: RefusalCode, locale: LeagueLocale, categoryId?: string) {
  const pack = getLeagueUiPack(locale)
  const message = refusalCopy(pack, code, refusalMessageForKey(refusalMessageKey(code), locale))
  const chipIds =
    (code === 'unsupported_entity' || code === 'prompt_not_available') && categoryId
      ? visibleChipInstrumentIds(categoryId)
      : []
  return NextResponse.json({
    status: 'refused',
    refusal: { code, message },
    catalog_chips: localizeChips(
      chipIds.map((id) => ({ id, label_i18n_key: `league.catalog.instruments.${id}` })),
      pack,
    ),
  })
}

function refusalCopy(pack: ReturnType<typeof getLeagueUiPack>, code: string, fallback: string): string {
  const table = pack.gateway.refusal as Record<string, string>
  return table[code] ?? table.generic ?? fallback
}

function parseAnswered(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string' && v.trim() && k.length <= 40) out[k] = v.trim().slice(0, 80)
  }
  return out
}

function localizeQuestion(q: ClarifyingQuestion, pack: ReturnType<typeof getLeagueUiPack>, locale: string) {
  return {
    slot: q.slot,
    prompt: promptFor(q.prompt_i18n_key, pack, locale),
    allow_free_input: Boolean(q.allow_free_input),
    options: (q.options ?? []).map((o) => ({
      id: o.id,
      label: optionLabel(o.id, o.label_i18n_key, pack),
    })),
  }
}

function promptFor(key: string, pack: ReturnType<typeof getLeagueUiPack>, locale: string): string {
  if (key === 'league.gateway.clarify.horizon') return pack.gateway.askHorizon
  if (key === 'league.gateway.clarify.entity') return pack.gateway.askEntity
  if (key === 'league.gateway.clarify.confirm_entity') return pack.gateway.askConfirm
  return pack.gateway.askEntity || refusalMessageForKey(key, locale)
}

function localizeChips(
  chips: { id: string; label_i18n_key: string }[] | undefined,
  pack: ReturnType<typeof getLeagueUiPack>,
): { id: string; label: string }[] {
  return (chips ?? []).map((c) => ({ id: c.id, label: optionLabel(c.id, c.label_i18n_key, pack) }))
}

function optionLabel(id: string, key: string, pack: ReturnType<typeof getLeagueUiPack>): string {
  if (key.startsWith('league.catalog.instruments.')) {
    const inst = key.slice('league.catalog.instruments.'.length)
    return pack.catalog.instruments[inst] ?? inst
  }
  if (key.startsWith('league.gateway.horizon.')) {
    const h = key.slice('league.gateway.horizon.'.length)
    if (h === '1d' || h === '1w' || h === '1m' || h === '3m') return pack.catalog.horizons[h]
  }
  if (key === 'league.gateway.clarify.option.confirm_yes') return pack.gateway.confirmYes
  return pack.catalog.instruments[id] ?? id
}

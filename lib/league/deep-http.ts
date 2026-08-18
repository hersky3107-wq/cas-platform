import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { withCostSpan } from '@/lib/ai/cost-span'
import type { DeductCreditsOutcome } from '@/lib/credits'
import { LEAGUE_DEEP_RATE_RULE } from './access-policy'
import { chargeDeep, refundDeep } from './deep-charge'
import { buildLeagueDeepContext } from './deep-context'
import {
  creditsForLeagueDeepDebate,
  creditsForLeagueDeepOpen,
  LEAGUE_DEEP_DEBATE_MODULE,
  LEAGUE_DEEP_OPEN_MODULE,
} from './credits'
import {
  addSpanTotals,
  deleteUnchargedRun,
  insertDeepRunClaim,
  loadDeepRun,
  markDeepRunBusy,
  markDeepRunCharged,
  resetDeepRun,
  saveDeepRunProgress,
  type DeepProduct,
  type DeepRunRow,
} from './deep-store'
import { decideDeepRunAction, runIsBusy } from './deep-run-policy'
import { advanceDebateState, providersFromDebateState, seedDebateState, type DebatePipelineState } from './deep-debate-run'
import { advanceOpenState, providersFromOpenState, seedOpenState, type OpenPipelineState } from './deep-open-run'
import type { LeagueLocale } from './i18n/locales'
import type { LeagueViewer } from './public-access'
import { enforceRateLimit } from './public-access'

function moduleFor(product: DeepProduct): string {
  return product === 'open' ? LEAGUE_DEEP_OPEN_MODULE : LEAGUE_DEEP_DEBATE_MODULE
}

function costFor(product: DeepProduct): number {
  return product === 'open' ? creditsForLeagueDeepOpen() : creditsForLeagueDeepDebate()
}

function deductFromRow(row: DeepRunRow): DeductCreditsOutcome {
  return row.deduct_skipped ? { ok: true, balance: null, skipped: true } : { ok: true, balance: null }
}

async function currentBalance(userId: string): Promise<number | undefined> {
  const { data } = await supabaseAdmin.from('users').select('credits').eq('id', userId).maybeSingle()
  return typeof data?.credits === 'number' ? data.credits : undefined
}

function replayPayload(row: DeepRunRow): NextResponse {
  const result = row.result ?? {}
  return NextResponse.json({
    ...result,
    ok: true,
    done: true,
    cached: true,
    unscored: true,
    sessionId: row.id,
    roundId: row.round_id,
    kind: row.product === 'open' ? 'open' : 'debate',
    providers: row.providers,
    created_at: row.created_at,
    upstream_cost_usd: Number((row.billed_usd + row.estimated_usd).toFixed(4)),
    billed_usd: Number(row.billed_usd.toFixed(4)),
    estimated_usd: Number(row.estimated_usd.toFixed(4)),
    provider_calls: row.provider_calls,
  })
}

function pendingPayload(row: DeepRunRow, stage: string): NextResponse {
  return NextResponse.json({
    ok: true,
    done: false,
    sessionId: row.id,
    stage,
    unscored: true,
    kind: row.product,
    roundId: row.round_id,
  })
}

function missingTableResponse(): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      error: 'Deep-analysis store is not migrated. Apply 20260818000003_league_deep_runs.sql.',
      code: 'store_unavailable',
    },
    { status: 503 }
  )
}

export async function handleDeepAnalysis(opts: {
  product: DeepProduct
  viewer: LeagueViewer
  roundId: string
  locale: LeagueLocale | null
  sessionId: string | null
}): Promise<NextResponse> {
  const { product, viewer, roundId, locale, sessionId } = opts
  const existing = await loadDeepRun(roundId, product, viewer.userId)

  if (sessionId && existing && existing.id !== sessionId) {
    return NextResponse.json({ error: 'Session not found', code: 'no_session' }, { status: 404 })
  }
  if (sessionId && !existing) {
    return NextResponse.json({ error: 'Session not found', code: 'no_session' }, { status: 404 })
  }

  const action = decideDeepRunAction(existing)

  if (action === 'replay' && existing) {
    return replayPayload(existing)
  }

  if (action === 'finish_refund' && existing) {
    await refundDeep(viewer.userId, existing.charged_cost, deductFromRow(existing))
    await saveDeepRunProgress({
      id: existing.id,
      stage: existing.stage,
      status: 'error',
      state: existing.state,
      result: existing.result,
      billedUsd: existing.billed_usd,
      estimatedUsd: existing.estimated_usd,
      providerCalls: existing.provider_calls,
      refunded: true,
    })
    return NextResponse.json(
      { ok: false, error: (existing.result?.error as string | undefined) ?? 'deep analysis failed', code: 'upstream_failed' },
      { status: 500 }
    )
  }

  if (action === 'resume' && existing) {
    if (runIsBusy(existing)) {
      return pendingPayload(existing, existing.stage)
    }
    return advancePersisted(existing, viewer.userId)
  }

  const limited = enforceRateLimit(
    viewer,
    product === 'open' ? 'league_deep_open' : 'league_deep_debate',
    LEAGUE_DEEP_RATE_RULE
  )
  if (limited) return limited

  const ctx = await buildLeagueDeepContext(roundId, locale)
  if (!ctx) {
    return NextResponse.json({ error: 'Round not found', code: 'no_round' }, { status: 404 })
  }

  const seed = product === 'open' ? seedOpenState(ctx) : seedDebateState(ctx)
  const cost = costFor(product)

  let row: DeepRunRow
  if (action === 'restart' && existing) {
    const reset = await resetDeepRun(existing.id, seed as unknown as Record<string, unknown>)
    if (!reset) return missingTableResponse()
    row = reset
  } else {
    const claimed = await insertDeepRunClaim({
      roundId,
      product,
      userId: viewer.userId,
      state: seed as unknown as Record<string, unknown>,
    })
    if ('error' in claimed) {
      return claimed.missingTable
        ? missingTableResponse()
        : NextResponse.json({ ok: false, error: claimed.error, code: 'upstream_failed' }, { status: 500 })
    }
    if (!claimed.created) {
      const raced = decideDeepRunAction(claimed.row)
      if (raced === 'replay') return replayPayload(claimed.row)
      if (raced === 'resume') {
        if (runIsBusy(claimed.row)) return pendingPayload(claimed.row, claimed.row.stage)
        return advancePersisted(claimed.row, viewer.userId)
      }
    }
    row = claimed.row
  }

  const charged = await chargeDeep(viewer.userId, cost, moduleFor(product))
  if (!charged.ok) {
    await deleteUnchargedRun(row.id)
    return charged.response
  }

  await markDeepRunCharged(row.id, cost, charged.deduct.skipped === true)
  row = {
    ...row,
    charged: true,
    charged_cost: cost,
    deduct_skipped: charged.deduct.skipped === true,
  }

  return advancePersisted(row, viewer.userId)
}

async function advancePersisted(row: DeepRunRow, userId: string): Promise<NextResponse> {
  await markDeepRunBusy(row.id)

  try {
    const span =
      row.product === 'open'
        ? await withCostSpan(() => advanceOpenState(row.state as unknown as OpenPipelineState))
        : await withCostSpan(() => advanceDebateState(row.state as unknown as DebatePipelineState))

    const totals = addSpanTotals(row, span)
    const nextState = span.result.state as unknown as Record<string, unknown>
    const providers =
      row.product === 'open'
        ? providersFromOpenState(span.result.state as OpenPipelineState)
        : providersFromDebateState(span.result.state as DebatePipelineState)

    if (span.result.done && !span.result.result.ok) {
      await refundDeep(userId, row.charged_cost, deductFromRow(row))
      await saveDeepRunProgress({
        id: row.id,
        stage: 'error',
        status: 'error',
        state: nextState,
        result: span.result.result as unknown as Record<string, unknown>,
        providers,
        ...totals,
        refunded: true,
      })
      return NextResponse.json(
        { ok: false, error: span.result.result.error ?? 'deep analysis failed', code: 'upstream_failed' },
        { status: 500 }
      )
    }

    if (!span.result.done) {
      await saveDeepRunProgress({
        id: row.id,
        stage: span.result.stage,
        status: 'running',
        state: nextState,
        providers,
        ...totals,
      })
      return pendingPayload({ ...row, stage: span.result.stage }, span.result.stage)
    }

    const result = span.result.result as unknown as Record<string, unknown>
    await saveDeepRunProgress({
      id: row.id,
      stage: 'done',
      status: 'done',
      state: nextState,
      result,
      providers,
      ...totals,
    })

    const balance = await currentBalance(userId)
    return NextResponse.json({
      ...result,
      ok: true,
      done: true,
      cached: false,
      unscored: true,
      sessionId: row.id,
      roundId: row.round_id,
      kind: row.product,
      instrument: (nextState.instrument as string | undefined) ?? row.state.instrument,
      category: (nextState.category as string | undefined) ?? row.state.category,
      proposition: (result.proposition as string | undefined) ?? row.state.proposition,
      providers,
      created_at: row.created_at,
      upstream_cost_usd: Number((totals.billedUsd + totals.estimatedUsd).toFixed(4)),
      billed_usd: Number(totals.billedUsd.toFixed(4)),
      estimated_usd: Number(totals.estimatedUsd.toFixed(4)),
      provider_calls: totals.providerCalls,
      balance,
    })
  } catch {
    // Platform kill / thrown interrupt: leave the row running at the last
    // persisted stage so the next request resumes. Do NOT refund.
    await saveDeepRunProgress({
      id: row.id,
      stage: row.stage,
      status: 'running',
      state: row.state,
      providers: row.providers,
      billedUsd: row.billed_usd,
      estimatedUsd: row.estimated_usd,
      providerCalls: row.provider_calls,
    })
    return pendingPayload(row, row.stage)
  }
}

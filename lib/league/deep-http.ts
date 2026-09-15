import { after, NextResponse } from 'next/server'
import type { DeductCreditsOutcome } from '@/lib/credits'
import { LEAGUE_DEEP_RATE_RULE } from './access-policy'
import { chargeDeep, refundDeep } from './deep-charge'
import {
  creditsForLeagueDeepDebate,
  creditsForLeagueDeepOpen,
  LEAGUE_DEEP_DEBATE_MODULE,
  LEAGUE_DEEP_OPEN_MODULE,
} from './credits'
import {
  countActiveDeepRuns,
  deleteUnchargedRun,
  insertDeepRunClaim,
  isUnseededState,
  loadDeepRun,
  markDeepRunCharged,
  markDeepRunRefundedOnce,
  resetDeepRun,
  saveDeepRunProgress,
  type DeepProduct,
  type DeepRunRow,
} from './deep-store'
import { decideDeepRunAction, placeholderUnseededState, runIsBusy } from './deep-run-policy'
import { buildDeepSnapshot } from './deep-snapshot'
import { createDeepRunnerDeps } from './generation/deep-live-deps'
import { LEAGUE_DEEP_MAX_ACTIVE } from './generation/policy'
import { advanceDeepRun } from './generation/deep-runner'
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
    stage: row.stage,
    refunded: row.refunded,
    // Full sanitized process (plan, briefs, rounds, ballot) — the terminal
    // `result` alone drops the debate transcript and per-voter ballots.
    snapshot: buildDeepSnapshot(row.product, row.state),
    upstream_cost_usd: Number((row.billed_usd + row.estimated_usd).toFixed(4)),
    billed_usd: Number(row.billed_usd.toFixed(4)),
    estimated_usd: Number(row.estimated_usd.toFixed(4)),
    provider_calls: row.provider_calls,
  })
}

function pendingPayload(row: DeepRunRow, stage: string): NextResponse {
  const waiting = !runIsBusy(row) && (row.lease_until === null || Date.parse(row.lease_until) <= Date.now())
  return NextResponse.json({
    ok: true,
    done: false,
    sessionId: row.id,
    stage,
    waiting,
    unscored: true,
    kind: row.product,
    roundId: row.round_id,
    refunded: row.refunded,
    // Partial process so the card can render each stage as it lands
    // (null until the seed hop persists the pipeline state).
    snapshot: buildDeepSnapshot(row.product, row.state),
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

function busyResponse(): NextResponse {
  return NextResponse.json(
    { error: 'Deep analysis queue is full. Try again shortly.', code: 'busy' },
    { status: 503, headers: { 'Retry-After': '60' } }
  )
}

async function finishRefund(existing: DeepRunRow, userId: string): Promise<NextResponse> {
  const won = await markDeepRunRefundedOnce(existing.id)
  if (won) await refundDeep(userId, existing.charged_cost, deductFromRow(existing))
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
    { ok: false, error: (existing.result?.error as string | undefined) ?? 'deep analysis failed', code: 'upstream_failed', refunded: true },
    { status: 500 }
  )
}

function enqueue(row: DeepRunRow): void {
  const deps = createDeepRunnerDeps((task) => after(task))
  after(async () => {
    await advanceDeepRun(row.id, deps)
  })
}

/**
 * GET — poll status. No rate limit (same as the card). Does not charge,
 * claim, or advance. Resume state is the row.
 */
export async function handleDeepStatus(opts: {
  product: DeepProduct
  viewer: LeagueViewer
  roundId: string
}): Promise<NextResponse> {
  const existing = await loadDeepRun(opts.roundId, opts.product, opts.viewer.userId)
  if (!existing) {
    return NextResponse.json({ ok: true, done: false, exists: false, kind: opts.product, roundId: opts.roundId })
  }
  if (existing.status === 'done' && existing.result) return replayPayload(existing)
  if (existing.status === 'error') {
    return NextResponse.json({
      ok: false,
      done: true,
      exists: true,
      refunded: existing.refunded,
      stage: existing.stage,
      error: (existing.result?.error as string | undefined) ?? 'deep analysis failed',
      sessionId: existing.id,
      kind: existing.product,
      roundId: existing.round_id,
      // Whatever completed before the failure — shown under the error note.
      snapshot: buildDeepSnapshot(existing.product, existing.state),
    })
  }
  return pendingPayload(existing, existing.stage)
}

/**
 * POST — claim → charge → enqueue. Hops run on the cron / after() runner.
 * Ordering from 2026-08-29 is preserved: nothing that costs money happens
 * before insertDeepRunClaim wins. The runner never charges.
 */
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
    return finishRefund(existing, viewer.userId)
  }

  if (action === 'resume' && existing) {
    if (runIsBusy(existing)) {
      return pendingPayload(existing, existing.stage)
    }
    enqueue(existing)
    return pendingPayload(existing, existing.stage)
  }

  const limited = enforceRateLimit(
    viewer,
    product === 'open' ? 'league_deep_open' : 'league_deep_debate',
    LEAGUE_DEEP_RATE_RULE
  )
  if (limited) return limited

  const active = await countActiveDeepRuns()
  if (active >= LEAGUE_DEEP_MAX_ACTIVE) return busyResponse()

  const cost = costFor(product)
  const placeholder = placeholderUnseededState(locale) as unknown as Record<string, unknown>

  let row: DeepRunRow
  if (action === 'restart' && existing) {
    const reset = await resetDeepRun(existing.id, placeholder)
    if (!reset) return missingTableResponse()
    row = reset
  } else {
    // CLAIM first. The FK on round_id IS the round-existence check.
    const claimed = await insertDeepRunClaim({
      roundId,
      product,
      userId: viewer.userId,
      state: placeholder,
    })
    if ('error' in claimed) {
      if (claimed.missingTable) return missingTableResponse()
      if (claimed.noRound) return NextResponse.json({ error: 'Round not found', code: 'no_round' }, { status: 404 })
      return NextResponse.json({ ok: false, error: claimed.error, code: 'upstream_failed' }, { status: 500 })
    }
    if (!claimed.created) {
      const raced = decideDeepRunAction(claimed.row)
      if (raced === 'replay') return replayPayload(claimed.row)
      if (raced === 'finish_refund') return finishRefund(claimed.row, viewer.userId)
      if (raced === 'resume') {
        if (runIsBusy(claimed.row)) return pendingPayload(claimed.row, claimed.row.stage)
        enqueue(claimed.row)
        return pendingPayload(claimed.row, claimed.row.stage)
      }
    }
    row = claimed.row
  }

  // CHARGE second. Only a successfully claimed (or reset) row reaches here.
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

  // BUILD CONTEXT is the runner's first hop (unseeded placeholder). Not here.
  enqueue(row)
  return pendingPayload({ ...row, stage: isUnseededState(row.state) ? 'start' : row.stage }, 'start')
}

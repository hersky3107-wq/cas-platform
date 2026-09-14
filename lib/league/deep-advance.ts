import 'server-only'

import { withCostSpan } from '@/lib/ai/cost-span'
import { buildLeagueDeepContext } from './deep-context'
import {
  addSpanTotals,
  isUnseededState,
  MAX_SEED_ATTEMPTS,
  nextUnseededState,
  saveDeepRunProgress,
  type DeepRunRow,
} from './deep-store'
import { normalizeLeagueLocale } from './i18n/locales'
import { localeFromPersistedState, runWithOutputLanguage } from './deep-output-language'
import {
  advanceDebateState,
  providersFromDebateState,
  seedDebateState,
  upcomingDebateStage,
  type DebatePipelineState,
} from './deep-debate-run'
import {
  advanceOpenState,
  providersFromOpenState,
  seedOpenState,
  upcomingOpenStage,
  type OpenPipelineState,
} from './deep-open-run'

export type DeepSeedOutcome =
  | { ok: true; row: DeepRunRow; produced: true }
  | { ok: false; retry: true; row: DeepRunRow }
  | { ok: false; giveUp: true; row: DeepRunRow }

export type DeepHopOutcome =
  | { done: false; stage: string; produced: true }
  | { done: true; ok: true; produced: true }
  | { done: true; ok: false; error: string; produced: true }

/**
 * Turns a charged-but-unseeded row into a seeded pipeline state.
 * Same 3-attempt cap as the 2026-08-29 HTTP path. Does NOT charge.
 */
export async function seedDeepRun(row: DeepRunRow): Promise<DeepSeedOutcome> {
  const localeRaw = isUnseededState(row.state) ? row.state.locale : null
  const locale = normalizeLeagueLocale(typeof localeRaw === 'string' ? localeRaw : null)

  let ctx: Awaited<ReturnType<typeof buildLeagueDeepContext>> = null
  let buildError: string | null = null
  try {
    ctx = await buildLeagueDeepContext(row.round_id, locale)
    if (!ctx) buildError = 'round not found while building context (removed after claim?)'
  } catch (e) {
    buildError = e instanceof Error ? e.message : String(e)
  }

  if (!ctx) {
    const failed = nextUnseededState(row.state, buildError ?? 'context build failed')
    if (failed.seedAttempts >= MAX_SEED_ATTEMPTS) {
      const failedRow: DeepRunRow = {
        ...row,
        status: 'error',
        stage: 'seed_failed',
        state: failed as unknown as Record<string, unknown>,
        result: { error: `seed failed after ${failed.seedAttempts} attempts: ${failed.lastSeedError}` },
      }
      await saveDeepRunProgress({
        id: row.id,
        stage: 'seed_failed',
        status: 'error',
        state: failed as unknown as Record<string, unknown>,
        result: failedRow.result,
        billedUsd: row.billed_usd,
        estimatedUsd: row.estimated_usd,
        providerCalls: row.provider_calls,
      })
      return { ok: false, giveUp: true, row: failedRow }
    }
    await saveDeepRunProgress({
      id: row.id,
      stage: 'seed_retry',
      status: 'running',
      state: failed as unknown as Record<string, unknown>,
      billedUsd: row.billed_usd,
      estimatedUsd: row.estimated_usd,
      providerCalls: row.provider_calls,
    })
    return { ok: false, retry: true, row: { ...row, stage: 'seed_retry', state: failed as unknown as Record<string, unknown> } }
  }

  const seeded = row.product === 'open' ? seedOpenState(ctx) : seedDebateState(ctx)
  const next = { ...row, stage: 'start', state: seeded as unknown as Record<string, unknown> }
  await saveDeepRunProgress({
    id: row.id,
    stage: 'start',
    status: 'running',
    state: next.state,
    billedUsd: row.billed_usd,
    estimatedUsd: row.estimated_usd,
    providerCalls: row.provider_calls,
  })
  return { ok: true, row: next, produced: true }
}

/** One pipeline hop. Persists progress. Does NOT refund — the runner owns money. */
export async function persistOneDeepHop(row: DeepRunRow): Promise<DeepHopOutcome> {
  const language = localeFromPersistedState(row.state)
  const previewStage =
    row.product === 'open'
      ? upcomingOpenStage(row.state as unknown as OpenPipelineState)
      : upcomingDebateStage(row.state as unknown as DebatePipelineState)
  await saveDeepRunProgress({
    id: row.id,
    stage: previewStage,
    status: 'running',
    state: row.state,
    providers: row.providers,
    billedUsd: row.billed_usd,
    estimatedUsd: row.estimated_usd,
    providerCalls: row.provider_calls,
  })

  const span =
    row.product === 'open'
      ? await withCostSpan(() =>
          runWithOutputLanguage(language, () => advanceOpenState(row.state as unknown as OpenPipelineState))
        )
      : await withCostSpan(() =>
          runWithOutputLanguage(language, () => advanceDebateState(row.state as unknown as DebatePipelineState))
        )

  const totals = addSpanTotals(row, span)
  const nextState = span.result.state as unknown as Record<string, unknown>
  const providers =
    row.product === 'open'
      ? providersFromOpenState(span.result.state as OpenPipelineState)
      : providersFromDebateState(span.result.state as DebatePipelineState)

  if (span.result.done && !span.result.result.ok) {
    await saveDeepRunProgress({
      id: row.id,
      stage: 'error',
      status: 'error',
      state: nextState,
      result: span.result.result as unknown as Record<string, unknown>,
      providers,
      ...totals,
    })
    return { done: true, ok: false, error: span.result.result.error ?? 'deep analysis failed', produced: true }
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
    return { done: false, stage: span.result.stage, produced: true }
  }

  await saveDeepRunProgress({
    id: row.id,
    stage: 'done',
    status: 'done',
    state: nextState,
    result: span.result.result as unknown as Record<string, unknown>,
    providers,
    ...totals,
  })
  return { done: true, ok: true, produced: true }
}

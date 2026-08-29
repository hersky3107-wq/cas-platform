import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { verifyCronAuth } from '@/lib/cron/auth'
import { generatePredictions, type RoundInput } from '@/lib/league/orchestrator'
import type { LeagueTier } from '@/lib/league/roster'
import {
  DAILY_FIXED_INSTRUMENTS,
  findFixedInstrument,
  type FixedInstrument,
} from '@/lib/league/instruments'

/**
 * Fan-out across 4 instruments × every league tier (premier/challenger/world/scout),
 * each with its own data-packet fetch + per-model calls. Give it the full
 * Vercel function budget.
 */
export const maxDuration = 300

const ALL_TIERS: LeagueTier[] = ['premier', 'challenger', 'world', 'scout']

/** Kill-switch default when LEAGUE_RUN_COST_CAP_USD is unset/invalid (mirrors orchestrator). */
const FALLBACK_COST_CAP_USD = 20

function resolveGlobalCostCap(): number {
  const raw = Number(process.env.LEAGUE_RUN_COST_CAP_USD)
  return Number.isFinite(raw) && raw > 0 ? raw : FALLBACK_COST_CAP_USD
}

// Canonical horizon codes (see lib/league/horizon.ts) → human label for the
// proposition. This opener only ever emits '1d' today (every fixed instrument
// is a daily round), but the full map keeps it correct if the set grows.
const HORIZON_LABEL: Record<string, string> = {
  '1d': '1 day',
  '1w': '7 days',
  '1m': '1 month',
  '3m': '3 months',
}

/**
 * Cache key = `daily|<instrument>|<horizon>|<UTC date YYYY-MM-DD>`. A re-run on
 * the same UTC day for the same instrument+horizon hits the unique constraint
 * and is treated as a no-op (idempotent).
 */
function buildCacheKey(inst: FixedInstrument, utcDay: string): string {
  return `daily|${inst.instrument}|${inst.horizon}|${utcDay}`
}

function buildProposition(inst: FixedInstrument): string {
  const horizonLabel = HORIZON_LABEL[inst.horizon] ?? inst.horizon
  return `Will ${inst.label} close higher ${horizonLabel} from now than its last close?`
}

function buildRoundInput(inst: FixedInstrument, now: Date): { round: RoundInput; cacheKey: string } {
  const resolvesAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString()
  const utcDay = now.toISOString().slice(0, 10)
  const cacheKey = buildCacheKey(inst, utcDay)
  return {
    round: {
      proposition_text: buildProposition(inst),
      category: inst.category,
      instrument: inst.instrument,
      horizon: inst.horizon,
      resolution_rule: inst.resolution_rule,
      resolves_at: resolvesAt,
      item_type: inst.item_type,
      cache_key: cacheKey,
    },
    cacheKey,
  }
}

async function findRoundByCacheKey(cacheKey: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('prediction_rounds')
    .select('id')
    .eq('cache_key', cacheKey)
    .maybeSingle()
  return data?.id ?? null
}

type InstrumentResult = {
  instrument: string
  label: string
  cache_key: string
  round_id: string | null
  status: 'ok' | 'skipped' | 'capped' | 'error'
  created: boolean
  total_cost_usd: number
  models?: number
  directional?: number
  error?: string
}

/**
 * POST /api/cron/league/open
 *
 * Legacy cron-secret round opener. It is NOT scheduled in `vercel.json`.
 * Additionally, requests without `?manual=1` safely no-op, so a stale external
 * schedule cannot spend provider money. Normal manual operation should use the
 * admin-only `POST /api/admin/league/generate` endpoint instead.
 *
 * With `?manual=1`, this retained operational fallback builds 1d ranked rounds
 * (canonical horizon code) for the fixed set and runs all tiers. Idempotent via
 * cache_key and cost-capped by LEAGUE_RUN_COST_CAP_USD.
 *
 * Auth: Bearer CRON_SECRET (Vercel sends this when the cron is configured with
 * an auth secret). Public callers get 401.
 *
 * Query params (optional, for manual subset testing):
 *   ?instrument=AAPL            — run only that fixed instrument
 *   ?instruments=AAPL,NVDA     — run a subset
 */
export async function POST(req: Request) {
  const authErr = verifyCronAuth(req)
  if (authErr) return authErr

  const url = new URL(req.url)
  if (url.searchParams.get('manual') !== '1') {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: 'automatic_league_generation_disabled',
    })
  }

  const instruments = selectInstruments(url)
  if (instruments.length === 0) {
    return NextResponse.json({ ok: false, error: 'No matching fixed instruments' }, { status: 400 })
  }

  const now = new Date()
  const globalCap = resolveGlobalCostCap()
  let runningTotal = 0
  let capped = false
  const results: InstrumentResult[] = []

  for (const inst of instruments) {
    if (runningTotal >= globalCap) {
      capped = true
      break
    }

    const { round: roundInput, cacheKey } = buildRoundInput(inst, now)

    // Idempotency: skip if today's round already exists.
    const existingId = await findRoundByCacheKey(cacheKey)
    if (existingId) {
      results.push({
        instrument: inst.instrument,
        label: inst.label,
        cache_key: cacheKey,
        round_id: existingId,
        status: 'skipped',
        created: false,
        total_cost_usd: 0,
      })
      continue
    }

    const remaining = globalCap - runningTotal
    try {
      const result = await generatePredictions({
        round: roundInput,
        tiers: ALL_TIERS,
        costCapUsd: remaining,
      })
      runningTotal += result.total_cost_usd
      // Any contract side token counts as an answer ('flat' is not storable —
      // two-answers law); null is abstain/timeout/error.
      const directional = result.results.filter((r) => r.direction !== null).length
      results.push({
        instrument: inst.instrument,
        label: inst.label,
        cache_key: cacheKey,
        round_id: result.round_id,
        status: result.capped ? 'capped' : 'ok',
        created: result.created,
        total_cost_usd: result.total_cost_usd,
        models: result.results.length,
        directional,
      })
      if (result.capped) {
        capped = true
        break
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'unknown error'
      // Race: another concurrent run created the round first — treat as skip.
      if (/duplicate key|23505/i.test(msg)) {
        const raceId = await findRoundByCacheKey(cacheKey)
        results.push({
          instrument: inst.instrument,
          label: inst.label,
          cache_key: cacheKey,
          round_id: raceId,
          status: 'skipped',
          created: false,
          total_cost_usd: 0,
        })
        continue
      }
      results.push({
        instrument: inst.instrument,
        label: inst.label,
        cache_key: cacheKey,
        round_id: null,
        status: 'error',
        created: false,
        total_cost_usd: 0,
        error: msg,
      })
    }
  }

  return NextResponse.json({
    ok: true,
    scanned: instruments.length,
    total_cost_usd: Number(runningTotal.toFixed(6)),
    capped,
    cost_cap_usd: globalCap,
    results,
  })
}

function selectInstruments(url: URL): FixedInstrument[] {
  const single = url.searchParams.get('instrument')
  if (single) {
    const f = findFixedInstrument(single.trim())
    return f ? [f] : []
  }
  const multi = url.searchParams.get('instruments')
  if (multi) {
    const list = multi
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => findFixedInstrument(s))
      .filter((x): x is FixedInstrument => x !== null)
    return list
  }
  return [...DAILY_FIXED_INSTRUMENTS]
}

import { after, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/server'
import { addCreditsBalance, deductCreditsBalance } from '@/lib/credits-server'
import { creditsForLeagueGenerate } from '@/lib/credits'
import { LEAGUE_GENERATE_RATE_RULE } from '@/lib/league/access-policy'
import { ensureLeagueRound } from '@/lib/league/orchestrator'
import { consumeGatewayReceipt } from '@/lib/league/gateway/charge-receipt'
import {
  countActiveGenerationJobs,
  findActiveJobForRound,
  hasPaidRoundAccess,
  insertAccessPurchase,
  insertGenerationJob,
  isRoundComplete,
  type JobInsert,
} from '@/lib/league/generation/job-store'
import { createLeagueRunnerDeps } from '@/lib/league/generation/live-deps'
import {
  decideGeneratePress,
  decisionCharges,
  decisionNeedsNewJob,
  LEAGUE_GENERATE_MODULE,
  LEAGUE_JOB_MAX_ACTIVE,
} from '@/lib/league/generation/policy'
import { advanceLeagueGenerationJob } from '@/lib/league/generation/runner'
import { normalizeLeagueLocale } from '@/lib/league/i18n/locales'
import {
  authorizeRoundForViewer,
  enforceRateLimit,
  resolveLeagueViewer,
  resolvePublicInstrumentGenerateTarget,
} from '@/lib/league/public-access'

/**
 * POST /api/league/generate — open (view-purchase) a league round. THE PAID
 * LEAGUE PATH since 2026-09-14; replaces the NDJSON generate-stream for
 * public users.
 *
 * PRICING: every round costs the same fixed credit price to VIEW — creating
 * it and opening one that already exists are the same purchase, and the
 * response never says which happened. Once paid, access is PERMANENT
 * (deep-runs model): reopening later, including after grading, never charges
 * again.
 *
 * INLINE (this request, ~1s): auth → rate limit → jurisdiction/instrument
 * gate → backpressure → charge (or receipt consume, or nothing when access
 * is already held) → round row insert if needed → job/access row insert →
 * respond with { round_id, state }.
 *
 * QUEUED (background, oracle-runner pattern): packet assembly, the 41-model
 * fan-out (chunked by tier), consensus persistence. The first chunk is
 * scheduled from THIS request via `after()` so a healthy round starts within
 * seconds; the every-minute cron (`/api/cron/league-generate`) resumes it if
 * this function dies — that is the whole point of the job table.
 *
 * ORDER OF ENFORCEMENT preserved from generate-stream: everything that can
 * reject rejects BEFORE anything that can cost money.
 */
export const runtime = 'nodejs'
export const maxDuration = 300

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

  const limited = enforceRateLimit(viewer, 'league_generate', LEAGUE_GENERATE_RATE_RULE)
  if (limited) return limited

  // ── Target: an authorized round id, or a curated instrument+horizon that
  // resolves to the open ranked round (creating its row here when none
  // exists — a fast insert from server-owned catalog metadata, no packet).
  const roundIdRaw = typeof body.roundId === 'string' ? body.roundId.trim() : ''
  const instrument = typeof body.instrument === 'string' ? body.instrument.trim() : ''
  const horizon = typeof body.horizon === 'string' && body.horizon.trim() ? body.horizon.trim() : '1d'

  let roundId: string
  if (roundIdRaw) {
    const access = await authorizeRoundForViewer(viewer, roundIdRaw)
    if (!access.ok) return access.response
    roundId = access.roundId
  } else if (instrument) {
    const target = await resolvePublicInstrumentGenerateTarget(viewer, instrument, horizon)
    if (!target.ok) return target.response
    if ('roundId' in target.round) {
      roundId = target.round.roundId
    } else {
      try {
        const { round } = await ensureLeagueRound(target.round)
        roundId = round.id
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : ''
        // Race: another press created this cache_key round first — reuse it.
        if (/duplicate key|23505/i.test(msg)) {
          const { data } = await supabaseAdmin
            .from('prediction_rounds')
            .select('id')
            .eq('cache_key', target.round.cache_key)
            .maybeSingle()
          if (!data) return NextResponse.json({ error: 'Round creation raced and lookup failed' }, { status: 500 })
          roundId = (data as { id: string }).id
        } else {
          return NextResponse.json({ error: 'Could not open the round' }, { status: 500 })
        }
      }
    }
  } else {
    return NextResponse.json(
      { error: 'Provide { roundId } or { instrument }', code: 'missing_target' },
      { status: 400 }
    )
  }

  // ── Facts → decision. `hasPaidAccess` is the permanent-access check: any
  // charged, never-refunded purchase row for (round, user).
  const [paidAccess, activeJob, roundComplete] = await Promise.all([
    hasPaidRoundAccess(roundId, viewer.userId),
    findActiveJobForRound(roundId),
    isRoundComplete(roundId),
  ])
  const decision = decideGeneratePress({
    hasPaidAccess: paidAccess,
    roundComplete,
    hasActiveJob: activeJob !== null,
  })

  // ── Global backpressure, BEFORE any charge: refuse new work when the queue
  // is deep enough that the wait would be dishonest to sell.
  if (decisionNeedsNewJob(decision)) {
    const active = await countActiveGenerationJobs()
    if (active >= LEAGUE_JOB_MAX_ACTIVE) {
      return NextResponse.json(
        { error: 'Generation queue is full. Try again shortly.', code: 'busy' },
        { status: 503, headers: { 'Retry-After': '60' } }
      )
    }
  }

  // ── Charge. Receipt first (the freeform gateway already charged and issued
  // a durable one-shot receipt); otherwise a normal deduction. Admins are
  // skipped by deductCreditsBalance itself and recorded as deduct_skipped.
  const cost = creditsForLeagueGenerate()
  const locale = normalizeLeagueLocale(typeof body.locale === 'string' ? body.locale : '') ?? 'en'
  let charged = false
  let chargedCost = 0
  let deductSkipped = false
  let balance: number | null = null

  if (decisionCharges(decision)) {
    const receiptId = typeof body.gateway_receipt === 'string' ? body.gateway_receipt.trim() : ''
    const consumed = receiptId
      ? await consumeGatewayReceipt(receiptId, viewer.userId, instrument, horizon)
      : false
    if (consumed) {
      // Money moved at the gateway; this purchase row is its ledger.
      charged = true
      chargedCost = cost
    } else {
      const deduct = await deductCreditsBalance(supabaseAdmin, viewer.userId, cost, LEAGUE_GENERATE_MODULE)
      if (!deduct.ok) {
        const insufficient = deduct.reason === 'insufficient'
        return NextResponse.json(
          {
            error: insufficient ? 'Insufficient credits' : 'Could not update credits',
            balance: deduct.balance,
            required: cost,
          },
          { status: insufficient ? 402 : 500 }
        )
      }
      deductSkipped = deduct.skipped === true
      charged = !deductSkipped
      chargedCost = deductSkipped ? 0 : cost
      balance = typeof deduct.balance === 'number' ? deduct.balance : null
    }
  } else if (typeof body.gateway_receipt === 'string' && body.gateway_receipt.trim()) {
    // The gateway charged for a round this user already owns (the gateway
    // cannot know the resolved round before charging). Consume the receipt so
    // it cannot be spent elsewhere, and give the money back.
    const consumed = await consumeGatewayReceipt(body.gateway_receipt.trim(), viewer.userId, instrument, horizon)
    if (consumed) await addCreditsBalance(supabaseAdmin, viewer.userId, cost)
  }

  // ── Purchase/job row. Any failure past this point refunds what THIS
  // request took — a crash between deduction and row insert must not eat
  // credits.
  const rowInput: JobInsert = {
    round_id: roundId,
    user_id: viewer.userId,
    locale,
    charged,
    charged_cost: chargedCost,
    deduct_skipped: deductSkipped,
  }

  try {
    if (decision === 'charge_view' || decision === 'charge_attach') {
      await insertAccessPurchase(rowInput)
      return NextResponse.json({
        ok: true,
        round_id: roundId,
        state: decision === 'charge_view' ? 'ready' : 'generating',
        ...(balance !== null ? { balance } : {}),
      })
    }

    if (decision === 'free_view' || decision === 'free_watch') {
      return NextResponse.json({
        ok: true,
        round_id: roundId,
        state: decision === 'free_view' ? 'ready' : 'generating',
      })
    }

    // charge_new_job | free_new_job
    const inserted = await insertGenerationJob(rowInput)
    if (!inserted.ok) {
      // Someone enqueued a job for this round between our facts read and this
      // insert. The user's purchase still buys permanent access — record it
      // as an access row and attach to the running job.
      if (charged || deductSkipped) await insertAccessPurchase(rowInput)
      return NextResponse.json({
        ok: true,
        round_id: roundId,
        state: 'generating',
        ...(balance !== null ? { balance } : {}),
      })
    }

    // First chunk starts NOW in this function's background (after()), so a
    // healthy round begins within seconds; the cron rescues everything else.
    const deps = createLeagueRunnerDeps((task) => after(task))
    after(async () => {
      await advanceLeagueGenerationJob(inserted.job.id, deps)
    })

    return NextResponse.json({
      ok: true,
      round_id: roundId,
      job_id: inserted.job.id,
      state: 'generating',
      ...(balance !== null ? { balance } : {}),
    })
  } catch (e: unknown) {
    if (charged && !deductSkipped && chargedCost > 0) {
      await addCreditsBalance(supabaseAdmin, viewer.userId, chargedCost)
    }
    const msg = e instanceof Error ? e.message : 'unknown error'
    // Double-press race: the paid-access unique index (migration
    // 20260914000002) rejected a SECOND live purchase row for (round, user) —
    // the other press already bought access. This press's deduction was just
    // refunded above, so the honest answer is success, not an error.
    if (/duplicate key|23505/i.test(msg)) {
      return NextResponse.json({
        ok: true,
        round_id: roundId,
        state: roundComplete ? 'ready' : 'generating',
      })
    }
    return NextResponse.json(
      { error: `Could not open the round. Nothing was charged. (${msg})`, code: 'open_failed' },
      { status: 500 }
    )
  }
}

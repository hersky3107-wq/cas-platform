/**
 * AI Prediction League — generation job policy (PURE).
 *
 * Named constants + press/stage decisions for the cron-driven round
 * generation runner. No DB, no 'server-only' — unit-testable, mirroring how
 * `lib/oracle/runner/conventions.ts` keeps the oracle runner's numbers out of
 * call sites. The lease / heartbeat / stale / attempt numbers are copied from
 * the oracle runner VERBATIM — that pattern is proven in production and the
 * whole point is to not invent a second one.
 */

/** How long a claimed lease is held before the sweeper may take it over. */
export const LEAGUE_JOB_LEASE_SECONDS = 150

/** Renew `last_heartbeat_at` + `lease_until` on this interval while models run. */
export const LEAGUE_JOB_HEARTBEAT_SECONDS = 20

/** A non-terminal job whose heartbeat is older than this is stuck. */
export const LEAGUE_JOB_STALE_HEARTBEAT_SECONDS = 60

/**
 * Consecutive fruitless lease claims tolerated before the job is closed out
 * (failed + refunded). `attempt_count` resets to 0 on any chunk that writes
 * at least one model row, so a healthy multi-tick run never trips this —
 * only a job that keeps claiming the lease and producing nothing does.
 * Same number and same reset rule as ORACLE_MAX_ATTEMPTS.
 */
export const LEAGUE_JOB_MAX_ATTEMPTS = 4

/** Jobs advanced per cron sweep. */
export const LEAGUE_JOB_SWEEP_BATCH_SIZE = 10

/**
 * GLOBAL cap on jobs being actively worked (status 'running' with a live
 * lease). Each running job fans out with the orchestrator's own concurrency
 * of 6, so 3 running jobs = at most 18 provider calls in flight — inside
 * every provider's burst tolerance, and packet assembly (the only Twelve
 * Data consumer) stays at ~a few calls per job start, far under the 55/min
 * plan cap. Jobs over the cap stay 'queued' and are claimed by a later tick;
 * the card shows the queued state, the user is never errored.
 */
export const LEAGUE_JOB_MAX_RUNNING = 3

/**
 * Press-time backpressure: with this many jobs already queued+running, a NEW
 * generation press is refused with 503 BEFORE any charge. At ~4-6 min per
 * job and 3 running at a time, job #10 would wait ~15+ minutes — refusing
 * honestly beats charging for a wait that long.
 */
export const LEAGUE_JOB_MAX_ACTIVE = 10

/**
 * Wall-clock budget for one cron tick's chunk work. The route's maxDuration
 * is 300s. This MUST exceed every roster `timeoutMs` (longest today:
 * deepseek-v4-pro at 240s) by a margin: after packet/DB
 * overhead, `now + timeout > start + budget` is otherwise true for the
 * whole tick and a leftover 240s seat is deferred forever (0-produced loop).
 * Budget = longest timeout + 60s. A 240s call launched in the first ~60s
 * still finishes inside the 300s function ceiling; remaining-time gating
 * still refuses to start a long seat into a short remainder. The one
 * overrun risk left is the orchestrator's internal one-retry on a
 * transient failure; if the platform kills the function, that model's row
 * was never written and the sweeper re-runs it.
 */
export const LEAGUE_JOB_TICK_BUDGET_MS = 300_000

/** Small margin between "may still launch" and the absolute function wall. */
export const LEAGUE_JOB_LAUNCH_DEADLINE_MS = 285_000

/** `credit_logs.module` for a round view/generation charge (pre-existing name). */
export const LEAGUE_GENERATE_MODULE = 'league_generate'

/** Client poll cadence while a generation job is queued/running. */
export const GENERATION_POLL_MS = 5_000

/**
 * Own running cap for deep-open / deep-debate — NOT shared with generation.
 * A deep hop is 8-wide (open) or a 2-round debate; three of those would
 * occupy the generation cap for ~6 minutes and stall every 30-credit
 * round. Two concurrent deep jobs + three generation jobs = 5 workers,
 * inside provider burst tolerance. Overflow deep rows stay `running`
 * with a free lease; the card/poll shows the queued wait, no error.
 */
export const LEAGUE_DEEP_MAX_RUNNING = 2

/**
 * Press-time backpressure for NEW deep purchases. At 2 running × ~6 min,
 * the 7th waiter would sit ~18 minutes — refuse before charge.
 */
export const LEAGUE_DEEP_MAX_ACTIVE = 6

/** Same 5s poll as the generation card. */
export const DEEP_POLL_MS = GENERATION_POLL_MS

/**
 * Work stages, in run order. One tier per stage keeps a tick's fan-out
 * bounded; 'packet' is not a separate wait — the first tier tick builds the
 * packet on its way in (packet assembly lives inside the orchestrator call).
 * 'view' is NOT a work stage: it marks an access-only purchase row (a user
 * buying permanent view access to a round that needed no work).
 */
export const GENERATION_STAGES = ['packet', 'premier', 'challenger', 'world', 'scout', 'finalize'] as const
export type GenerationStage = (typeof GENERATION_STAGES)[number] | 'done' | 'view'

export type GenerationJobStatus = 'queued' | 'running' | 'done' | 'failed'

export const GENERATION_ACTIVE_STATUSES: readonly GenerationJobStatus[] = ['queued', 'running']
export const GENERATION_TERMINAL_STATUSES: readonly GenerationJobStatus[] = ['done', 'failed']

/** Which roster tier a work stage runs. 'packet' runs premier (packet builds on entry). */
export function tierForStage(stage: string): 'premier' | 'challenger' | 'world' | 'scout' | null {
  if (stage === 'packet' || stage === 'premier') return 'premier'
  if (stage === 'challenger' || stage === 'world' || stage === 'scout') return stage
  return null
}

/** The stage after `stage`, or null past finalize. */
export function nextGenerationStage(stage: string): GenerationStage | null {
  if (stage === 'packet') return 'challenger' // packet tick runs the premier tier
  const order: readonly string[] = GENERATION_STAGES
  const i = order.indexOf(stage)
  if (i === -1) return null
  return (order[i + 1] as GenerationStage | undefined) ?? null
}

/**
 * What a generate/open press does, decided from three facts. PRICING (2026-09-14):
 * every round costs the same fixed credit price to VIEW — creating it and
 * opening an existing one are the same purchase, and once a user has paid,
 * access is permanent (deep-runs model). A press while a job is live NEVER
 * starts or charges a second run of the same shared roster.
 */
export type GeneratePressDecision =
  | 'free_view' // paid before, round complete — just show it
  | 'free_watch' // paid before, a job is live — attach to its progress
  | 'free_new_job' // paid before (not refunded), round incomplete — retry costs nothing
  | 'charge_view' // new purchase of a completed round — access row only
  | 'charge_attach' // new purchase while a job is live — access row, no second job
  | 'charge_new_job' // new purchase, round incomplete — charge + enqueue

export function decideGeneratePress(facts: {
  hasPaidAccess: boolean
  roundComplete: boolean
  hasActiveJob: boolean
}): GeneratePressDecision {
  if (facts.hasPaidAccess) {
    if (facts.roundComplete) return 'free_view'
    if (facts.hasActiveJob) return 'free_watch'
    return 'free_new_job'
  }
  if (facts.roundComplete) return 'charge_view'
  if (facts.hasActiveJob) return 'charge_attach'
  return 'charge_new_job'
}

/** Does this decision enqueue NEW work (and therefore hit the global cap)? */
export function decisionNeedsNewJob(decision: GeneratePressDecision): boolean {
  return decision === 'free_new_job' || decision === 'charge_new_job'
}

/** Does this decision charge the presser? */
export function decisionCharges(decision: GeneratePressDecision): boolean {
  return decision === 'charge_view' || decision === 'charge_attach' || decision === 'charge_new_job'
}

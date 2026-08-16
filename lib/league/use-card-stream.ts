'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { CAMPS, LEAGUE_TIERS, type CardData, type CardModelPrediction } from './card-types'
import { computeCardAggregates } from './card-aggregate'

export type CardStreamState = 'static' | 'connecting' | 'live' | 'reconnecting' | 'error'

export type UseCardStreamOptions = {
  roundId: string
  initialData: CardData
  /** Opt into the live generation stream for THIS round. Default false — the stored card (from `initialData`, via `GET /api/league/card`) is always what renders otherwise. */
  live?: boolean
}

/**
 * Why a live run never started. Distinct from `connection: 'error'` (which
 * means a run started and then broke): the paid path can be REFUSED before any
 * compute — 402 insufficient credits, 429 rate limited, 403 jurisdiction — and
 * a user who was refused deserves to be told which, not "connection lost".
 */
export type CardStreamStartError = {
  status: number
  /** Present on a 402, straight from the standard credits error body. */
  balance?: number
  required?: number
  /** Present on a 429. */
  retryAfterSec?: number
}

export type UseCardStreamResult = {
  data: CardData
  connection: CardStreamState
  /** Non-null when the live run was refused before it began. Cleared on the next attempt. */
  startError: CardStreamStartError | null
  /** Re-pull the current stored state from the DB. Also fires automatically on reconnect. */
  refetch: () => Promise<void>
  /**
   * Live-only progress info, for a lightweight "N of rosterSize answered"
   * indicator. `null` outside an active live run (including once it
   * completes) — `data.models.length` is the durable "how many models does
   * this round have" answer at every other time.
   */
  liveProgress: { answered: number; rosterSize: number } | null
}

type RoundLine = { type: 'round'; round_id: string; created: boolean; roster_size: number }
type ModelLine = CardModelPrediction & { type: 'model'; status: 'ok' | 'abstain' | 'timeout' | 'error' }
type DoneLine = { type: 'done'; round_id: string; total_cost_usd: number; capped: boolean }
type ErrorLine = { type: 'error'; error: string }
type StreamLine = RoundLine | ModelLine | DoneLine | ErrorLine

function isStreamLine(v: unknown): v is StreamLine {
  return !!v && typeof v === 'object' && typeof (v as { type?: unknown }).type === 'string'
}

const TIER_ORDER = new Map(LEAGUE_TIERS.map((t, i) => [t, i]))
const CAMP_ORDER = new Map(CAMPS.map((c, i) => [c, i]))

/** Stable final layout: tier first, then camp. Arrival order (used while `connection === 'live'`) is transient. */
function sortByTierThenCamp(models: CardModelPrediction[]): CardModelPrediction[] {
  return [...models].sort((a, b) => {
    const t = (TIER_ORDER.get(a.league_tier) ?? 99) - (TIER_ORDER.get(b.league_tier) ?? 99)
    if (t !== 0) return t
    return (CAMP_ORDER.get(a.camp) ?? 99) - (CAMP_ORDER.get(b.camp) ?? 99)
  })
}

/**
 * Merge one arriving model into `prev` by `model_id` — a Map guarantees a
 * re-delivered model (e.g. the stream re-sends, or a concurrent refetch
 * already added it) REPLACES its existing entry instead of appending a
 * duplicate. Recomputes aggregates via the exact same shared pure function
 * `buildCardData` uses (`computeCardAggregates`) — see that function's doc
 * comment for why this is not a second definition of "majority"/"hit rate".
 *
 * Exported (not just used internally) so the merge/dedup/aggregate-recompute
 * contract can be unit-tested without rendering the hook — see
 * `__tests__/use-card-stream.test.ts`.
 */
export function mergeModel(prev: CardData, incoming: CardModelPrediction): CardData {
  const byId = new Map(prev.models.map((m) => [m.model_id, m] as const))
  byId.set(incoming.model_id, incoming)
  const models = Array.from(byId.values())
  return { ...prev, models, ...computeCardAggregates(models, prev.round.resolved_at) }
}

/** Exported for the same reason as `mergeModel` — see its doc comment. */
export function resort(prev: CardData): CardData {
  const models = sortByTierThenCamp(prev.models)
  return { ...prev, models, ...computeCardAggregates(models, prev.round.resolved_at) }
}

/**
 * AI Prediction League — STREAM HOOK (Layer 4).
 *
 * THE CONTRACT: the DATABASE is always the source of truth for a round.
 *  - Every "model" line from the live stream is emitted only AFTER that
 *    model's row is already persisted (see orchestrator.ts's `onModelResult`
 *    doc comment) — this hook never displays unsaved state.
 *  - If the live connection drops — mobile background, screen lock, flaky
 *    network, or the stream simply errors — this hook falls back to
 *    `refetch()` (`GET /api/league/card`) and REPLACES `data` wholesale with
 *    the DB's current view. The UI always converges back to ground truth.
 *  - Reconnect/refetch merges are idempotent: a model that already arrived
 *    via the stream and then reappears in a GET response is the same object
 *    keyed by the same `model_id` — replacing it is a no-op in practice, and
 *    never produces a duplicate row.
 *
 * WHAT'S REAL:
 *  - Initial render from server-supplied `initialData` (no client-side
 *    aggregation on mount — every aggregate already lives on `CardData`).
 *  - `refetch()`, wired to fire automatically on `visibilitychange` (tab/app
 *    foregrounded again) and `online` (network restored) — independent of
 *    whether `live` is even true, so a purely static card still self-heals.
 *  - When `live` is true: opens `POST /api/league/generate-stream` for this
 *    round, consumes the NDJSON body (same line-buffering convention as
 *    `app/modes/compare/page.tsx`'s consumption of `/api/ai-compare`), and
 *    merges each arriving model in as it completes.
 *
 * SCOPE: `live` is an explicit opt-in per render (see `PredictionCard`'s
 * `live` prop). Nothing here or upstream ever flips it on by default — the
 * stored/cached path (`initialData` from `GET /api/league/card`) remains
 * what every normal card view renders.
 */
export function useCardStream({ roundId, initialData, live = false }: UseCardStreamOptions): UseCardStreamResult {
  const [data, setData] = useState<CardData>(initialData)
  const [connection, setConnection] = useState<CardStreamState>('static')
  const [startError, setStartError] = useState<CardStreamStartError | null>(null)
  const [liveProgress, setLiveProgress] = useState<{ answered: number; rosterSize: number } | null>(null)
  const roundIdRef = useRef(roundId)
  useEffect(() => {
    roundIdRef.current = roundId
  }, [roundId])

  const refetch = useCallback(async () => {
    try {
      const res = await fetch(`/api/league/card?round_id=${encodeURIComponent(roundIdRef.current)}`, {
        credentials: 'include',
      })
      if (!res.ok) throw new Error(`league card refetch failed: ${res.status}`)
      const fresh = (await res.json()) as CardData
      setData(fresh)
      setConnection((prev) => (prev === 'live' || prev === 'connecting' ? prev : 'static'))
    } catch {
      setConnection('error')
    }
  }, [])

  // Reconnect-from-DB contract: whenever the tab/app returns to the
  // foreground or the network comes back, re-hydrate from the DB instead of
  // trusting whatever partial state a dropped connection left behind. This
  // is intentionally independent of the live-stream path below.
  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState === 'visible') void refetch()
    }
    function onOnline() {
      void refetch()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('online', onOnline)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('online', onOnline)
    }
  }, [refetch])

  useEffect(() => {
    if (!live) return

    const abortController = new AbortController()
    let cancelled = false
    let sawDone = false

    async function run() {
      setConnection('connecting')
      setStartError(null)
      setLiveProgress(null)
      let answered = 0
      try {
        const res = await fetch('/api/league/generate-stream', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roundId: roundIdRef.current }),
          signal: abortController.signal,
        })
        if (!res.ok || !res.body) {
          // Refused before any compute (402 / 429 / 403 / 401). The body is the
          // route's standard JSON error shape; keep the numbers so the caller
          // can say "needs 7, you have 3" instead of a generic failure.
          const detail = (await res.json().catch(() => null)) as
            | { balance?: number; required?: number; retryAfterSec?: number }
            | null
          setStartError({
            status: res.status,
            balance: typeof detail?.balance === 'number' ? detail.balance : undefined,
            required: typeof detail?.required === 'number' ? detail.required : undefined,
            retryAfterSec: typeof detail?.retryAfterSec === 'number' ? detail.retryAfterSec : undefined,
          })
          throw new Error(`live stream failed to start: ${res.status}`)
        }

        setConnection('live')
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''
          for (const line of lines) {
            if (!line.trim()) continue
            let msg: unknown
            try {
              msg = JSON.parse(line)
            } catch {
              continue
            }
            if (!isStreamLine(msg)) continue

            if (msg.type === 'round') {
              setLiveProgress({ answered, rosterSize: msg.roster_size })
            } else if (msg.type === 'model') {
              const { type: _type, status: _status, ...model } = msg
              void _type
              void _status
              answered += 1
              setLiveProgress((prev) => (prev ? { ...prev, answered } : { answered, rosterSize: answered }))
              setData((prev) => mergeModel(prev, model))
            } else if (msg.type === 'done') {
              sawDone = true
              setData((prev) => resort(prev))
            } else if (msg.type === 'error') {
              throw new Error(msg.error)
            }
          }
        }

        if (!cancelled) {
          setConnection('static')
          setLiveProgress(null)
          if (!sawDone) {
            // Stream closed without a "done" line (dropped mid-run) — DB may
            // hold models this connection never told us about. Converge.
            void refetch()
          }
        }
      } catch (e: unknown) {
        if (cancelled || abortController.signal.aborted) return
        setConnection('error')
        setLiveProgress(null)
        // Hard contract: any drop/error falls back to the DB, never leaves
        // the UI stuck on a partial live view.
        void refetch()
        void e
      }
    }

    void run()
    return () => {
      cancelled = true
      abortController.abort()
    }
  }, [live, roundId, refetch])

  return { data, connection, startError, refetch, liveProgress }
}
